/**
 * journey-recheck.ts — re-read a restored journey's SENT steps from their
 * chains, by the transaction hashes saved before broadcast (privileged layer).
 *
 * Read-only toward the chains: nothing is built, signed or re-sent. Persisted,
 * through the store's progress guard:
 *   - a cbADA bridge step's CCIP message id, recovered from the CONFIRMED Base
 *     receipt (recoverBridgeReference; stored once, never replaced);
 *   - a USDCx burn step's outcome (usdcx-burn-tracking.ts): confirmed only with
 *     the MEASURED destination credit; failed only for a burn that failed script
 *     validation; needs-review for conflicts. Pending evidence changes nothing.
 *
 * For a cbADA bridge step with a message id, Solana delivery is DISCOVERED
 * (cbada-solana-delivery.ts) and decided only by the OffRamp/credit proof.
 */

import type { StablecoinJourney, JourneyLeg } from '../shared/stablecoin-journey'
import type { JourneyStore } from './journey-store'
import { CBADA } from './cbada-ccip'
import { recoverBridgeReference, CcipSendError, type ReceiptLike } from './cbada-ccip-send'
import { findSolanaCbAdaDelivery, type DeliverySearch, type DeliveryCursor, type SolanaDeliveryReads } from './cbada-solana-delivery'
import { checkUsdcxBurnLeg, type BurnLegEvidence, type UsdcxBurnReads } from './usdcx-burn-tracking'
import { recordLegOutcome } from '../shared/stablecoin-journey'

/**
 * Where each message's Solana search got to, so repeated checks continue
 * instead of restarting at the newest transaction. In-process: after a restart
 * the search starts again (still bounded, still never reported as "not delivered").
 */
const deliveryCursors = new Map<string, DeliveryCursor>()
export function __clearDeliveryCursors(): void { deliveryCursors.clear() }

export type OnChain = 'confirmed' | 'failed' | 'not-found' | 'unknown'

export interface LegEvidence {
  role: JourneyLeg['role']
  /** `approval`: the step's token approval, sent while the step itself was not. */
  kind: 'transaction' | 'approval'
  chain: string
  txHash: string
  /** What the chain says about the saved hash right now. */
  onChain: OnChain
  /** cbADA bridge: the CCIP message id from the confirmed send, when recovered. */
  messageId: string | null
  /** cbADA bridge with a message id: the Solana delivery search, decided by the proof. */
  delivery: DeliverySearch | null
  /** Approval only: whether the current allowance covers the approved amount (null when unreadable). */
  allowanceCovers: boolean | null
  /** USDCx burn step: the burn, the provider's row and the destination credit. */
  burn: BurnLegEvidence | null
  note: string | null
}

export interface RecheckReads {
  /** ERC-20 allowance(owner, spender), or null when unreadable. */
  evmAllowance(chain: string, token: string, owner: string, spender: string): Promise<bigint | null>
  evmReceipt(chain: string, txHash: string): Promise<(ReceiptLike & { blockNumber: string }) | null | 'unreadable'>
  evmBlockTime(chain: string, blockNumber: string): Promise<number | null>
  solanaStatus(signature: string): Promise<'confirmed' | 'failed' | 'not-found' | null>
  cardanoTx(txHash: string): Promise<'confirmed' | 'failed' | 'not-found' | null>
  solanaDelivery: SolanaDeliveryReads
  /** USDCx burn tracking; without it a burn step is only looked up on Cardano. */
  usdcxBurn?: UsdcxBurnReads
}

const SENT = new Set(['submitted', 'uncertain', 'needs-review', 'confirmed', 'failed'])

