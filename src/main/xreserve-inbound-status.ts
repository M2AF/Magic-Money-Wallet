/**
 * xreserve-inbound-status.ts — ONE read-only status check for one known
 * Ethereum → Cardano xReserve deposit. It joins the existing modules and adds
 * no proof rule of its own:
 *
 *   1. Ethereum evidence for the known source hash   (xreserve-ethereum-evidence-reader)
 *   2. verifyXReserveEthereumDeposit                  (xreserve-ethereum-deposit-proof)
 *      — a pending, failed, unapproved or inconsistent source is returned HERE,
 *        before Circle is asked, so a Circle outage can never mask it.
 *   3. Circle's attestation for exactly that hash     (xreserve-cardano-provider)
 *   4. linkXReserveSourceToAttestation                (xreserve-source-attestation-link)
 *      — Cardano is NOT read unless this returns `linked`.
 *   5. The recipient-address mint locator             (xreserve-cardano-mint-locator)
 *   6. The global USDCx audit, only when `auditDue`   (xreserve-cardano-mint-audit)
 *      — the asset history is much busier, so the caller runs it less often.
 *
 * ONE-SHOT. No polling loop, no session, no persistence: the caller stores the
 * returned cursors and decides when to call again. The Ethereum source is
 * re-read and re-verified on EVERY call, so a reorg that removes or changes the
 * deposit turns a previous `linked`/`minted` back into a source state here
 * instead of leaving it stale.
 *
 * TRACKING RECORD. Both scan cursors start at the Cardano tip captured when the
 * Ethereum deposit was SUBMITTED (`startXReserveInboundTracking`), because the
 * mint cannot precede it. A missing cursor is never re-created from the tip at
 * status time — a mint that happened in between would be skipped — so a
 * missing submission tip or required cursor is a typed `tracking-error` that
 * needs recovery, never `awaiting-mint`. Both cursors are required on every
 * call, whether or not the audit is due: `auditDue` only decides whether the
 * audit makes network reads.
 *
 * CURSORS RETURNED. Each scanner's cursor is returned exactly as the scanner
 * left it. A scanner that reports `minted` (or any verified or conflicting
 * candidate) leaves its cursor immediately BEFORE that candidate, so the next
 * call re-verifies it (reorg-safe) and both scanners can still be compared on
 * it. `null` means "nothing to persist; keep what you have".
 *
 * NEVER A VERDICT FROM ABSENCE. An empty Circle list, an unfinished scan, a rate
 * limit or an unavailable provider is reported as exactly that, retryable, with
 * scan progress kept. Nothing here concludes that a mint will not happen or that
 * funds were refunded.
 *
 * COMBINING THE SCANNERS (when both ran). A deep `mint-conflict` from either
 * wins over `minted`. Two different verified mint transactions are
 * `mint-evidence-inconsistent` (needs review) only once BOTH are at the
 * required depth; while either is shallow the status is the retryable
 * `disagreement-awaiting-confirmations`, with both cursors held before their
 * candidates. A shallow mint or a provisional conflict keeps the status pending.
 */

import {
  linkXReserveSourceToAttestation, type LinkResult, type LinkState, type LinkCode,
} from './xreserve-source-attestation-link'
import {
  verifyXReserveEthereumDeposit,
  type EthereumDepositEvidence, type SourceDepositResult, type SourceDepositCode,
} from './xreserve-ethereum-deposit-proof'
import type { CardanoDepositInput } from './xreserve-cardano-deposit'
import {
  locateXReserveCardanoMint, startMintScanCursor, readMintScanCursor,
  type CardanoMintReader, type MintLocatorResult, type MintScanCursor,
} from './xreserve-cardano-mint-locator'
import {
  auditXReserveCardanoMint, startMintAuditCursor, readMintAuditCursor,
  type UsdcxAssetReader, type MintAuditResult, type MintAuditCursor,
} from './xreserve-cardano-mint-audit'
import type { MintConflictCode, VerifiedMintProof } from './xreserve-cardano-mint-proof'
import {
  fetchXReserveAttestation, createBlockfrostLocatorReader, createBlockfrostAuditReader,
  ProviderFault, type HttpFetchFn, type BlockfrostFetchFn,
} from './xreserve-cardano-provider'
import { readXReserveEthereumEvidence, EthereumEvidenceError } from './xreserve-ethereum-evidence-reader'
import type { WalletConfig } from './secure-store'
import { xreserveNetwork, type XReserveNetwork } from './xreserve-network'

