/**
 * xreserve-inbound-tracking.ts — the persistence boundary for tracking ONE
 * already-submitted Ethereum USDC → Cardano USDCx xReserve deposit.
 *
 * TRACKING INFRASTRUCTURE ONLY. Nothing here builds, signs or submits a
 * transaction, and nothing here makes a cross-chain swap executable. It stores
 * what the one-shot status coordinator (xreserve-inbound-status.ts) needs to
 * resume, and runs that coordinator once per call.
 *
 * STORAGE IS INJECTED. `InboundTrackingStore` is a plain load/save port over
 * JSON text; no platform store is chosen here. The record holds ONLY resume
 * evidence: wallet/account/environment identity, the approved sender, the
 * source transaction hash, the approved recipient / amount / fee cap as decimal
 * strings, the confirmation depths, the Cardano tip captured at submission and
 * both scan cursors. Never calldata, CBOR, signatures, keys or an executable
 * intent — the schema is closed, and a loaded record with any other field is
 * refused as corrupt.
 *
 * NO MANUFACTURED STATE. Tracking starts only from the Cardano tip the caller
 * captured AT SUBMISSION. A missing, corrupt or mismatched record is a typed
 * tracking error returned before any network read; it is never re-created from
 * the current tip and never read as "awaiting mint", a failed deposit or a refund.
 *
 * PERSIST BEFORE REPORTING. `checkAndPersistXReserveInbound` saves the cursors
 * the coordinator returned before it returns the status. When that save fails,
 * the result says so (`save-failed`, with the status still attached): the stored
 * record still holds the previous cursors, so the next call re-scans from there.
 */

import {
  checkXReserveInboundStatus, startXReserveInboundTracking,
  type InboundReads, type InboundStatus,
} from './xreserve-inbound-status'
import { buildCardanoDepositRequest, XReserveCardanoError, type CardanoDepositInput } from './xreserve-cardano-deposit'
import { readMintScanCursor, type MintScanCursor } from './xreserve-cardano-mint-locator'
import { readMintAuditCursor, type MintAuditCursor } from './xreserve-cardano-mint-audit'
import { xreserveNetworkFor, type XReserveNetwork } from './xreserve-network'

// ── Port ──────────────────────────────────────────────────────────────────────

/** Injected storage. `load` resolves null when no record exists under `key`. */
export interface InboundTrackingStore {
  load(key: string): Promise<string | null>
  save(key: string, json: string): Promise<void>
}

// ── Record ────────────────────────────────────────────────────────────────────

/**
 * The wallet environment. Each maps to ONE pinned xReserve profile:
 * mainnet → Ethereum mainnet / Cardano mainnet; testnet → Ethereum Sepolia /
 * Cardano Preprod (xreserve-network.ts). The record binds it, so a testnet
 * record can never be checked or resumed as mainnet, or the reverse.
 */
export type TrackingEnvironment = 'mainnet' | 'testnet'

/** The xReserve profile a tracking environment uses. */
export const trackingNetwork = (environment: TrackingEnvironment): XReserveNetwork => xreserveNetworkFor(environment === 'testnet')

export interface TrackingIdentity {
  walletId: string
  accountId: string
  environment: TrackingEnvironment
}

export interface XReserveInboundRecord {
  v: 1
  kind: 'xreserve-inbound-tracking'
  identity: TrackingIdentity
  /** Lower-case 0x address that sent the Ethereum deposit. */
  approvedSender: string
  /** Lower-case Ethereum source transaction hash. */
  sourceTxHash: string
  /** The approval, as decimal base-unit strings. */
  approved: { recipient: string; amountRaw: string; maxFeeRaw: string }
  confirmations: { ethereum: number; cardano: number }
  cardanoTipAtSubmission: { blockHeight: number }
  cursors: { locator: MintScanCursor; audit: MintAuditCursor }
}

/** The deposit a caller expects a record to describe. */
export interface TrackedDeposit {
  identity: TrackingIdentity
  approvedSender: string
  sourceTxHash: string
  approved: CardanoDepositInput
}

export type TrackingRecordErrorCode =
  /** The caller's own arguments are unusable. */
  | 'invalid-input'
  /** No record is stored for this deposit. Tracking was never started (or the store lost it). */
  | 'record-missing'
  /** The stored text is not a well-formed, closed tracking record. */
  | 'record-corrupt'
  /** The record belongs to another wallet, account or environment. */
  | 'identity-mismatch'
  /** The record is for another sender, source transaction, recipient, amount or fee cap. */
  | 'approval-mismatch'
  /** A record exists for this deposit but was started with different depths or submission tip. */
  | 'start-mismatch'
  /** The store could not be read. */
  | 'load-failed'
  /** The store could not be written. */
  | 'save-failed'

