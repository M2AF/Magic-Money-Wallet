/**
 * cbada-solana-delivery.ts — FIND the Solana transaction that executed a
 * Base -> Solana cbADA CCIP message (privileged layer, read-only).
 *
 * Discovery is not proof. This module only gathers candidate transactions;
 * every candidate is decided by verifySolanaCbAdaDelivery (cbada-ccip-send.ts):
 * the pinned OffRamp's own ExecutionStateChanged event for exactly this message
 * id from Base in state Success, and the recipient's exact cbADA credit.
 *
 * WHERE IT LOOKS. A successful delivery writes the recipient's cbADA token
 * account, so that account's signature history contains the execution:
 *   - every token account the recipient currently holds for the mint (no cap),
 *   - AND the recipient's associated token account, derived — the CCIP Solana
 *     token pool releases/mints to the receiver's ATA, and an address's history
 *     survives the account being closed, so a later-closed account is still
 *     searched even though the current-account lookup no longer lists it.
 *
 * COMPLETENESS. The search is bounded per call and RESUMABLE: a cursor per
 * account records the newest signature already checked and where the walk into
 * older history stopped. The next call first checks transactions newer than
 * that (oldest first, so it can stop anywhere and resume), then continues the
 * older walk from where it stopped, down to the Base send time. An exhausted
 * budget or a failed read is `incomplete` (with the cursor to continue) — never
 * "not delivered". `not-found-yet` means every candidate back to the send time
 * was checked. A FAILED execution may not touch the recipient's account at all,
 * so not-found-yet is never reported as failure or refund.
 */

import { PublicKey } from '@solana/web3.js'
import { CBADA } from './cbada-ccip'
import { verifySolanaCbAdaDelivery, type SolanaParsedTx } from './cbada-ccip-send'
import { associatedTokenAddress, TOKEN_PROGRAM_ID } from './spl-transfer'

/** cbADA on Solana is a classic SPL Token mint (its CCIP transactions invoke Tokenkeg…, 2026-10-05). */
const CBADA_TOKEN_PROGRAM = TOKEN_PROGRAM_ID

export interface SolanaDeliveryReads {
  /** Token accounts (addresses) the owner holds for the mint. Null when unreadable. */
  tokenAccounts(owner: string, mint: string): Promise<string[] | null>
  /** Signatures touching `address`, newest first; `until` stops before that signature. Null when unreadable. */
  signatures(address: string, limit: number, opts?: { before?: string; until?: string }): Promise<Array<{ signature: string; blockTime: number | null }> | null>
  /** jsonParsed transaction, or null when not found/unreadable. */
  transaction(signature: string): Promise<SolanaParsedTx | null>
}

/** How far each account's history has been checked. Pass back to continue. */
export interface DeliveryCursor {
  messageId: string
  accounts: Record<string, { newest: string | null; before: string | null; done: boolean }>
}

export type DeliverySearch =
  | { state: 'delivered'; signature: string; sequenceNumber: string }
  | { state: 'execution-failed'; signature: string; sequenceNumber: string }
  | { state: 'credit-mismatch'; signature: string; creditedRaw: string }
  /** Every candidate back to the send time, in every account searched, was checked. */
  | { state: 'not-found-yet'; checked: number; cursor: DeliveryCursor }
  /** The budget ran out or a read failed. Continue with `cursor`. */
  | { state: 'incomplete'; checked: number; reason: string; cursor: DeliveryCursor }

export interface DeliveryQuery {
  messageId: string
  /** The Solana wallet the message credits. */
  recipient: string
  amountRaw: string
  /** Unix seconds of the confirmed Base send; older Solana transactions cannot be the delivery. */
  sentAt: number
}

const PAGE = 25
/** Newer-than-cursor pages read per account per call before giving up as incomplete. */
const MAX_NEWER_PAGES = 20

export function recipientAta(recipient: string): string {
  return associatedTokenAddress(new PublicKey(CBADA.solana.token), new PublicKey(recipient), CBADA_TOKEN_PROGRAM).toBase58()
}