// ── Injected reads ────────────────────────────────────────────────────────────

export interface InboundReads {
  /** One Ethereum evidence snapshot for the hash (throws on provider failure). */
  readEthereumEvidence(sourceTxHash: string): Promise<{ sourceTxHash: string; evidence: EthereumDepositEvidence }>
  /** Circle's `GET /v1/attestations?txHash=` answer, with the hash it was requested for. */
  fetchAttestation(sourceTxHash: string): Promise<{ requestedTxHash: string; response: unknown }>
  locatorReader: CardanoMintReader
  auditReader: UsdcxAssetReader
  /**
   * The xReserve network these reads serve; mainnet when omitted. It must be the
   * deposit's network, or the coordinator refuses to run.
   */
  network?: XReserveNetwork
}

/**
 * The wallet's production reads: its Ethereum RPC ladder, Circle's API and
 * Blockfrost (proxy or user key on mainnet; the user's preprod key on
 * Preprod), all for ONE xReserve network (mainnet by default). Electron main
 * should pass `net.fetch` as `fetchFn`.
 */
export function xreserveInboundReads(
  config: WalletConfig, opts: { fetchFn?: HttpFetchFn; blockfrostFetch?: BlockfrostFetchFn; network?: XReserveNetwork } = {},
): InboundReads {
  const network = xreserveNetwork(opts.network)
  return {
    readEthereumEvidence: (hash) => readXReserveEthereumEvidence(hash, config, { fetchFn: opts.fetchFn, network }),
    fetchAttestation: (hash) => fetchXReserveAttestation(hash, { fetchFn: opts.fetchFn, network }),
    locatorReader: createBlockfrostLocatorReader({ config, blockfrostFetch: opts.blockfrostFetch, network }),
    auditReader: createBlockfrostAuditReader({ config, blockfrostFetch: opts.blockfrostFetch, network }),
    network,
  }
}

// ── Tracking record ───────────────────────────────────────────────────────────

export interface InboundTracking {
  /** Cardano tip captured when the Ethereum deposit was submitted. */
  cardanoTipAtSubmission: { blockHeight: number } | null | undefined
  /** The locator cursor as persisted (plain JSON is fine). */
  locatorCursor: unknown
  /** The audit cursor as persisted (plain JSON is fine). */
  auditCursor: unknown
}

/**
 * The tracking record to persist AT SUBMISSION: both cursors start at the
 * Cardano tip captured then. Never call this at the first status poll.
 */
export function startXReserveInboundTracking(
  recipient: string, sourceTxHash: string, cardanoTipAtSubmission: { blockHeight: number }, network?: XReserveNetwork,
): { cardanoTipAtSubmission: { blockHeight: number }; locatorCursor: MintScanCursor; auditCursor: MintAuditCursor } {
  if (!Number.isSafeInteger(cardanoTipAtSubmission?.blockHeight) || cardanoTipAtSubmission.blockHeight < 0) {
    throw new RangeError('the Cardano tip at submission must be a non-negative block height')
  }
  return {
    cardanoTipAtSubmission: { blockHeight: cardanoTipAtSubmission.blockHeight },
    locatorCursor: startMintScanCursor(recipient, sourceTxHash, cardanoTipAtSubmission),
    auditCursor: startMintAuditCursor(recipient, sourceTxHash, cardanoTipAtSubmission, network),
  }
}

// ── Input and result ──────────────────────────────────────────────────────────

export interface InboundStatusInput {
  sourceTxHash: string
  approvedSender: string
  approved: CardanoDepositInput
  /** Required depths: Ethereum blocks for the source, Cardano blocks for the mint. */
  confirmations: { ethereum: number; cardano: number }
  tracking: InboundTracking
  /** Run the global USDCx audit on this call. */
  auditDue: boolean
  /** xReserve network profile; mainnet when omitted. Must equal `reads.network`. */
  network?: XReserveNetwork
}