export interface TrackingRecordError {
  kind: 'tracking-error'
  code: TrackingRecordErrorCode
  reason: string
}

const HASH_RE = /^0x[0-9a-f]{64}$/
const ADDRESS_RE = /^0x[0-9a-f]{40}$/
const POSITIVE_RE = /^[1-9][0-9]*$/
const NON_NEGATIVE_RE = /^(0|[1-9][0-9]*)$/

const error = (code: TrackingRecordErrorCode, reason: string): TrackingRecordError => ({ kind: 'tracking-error', code, reason })
const isError = (v: unknown): v is TrackingRecordError => typeof v === 'object' && v !== null && (v as { kind?: unknown }).kind === 'tracking-error'
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const exactKeys = (o: Record<string, unknown>, keys: string[]) =>
  Object.keys(o).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(o, k))
const positiveInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1
const nonNegativeInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200 && v.trim() === v

/** Storage key for one deposit. Contains no secret. */
export function inboundTrackingKey(identity: TrackingIdentity, sourceTxHash: string): string {
  return `xreserve-inbound:v1:${identity.environment}:${identity.walletId}:${identity.accountId}:${sourceTxHash.toLowerCase()}`
}

/** The approval as decimal strings, or an error reason. Uses the deposit builder's own rules. */
function normalizeApproval(approved: CardanoDepositInput, network: XReserveNetwork): XReserveInboundRecord['approved'] | string {
  if (!isObj(approved)) return 'the approval is missing'
  try {
    buildCardanoDepositRequest(approved, network)   // validation only; the call it builds is discarded, never stored
  } catch (e) {
    return e instanceof XReserveCardanoError ? `the approval is invalid: ${e.message}` : 'the approval is invalid'
  }
  return { recipient: approved.recipient, amountRaw: BigInt(approved.amountRaw).toString(), maxFeeRaw: BigInt(approved.maxFeeRaw).toString() }
}

interface NormalizedDeposit {
  identity: TrackingIdentity
  approvedSender: string
  sourceTxHash: string
  approved: XReserveInboundRecord['approved']
}

function normalizeDeposit(d: TrackedDeposit): NormalizedDeposit | TrackingRecordError {
  if (!isObj(d)) return error('invalid-input', 'no deposit')
  const id = d.identity
  if (!isObj(id) || !nonEmpty(id.walletId) || !nonEmpty(id.accountId) || (id.environment !== 'mainnet' && id.environment !== 'testnet')) {
    return error('invalid-input', 'the wallet identity must name a wallet, an account and the mainnet or testnet environment')
  }
  const environment: TrackingEnvironment = id.environment
  if (typeof d.approvedSender !== 'string' || !ADDRESS_RE.test(d.approvedSender.toLowerCase())) {
    return error('invalid-input', 'the approved sender is not an Ethereum address')
  }
  if (typeof d.sourceTxHash !== 'string' || !HASH_RE.test(d.sourceTxHash.toLowerCase())) {
    return error('invalid-input', 'the source transaction hash is malformed')
  }
  const approved = normalizeApproval(d.approved, trackingNetwork(environment))
  if (typeof approved === 'string') return error('invalid-input', approved)
  return {
    identity: { walletId: id.walletId, accountId: id.accountId, environment },
    approvedSender: d.approvedSender.toLowerCase(),
    sourceTxHash: d.sourceTxHash.toLowerCase(),
    approved,
  }
}

/**
 * Parse stored JSON into a record, refusing anything that is not exactly one:
 * unknown fields, malformed values, an invalid approval or cursors bound to
 * another deposit.
 */
