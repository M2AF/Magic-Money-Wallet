/**
 * xreserve-source-attestation-link.ts — does Circle's attestation describe
 * EXACTLY the Ethereum deposit this wallet verified? (pure, read-only)
 *
 * This is the joint between the two halves of an inbound xReserve route: the
 * Ethereum source deposit (xreserve-ethereum-deposit-proof.ts) and the Cardano
 * mint tracking that consumes Circle's attestation (xreserve-cardano-mint-*).
 * Only a `linked` result means the attestation may be used for that deposit.
 *
 * WHY THE SOURCE IS VERIFIED HERE, NOT ACCEPTED. The source verifier's result
 * does not carry the transaction hash, so a "verified" result produced for one
 * transaction could be paired with another transaction's attestation. This
 * function therefore runs `verifyXReserveEthereumDeposit` itself on the evidence
 * for the known hash, and continues only on `verified`.
 *
 * TRUST BOUNDARY (inherited, and unchanged): the Ethereum evidence must come
 * from a trusted mainnet provider fetched by the caller for the known hash
 * (never user-supplied, re-checked after reorgs), and Circle's response must be
 * the answer to `GET /v1/attestations?txHash=` for EXACTLY that hash — the pair
 * `{ requestedTxHash, response }` carries that binding and is checked here.
 *
 * WHAT IS COMPARED, field by field, between Circle's attested DepositIntent
 * (Circle's published layout, DepositIntent.sol) and the verified on-chain
 * `DepositedToRemote` event: amount, local token (USDC), local depositor
 * (bytes32-encoded address), remote domain (Cardano 10004), remote recipient,
 * remote token, max fee and hookData.
 *
 * NEVER a refund: an attestation that is missing, unreadable or does not match
 * is reported as exactly that. Nothing here infers that funds came back.
 */

import {
  verifyXReserveEthereumDeposit, type SourceDepositResult, type SourceDepositCode,
  type EthereumDepositEvidence, type DecodedDepositEvent,
} from './xreserve-ethereum-deposit-proof'
import {
  validateXReserveAttestation, parseDepositIntent,
  type ValidatedAttestation, type AttestationFailureCode, type DepositIntentFields,
} from './xreserve-cardano-mint-proof'
import type { CardanoDepositInput } from './xreserve-cardano-deposit'
import type { XReserveNetwork } from './xreserve-network'

export type LinkState =
  /** Source verified at depth AND Circle's attestation describes exactly that deposit. */
  | 'linked'
  /** Source not found, not mined, or not deep enough. Poll again. */
  | 'source-pending'
  /** Source reverted: no deposit, so nothing to attest. Terminal. */
  | 'source-failed'
  /** Source is not the approved deposit. Needs review. */
  | 'source-not-approved'
  /** Source evidence contradicts itself. Fetch again. */
  | 'source-inconsistent'
  /** Source verified; Circle has not attested it yet (empty list). Poll again. */
  | 'attestation-pending'
  /** Circle's response is not a well-formed attestation. Fetch again. */
  | 'attestation-malformed'
  /** Circle's attestation does not describe this deposit, or was requested for another hash. Needs review. */
  | 'attestation-mismatch'
  /** The caller's own arguments are unusable. */
  | 'invalid-input'

/** A DepositIntent field compared with the verified event. */
export type LinkedField =
  | 'amount' | 'localToken' | 'localDepositor' | 'remoteDomain'
  | 'remoteRecipient' | 'remoteToken' | 'maxFee' | 'hookData'

export type LinkCode =
  | 'linked'
  | SourceDepositCode
  | AttestationFailureCode
  /** The Circle response was requested for a different hash than the verified source. */
  | 'source-hash-misbound'
  /** The attestation is well-formed and approved, but its intent differs from the on-chain event. */
  | 'intent-event-mismatch'

export interface LinkInput {
  sourceTxHash: string
  approvedSender: string
  approved: CardanoDepositInput
  evidence: EthereumDepositEvidence
  circle: { requestedTxHash: string; response: unknown }
  minConfirmations: number
  /** xReserve network profile; mainnet when omitted. */
  network?: XReserveNetwork
}

export interface LinkResult {
  state: LinkState
  code: LinkCode
  retryable: boolean
  reason: string | null
  /** The source verifier's own result, always present once it ran. */
  source: SourceDepositResult | null
  /** Circle's validated attestation, once it passed validation. */
  attestation: ValidatedAttestation | null
  /** Every DepositIntent field that differs from the verified event (when the payload could be parsed). */
  mismatchedFields: LinkedField[]
}

const RETRYABLE: Record<LinkState, boolean> = {
  'linked': false, 'source-pending': true, 'source-failed': false, 'source-not-approved': false,
  'source-inconsistent': true, 'attestation-pending': true, 'attestation-malformed': true,
  'attestation-mismatch': false, 'invalid-input': false,
}