export type InboundState =
  // Before any network read
  | 'invalid-input'
  /** The tracking record cannot be used as is; see `trackingError`. Needs recovery, not a retry. */
  | 'tracking-error'
  // Ethereum / Circle
  /** Ethereum RPC or Circle could not be read; see `providerFailure`. Retry. */
  | 'provider-unavailable'
  | Exclude<LinkState, 'linked' | 'invalid-input'>
  // Cardano (only after `linked`)
  /** No matching mint in the history read so far. Poll again. */
  | 'awaiting-mint'
  /** A verified mint exists but is not deep enough yet. Poll again. */
  | 'awaiting-confirmations'
  /** A transaction carrying the attestation failed phase-2 validation: not a mint, not a refund. Poll again. */
  | 'mint-attempt-failed'
  /** An attested transaction mints or credits wrongly but is still shallow. Poll again. */
  | 'conflict-awaiting-confirmations'
  /** An attested transaction at depth mints or credits wrongly. Needs review. */
  | 'mint-conflict'
  /** The two scanners verified DIFFERENT mint transactions, both at depth. Needs review. */
  | 'mint-evidence-inconsistent'
  /** The two scanners verified DIFFERENT mint transactions, at least one still shallow. Poll again. */
  | 'disagreement-awaiting-confirmations'
  /** Cardano provider trouble or an unfinished scan. Progress kept; poll again. */
  | 'cardano-unknown'
  /** Verified mint at depth, source re-verified on this call. */
  | 'minted'

export type TrackingErrorCode =
  | 'submission-tip-missing'
  | 'locator-cursor-missing'
  | 'locator-cursor-invalid'
  | 'audit-cursor-missing'
  | 'audit-cursor-invalid'

export interface InboundStatus {
  state: InboundState
  retryable: boolean
  reason: string | null
  trackingError: TrackingErrorCode | null
  providerFailure: { provider: 'ethereum' | 'circle'; kind: string } | null
  /** The source verifier's result, once Ethereum evidence was read. */
  source: SourceDepositResult | null
  /** The source verifier's typed code, once it ran. */
  sourceCode: SourceDepositCode | null
  /** The link's typed code, once the link ran. */
  linkCode: LinkCode | null
  /** Set for `mint-conflict` / `conflict-awaiting-confirmations`. */
  conflict: MintConflictCode | null
  /** The verified mint (minted / awaiting-confirmations). */
  mint: { txHash: string; blockHeight: number; confirmations: number } | null
  proof: VerifiedMintProof | null
  /** Cursors for the caller to persist; null = keep the stored one. */
  cursors: { locator: MintScanCursor | null; audit: MintAuditCursor | null }
  link: LinkResult | null
  locator: MintLocatorResult | null
  audit: MintAuditResult | null
}

const RETRYABLE: Record<InboundState, boolean> = {
  'invalid-input': false, 'tracking-error': false, 'provider-unavailable': true,
  'source-pending': true, 'source-failed': false, 'source-not-approved': false, 'source-inconsistent': true,
  'attestation-pending': true, 'attestation-malformed': true, 'attestation-mismatch': false,
  'awaiting-mint': true, 'awaiting-confirmations': true, 'mint-attempt-failed': true,
  'conflict-awaiting-confirmations': true, 'mint-conflict': false, 'mint-evidence-inconsistent': false,
  'disagreement-awaiting-confirmations': true,
  'cardano-unknown': true, 'minted': false,
}

const HASH_RE = /^0x[0-9a-fA-F]{64}$/

type Scan = MintLocatorResult | MintAuditResult

const isVerified = (s: Scan) => s.state === 'minted' || s.state === 'awaiting-confirmations'

// ── The status check ──────────────────────────────────────────────────────────