export function parseInboundTrackingRecord(json: string): XReserveInboundRecord | null {
  let raw: unknown
  try { raw = JSON.parse(json) } catch { return null }
  if (!isObj(raw) || !exactKeys(raw, ['v', 'kind', 'identity', 'approvedSender', 'sourceTxHash', 'approved', 'confirmations', 'cardanoTipAtSubmission', 'cursors'])) return null
  if (raw.v !== 1 || raw.kind !== 'xreserve-inbound-tracking') return null
  const { identity, approved, confirmations, cardanoTipAtSubmission: tip, cursors } = raw
  if (!isObj(identity) || !exactKeys(identity, ['walletId', 'accountId', 'environment'])) return null
  if (!isObj(approved) || !exactKeys(approved, ['recipient', 'amountRaw', 'maxFeeRaw'])) return null
  if (!isObj(confirmations) || !exactKeys(confirmations, ['ethereum', 'cardano'])) return null
  if (!isObj(tip) || !exactKeys(tip, ['blockHeight']) || !nonNegativeInt(tip.blockHeight)) return null
  if (!isObj(cursors) || !exactKeys(cursors, ['locator', 'audit'])) return null
  if (!positiveInt(confirmations.ethereum) || !positiveInt(confirmations.cardano)) return null
  if (typeof raw.approvedSender !== 'string' || !ADDRESS_RE.test(raw.approvedSender)) return null
  if (typeof raw.sourceTxHash !== 'string' || !HASH_RE.test(raw.sourceTxHash)) return null
  if (typeof approved.recipient !== 'string' || typeof approved.amountRaw !== 'string' || typeof approved.maxFeeRaw !== 'string'
      || !POSITIVE_RE.test(approved.amountRaw) || !NON_NEGATIVE_RE.test(approved.maxFeeRaw)) return null

  const deposit = normalizeDeposit({
    identity: identity as unknown as TrackingIdentity,
    approvedSender: raw.approvedSender, sourceTxHash: raw.sourceTxHash,
    approved: { recipient: approved.recipient, amountRaw: approved.amountRaw, maxFeeRaw: approved.maxFeeRaw },
  })
  if (isError(deposit)) return null

  const locator = readMintScanCursor(cursors.locator)
  const audit = readMintAuditCursor(cursors.audit, trackingNetwork(deposit.identity.environment))
  if (!locator || !exactKeys(cursors.locator as Record<string, unknown>, ['v', 'recipient', 'sourceTxHash', 'blockHeight', 'txIndex'])) return null
  if (!audit || !exactKeys(cursors.audit as Record<string, unknown>, ['v', 'kind', 'asset', 'recipient', 'sourceTxHash', 'blockHeight', 'txIndex'])) return null
  for (const c of [locator, audit]) {
    if (c.recipient !== deposit.approved.recipient || c.sourceTxHash.toLowerCase() !== deposit.sourceTxHash) return null
  }
  return {
    v: 1, kind: 'xreserve-inbound-tracking', ...deposit,
    confirmations: { ethereum: confirmations.ethereum as number, cardano: confirmations.cardano as number },
    cardanoTipAtSubmission: { blockHeight: tip.blockHeight },
    cursors: { locator, audit },
  }
}

/** Load the record for `deposit` and check it is bound to exactly that deposit. */
async function loadBound(deposit: NormalizedDeposit, store: InboundTrackingStore): Promise<XReserveInboundRecord | null | TrackingRecordError> {
  let json: string | null
  try {
    json = await store.load(inboundTrackingKey(deposit.identity, deposit.sourceTxHash))
  } catch {
    return error('load-failed', 'the tracking store could not be read')
  }
  if (json === null || json === undefined) return null
  if (typeof json !== 'string') return error('record-corrupt', 'the stored tracking record is not text')
  const record = parseInboundTrackingRecord(json)
  if (!record) return error('record-corrupt', 'the stored tracking record is corrupt; it needs recovery, not a fresh start')
  const a = record.identity, b = deposit.identity
  if (a.walletId !== b.walletId || a.accountId !== b.accountId || a.environment !== b.environment) {
    return error('identity-mismatch', 'the stored tracking record belongs to another wallet, account or environment')
  }
  if (record.approvedSender !== deposit.approvedSender || record.sourceTxHash !== deposit.sourceTxHash
      || record.approved.recipient !== deposit.approved.recipient || record.approved.amountRaw !== deposit.approved.amountRaw
      || record.approved.maxFeeRaw !== deposit.approved.maxFeeRaw) {
    return error('approval-mismatch', 'the stored tracking record describes a different sender, transaction, recipient, amount or fee cap')
  }
  return record
}

async function save(record: XReserveInboundRecord, store: InboundTrackingStore): Promise<TrackingRecordError | null> {
  try {
    await store.save(inboundTrackingKey(record.identity, record.sourceTxHash), JSON.stringify(record))
    return null
  } catch {
    return error('save-failed', 'the tracking store could not be written')
  }
}

// ── Start tracking ────────────────────────────────────────────────────────────

export interface StartTrackingInput extends TrackedDeposit {
  confirmations: { ethereum: number; cardano: number }
  /** The Cardano tip captured when the Ethereum deposit was submitted. Required; never the current tip. */
  cardanoTipAtSubmission: { blockHeight: number }
}

export type StartTrackingResult =
  | { kind: 'started'; record: XReserveInboundRecord }
  /** The same deposit is already tracked; the stored record (and its progress) is kept. */
  | { kind: 'already-tracking'; record: XReserveInboundRecord }
  | TrackingRecordError

/**
 * Start tracking an ALREADY submitted deposit. Idempotent: calling it again
 * with the same arguments returns the stored record untouched, so scan progress
 * is never reset. A stored record that is corrupt or disagrees is reported,
 * never overwritten.
 */