const strip = (h: string) => h.toLowerCase().replace(/^0x/, '')
const addressWord = (a: string) => strip(a).padStart(64, '0')

/** Compare a parsed DepositIntent with the verified event. Returns the fields that differ. */
export function compareIntentWithEvent(intent: DepositIntentFields, event: DecodedDepositEvent): LinkedField[] {
  const differs: LinkedField[] = []
  if (BigInt(intent.amountRaw) !== event.value) differs.push('amount')
  if (strip(intent.localToken) !== addressWord(event.localToken)) differs.push('localToken')
  if (strip(intent.localDepositor) !== addressWord(event.localDepositor)) differs.push('localDepositor')
  if (intent.remoteDomain !== event.remoteDomain) differs.push('remoteDomain')
  if (strip(intent.remoteRecipient) !== strip(event.remoteRecipient)) differs.push('remoteRecipient')
  if (strip(intent.remoteToken) !== strip(event.remoteToken)) differs.push('remoteToken')
  if (BigInt(intent.maxFeeRaw) !== event.maxFee) differs.push('maxFee')
  if (strip(intent.hookData) !== strip(event.hookData)) differs.push('hookData')
  return differs
}

/** The single attestation's payload, parsed — or null when there is not exactly one well-formed one. */
function parseSinglePayload(response: unknown): DepositIntentFields | null {
  try {
    const list = (response as { attestations?: unknown }).attestations
    if (!Array.isArray(list) || list.length !== 1) return null
    const payload = (list[0] as { payload?: unknown }).payload
    if (typeof payload !== 'string' || !/^0x([0-9a-fA-F]{2})+$/.test(payload)) return null
    return parseDepositIntent(payload.slice(2))
  } catch {
    return null
  }
}

export function linkXReserveSourceToAttestation(input: LinkInput): LinkResult {
  const result = (state: LinkState, code: LinkCode, reason: string | null, extra: Partial<LinkResult> = {}): LinkResult =>
    ({ state, code, retryable: RETRYABLE[state], reason, source: null, attestation: null, mismatchedFields: [], ...extra })

  if (!input || typeof input !== 'object') return result('invalid-input', 'invalid-input', 'no input')
  if (!input.circle || typeof input.circle !== 'object' || typeof input.circle.requestedTxHash !== 'string'
      || !/^0x[0-9a-fA-F]{64}$/.test(input.circle.requestedTxHash)) {
    return result('invalid-input', 'invalid-input', 'the Circle response must come with the hash it was requested for')
  }

  // ── 1. The source deposit, verified here for the known hash ────────────────
  const source = verifyXReserveEthereumDeposit({
    sourceTxHash: input.sourceTxHash,
    approved: input.approved,
    approvedSender: input.approvedSender,
    evidence: input.evidence,
    minConfirmations: input.minConfirmations,
    network: input.network,
  })
  switch (source.state) {
    case 'pending': return result('source-pending', source.code, source.reason, { source })
    case 'failed': return result('source-failed', source.code, source.reason, { source })
    case 'not-approved': return result('source-not-approved', source.code, source.reason, { source })
    case 'evidence-inconsistent': return result('source-inconsistent', source.code, source.reason, { source })
    case 'invalid-input': return result('invalid-input', source.code, source.reason, { source })
    case 'verified': break
  }
  const event = source.event
  if (!event) return result('source-inconsistent', 'malformed', 'the verified source carries no deposit event', { source })

  // ── 2. The Circle response was requested for THIS source ───────────────────
  if (input.circle.requestedTxHash.toLowerCase() !== input.sourceTxHash.toLowerCase()) {
    return result('attestation-mismatch', 'source-hash-misbound',
      'the Circle response was requested for a different transaction than the verified source', { source })
  }

  // ── 3. Circle's attestation, against the approval, then against the event ──
  let check: ReturnType<typeof validateXReserveAttestation>
  try {
    check = validateXReserveAttestation(input.circle.response, input.approved, input.network)
  } catch {
    return result('invalid-input', 'invalid-input', 'unknown xReserve network', { source })
  }
  const parsed = parseSinglePayload(input.circle.response)
  const mismatchedFields = parsed ? compareIntentWithEvent(parsed, event) : []
  if (!check.ok) {
    switch (check.code) {
      case 'attestation-missing': return result('attestation-pending', check.code, check.reason, { source })
      case 'attestation-malformed': return result('attestation-malformed', check.code, check.reason, { source })
      case 'attestation-mismatch': return result('attestation-mismatch', check.code, check.reason, { source, mismatchedFields })
      case 'invalid-approval': return result('invalid-input', check.code, check.reason, { source })
    }
  }
  if (mismatchedFields.length) {
    return result('attestation-mismatch', 'intent-event-mismatch',
      `Circle's attestation differs from the verified deposit in: ${mismatchedFields.join(', ')}`,
      { source, attestation: check.attestation, mismatchedFields })
  }
  return result('linked', 'linked', null, { source, attestation: check.attestation })
}