export async function findSolanaCbAdaDelivery(
  q: DeliveryQuery, reads: SolanaDeliveryReads, opts: { maxTransactions?: number; cursor?: DeliveryCursor | null } = {},
): Promise<DeliverySearch> {
  const budget = opts.maxTransactions ?? 40
  const cursor: DeliveryCursor = opts.cursor && opts.cursor.messageId === q.messageId
    ? { messageId: q.messageId, accounts: structuredClone(opts.cursor.accounts) }
    : { messageId: q.messageId, accounts: {} }
  let checked = 0
  let unreadable: string | null = null

  // Every current account, plus the derived ATA (covers a later-closed account).
  const listed = await reads.tokenAccounts(q.recipient, CBADA.solana.token)
  if (listed === null) unreadable = 'the recipient\'s token accounts could not be read'
  let ata: string | null = null
  try { ata = recipientAta(q.recipient) } catch { unreadable = unreadable ?? 'the recipient is not a valid Solana address' }
  const accounts = [...new Set([...(ata ? [ata] : []), ...(listed ?? [])])]

  type Verdict = Exclude<DeliverySearch, { state: 'not-found-yet' | 'incomplete' }>
  const judge = async (signature: string): Promise<Verdict | 'continue' | 'unreadable'> => {
    const tx = await reads.transaction(signature)
    if (!tx) return 'unreadable'
    const v = verifySolanaCbAdaDelivery(tx, q)
    if (v.state === 'delivered') return { state: 'delivered', signature, sequenceNumber: v.sequenceNumber }
    if (v.state === 'execution-failed') return { state: 'execution-failed', signature, sequenceNumber: v.sequenceNumber }
    if (v.state === 'credit-mismatch') return { state: 'credit-mismatch', signature, creditedRaw: v.creditedRaw }
    return 'continue'
  }
  const out = (reason: string): DeliverySearch => ({ state: 'incomplete', checked, reason, cursor })

  for (const account of accounts) {
    const st = cursor.accounts[account] ?? { newest: null, before: null, done: false }
    cursor.accounts[account] = st

    // ── 1. Newer than anything checked: oldest first, so a stop is resumable ─
    if (st.newest) {
      const newer: Array<{ signature: string; blockTime: number | null }> = []
      let before: string | undefined
      let pages = 0
      for (;;) {
        const page = await reads.signatures(account, PAGE, { until: st.newest, ...(before ? { before } : {}) })
        if (page === null) return out('a signature list could not be read')
        newer.push(...page)
        if (page.length < PAGE) break
        if (++pages >= MAX_NEWER_PAGES) return out('too many new transactions to check in one pass')
        before = page[page.length - 1].signature
      }
      for (const s of newer.reverse()) {
        if (checked >= budget) return out('search budget reached')
        checked++
        const v = await judge(s.signature)
        if (v === 'unreadable') return out('a candidate transaction could not be read')
        if (v !== 'continue') return v
        st.newest = s.signature
      }
    }

    // ── 2. Continue the walk into older history, down to the send time ───────
    while (!st.done) {
      const page = await reads.signatures(account, PAGE, st.before ? { before: st.before } : {})
      if (page === null) return out('a signature list could not be read')
      for (const s of page) {
        if (s.blockTime !== null && s.blockTime < q.sentAt) { st.done = true; break }
        if (checked >= budget) return out('search budget reached')
        checked++
        const v = await judge(s.signature)
        if (v === 'unreadable') return out('a candidate transaction could not be read')
        if (v !== 'continue') return v
        // The first signature checked in a fresh walk is the newest: later
        // passes look only above it for new transactions.
        if (st.newest === null) st.newest = s.signature
        st.before = s.signature
      }
      // A short page is the end of the history.
      if (page.length < PAGE) st.done = true
    }
  }
  if (unreadable) return out(unreadable)
  return { state: 'not-found-yet', checked, cursor }
}

/** JSON-RPC reads over the wallet's Solana endpoints, in order. */
export function solanaDeliveryReads(rpcUrls: string[], fetchFn: typeof fetch = fetch): SolanaDeliveryReads {
  const call = async <T>(method: string, params: unknown[]): Promise<T | null> => {
    for (const url of rpcUrls) {
      try {
        const r = await fetchFn(url, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15_000),
        })
        if (!r.ok) continue
        const j = await r.json() as { result?: T; error?: unknown }
        if (j.error === undefined && j.result !== undefined) return j.result
      } catch { /* next endpoint */ }
    }
    return null
  }
  return {
    async tokenAccounts(owner, mint) {
      const r = await call<{ value: Array<{ pubkey: string }> }>('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed' }])
      return r ? r.value.map(a => a.pubkey) : null
    },
    async signatures(address, limit, opts = {}) {
      const r = await call<Array<{ signature: string; blockTime: number | null }>>('getSignaturesForAddress', [address, { limit, ...opts }])
      return r ? r.map(s => ({ signature: s.signature, blockTime: s.blockTime ?? null })) : null
    },
    transaction: (signature) => call<SolanaParsedTx>('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]),
  }
}