export async function recheckJourney(
  journey: StablecoinJourney, store: JourneyStore, reads: RecheckReads,
  wallet: { evm?: string; cardano?: string }, now: number,
): Promise<{ journey: StablecoinJourney; legs: LegEvidence[] }> {
  let current = journey
  const legs: LegEvidence[] = []
  for (const leg of journey.legs) {
    // An approval sent before an interruption: its receipt and the allowance,
    // read-only. It is never sent again, and the step is never sent from here.
    if (leg.approvalTxHash && !leg.txHash && leg.state === 'approved' && (leg.chain === 'base' || leg.chain === 'ethereum')) {
      const ev: LegEvidence = { role: leg.role, kind: 'approval', chain: leg.chain, txHash: leg.approvalTxHash, onChain: 'unknown',
        messageId: null, delivery: null, allowanceCovers: null, burn: null, note: null }
      const r = await reads.evmReceipt(leg.chain, leg.approvalTxHash)
      if (r === 'unreadable') ev.note = 'The network could not be read; try again.'
      else if (r === null) { ev.onChain = 'not-found'; ev.note = 'The approval is not on chain (yet). It is checked again, never sent again.' }
      else ev.onChain = r.status === '0x1' ? 'confirmed' : 'failed'
      const owner = journey.authorization?.sender ?? wallet.evm
      if (owner && leg.approvedInputRaw && journey.bridge === 'ccip-cbada') {
        const a = await reads.evmAllowance(leg.chain, CBADA.base.token, owner, CBADA.base.router)
        ev.allowanceCovers = a === null ? null : a >= BigInt(leg.approvedInputRaw)
      }
      if (ev.onChain === 'failed') {
        ev.note = 'The approval failed on chain; only its network fee was spent. It is not sent again — a new transfer needs a new approval.'
      } else if (ev.onChain === 'confirmed' && ev.allowanceCovers) {
        ev.note = 'Approval confirmed. The transfer itself has not been sent.'
      }
      legs.push(ev)
      continue
    }
    if (!leg.txHash || !SENT.has(leg.state)) continue
    const ev: LegEvidence = { role: leg.role, kind: 'transaction', chain: leg.chain, txHash: leg.txHash, onChain: 'unknown',
      messageId: leg.providerRef, delivery: null, allowanceCovers: null, burn: null, note: null }
    try {
      if (leg.chain === 'base' || leg.chain === 'ethereum') {
        const r = await reads.evmReceipt(leg.chain, leg.txHash)
        if (r === 'unreadable') ev.note = 'The network could not be read; try again.'
        else if (r === null) ev.onChain = 'not-found'
        else {
          ev.onChain = r.status === '0x1' ? 'confirmed' : 'failed'
          if (leg.role === 'bridge' && journey.bridge === 'ccip-cbada' && ev.onChain === 'confirmed') {
            if (!wallet.evm || !leg.approvedInputRaw) {
              ev.note = 'The approved terms needed to read this message are missing.'
            } else {
              const terms = { sender: wallet.evm, solanaRecipient: journey.recipient, amountRaw: leg.approvedInputRaw, feeWei: '0' }
              const rec = await recoverBridgeReference(store, current, terms, async () => r, now)
              current = rec.journey
              ev.messageId = rec.messageId
              const sentAt = await reads.evmBlockTime(leg.chain, r.blockNumber)
              if (rec.messageId && sentAt !== null) {
                const search = await findSolanaCbAdaDelivery(
                  { messageId: rec.messageId, recipient: journey.recipient, amountRaw: leg.approvedInputRaw, sentAt },
                  reads.solanaDelivery, { cursor: deliveryCursors.get(rec.messageId) ?? null })
                if ('cursor' in search) deliveryCursors.set(rec.messageId, search.cursor)
                else deliveryCursors.delete(rec.messageId)
                ev.delivery = search
              } else if (rec.messageId) {
                ev.note = 'The send time could not be read, so Solana delivery was not searched.'
              }
            }
          }
        }
      } else if (leg.chain === 'solana') {
        ev.onChain = (await reads.solanaStatus(leg.txHash)) ?? 'unknown'
      } else if (leg.chain === 'cardano' && leg.role === 'bridge' && journey.bridge.startsWith('xreserve-') && reads.usdcxBurn) {
        const { evidence, outcome } = await checkUsdcxBurnLeg(current, wallet.cardano ?? null, reads.usdcxBurn)
        ev.burn = evidence
        ev.note = evidence.reason
        ev.onChain = evidence.burn === 'not-found' ? 'not-found'
          : evidence.burn === 'failed-attempt' ? 'failed'
          : evidence.burn === 'verified' ? 'confirmed' : 'unknown'
        const live = current.legs[1]
        const settled = outcome?.state === 'confirmed' && live.state === 'confirmed'
        if (outcome && !settled && live.state !== outcome.state && ['submitted', 'uncertain', 'needs-review'].includes(live.state)) {
          const next = recordLegOutcome(current, 'bridge', outcome, now)
          await store.put(next)
          current = next
        }
      } else if (leg.chain === 'cardano') {
        ev.onChain = (await reads.cardanoTx(leg.txHash)) ?? 'unknown'
      }
    } catch (e) {
      // A receipt that does not match the approved terms is evidence for review, not a crash.
      ev.note = e instanceof CcipSendError ? `Needs review: ${e.message}` : 'This step could not be checked; try again.'
    }
    legs.push(ev)
  }
  return { journey: current, legs }
}

