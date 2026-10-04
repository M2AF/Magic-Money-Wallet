/**
 * xreserve-cardano-mint-locator.ts — find the Cardano transaction that minted
 * a known Ethereum → Cardano xReserve deposit (read-only, dependency-injected).
 *
 * No network code lives here: every read goes through an injected
 * `CardanoMintReader`, and the proof rules live in
 * xreserve-cardano-mint-proof.ts — `validateXReserveAttestation` once per
 * poll, `evaluateMintCandidate` per transaction — and are not repeated. This
 * module decides WHICH transactions to hand it, WHEN a verified one counts,
 * and what to say while nothing has been found. It branches only on those
 * functions' typed outcome codes, never on their human-readable reasons.
 *
 * TRUST BOUNDARY — what the caller must guarantee:
 *   • `attestation.response` is Circle's `GET /v1/attestations?txHash=` answer
 *     fetched for `attestation.requestedTxHash`, which must be the deposit's
 *     own source transaction hash. Circle's response does not name the source
 *     transaction, so this binding cannot be checked from its content; it is
 *     enforced here as an explicit, equal pair of hashes.
 *   • The reader is backed by a TRUSTED Cardano provider (the wallet's own
 *     Blockfrost/Koios access), returns data for CONFIRMED transactions only,
 *     and reports each one's block height. This module never accepts CBOR as a
 *     proof argument: candidates come from the reader's history of the approved
 *     address, and a mint only counts once the reader's tip puts it at the
 *     required confirmation depth.
 *
 * SCAN: the exact approved address, oldest first, keyset-paginated on the
 * provider's inclusive `from = block:index` (the same pattern as the Minswap
 * order scan in cardano-swap.ts). At most 20 candidates are read per poll, and
 * the returned cursor is plain JSON, so a later poll or an app restart resumes
 * exactly where this one stopped — never past an unread or unconfirmed
 * candidate.
 *
 * LIMITATION — a mint paid ONLY to another address is invisible here. The scan
 * reads the approved address's history and nothing else, so if Circle's
 * attestation were minted to a different address (or the whole amount paid
 * elsewhere), that transaction never appears as a candidate and this locator
 * keeps answering `awaiting-mint`. There is deliberately no timeout that turns
 * that into a verdict; detecting it needs a different lookup (for example the
 * USDCx mint history), which this module does not do.
 */

import {
  validateXReserveAttestation, evaluateMintCandidate,
  type MintProof, type MintProofInput, type MintConflictCode,
} from './xreserve-cardano-mint-proof'
import { encodeCardanoRecipient, XReserveCardanoError } from './xreserve-cardano-deposit'
import { xreserveNetwork, type XReserveNetwork } from './xreserve-network'

/** Candidate transactions read per poll. */
export const MINT_SCAN_CANDIDATES_PER_POLL = 20

// ── The injected reader ───────────────────────────────────────────────────────

export interface AddressTxRow { txHash: string; blockHeight: number; txIndex: number }

export interface ConfirmedTx {
  txHash: string
  /** Height of the block that includes it — the reader's claim of inclusion. */
  blockHeight: number
  cbor: string
}

export type CardanoOutputs = NonNullable<MintProofInput['cardanoOutputs']>

/** Raised by a reader for a provider problem; anything thrown is treated alike. */
export class CardanoReaderError extends Error {
  constructor(readonly kind: 'rate-limited' | 'unavailable' | 'malformed' | 'not-found', message?: string) {
    super(message ?? kind)
  }
}

export interface CardanoMintReader {
  /**
   * The address's transactions in ascending chain order, starting AT
   * (fromBlock, fromIndex) inclusive — Blockfrost's `from=block:index` — at
   * most `count` rows.
   */
  addressTransactions(address: string, from: { blockHeight: number; txIndex: number }, count: number): Promise<AddressTxRow[]>
  /** A confirmed transaction's CBOR and block height. */
  confirmedTransaction(txHash: string): Promise<ConfirmedTx>
  /** The same transaction's outputs, as the provider indexes them. */
  transactionOutputs(txHash: string): Promise<CardanoOutputs>
  /** Current chain tip. */
  tip(): Promise<{ blockHeight: number }>
}

// ── Cursor ────────────────────────────────────────────────────────────────────

/**
 * Serializable scan position: every transaction of `recipient` at or before
 * (blockHeight, txIndex) has been checked and is not the mint. txIndex -1 means
 * "nothing in that block checked yet". Bound to one deposit and one address.
 */
export interface MintScanCursor {
  v: 1
  recipient: string
  sourceTxHash: string
  blockHeight: number
  txIndex: number
}

/** The cursor to store when the deposit is submitted: start at the tip block, inclusive. */
export function startMintScanCursor(recipient: string, sourceTxHash: string, tipAtSubmission: { blockHeight: number }): MintScanCursor {
  return { v: 1, recipient, sourceTxHash: sourceTxHash.toLowerCase(), blockHeight: tipAtSubmission.blockHeight, txIndex: -1 }
}

