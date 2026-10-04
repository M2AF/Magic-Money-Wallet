/**
 * xreserve-testnet-send-journal.ts — the durable "about to broadcast" record for
 * a Testnet Mode xReserve deposit, and the pure rules for recovering it.
 *
 * THE GAP IT CLOSES. A deposit can reach Sepolia before its tracking record is
 * saved (a crash, a failed write, or an uncertain broadcast). So, BEFORE the
 * signed deposit is broadcast, the executor saves this journal entry to the same
 * persisted store as the tracking records:
 *   • the wallet/account/environment identity and the approved sender;
 *   • the approved recipient, amount and fee cap (decimal strings);
 *   • the Cardano Preprod tip read before sending (tracking starts there);
 *   • the pinned Ethereum nonce and the transaction's hash, computed from the
 *     locally signed bytes before they were broadcast.
 * It holds NO calldata and NO signed bytes: nothing in it can be broadcast. The
 * calldata is rebuilt from the approved terms when recovering.
 *
 * RECOVERY (`judgeJournal`) reads the chain for the pre-computed hash and
 * accepts it ONLY if the transaction matches sender, nonce, the Sepolia xReserve
 * contract, chain id, zero value and the EXACT calldata rebuilt from the terms.
 *   found      → start tracking from the recorded tip, then clear the entry;
 *   not-sent   → the hash is absent AND the nonce was used ≥ NOT_SENT_DEPTH
 *                blocks deep by something else: this deposit can never land, so
 *                the entry is cleared;
 *   mismatch   → a transaction with that hash exists but is not the approved
 *                deposit: kept, never tracked, needs a person;
 *   unresolved → anything else (not seen yet, pending, RPC trouble): kept.
 * Nothing here ever sends a transaction again.
 *
 * NEW DEPOSITS WHILE ONE IS PENDING. Two transactions from one account with the
 * SAME nonce can never both land. So a new deposit is refused only while a
 * pending entry sits at a LOWER nonce than the new deposit would use (both
 * could land: a double deposit). At the same nonce the new deposit replaces the
 * old one — the old one can then only land instead of it, never as well — and
 * both entries are resolved by recovery. This also avoids a deadlock: a deposit
 * that never reached any node leaves its nonce unused, and could otherwise
 * never be resolved.
 */

import { buildCardanoDepositRequest, type CardanoDepositInput } from './xreserve-cardano-deposit'
import { XRESERVE_SEPOLIA_PREPROD } from './xreserve-network'
import type { TrackingIdentity } from './xreserve-inbound-tracking'

const NET = XRESERVE_SEPOLIA_PREPROD
/** Blocks under the tip at which a used nonce proves this deposit can no longer land. */
export const NOT_SENT_DEPTH = 12

export interface SendJournalEntry {
  v: 1
  kind: 'xreserve-send-journal'
  identity: TrackingIdentity
  /** Lower-case 0x sender. */
  sender: string
  chainId: number
  /** Lower-case Sepolia xReserve contract. */
  xReserve: string
  nonce: number
  /** Lower-case hash of the signed deposit, computed before broadcast. */
  txHash: string
  approved: { recipient: string; amountRaw: string; maxFeeRaw: string }
  confirmations: { ethereum: number; cardano: number }
  cardanoTipAtSubmission: { blockHeight: number }
  /** ms since epoch, for display only. */
  createdAt: number
}

const PREFIX = 'xreserve-send:v1:'
/**
 * One entry per SIGNED deposit. The hash is part of the key: a later deposit at
 * the same nonce (a replacement — only one of the two can ever land) gets its
 * own entry, so both are resolved rather than one overwriting the other.
 */
export const sendJournalKey = (identity: TrackingIdentity, nonce: number, txHash: string) =>
  `${PREFIX}${identity.environment}:${identity.walletId}:${identity.accountId}:${nonce}:${txHash.toLowerCase()}`
/** Every journal key of this identity starts with this. */
export const sendJournalPrefix = (identity: TrackingIdentity) =>
  `${PREFIX}${identity.environment}:${identity.walletId}:${identity.accountId}:`
export const isSendJournalKey = (key: string) => key.startsWith(PREFIX)

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const exactKeys = (o: Record<string, unknown>, keys: string[]) =>
  Object.keys(o).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(o, k))
const nonNegInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0

