/**
 * cardano-swap.ts — Cardano same-chain swaps: quote, pre-signing check, and
 * order status (privileged layer, shared by all four targets).
 *
 * The one provider is the Minswap Aggregator, and the one transaction shape is a
 * Minswap V2 batcher order (see cardano-swap-validate.ts for exactly what is and
 * is not accepted, and docs/CARDANO-SWAP-DISCOVERY.md for the live evidence).
 *
 * THE ORDER LIFECYCLE IS NOT A SAME-CHAIN SWAP'S
 *
 * An EVM or Solana swap is atomic: the transaction that confirms IS the trade.
 * A batcher order is two events. The wallet's transaction only LOCKS the sell
 * amount at the order script; a batcher trades it later, or — when the price
 * moves past the minimum — never. Every live V2 order sampled was non-killable,
 * so an unfilled order waits for its owner to cancel it. Settlement is therefore
 * read from Cardano itself: find the transaction that spent the order, and
 * measure what it paid this wallet. The provider is never asked what happened.
 *
 * Cancelling is not built into the wallet: the aggregator API documents a
 * cancel endpoint that does not exist (404, measured 2026-09-26), and a cancel
 * spends a script UTxO (redeemer, collateral, reference script, execution
 * units) — a different transaction class from the one validated here. The
 * recovery path is Minswap's own Orders page, opened in the wallet's browser and
 * signed through the existing CIP-30 prompt, which decodes what it signs.
 */

import { bech32 } from '@scure/base'
import { blockfrostFetch } from './api-proxy'
import { fetchUtxos, fetchCardanoTip } from './tx-sender'
import { isTestnet } from './chain-config'
import type { WalletConfig } from './secure-store'
import type { NormalizedSwapQuote, SwapQuoteRequest, CrossSwapStatusRequest, CrossSwapStatus } from './swap-proxy'
import { minswapQuoteDirect, MinswapQuoteError, type MinswapFetch } from './minswap-client'
import {
  validateMinswapOrderTx, indexWalletUtxos, CardanoSwapValidationError,
  type MinswapOrderExpectation, type ValidatedMinswapOrder,
} from './cardano-swap-validate'
import { MINSWAP_V2, decodeMinswapV2OrderDatum } from './minswap-v2-order'
import { CARDANO_LOVELACE, normalizeSwapAddress } from '../shared/swap-token-identity'

export const MINSWAP_ORDERS_URL = 'https://minswap.org/orders'
export const cardanoscanTx = (hash: string) => `https://cardanoscan.io/transaction/${hash}`

export class CardanoSwapError extends Error {}

/** What the validator must hold the transaction to, taken from the bound quote. */
export function expectationFromQuote(quote: NormalizedSwapQuote, walletAddress: string, testnet: boolean): MinswapOrderExpectation {
  if (quote.provider !== 'minswap' || !quote.cardanoOrder || !quote.txData?.cbor) {
    throw new CardanoSwapError('This Cardano quote carries no order to check.')
  }
  if (!quote.minBuyAmountRaw) throw new CardanoSwapError('This Cardano quote has no minimum received.')
  return {
    walletAddress,
    network: testnet ? 'testnet' : 'mainnet',
    sellUnit: normalizeSwapAddress('cardano', quote.fromTokenAddress),
    sellAmountRaw: quote.sellAmountRaw,
    buyUnit: normalizeSwapAddress('cardano', quote.toTokenAddress),
    buyAmountRaw: quote.buyAmountRaw,
    minBuyAmountRaw: quote.minBuyAmountRaw,
    terms: quote.cardanoOrder,
  }
}

/**
 * Validate the quote's transaction against the wallet's CURRENT coins and the
 * current slot. Both are read fresh on every call: an input spent since the
 * quote, or a validity window that has closed, must stop the swap here rather
 * than at the node.
 */
export async function checkCardanoSwapTx(
  quote: NormalizedSwapQuote, walletAddress: string, config: WalletConfig,
): Promise<ValidatedMinswapOrder> {
  const expectation = expectationFromQuote(quote, walletAddress, isTestnet(config))
  const [utxos, tip] = await Promise.all([fetchUtxos(walletAddress, config), fetchCardanoTip(config)])
  if (tip == null) {
    throw new CardanoSwapError('Could not read the current Cardano slot, so the order\'s validity window cannot be checked.')
  }
  return validateMinswapOrderTx(quote.txData.cbor as string, expectation, indexWalletUtxos(utxos), tip)
}