export async function checkXReserveInboundStatus(input: InboundStatusInput, reads: InboundReads): Promise<InboundStatus> {
  const cursors: InboundStatus['cursors'] = { locator: null, audit: null }
  const status = (state: InboundState, extra: Partial<InboundStatus> = {}): InboundStatus => ({
    state, retryable: RETRYABLE[state], reason: null, trackingError: null, providerFailure: null,
    source: null, sourceCode: null, linkCode: null, conflict: null, mint: null, proof: null,
    cursors: { ...cursors }, link: null, locator: null, audit: null, ...extra,
  })

  // ── 0. The caller's arguments and tracking record (no network) ─────────────
  if (!input || typeof input !== 'object') return status('invalid-input', { reason: 'no input' })
  if (typeof input.sourceTxHash !== 'string' || !HASH_RE.test(input.sourceTxHash)) {
    return status('invalid-input', { reason: 'source transaction hash is malformed' })
  }
  const source = input.sourceTxHash.toLowerCase()
  const depth = input.confirmations
  if (!depth || !Number.isSafeInteger(depth.ethereum) || depth.ethereum < 1
      || !Number.isSafeInteger(depth.cardano) || depth.cardano < 1) {
    return status('invalid-input', { reason: 'confirmation depths must be positive integers' })
  }
  if (typeof input.auditDue !== 'boolean') return status('invalid-input', { reason: 'auditDue must be true or false' })
  let network: XReserveNetwork
  try {
    network = xreserveNetwork(input.network)
    // Reads built for another network would read the wrong chains for this deposit.
    if (xreserveNetwork(reads?.network) !== network) {
      return status('invalid-input', { reason: 'the reads serve a different xReserve network than the deposit' })
    }
  } catch {
    return status('invalid-input', { reason: 'unknown xReserve network' })
  }
  const recipient = input.approved?.recipient

  const tracking = input.tracking ?? ({} as InboundTracking)
  const trackingError = (code: TrackingErrorCode, reason: string) => status('tracking-error', { trackingError: code, reason })
  const tip = tracking.cardanoTipAtSubmission
  if (tip === null || tip === undefined) return trackingError('submission-tip-missing', 'the Cardano tip captured at submission is missing')
  if (!Number.isSafeInteger(tip.blockHeight) || tip.blockHeight < 0) {
    return trackingError('submission-tip-missing', 'the Cardano tip captured at submission is unreadable')
  }

  if (tracking.locatorCursor === null || tracking.locatorCursor === undefined) {
    return trackingError('locator-cursor-missing', 'the recipient scan cursor is missing; it must be restored, not restarted from the current tip')
  }
  const locatorCursor = readMintScanCursor(tracking.locatorCursor)
  if (!locatorCursor || locatorCursor.recipient !== recipient || locatorCursor.sourceTxHash.toLowerCase() !== source) {
    return trackingError('locator-cursor-invalid', 'the recipient scan cursor does not belong to this deposit and recipient')
  }
  // Required whether or not the audit is due: `auditDue` only gates its reads.
  if (tracking.auditCursor === null || tracking.auditCursor === undefined) {
    return trackingError('audit-cursor-missing', 'the USDCx audit cursor is missing; it must be restored, not restarted from the current tip')
  }
  const auditCursor = readMintAuditCursor(tracking.auditCursor, network)
  if (!auditCursor || auditCursor.recipient !== recipient || auditCursor.sourceTxHash.toLowerCase() !== source) {
    return trackingError('audit-cursor-invalid', 'the USDCx audit cursor does not belong to this deposit and recipient')
  }
  // From here on, the stored cursors are echoed back unless a scanner advances them.
  cursors.locator = locatorCursor
  cursors.audit = auditCursor

  // ── 1. Ethereum evidence for the known hash ────────────────────────────────
  let evidence: EthereumDepositEvidence
  try {
    const snap = await reads.readEthereumEvidence(source)
    if (!snap || typeof snap.sourceTxHash !== 'string' || snap.sourceTxHash.toLowerCase() !== source) {
      return status('provider-unavailable', { providerFailure: { provider: 'ethereum', kind: 'inconsistent' },
        reason: 'the Ethereum evidence was not read for this source transaction' })
    }
    evidence = snap.evidence
  } catch (e) {
    const kind = e instanceof EthereumEvidenceError ? e.kind : 'unavailable'
    if (kind === 'invalid-input') return status('invalid-input', { reason: 'source transaction hash is malformed' })
    return status('provider-unavailable', { providerFailure: { provider: 'ethereum', kind },
      reason: 'the Ethereum source could not be read; will retry' })
  }

  // ── 2. The source, verified before Circle is asked ──────────────────────────
  const verified = verifyXReserveEthereumDeposit({
    sourceTxHash: source, approved: input.approved, approvedSender: input.approvedSender,
    evidence, minConfirmations: depth.ethereum, network,
  })
  const sourceExtra = { source: verified, sourceCode: verified.code, reason: verified.reason }
  switch (verified.state) {
    case 'pending': return status('source-pending', sourceExtra)
    case 'failed': return status('source-failed', sourceExtra)
    case 'not-approved': return status('source-not-approved', sourceExtra)
    case 'evidence-inconsistent': return status('source-inconsistent', sourceExtra)
    case 'invalid-input': return status('invalid-input', sourceExtra)
    case 'verified': break
  }

  // ── 3. Circle's attestation for exactly that hash ──────────────────────────
  let circle: { requestedTxHash: string; response: unknown }
  try {
    circle = await reads.fetchAttestation(source)
  } catch (e) {
    const kind = e instanceof ProviderFault ? e.kind : 'unavailable'
    return status('provider-unavailable', { source: verified, sourceCode: verified.code, providerFailure: { provider: 'circle', kind },
      reason: 'Circle\'s attestation service could not be read; will retry' })
  }

  // ── 4. The link (it re-verifies the same evidence). Cardano only after `linked`.
  const link = linkXReserveSourceToAttestation({
    sourceTxHash: source, approvedSender: input.approvedSender, approved: input.approved,
    evidence, circle, minConfirmations: depth.ethereum, network,
  })
  if (link.state !== 'linked') {
    return status(link.state === 'invalid-input' ? 'invalid-input' : link.state, {
      source: link.source, sourceCode: link.source?.code ?? null, link, linkCode: link.code, reason: link.reason,
    })
  }
  const attestation = { requestedTxHash: circle.requestedTxHash, response: circle.response }
  const approved = { recipient: input.approved.recipient, amountRaw: input.approved.amountRaw }

  // ── 5. The recipient-address locator ───────────────────────────────────────
  const locator = await locateXReserveCardanoMint(
    { approved, sourceTxHash: source, attestation, cursor: locatorCursor, minConfirmations: depth.cardano, network },
    reads.locatorReader)
  if (locator.cursor) cursors.locator = locator.cursor

  // ── 6. The global USDCx audit: network reads only when due ─────────────────
  let audit: MintAuditResult | null = null
  if (input.auditDue) {
    audit = await auditXReserveCardanoMint(
      { approved, sourceTxHash: source, attestation, cursor: auditCursor, minConfirmations: depth.cardano, network },
      reads.auditReader)
    if (audit.cursor) cursors.audit = audit.cursor
  }

  return combine(locator, audit, (state, extra) => status(state, {
    source: link.source, sourceCode: link.source?.code ?? null, link, linkCode: link.code, locator, audit, ...extra,
  }))
}

