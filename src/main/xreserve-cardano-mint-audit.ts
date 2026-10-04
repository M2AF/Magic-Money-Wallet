/**
 * xreserve-cardano-mint-audit.ts — a GLOBAL, read-only audit for one known
 * Ethereum → Cardano xReserve deposit, over every transaction of the pinned
 * mainnet USDCx asset.
 *
 * WHY IT EXISTS. The recipient-address locator (xreserve-cardano-mint-locator.ts)
 * only sees transactions touching the approved address, so a mint of this
 * deposit paid ONLY to another address is invisible to it. This audit walks
 * the USDCx asset's own history instead (Blockfrost-style
 * `GET /assets/{unit}/transactions?order=asc&from=block:index`, inclusive), so
 * that case surfaces as a `mint-conflict`. That history includes every USDCx
 * TRANSFER, not only mints, so it is much busier than one address: run it less
 * often than the locator. It is deliberately a separate module with its own
 * cursor; nothing here changes the locator.
 *
 * A candidate is judged only through the typed proof API —
 * `validateXReserveAttestation` once per poll, `evaluateMintCandidate` per
 * transaction — never by amount, timing or "USDCx moved" alone.
 *
 * TRUST BOUNDARY — what the caller must guarantee:
 *   • `attestation.response` is Circle's `GET /v1/attestations?txHash=` answer
 *     fetched for `attestation.requestedTxHash`, which must equal the deposit's
 *     own source transaction hash (Circle's response does not name it, so this
 *     binding is a caller contract, enforced here as two equal hashes).
 *   • The reader is backed by a TRUSTED Cardano provider, returns CONFIRMED
 *     transactions only with their block heights, and scopes
 *     `assetTransactions` to the unit it is given. This module accepts no CBOR
 *     as an argument: every candidate comes from the reader's asset history, and
 *     a mint counts only once the reader's tip puts it at the required depth.
 *   • The starting cursor is the Cardano tip captured when the Ethereum deposit
 *     was submitted; the mint cannot precede it.
 *
 * WHAT IT NEVER CONCLUDES: reaching today's end of the asset history means "no
 * match yet", never a terminal failure — a later poll checks newer transactions.
 */

import {
  validateXReserveAttestation, evaluateMintCandidate,
  type MintConflictCode, type VerifiedMintProof, type MintProofInput,
} from './xreserve-cardano-mint-proof'
import { encodeCardanoRecipient, XReserveCardanoError } from './xreserve-cardano-deposit'
import { xreserveNetwork, XRESERVE_MAINNET, type XReserveNetwork } from './xreserve-network'

/** The asset audited on mainnet: Circle's mainnet USDCx, by full unit. Other networks use their profile's unit. */
export const AUDITED_ASSET_UNIT = XRESERVE_MAINNET.cardano.usdcxUnit
/** Candidate transactions read per poll. */
export const AUDIT_CANDIDATES_PER_POLL = 20

// ── The injected reader ───────────────────────────────────────────────────────

export interface AssetTxRow { txHash: string; blockHeight: number; txIndex: number }
export interface ConfirmedAssetTx { txHash: string; blockHeight: number; cbor: string }
export type AuditOutputs = NonNullable<MintProofInput['cardanoOutputs']>

/** Raised by a reader for a provider problem; anything thrown is treated alike. */
export class AuditReaderError extends Error {
  constructor(readonly kind: 'rate-limited' | 'unavailable' | 'malformed' | 'not-found', message?: string) {
    super(message ?? kind)
  }
}

export interface UsdcxAssetReader {
  /**
   * The asset's transactions in ascending chain order, starting AT
   * (blockHeight, txIndex) inclusive, at most `count` rows.
   */
  assetTransactions(assetUnit: string, from: { blockHeight: number; txIndex: number }, count: number): Promise<AssetTxRow[]>
  confirmedTransaction(txHash: string): Promise<ConfirmedAssetTx>
  transactionOutputs(txHash: string): Promise<AuditOutputs>
  tip(): Promise<{ blockHeight: number }>
}

// ── Cursor ────────────────────────────────────────────────────────────────────