/** Read a stored cursor back, refusing anything that is not one. */
export function readMintScanCursor(value: unknown): MintScanCursor | null {
  if (!value || typeof value !== 'object') return null
  const c = value as Record<string, unknown>
  if (c.v !== 1 || typeof c.recipient !== 'string' || typeof c.sourceTxHash !== 'string') return null
  if (!Number.isSafeInteger(c.blockHeight) || (c.blockHeight as number) < 0) return null
  if (!Number.isSafeInteger(c.txIndex) || (c.txIndex as number) < -1) return null
  return { v: 1, recipient: c.recipient, sourceTxHash: c.sourceTxHash, blockHeight: c.blockHeight as number, txIndex: c.txIndex as number }
}

const ahead = (a: { blockHeight: number; txIndex: number }, b: { blockHeight: number; txIndex: number }) =>
  a.blockHeight > b.blockHeight || (a.blockHeight === b.blockHeight && a.txIndex > b.txIndex)

// ── Result ────────────────────────────────────────────────────────────────────

export type MintLocatorState =
  /** Verified mint at the required depth. Terminal. */
  | 'minted'
  /** Circle has not attested the deposit yet. Poll again. */
  | 'awaiting-attestation'
  /** The address's current history holds no matching mint. Poll again: new transactions will be checked. */
  | 'awaiting-mint'
  /** The mint is found and verifies, but is not yet deep enough. Poll again. */
  | 'awaiting-confirmations'
  /**
   * A transaction carrying Circle's attestation failed phase-2 validation: an
   * unsuccessful mint attempt, NOT a mint and NOT a refund. Poll again — a later
   * attempt may succeed.
   */
  | 'mint-attempt-failed'
  /**
   * A transaction carries Circle's exact payload and signature in a qualifying
   * redeemer, but its USDCx mint or the recipient's credit is wrong. Needs a
   * person; never reported as minted, unrelated or "awaiting mint".
   */
  /**
   * A transaction carries Circle's attestation but mints or credits wrongly,
   * and is still SHALLOWER than the required depth. It could roll back, so it
   * is not a verdict yet: the cursor stays before it and the next poll
   * re-evaluates it. `provisionalConflict` says what is wrong so far.
   */
  | 'conflict-awaiting-confirmations'
  | 'mint-conflict'
  /** A provider or data problem, or a scan cut short. Progress kept; poll again. */
  | 'unknown'
  /** Circle's attestation contradicts the approved deposit (amount, recipient, domain…). Needs a person. */
  | 'attestation-mismatch'
  /** The caller's own arguments are unusable. */
  | 'invalid-input'

export interface MintLocatorResult {
  state: MintLocatorState
  retryable: boolean
  cursor: MintScanCursor | null
  reason: string | null
  proof: Extract<MintProof, { verified: true }> | null
  /** The candidate that verified, with its measured depth (minted / awaiting-confirmations). */
  candidate: { txHash: string; blockHeight: number; confirmations: number } | null
  /** Candidates read during this poll. */
  checked: number
  /** Set for `mint-conflict`: which rule the attested transaction broke. */
  conflict: MintConflictCode | null
  /**
   * Set only for `conflict-awaiting-confirmations`: the conflict the shallow
   * candidate shows now. Not a final verdict; `conflict` stays null until the
   * candidate reaches the required depth.
   */
  provisionalConflict: MintConflictCode | null
}

export interface LocateMintInput {
  approved: { recipient: string; amountRaw: bigint | string }
  sourceTxHash: string
  /** Circle's response and the hash it was requested for (must equal sourceTxHash). */
  attestation: { requestedTxHash: string; response: unknown }
  cursor: MintScanCursor
  /** Blocks on top of (and including) the mint's block before it counts. Positive integer. */
  minConfirmations: number
  /** xReserve network profile; mainnet when omitted. The reader must serve that network. */
  network?: XReserveNetwork
}