/**
 * Quote a Cardano same-chain swap for the wallet's own address, and refuse it
 * unless its transaction passes the same check signing will run.
 */
export async function prepareCardanoSwapQuote(
  req: SwapQuoteRequest, config: WalletConfig, fetchFn: MinswapFetch,
): Promise<NormalizedSwapQuote> {
  if (isTestnet(config)) {
    throw new CardanoSwapError('Cardano swaps are mainnet-only: the Minswap aggregator has no Preprod endpoint.')
  }
  if (!req.taker) throw new CardanoSwapError('This wallet has no Cardano address for this account.')
  let quote: NormalizedSwapQuote
  try {
    quote = await minswapQuoteDirect({
      sellUnit: req.fromToken,
      buyUnit: req.toToken,
      sellAmountRaw: req.sellAmountRaw,
      slippageBps: req.slippageBps,
      sender: req.taker,
      fromSymbol: req.fromSymbol,
      toSymbol: req.toSymbol,
    }, fetchFn)
  } catch (e) {
    if (e instanceof MinswapQuoteError) throw new CardanoSwapError(e.message)
    throw e
  }
  try {
    const validated = await checkCardanoSwapTx(quote, req.taker, config)
    return { ...quote, cardanoCost: validated.cost }
  } catch (e) {
    if (e instanceof CardanoSwapValidationError) {
      throw new CardanoSwapError(`The Minswap transaction failed the wallet's safety check: ${e.message}.`)
    }
    throw e
  }
}

// ── Order status, measured on Cardano ─────────────────────────────────────────

interface BfAmount { unit: string; quantity: string }
interface BfUtxos {
  inputs: Array<{ address: string; amount: BfAmount[]; tx_hash: string; output_index: number }>
  outputs: Array<{ address: string; amount: BfAmount[]; output_index: number; inline_datum?: string | null }>
}

async function bfJson<T>(path: string, config: WalletConfig): Promise<{ status: number; data: T | null }> {
  const res = await blockfrostFetch(path, config, 12_000)
  if (!res.ok) return { status: res.status, data: null }
  return { status: res.status, data: await res.json().catch(() => null) as T | null }
}

function paymentHashOf(address: string): { type: number; hash: string } | null {
  try {
    const bytes = bech32.fromWords(bech32.decode(address as `${string}1${string}`, 1000).words)
    return { type: bytes[0] >> 4, hash: Array.from(bytes.slice(1, 29), b => b.toString(16).padStart(2, '0')).join('') }
  } catch {
    return null
  }
}

function hexBytes(value: string): Uint8Array {
  const out = new Uint8Array(value.length >> 1)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16)
  return out
}

function credited(outputs: BfUtxos['outputs'], address: string, unit: string): bigint {
  let sum = 0n
  for (const o of outputs) {
    if (o.address !== address) continue
    for (const a of o.amount) if (a.unit.toLowerCase() === unit) sum += BigInt(a.quantity)
  }
  return sum
}

/** How many of the wallet's later transactions are inspected per poll. */
const MAX_SPENDER_LOOKUPS = 25

/**
 * Where a Minswap order stands, in the vocabulary `mapMinswapStatus` reads.
 * A read failure is UNKNOWN (poll again), never a verdict.
 */