/**
 * Serializable position: every USDCx transaction at or before (blockHeight,
 * txIndex) has been checked and is not this deposit's mint. txIndex -1 means
 * "nothing in that block checked yet". Bound to one asset, deposit and recipient.
 */
export interface MintAuditCursor {
  v: 1
  kind: 'usdcx-asset-audit'
  asset: string
  recipient: string
  sourceTxHash: string
  blockHeight: number
  txIndex: number
}

/** The cursor to store when the Ethereum deposit is submitted: the Cardano tip block, inclusive. */
export function startMintAuditCursor(
  recipient: string, sourceTxHash: string, tipAtSubmission: { blockHeight: number }, network?: XReserveNetwork,
): MintAuditCursor {
  return {
    v: 1, kind: 'usdcx-asset-audit', asset: xreserveNetwork(network).cardano.usdcxUnit, recipient,
    sourceTxHash: sourceTxHash.toLowerCase(), blockHeight: tipAtSubmission.blockHeight, txIndex: -1,
  }
}

/** Read a stored cursor back, refusing anything that is not one for the network's USDCx (mainnet by default). */
export function readMintAuditCursor(value: unknown, network?: XReserveNetwork): MintAuditCursor | null {
  if (!value || typeof value !== 'object') return null
  const unit = xreserveNetwork(network).cardano.usdcxUnit
  const c = value as Record<string, unknown>
  if (c.v !== 1 || c.kind !== 'usdcx-asset-audit' || c.asset !== unit) return null
  if (typeof c.recipient !== 'string' || typeof c.sourceTxHash !== 'string') return null
  if (!Number.isSafeInteger(c.blockHeight) || (c.blockHeight as number) < 0) return null
  if (!Number.isSafeInteger(c.txIndex) || (c.txIndex as number) < -1) return null
  return {
    v: 1, kind: 'usdcx-asset-audit', asset: unit, recipient: c.recipient,
    sourceTxHash: c.sourceTxHash, blockHeight: c.blockHeight as number, txIndex: c.txIndex as number,
  }
}

const ahead = (a: { blockHeight: number; txIndex: number }, b: { blockHeight: number; txIndex: number }) =>
  a.blockHeight > b.blockHeight || (a.blockHeight === b.blockHeight && a.txIndex > b.txIndex)

// ── Result ────────────────────────────────────────────────────────────────────

export type MintAuditState =
  /** Verified mint to the approved address, at the required depth. Terminal. */
  | 'minted'
  /** Circle has not attested the deposit yet. Poll again. */
  | 'awaiting-attestation'
  /** Nothing matching so far. `scanComplete` says whether today's end of the asset history was reached. Poll again. */
  | 'no-match-yet'
  /** The mint is found and verifies, but is not yet deep enough. Poll again. */
  | 'awaiting-confirmations'
  /** A transaction carrying the attestation failed phase-2 validation: not a mint, not a refund. Poll again. */
  | 'mint-attempt-failed'
  /** A transaction carries the attestation but mints or credits wrongly (including paying another address). Needs review. */
  /**
   * A transaction carries Circle's attestation but mints or credits wrongly,
   * and is still SHALLOWER than the required depth. It could roll back, so it
   * is not a verdict yet: the cursor stays before it and the next poll
   * re-evaluates it. `provisionalConflict` says what is wrong so far.
   */
  | 'conflict-awaiting-confirmations'
  | 'mint-conflict'
  /** Provider trouble, malformed or inconsistent data, or a scan cut short. Progress kept; poll again. */
  | 'unknown'
  /** Circle's attestation contradicts the approved deposit. Needs review. */
  | 'attestation-mismatch'
  /** The caller's own arguments are unusable. */
  | 'invalid-input'

export interface MintAuditResult {
  state: MintAuditState
  retryable: boolean
  cursor: MintAuditCursor | null
  reason: string | null
  proof: VerifiedMintProof | null
  conflict: MintConflictCode | null
  /**
   * Set only for `conflict-awaiting-confirmations`: the conflict the shallow
   * candidate shows now. Not a final verdict; `conflict` stays null until the
   * candidate reaches the required depth.
   */
  provisionalConflict: MintConflictCode | null
  candidate: { txHash: string; blockHeight: number; confirmations: number } | null
  /** For `no-match-yet`: true when this poll reached the current end of the asset history. */
  scanComplete: boolean
  checked: number
}