export async function startXReserveInboundTrackingRecord(input: StartTrackingInput, store: InboundTrackingStore): Promise<StartTrackingResult> {
  const deposit = normalizeDeposit(input)
  if (isError(deposit)) return deposit
  const depth = input.confirmations
  if (!isObj(depth) || !positiveInt(depth.ethereum) || !positiveInt(depth.cardano)) {
    return error('invalid-input', 'confirmation depths must be positive integers')
  }
  const tip = input.cardanoTipAtSubmission
  if (!isObj(tip) || !nonNegativeInt(tip.blockHeight)) {
    return error('invalid-input', 'the Cardano tip captured at submission is required; it is never taken from the current chain')
  }

  const existing = await loadBound(deposit, store)
  if (isError(existing)) return existing
  if (existing) {
    if (existing.confirmations.ethereum !== depth.ethereum || existing.confirmations.cardano !== depth.cardano
        || existing.cardanoTipAtSubmission.blockHeight !== tip.blockHeight) {
      return error('start-mismatch', 'this deposit is already tracked with different depths or a different submission tip')
    }
    return { kind: 'already-tracking', record: existing }
  }

  const seeded = startXReserveInboundTracking(
    deposit.approved.recipient, deposit.sourceTxHash, { blockHeight: tip.blockHeight }, trackingNetwork(deposit.identity.environment))
  const record: XReserveInboundRecord = {
    v: 1, kind: 'xreserve-inbound-tracking', ...deposit,
    confirmations: { ethereum: depth.ethereum, cardano: depth.cardano },
    cardanoTipAtSubmission: seeded.cardanoTipAtSubmission,
    cursors: { locator: seeded.locatorCursor, audit: seeded.auditCursor },
  }
  const failed = await save(record, store)
  return failed ?? { kind: 'started', record }
}

// ── Check and persist ─────────────────────────────────────────────────────────

export interface CheckTrackingInput extends TrackedDeposit {
  /** Run the global USDCx audit's network reads on this call. */
  auditDue: boolean
}

export type CheckTrackingResult =
  /**
   * The coordinator ran. `status` is its typed result, unchanged; `persisted`
   * says whether new cursors were saved ('saved') or none had moved ('unchanged').
   */
  | { kind: 'checked'; status: InboundStatus; record: XReserveInboundRecord; persisted: 'saved' | 'unchanged' }
  /**
   * The coordinator ran but its cursors could NOT be saved. `status` is still
   * the true status of this call; the stored record keeps the previous cursors,
   * so progress from this call is not resumable.
   */
  | { kind: 'save-failed'; status: InboundStatus; reason: string }
  | TrackingRecordError

/**
 * One status check for a tracked deposit: load and bind the record, run the
 * coordinator (which re-reads Ethereum every time), and save the returned
 * cursors before returning.
 */
export async function checkAndPersistXReserveInbound(
  input: CheckTrackingInput, reads: InboundReads, store: InboundTrackingStore,
): Promise<CheckTrackingResult> {
  const deposit = normalizeDeposit(input)
  if (isError(deposit)) return deposit
  if (typeof input.auditDue !== 'boolean') return error('invalid-input', 'auditDue must be true or false')

  const record = await loadBound(deposit, store)
  if (record === null) return error('record-missing', 'this deposit is not tracked; start tracking with the Cardano tip captured at submission')
  if (isError(record)) return record

  const status = await checkXReserveInboundStatus({
    sourceTxHash: record.sourceTxHash,
    approvedSender: record.approvedSender,
    approved: { recipient: record.approved.recipient, amountRaw: BigInt(record.approved.amountRaw), maxFeeRaw: BigInt(record.approved.maxFeeRaw) },
    confirmations: { ...record.confirmations },
    tracking: {
      cardanoTipAtSubmission: { ...record.cardanoTipAtSubmission },
      locatorCursor: { ...record.cursors.locator },
      auditCursor: { ...record.cursors.audit },
    },
    auditDue: input.auditDue,
    network: trackingNetwork(record.identity.environment),
  }, reads)

  const next: XReserveInboundRecord = {
    ...record,
    cursors: {
      locator: status.cursors.locator ?? record.cursors.locator,
      audit: status.cursors.audit ?? record.cursors.audit,
    },
  }
  if (JSON.stringify(next.cursors) === JSON.stringify(record.cursors)) {
    return { kind: 'checked', status, record, persisted: 'unchanged' }
  }
  // Re-validate what is about to be written, as a load would.
  if (!parseInboundTrackingRecord(JSON.stringify(next))) {
    return { kind: 'save-failed', status, reason: 'the returned cursors do not belong to this deposit; nothing was saved' }
  }
  const failed = await save(next, store)
  if (failed) return { kind: 'save-failed', status, reason: failed.reason }
  return { kind: 'checked', status, record: next, persisted: 'saved' }
}