export async function getMinswapOrderStatus(
  req: CrossSwapStatusRequest, config: WalletConfig,
): Promise<CrossSwapStatus> {
  const unknown: CrossSwapStatus = { status: 'pending', state: 'unknown', error: null, providerStatus: 'UNKNOWN' }
  const wallet = req.recipient ?? ''
  const buyUnit = normalizeSwapAddress('cardano', req.expectedToTokenAddress ?? '')
  if (!req.txHash || !wallet || !buyUnit) return { ...unknown, error: 'missing order details' }
  try {
    const order = await bfJson<BfUtxos>(`txs/${req.txHash}/utxos`, config)
    if (order.status === 404) {
      return { status: 'pending', state: 'source-submitted', error: null, providerStatus: 'NOT_FOUND' }
    }
    if (!order.data) return unknown
    const orderOut = order.data.outputs.find(o => {
      const p = paymentHashOf(o.address)
      return p?.type === 1 && p.hash === MINSWAP_V2.orderScriptHash
    })
    if (!orderOut) return { ...unknown, error: 'the transaction created no Minswap order' }
    const sellUnit = orderOut.amount.find(a => a.unit !== CARDANO_LOVELACE)?.unit.toLowerCase() ?? CARDANO_LOVELACE
    const orderLovelace = BigInt(orderOut.amount.find(a => a.unit === CARDANO_LOVELACE)?.quantity ?? '0')
    // The deposit is what the order locked beyond its max batcher fee (and
    // beyond the sale itself when ADA is sold) — read from the order's own datum.
    let maxBatcherFee: bigint | null = null
    try {
      if (orderOut.inline_datum) maxBatcherFee = decodeMinswapV2OrderDatum(hexBytes(orderOut.inline_datum)).maxBatcherFee
    } catch { maxBatcherFee = null }

    const meta = await bfJson<{ block_height?: number }>(`txs/${req.txHash}`, config)
    const height = meta.data?.block_height
    if (typeof height !== 'number') return unknown

    const later = await bfJson<Array<{ tx_hash: string }>>(
      `addresses/${wallet}/transactions?order=asc&from=${height}&count=100`, config)
    if (!later.data) return unknown
    const candidates = later.data.map(t => t.tx_hash).filter(h => h !== req.txHash).slice(0, MAX_SPENDER_LOOKUPS)

    for (const hash of candidates) {
      const tx = await bfJson<BfUtxos>(`txs/${hash}/utxos`, config)
      if (!tx.data) return unknown   // a gap in what was read is not "still open"
      const spendsOrder = tx.data.inputs.some(i => i.tx_hash === req.txHash && i.output_index === orderOut.output_index)
      if (!spendsOrder) continue

      const boughtAda = buyUnit === CARDANO_LOVELACE
      const gotBuy = credited(tx.data.outputs, wallet, buyUnit)
      const gotSell = sellUnit === CARDANO_LOVELACE ? 0n : credited(tx.data.outputs, wallet, sellUnit)
      // A fill pays the bought token; a cancel returns the sold one. When ADA is
      // BOUGHT both carry ADA, so the sold token coming back is what tells them apart.
      const filled = boughtAda ? gotSell === 0n : gotBuy > 0n
      if (!filled) {
        return {
          status: 'done', state: 'refunded', error: null,
          providerStatus: 'DONE', providerSubstatus: 'REFUNDED',
          destTxHash: hash, destExplorerUrl: cardanoscanTx(hash),
          deliveredAmountSource: 'onchain',
          delivered: { chain: 'cardano', address: sellUnit, symbol: null, decimals: null,
            amountRaw: (sellUnit === CARDANO_LOVELACE ? credited(tx.data.outputs, wallet, CARDANO_LOVELACE) : gotSell).toString() },
        }
      }
      // ADA bought arrives together with the returned deposit and any unused
      // batcher fee. Subtracting what the order locked BEYOND the batcher fee
      // (the deposit) keeps the figure at or above what was actually bought,
      // so the minimum check below can never misreport a shortfall.
      let amount = gotBuy
      if (boughtAda) {
        if (maxBatcherFee == null) return unknown   // cannot separate the purchase from the deposit
        const deposit = orderLovelace - maxBatcherFee
        amount = deposit > 0n && gotBuy > deposit ? gotBuy - deposit : gotBuy
      }
      return {
        status: 'done', state: 'completed', error: null,
        providerStatus: 'DONE', providerSubstatus: 'COMPLETED',
        receivedAmountRaw: amount.toString(),
        destTxHash: hash, destExplorerUrl: cardanoscanTx(hash),
        deliveredAmountSource: 'onchain',
        delivered: { chain: 'cardano', address: buyUnit, symbol: null, decimals: null, amountRaw: amount.toString() },
      }
    }
    return {
      status: 'pending', state: 'source-confirmed', error: null,
      providerStatus: 'PENDING', providerSubstatus: 'ORDER_OPEN',
    }
  } catch (e) {
    return { ...unknown, error: e instanceof Error ? e.message : 'status read failed' }
  }
}