/** Live reads over the wallet's public endpoints. */
export function liveRecheckReads(
  evmRpcs: Record<string, string[]>, solanaRpcs: string[], cardano: (path: string) => Promise<Response>,
  solanaDelivery: SolanaDeliveryReads, fetchFn: typeof fetch = fetch,
): RecheckReads {
  const rpc = async <T>(urls: string[], method: string, params: unknown[]): Promise<{ ok: true; result: T | null } | { ok: false }> => {
    for (const url of urls) {
      try {
        const r = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15_000) })
        if (!r.ok) continue
        const j = await r.json() as { result?: T | null; error?: unknown }
        if (j.error === undefined) return { ok: true, result: j.result ?? null }
      } catch { /* next endpoint */ }
    }
    return { ok: false }
  }
  return {
    async evmReceipt(chain, txHash) {
      const r = await rpc<ReceiptLike & { blockNumber: string }>(evmRpcs[chain] ?? [], 'eth_getTransactionReceipt', [txHash])
      return r.ok ? r.result : 'unreadable'
    },
    async evmAllowance(chain, token, owner, spender) {
      // allowance(address,address) selector 0xdd62ed3e
      const pad = (a: string) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0')
      const r = await rpc<string>(evmRpcs[chain] ?? [], 'eth_call', [{ to: token, data: '0xdd62ed3e' + pad(owner) + pad(spender) }, 'latest'])
      return r.ok && typeof r.result === 'string' && /^0x[0-9a-fA-F]+$/.test(r.result) ? BigInt(r.result) : null
    },
    async evmBlockTime(chain, blockNumber) {
      const r = await rpc<{ timestamp: string }>(evmRpcs[chain] ?? [], 'eth_getBlockByNumber', [blockNumber, false])
      return r.ok && r.result ? Number(BigInt(r.result.timestamp)) : null
    },
    async solanaStatus(signature) {
      const r = await rpc<{ value: Array<{ err: unknown; confirmationStatus?: string } | null> }>(solanaRpcs, 'getSignatureStatuses', [[signature], { searchTransactionHistory: true }])
      if (!r.ok || !r.result) return null
      const s = r.result.value[0]
      if (!s) return 'not-found'
      if (s.err) return 'failed'
      return s.confirmationStatus === 'finalized' || s.confirmationStatus === 'confirmed' ? 'confirmed' : 'not-found'
    },
    async cardanoTx(txHash) {
      try {
        const res = await cardano(`txs/${txHash}`)
        if (res.status === 404) return 'not-found'
        if (!res.ok) return null
        const d = await res.json() as { valid_contract?: boolean }
        return d.valid_contract === false ? 'failed' : 'confirmed'
      } catch { return null }
    },
    solanaDelivery,
  }
}