export async function locateXReserveCardanoMint(
  input: LocateMintInput, reader: CardanoMintReader,
): Promise<MintLocatorResult> {
  const result = (state: MintLocatorState, extra: Partial<MintLocatorResult> = {}): MintLocatorResult => ({
    state,
    retryable: state !== 'minted' && state !== 'attestation-mismatch' && state !== 'invalid-input' && state !== 'mint-conflict',
    cursor: extra.cursor === undefined ? null : extra.cursor,
    reason: null, proof: null, candidate: null, checked: 0, conflict: null, provisionalConflict: null,
    ...extra,
  })

  // ── The caller's own arguments ─────────────────────────────────────────────
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
  const amount = input.approved.amountRaw
  const amountOk = typeof amount === 'bigint' ? amount > 0n
    : typeof amount === 'string' && /^[1-9][0-9]*$/.test(amount)
  if (!amountOk) return result('invalid-input', { reason: 'approved amount must be a positive integer in base units' })
  if (!Number.isSafeInteger(input.minConfirmations) || input.minConfirmations < 1) {
    return result('invalid-input', { reason: 'minConfirmations must be a positive integer' })
  }
  const stored = readMintScanCursor(input.cursor)
  if (!stored || stored.recipient !== input.approved.recipient || stored.sourceTxHash.toLowerCase() !== source) {
    return result('invalid-input', { reason: 'the scan cursor does not belong to this deposit and recipient' })
  }
  const cursor: MintScanCursor = { ...stored }
  const snapshot = () => ({ ...cursor })

  // ── Circle: attested yet, and consistent with the approval? ────────────────
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

  // ── Cardano: scan the approved address from the cursor ─────────────────────
  let checked = 0
  const unknown = (reason: string) => result('unknown', { cursor: snapshot(), reason, checked })
  try {
    const tip = await reader.tip()
    if (!Number.isSafeInteger(tip?.blockHeight) || tip.blockHeight < 0) return unknown('the chain tip is unreadable')

    const count = MINT_SCAN_CANDIDATES_PER_POLL + 1   // +1: the inclusive cursor row itself
    const rows = await reader.addressTransactions(input.approved.recipient,
      { blockHeight: cursor.blockHeight, txIndex: Math.max(0, cursor.txIndex) }, count)
    if (!Array.isArray(rows) || rows.length > count) return unknown('the address history is malformed')

    let previous: { blockHeight: number; txIndex: number } | null = null
    for (const row of rows) {
      if (!row || typeof row.txHash !== 'string' || !/^[0-9a-f]{64}$/i.test(row.txHash)
          || !Number.isSafeInteger(row.blockHeight) || !Number.isSafeInteger(row.txIndex) || row.txIndex < 0) {
        return unknown('the address history contains a malformed row')
      }
      if (previous && !ahead(row, previous)) return unknown('the address history is not in ascending chain order')
      previous = row
      if (!ahead(row, cursor)) continue   // at or before the cursor: already checked
      if (row.blockHeight > tip.blockHeight) return unknown('the address history is ahead of the chain tip')

      if (checked >= MINT_SCAN_CANDIDATES_PER_POLL) return unknown('still scanning the address history')
      checked++
      const tx = await reader.confirmedTransaction(row.txHash)
      if (!tx || String(tx.txHash).toLowerCase() !== row.txHash.toLowerCase()
          || tx.blockHeight !== row.blockHeight || typeof tx.cbor !== 'string') {
        return unknown('the provider returned a transaction that does not match the address history')
      }
      const outputs = await reader.transactionOutputs(row.txHash)
      const outcome = evaluateMintCandidate(attestation, { txHash: row.txHash.toLowerCase(), cbor: tx.cbor }, outputs)
      const confirmations = tip.blockHeight - tx.blockHeight + 1
      const deep = confirmations >= input.minConfirmations
      const candidate = { txHash: row.txHash.toLowerCase(), blockHeight: tx.blockHeight, confirmations }
      const passCandidate = () => { cursor.blockHeight = row.blockHeight; cursor.txIndex = row.txIndex }

      switch (outcome.kind) {
        case 'verified':
          if (!deep) return result('awaiting-confirmations', { cursor: snapshot(), candidate, checked })
          // The cursor stays immediately BEFORE the mint (after the unrelated
          // transactions already passed), so a later poll re-verifies it — a
          // rollback or a second scanner's disagreement stays visible.
          return result('minted', { cursor: snapshot(), proof: outcome.proof, candidate, checked })

        case 'evidence-unreadable':
          // The provider's data is not trustworthy: judge the SAME candidate again.
          return unknown(`candidate ${row.txHash} could not be read reliably: ${outcome.reason}`)

        case 'mint-conflict':
          // Circle's attestation is really here, but the mint or credit is wrong.
          // Not skipped, not "awaiting": the cursor stays before it for review.
          // A SHALLOW conflicting candidate can still roll back: hold the cursor
          // before it and wait, instead of a final, non-retryable verdict.
          if (!deep) {
            return result('conflict-awaiting-confirmations', {
              cursor: snapshot(), candidate, checked, provisionalConflict: outcome.code, reason: outcome.reason,
            })
          }
          return result('mint-conflict', { cursor: snapshot(), candidate, checked, conflict: outcome.code, reason: outcome.reason })

        case 'failed-attempt':
          // A phase-2 failure is final once it is deep enough to stay on chain;
          // pass it then, so a later successful attempt can still be found.
          if (deep) passCandidate()
          return result('mint-attempt-failed', { cursor: snapshot(), candidate, checked, reason: outcome.reason })

        case 'unrelated':
          // Not the mint. Only a transaction at the required depth is passed for
          // good: a shallower one could still be rolled back and its position
          // reused, so the scan waits there instead.
          if (!deep) return result('awaiting-mint', { cursor: snapshot(), checked, reason: 'waiting for newer transactions to reach the required depth' })
          passCandidate()
          break
      }
    }

    // Fewer rows than asked for: this is the current end of the address history.
    return rows.length < count
      ? result('awaiting-mint', { cursor: snapshot(), checked })
      : unknown('still scanning the address history')
  } catch (e) {
    const kind = e instanceof CardanoReaderError ? e.kind : 'unavailable'
    return unknown(kind === 'rate-limited'
      ? 'the Cardano provider is rate-limiting; will retry'
      : `the Cardano provider could not be read (${kind}); will retry`)
  }
}