/** Parse a stored entry, refusing anything that is not exactly one. */
export function parseSendJournal(json: unknown): SendJournalEntry | null {
  let raw: unknown
  try { raw = typeof json === 'string' ? JSON.parse(json) : null } catch { return null }
  if (!isObj(raw) || !exactKeys(raw, ['v', 'kind', 'identity', 'sender', 'chainId', 'xReserve', 'nonce', 'txHash', 'approved', 'confirmations', 'cardanoTipAtSubmission', 'createdAt'])) return null
  const { identity: id, approved: a, confirmations: c, cardanoTipAtSubmission: t } = raw
  if (raw.v !== 1 || raw.kind !== 'xreserve-send-journal') return null
  if (!isObj(id) || !exactKeys(id, ['walletId', 'accountId', 'environment']) || id.environment !== 'testnet'
      || typeof id.walletId !== 'string' || !id.walletId || typeof id.accountId !== 'string' || !id.accountId) return null
  if (typeof raw.sender !== 'string' || !/^0x[0-9a-f]{40}$/.test(raw.sender)) return null
  if (raw.chainId !== NET.ethereum.chainId || raw.xReserve !== NET.ethereum.xReserve.toLowerCase()) return null
  if (!nonNegInt(raw.nonce) || typeof raw.txHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(raw.txHash)) return null
  if (!isObj(a) || !exactKeys(a, ['recipient', 'amountRaw', 'maxFeeRaw']) || typeof a.recipient !== 'string'
      || typeof a.amountRaw !== 'string' || !/^[1-9][0-9]*$/.test(a.amountRaw)
      || typeof a.maxFeeRaw !== 'string' || !/^(0|[1-9][0-9]*)$/.test(a.maxFeeRaw)) return null
  if (!isObj(c) || !exactKeys(c, ['ethereum', 'cardano']) || !Number.isSafeInteger(c.ethereum) || (c.ethereum as number) < 1
      || !Number.isSafeInteger(c.cardano) || (c.cardano as number) < 1) return null
  if (!isObj(t) || !exactKeys(t, ['blockHeight']) || !nonNegInt(t.blockHeight)) return null
  if (!nonNegInt(raw.createdAt)) return null
  try { buildCardanoDepositRequest({ recipient: a.recipient, amountRaw: a.amountRaw, maxFeeRaw: a.maxFeeRaw }, NET) } catch { return null }
  return raw as unknown as SendJournalEntry
}

export const approvedOf = (e: SendJournalEntry): CardanoDepositInput =>
  ({ recipient: e.approved.recipient, amountRaw: BigInt(e.approved.amountRaw), maxFeeRaw: BigInt(e.approved.maxFeeRaw) })

export type JournalVerdict =
  | { kind: 'found'; pending: boolean }
  | { kind: 'not-sent' }
  | { kind: 'mismatch'; field: string }
  | { kind: 'unresolved'; reason: string }

const quantity = (v: unknown): bigint | null =>
  typeof v === 'bigint' ? v : typeof v === 'string' && /^0x[0-9a-fA-F]+$/.test(v) ? BigInt(v) : typeof v === 'number' && Number.isSafeInteger(v) ? BigInt(v) : null

/**
 * Judge one journal entry from trusted Sepolia reads:
 *   `tx` — eth_getTransactionByHash(entry.txHash) (null = not known to the node);
 *   `usedNonceDeep` — the sender's transaction count at (tip − NOT_SENT_DEPTH),
 *   or null when it could not be read.
 */
export function judgeJournal(entry: SendJournalEntry, tx: unknown, usedNonceDeep: number | null): JournalVerdict {
  if (tx !== null && tx !== undefined) {
    if (!isObj(tx)) return { kind: 'unresolved', reason: 'the transaction read was malformed' }
    const want = buildCardanoDepositRequest(approvedOf(entry), NET)
    const checks: Array<[string, boolean]> = [
      ['hash', typeof tx.hash === 'string' && tx.hash.toLowerCase() === entry.txHash],
      ['sender', typeof tx.from === 'string' && tx.from.toLowerCase() === entry.sender],
      ['nonce', quantity(tx.nonce) === BigInt(entry.nonce)],
      ['destination', typeof tx.to === 'string' && tx.to.toLowerCase() === entry.xReserve],
      ['chain', quantity(tx.chainId) === BigInt(entry.chainId)],
      ['value', quantity(tx.value) === 0n],
      ['calldata', typeof tx.input === 'string' && tx.input.toLowerCase() === want.data.toLowerCase()],
    ]
    const bad = checks.find(([, ok]) => !ok)
    if (bad) return { kind: 'mismatch', field: bad[0] }
    return { kind: 'found', pending: tx.blockNumber === null || tx.blockNumber === undefined }
  }
  if (usedNonceDeep !== null && usedNonceDeep > entry.nonce) return { kind: 'not-sent' }
  return { kind: 'unresolved', reason: 'the deposit is not visible on Sepolia yet, and its nonce is still open' }
}