/** Join the scanners' results, strongest evidence first. */
function combine(
  locator: MintLocatorResult, audit: MintAuditResult | null,
  status: (state: InboundState, extra?: Partial<InboundStatus>) => InboundStatus,
): InboundStatus {
  const scans: Scan[] = audit ? [locator, audit] : [locator]
  const find = (pred: (s: Scan) => boolean) => scans.find(pred) ?? null

  // A deep conflict wins over everything, including `minted`.
  const deepConflict = find(s => s.state === 'mint-conflict')
  if (deepConflict) {
    return status('mint-conflict', { conflict: deepConflict.conflict, reason: deepConflict.reason })
  }
  // Two scanners, two different verified mints: final only once both are deep
  // (`minted`); while either is shallow, both cursors stay before their
  // candidates and the next call re-evaluates them.
  const verified = scans.filter(isVerified)
  if (verified.length === 2 && verified[0].candidate?.txHash !== verified[1].candidate?.txHash) {
    const pair = `${verified[0].candidate?.txHash} vs ${verified[1].candidate?.txHash}`
    return verified.every(s => s.state === 'minted')
      ? status('mint-evidence-inconsistent', { reason: `the address scan and the USDCx audit verified different mint transactions (${pair})` })
      : status('disagreement-awaiting-confirmations', { reason: `the scanners verified different mint transactions, not all deep yet (${pair})` })
  }
  const bad = find(s => s.state === 'attestation-mismatch' || s.state === 'invalid-input')
  if (bad) {
    return status(bad.state === 'attestation-mismatch' ? 'attestation-mismatch' : 'invalid-input', { reason: bad.reason })
  }
  const provisional = find(s => s.state === 'conflict-awaiting-confirmations')
  if (provisional) {
    return status('conflict-awaiting-confirmations', { conflict: provisional.provisionalConflict, reason: provisional.reason })
  }
  const shallow = find(s => s.state === 'awaiting-confirmations')
  if (shallow) return status('awaiting-confirmations', { mint: shallow.candidate })
  const minted = find(s => s.state === 'minted')
  if (minted) return status('minted', { mint: minted.candidate, proof: minted.proof })
  const failed = find(s => s.state === 'mint-attempt-failed')
  if (failed) return status('mint-attempt-failed', { reason: failed.reason })
  const unknown = find(s => s.state === 'unknown')
  if (unknown) return status('cardano-unknown', { reason: unknown.reason })
  const unattested = find(s => s.state === 'awaiting-attestation')
  if (unattested) return status('attestation-pending', { reason: unattested.reason })
  return status('awaiting-mint', { reason: locator.reason })
}
