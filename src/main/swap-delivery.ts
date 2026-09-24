/**
 * swap-delivery.ts — how much ACTUALLY arrived, read from the destination chain.
 *
 * WHY
 *
 * A bridge's status response is a claim, and for LI.FI it is not even a
 * measurement. Field report 2026-09-22, two MON -> SOL swaps routed through
 * Relay: LI.FI's `receiving.amount` was 11717316 and 21358296 lamports, while
 * the destination transactions credited 12026493 and 21919609. LI.FI's figure
 * matched its own quoted output times (1 - 2.5% slippage) to within 1–4
 * lamports on both, so it is DERIVED from the quote, not observed. Relay's own
 * record, and the chain, agreed on the larger number.
 *
 * Two consequences. The status screen showed the wrong amount. And the
 * post-settlement shortfall check compared a quote-derived number against the
 * approved minimum, so for LI.FI it could never have caught a real shortfall.
 * Measuring the destination transaction fixes both — the check gets STRICTER,
 * not looser, because it now uses what arrived rather than what was promised.
 *
 * WHAT IT DOES NOT DO
 *
 * Every read is best-effort and read-only. An amount that cannot be measured is
 * `null` — never 0 — and the caller then keeps the provider's figure, labelled
 * as the provider's.
 */

import { Connection } from '@solana/web3.js'
import type { WalletConfig } from './secure-store'
import { heliusRpcUrl } from './api-proxy'
import { activeEvmChains } from './chain-config'
import { readEvmTokenCredit } from './tx-sender'
import { isNativeSwapAddress, normalizeSwapAddress } from '../shared/swap-token-identity'

/** The parts of a jsonParsed Solana transaction this reads. */
type TokenBalanceLike = { owner?: string; mint: string; uiTokenAmount: { amount: string } }

export interface ParsedSolanaTxLike {
  meta: {
    err: unknown
    fee: number
    preBalances: number[]
    postBalances: number[]
    preTokenBalances?: TokenBalanceLike[] | null
    postTokenBalances?: TokenBalanceLike[] | null
  } | null
  transaction: { message: { accountKeys: Array<{ pubkey: { toString(): string } | string }> } }
}

/**
 * What a Solana transaction credited `recipient` in `mint`, in base units.
 *
 * Native SOL (either spelling): the recipient's lamport change, plus any
 * wrapped-SOL held for them — with the network fee added back if the recipient
 * paid it, so paying a fee is not mistaken for receiving less. SPL tokens: the
 * change in the recipient's token balance for that mint, across all of its
 * accounts. Null for a failed transaction or when the recipient is not in it.
 */
export function solanaCredit(tx: ParsedSolanaTxLike, recipient: string, mint: string): bigint | null {
  const meta = tx.meta
  if (!meta || meta.err) return null
  const keys = tx.transaction.message.accountKeys.map(k => typeof k.pubkey === 'string' ? k.pubkey : k.pubkey.toString())

  const tokenDelta = (m: string): bigint => {
    const sum = (list: TokenBalanceLike[] | null | undefined) =>
      (list ?? []).filter(b => b.owner === recipient && b.mint === m)
        .reduce((a, b) => a + BigInt(b.uiTokenAmount.amount || '0'), 0n)
    return sum(meta.postTokenBalances) - sum(meta.preTokenBalances)
  }

  if (isNativeSwapAddress('solana', mint)) {
    const i = keys.indexOf(recipient)
    const lamports = i >= 0 ? BigInt(meta.postBalances[i] - meta.preBalances[i]) + (i === 0 ? BigInt(meta.fee) : 0n) : 0n
    const wsol = tokenDelta(normalizeSwapAddress('solana', mint))
    if (i < 0 && wsol === 0n) return null
    return lamports + wsol
  }
  const delta = tokenDelta(mint)
  const touched = [...(meta.preTokenBalances ?? []), ...(meta.postTokenBalances ?? [])]
    .some(b => b.owner === recipient && b.mint === mint)
  return touched ? delta : null
}

export interface DeliveryMeasurement {
  amountRaw: string
  source: 'onchain'
}

/**
 * Measure what the destination transaction credited to the recipient.
 * Null when it cannot be measured; see the header for why that is not 0.
 */
export async function measureDelivery(
  args: { toChain: string; destTxHash: string; recipient: string; tokenAddress: string },
  config: WalletConfig,
): Promise<DeliveryMeasurement | null> {
  const { toChain, destTxHash, recipient, tokenAddress } = args
  if (!destTxHash || !recipient || !tokenAddress) return null
  try {
    if (toChain === 'solana') {
      const connection = new Connection(heliusRpcUrl(config), 'confirmed')
      const tx = await connection.getParsedTransaction(destTxHash, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
      if (!tx) return null
      const credit = solanaCredit(tx as unknown as ParsedSolanaTxLike, recipient, tokenAddress)
      return credit != null && credit >= 0n ? { amountRaw: credit.toString(), source: 'onchain' } : null
    }
    // EVM: only ERC-20 deliveries leave a Transfer event to measure.
    if (isNativeSwapAddress(toChain, tokenAddress)) return null
    const chainId = activeEvmChains(config).find(c => c.id === toChain)?.chainId
    if (chainId == null) return null
    const credit = await readEvmTokenCredit(chainId, destTxHash, tokenAddress, recipient, config)
    return credit != null && credit > 0n ? { amountRaw: credit.toString(), source: 'onchain' } : null
  } catch {
    return null
  }
}