export interface AuditMintInput {
  approved: { recipient: string; amountRaw: bigint | string }
  sourceTxHash: string
  attestation: { requestedTxHash: string; response: unknown }
  cursor: MintAuditCursor
  /** Blocks on top of (and including) the mint's block before it counts. Positive integer. */
  minConfirmations: number
  /** xReserve network profile; mainnet when omitted. The reader must serve that network. */
  network?: XReserveNetwork
}

export async function auditXReserveCardanoMint(
  input: AuditMintInput, reader: UsdcxAssetReader,
): Promise<MintAuditResult> {
  const result = (state: MintAuditState, extra: Partial<MintAuditResult> = {}): MintAuditResult => ({
    state,
    retryable: state !== 'minted' && state !== 'mint-conflict' && state !== 'attestation-mismatch' && state !== 'invalid-input',
    cursor: null, reason: null, proof: null, conflict: null, provisionalConflict: null, candidate: null, scanComplete: false, checked: 0,
    ...extra,
  })

  // ── The caller's own arguments, and their bindings ─────────────────────────
  if (!input || typeof input !== 'object') return result('invalid-input', { reason: 'no input' })
  const source = String(input.sourceTxHash ?? '').toLowerCase()
  if (!/^0x[0-9a-f]{64}$/.test(source)) return result('invalid-input', { reason: 'source transaction hash is malformed' })
  if (String(input.attestation?.requestedTxHash ?? '').toLowerCase() !== source) {
    return result('invalid-input', { reason: 'the attestation was not requested for this deposit\'s source transaction' })
  }
  let net: XReserveNetwork
  try { net = xreserveNetwork(input.network) } catch { return result('invalid-input', { reason: 'unknown xReserve network' }) }
  try {
    encodeCardanoRecipient(input.approved?.recipient, net)
  } catch (e) {
    return result('invalid-input', { reason: `approved recipient: ${e instanceof XReserveCardanoError ? e.message : 'invalid'}` })
  }
  if (!Number.isSafeInteger(input.minConfirmations) || input.minConfirmations < 1) {
    return result('invalid-input', { reason: 'minConfirmations must be a positive integer' })
  }
  const stored = readMintAuditCursor(input.cursor, net)
  if (!stored || stored.recipient !== input.approved.recipient || stored.sourceTxHash.toLowerCase() !== source) {
    return result('invalid-input', { reason: 'the audit cursor does not belong to this deposit, recipient and asset' })
  }
  const cursor: MintAuditCursor = { ...stored }
  const snapshot = () => ({ ...cursor })

  // ── Circle's attestation, once per poll ────────────────────────────────────
  const check = validateXReserveAttestation(input.attestation.response, input.approved, net)
  if (!check.ok) {
    switch (check.code) {
      case 'attestation-missing': return result('awaiting-attestation', { cursor: snapshot(), reason: check.reason })
      case 'attestation-mismatch': return result('attestation-mismatch', { cursor: snapshot(), reason: check.reason })
      case 'invalid-approval': return result('invalid-input', { reason: check.reason })
      case 'attestation-malformed': return result('unknown', { cursor: snapshot(), reason: `Circle's response is unusable: ${check.reason}` })
    }
  }
  const attestation = check.attestation

  // ── The USDCx asset history, from the cursor ───────────────────────────────
  let checked = 0
  const unknown = (reason: string) => result('unknown', { cursor: snapshot(), reason, checked })
  try {
    const tip = await reader.tip()
    if (!Number.isSafeInteger(tip?.blockHeight) || tip.blockHeight < 0) return unknown('the chain tip is unreadable')

    const count = AUDIT_CANDIDATES_PER_POLL + 1   // +1: the inclusive cursor row itself
    const rows = await reader.assetTransactions(net.cardano.usdcxUnit,
      { blockHeight: cursor.blockHeight, txIndex: Math.max(0, cursor.txIndex) }, count)
    if (!Array.isArray(rows) || rows.length > count) return unknown('the asset history is malformed')

    let previous: { blockHeight: number; txIndex: number } | null = null
    for (const row of rows) {
      if (!row || typeof row.txHash !== 'string' || !/^[0-9a-f]{64}$/i.test(row.txHash)
          || !Number.isSafeInteger(row.blockHeight) || !Number.isSafeInteger(row.txIndex) || row.txIndex < 0) {
        return unknown('the asset history contains a malformed row')
      }
      if (previous && !ahead(row, previous)) return unknown('the asset history is not in ascending chain order')
      previous = row
      if (!ahead(row, cursor)) continue   // at or before the cursor: already checked
      if (row.blockHeight > tip.blockHeight) return unknown('the asset history is ahead of the chain tip')

      if (checked >= AUDIT_CANDIDATES_PER_POLL) return unknown('still auditing the USDCx history')
      checked++
      const tx = await reader.confirmedTransaction(row.txHash)
      if (!tx || String(tx.txHash).toLowerCase() !== row.txHash.toLowerCase()
          || tx.blockHeight !== row.blockHeight || typeof tx.cbor !== 'string') {
        return unknown('the provider returned a transaction that does not match the asset history')
      }
      const outputs = await reader.transactionOutputs(row.txHash)
      const outcome = evaluateMintCandidate(attestation, { txHash: row.txHash.toLowerCase(), cbor: tx.cbor }, outputs)
      const confirmations = tip.blockHeight - tx.blockHeight + 1
      const deep = confirmations >= input.minConfirmations
      const candidate = { txHash: row.txHash.toLowerCase(), blockHeight: tx.blockHeight, confirmations }
      const pass = () => { cursor.blockHeight = row.blockHeight; cursor.txIndex = row.txIndex }

      switch (outcome.kind) {
        case 'verified':
          if (!deep) return result('awaiting-confirmations', { cursor: snapshot(), candidate, checked })
          // The cursor stays immediately BEFORE the mint (after the unrelated
          // transactions already passed), so a later poll re-verifies it.
          return result('minted', { cursor: snapshot(), proof: outcome.proof, candidate, checked })
        case 'evidence-unreadable':
          return unknown(`candidate ${row.txHash} could not be read reliably: ${outcome.reason}`)
        case 'mint-conflict':
          // Circle's attestation is genuinely here, but the mint or the credit is
          // wrong — including a mint paid only to another address. The cursor
          // stays before it: never skipped, never called a refund.
          // A SHALLOW conflicting candidate can still roll back: hold the cursor
          // before it and wait, instead of a final, non-retryable verdict.
          if (!deep) {
            return result('conflict-awaiting-confirmations', {
              cursor: snapshot(), candidate, checked, provisionalConflict: outcome.code, reason: outcome.reason,
            })
          }
          return result('mint-conflict', { cursor: snapshot(), candidate, checked, conflict: outcome.code, reason: outcome.reason })
        case 'failed-attempt':
          if (deep) pass()
          return result('mint-attempt-failed', { cursor: snapshot(), candidate, checked, reason: outcome.reason })
        case 'unrelated':
          // Most rows are plain USDCx transfers. Only a transaction at the
          // required depth is passed for good; a shallower one waits.
          if (!deep) return result('no-match-yet', { cursor: snapshot(), checked, reason: 'waiting for newer USDCx transactions to reach the required depth' })
          pass()
          break
      }
    }

    // Fewer rows than asked for: the current end of the asset history.
    return rows.length < count
      ? result('no-match-yet', { cursor: snapshot(), checked, scanComplete: true })
      : unknown('still auditing the USDCx history')
  } catch (e) {
    const kind = e instanceof AuditReaderError ? e.kind : 'unavailable'
    return unknown(kind === 'rate-limited'
      ? 'the Cardano provider is rate-limiting; will retry'
      : `the Cardano provider could not be read (${kind}); will retry`)
  }
}
