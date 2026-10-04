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
//
// FINDING THE TRANSACTION THAT SPENT THE ORDER
//
// Primary: Blockfrost's `/txs/{hash}/utxos` states, for every output, the
// transaction that consumed it (`consumed_by_tx`, null while unspent — added
// in Blockfrost API 0.1.67, 2024-09-11; returned through our proxy, measured
// 2026-09-27). That is an INDEXED answer for exactly this order output: one
// request, no scanning, and it cannot miss a spend that happened later.
//
// Fallback, only when that field is absent from the response: walk the wallet's
// transactions after the order, oldest first, checking each one's inputs for
// the exact order output. The walk is bounded per poll and resumable (keyset
// pagination): a cursor records the last (block, index) fully checked, so the
// next poll starts there — Blockfrost's `from` is an inclusive `block:index`
// range — instead of re-reading old pages. Only a walk that reaches the end of the list with no
// spender is evidence the order is still open; a walk cut short by the budget,
// a rate limit or an error is UNKNOWN, never "open".
//
// CLASSIFYING THE SPEND
//
// From the spending transaction's own inputs and outputs, as the wallet's NET
// change per asset (outputs to the wallet minus inputs from it — a cancel pays
// its fee from the owner's coins, so gross credits would overstate it):
//   fill    the bought asset arrived, and the sold one did not come back
//   refund  the sold asset came back, at least the amount the order sold
//   neither an UNEXPLAINED spend: reported as such, never as a refund

interface BfAmount { unit: string; quantity: string }
interface BfUtxos {
  inputs: Array<{ address: string; amount: BfAmount[]; tx_hash: string; output_index: number; collateral?: boolean; reference?: boolean }>
  outputs: Array<{
    address: string; amount: BfAmount[]; output_index: number; inline_datum?: string | null
    consumed_by_tx?: string | null; collateral?: boolean
  }>
}
interface BfAddressTx { tx_hash: string; tx_index: number; block_height: number }

/**
 * Where a fallback scan got to: every wallet transaction at or before
 * (blockHeight, txIndex) has been checked and none spent the order. Persisted
 * on the swap session so a restart resumes rather than rescans.
 */
export interface MinswapOrderScanCursor {
  orderRef: string
  blockHeight: number
  txIndex: number
}

/**
 * Transactions whose inputs are read per poll in the fallback scan. Each poll
 * lists at most this many (+1 for the cursor's own, inclusive entry) starting
 * at the cursor, so a long history is walked across polls without re-reading.
 */
export const SCAN_TX_LOOKUPS_PER_POLL = 20

/** Stated when a spend cannot be explained — shown instead of any "refunded" wording. */
export const MINSWAP_UNEXPLAINED_SPEND_MESSAGE =
  'The order was spent on Cardano, but the wallet cannot find the token you bought or the token you sold '
  + 'coming back in that transaction. It is not being reported as a refund. Check the spending transaction.'

/** In-process cursors, so polls from the swap screen resume too (sessions persist them across restarts). */
const scanCursors = new Map<string, MinswapOrderScanCursor>()
export function __clearMinswapScanCursors(): void { scanCursors.clear() }

class BlockfrostUnavailable extends Error {}

async function bfJson<T>(path: string, config: WalletConfig): Promise<{ status: number; data: T | null }> {
  let res: Response
  try {
    res = await blockfrostFetch(path, config, 12_000)
  } catch {
    // Network error or timeout. The message is not surfaced: it would only
    // restate the request, and nothing about it is actionable for the user.
    throw new BlockfrostUnavailable('Cardano data service unreachable; will retry')
  }
  if (res.status === 429) throw new BlockfrostUnavailable('Cardano data service is rate-limiting; will retry')
  if (res.status >= 500) throw new BlockfrostUnavailable(`Cardano data service error ${res.status}; will retry`)
  if (!res.ok) return { status: res.status, data: null }
  const data = await res.json().catch(() => null) as T | null
  if (data == null) throw new BlockfrostUnavailable('Cardano data service returned an unreadable answer; will retry')
  return { status: res.status, data }
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

/** The wallet's net change in `unit` across one transaction (collateral and reference inputs excluded). */
function netDelta(tx: BfUtxos, wallet: string, unit: string): bigint {
  let sum = 0n
  for (const o of tx.outputs) {
    if (o.address !== wallet || o.collateral) continue
    for (const a of o.amount) if (a.unit.toLowerCase() === unit) sum += BigInt(a.quantity)
  }
  for (const i of tx.inputs) {
    if (i.address !== wallet || i.collateral || i.reference) continue
    for (const a of i.amount) if (a.unit.toLowerCase() === unit) sum -= BigInt(a.quantity)
  }
  return sum
}

const ahead = (a: { blockHeight: number; txIndex: number }, b: { blockHeight: number; txIndex: number }) =>
  a.blockHeight > b.blockHeight || (a.blockHeight === b.blockHeight && a.txIndex > b.txIndex)

type SpenderSearch =
  | { kind: 'found'; hash: string; tx: BfUtxos }
  | { kind: 'open' }
  | { kind: 'incomplete'; reason: string }

/**
 * Bounded, resumable walk of the wallet's transactions after the order —
 * keyset pagination on Blockfrost's inclusive `from=block:index`. Advances
 * `cursor` past every transaction it has fully checked.
 */
async function scanForSpender(
  orderTx: string, orderIndex: number, orderHeight: number, wallet: string,
  cursor: MinswapOrderScanCursor, config: WalletConfig,
): Promise<SpenderSearch> {
  const count = SCAN_TX_LOOKUPS_PER_POLL + 1
  const from = `${cursor.blockHeight}:${Math.max(0, cursor.txIndex)}`
  const list = await bfJson<BfAddressTx[]>(
    `addresses/${wallet}/transactions?order=asc&count=${count}&from=${from}`, config)
  if (!Array.isArray(list.data)) return { kind: 'incomplete', reason: "the wallet's transaction list could not be read" }
  let lookups = 0
  for (const t of list.data) {
    const pos = { blockHeight: t.block_height, txIndex: t.tx_index }
    if (!ahead(pos, cursor) || t.block_height < orderHeight || t.tx_hash === orderTx) continue
    if (lookups >= SCAN_TX_LOOKUPS_PER_POLL) return { kind: 'incomplete', reason: "still searching the wallet's later transactions" }
    lookups++
    const tx = await bfJson<BfUtxos>(`txs/${t.tx_hash}/utxos`, config)
    if (!tx.data) return { kind: 'incomplete', reason: 'a later transaction could not be read' }
    if (tx.data.inputs.some(i => i.tx_hash === orderTx && i.output_index === orderIndex && !i.reference)) {
      return { kind: 'found', hash: t.tx_hash, tx: tx.data }
    }
    cursor.blockHeight = pos.blockHeight
    cursor.txIndex = pos.txIndex
  }
  // Fewer entries than asked for means the list ended here: every later
  // transaction has now been checked, and none spent the order.
  return list.data.length < count
    ? { kind: 'open' }
    : { kind: 'incomplete', reason: "still searching the wallet's later transactions" }
}

/**
 * Where a Minswap order stands, in the vocabulary `mapMinswapStatus` reads.
 * Anything short of positive evidence is UNKNOWN (poll again), never a verdict.
 */
export async function getMinswapOrderStatus(
  req: CrossSwapStatusRequest, config: WalletConfig,
): Promise<CrossSwapStatus> {
  const unknown = (error: string | null, extra: Partial<CrossSwapStatus> = {}): CrossSwapStatus =>
    ({ status: 'pending', state: 'unknown', error, providerStatus: 'UNKNOWN', ...extra })
  const wallet = req.recipient ?? ''
  const buyUnit = normalizeSwapAddress('cardano', req.expectedToTokenAddress ?? '')
  if (!req.txHash || !wallet || !buyUnit) return unknown('missing order details')
  try {
    const order = await bfJson<BfUtxos>(`txs/${req.txHash}/utxos`, config)
    if (order.status === 404) {
      return { status: 'pending', state: 'source-submitted', error: null, providerStatus: 'NOT_FOUND' }
    }
    if (!order.data) return unknown('the order transaction could not be read')
    const orderOut = order.data.outputs.find(o => {
      const p = paymentHashOf(o.address)
      return p?.type === 1 && p.hash === MINSWAP_V2.orderScriptHash
    })
    if (!orderOut) return unknown('the transaction created no Minswap order')
    const orderRef = `${req.txHash}#${orderOut.output_index}`
    const sellUnit = orderOut.amount.find(a => a.unit !== CARDANO_LOVELACE)?.unit.toLowerCase() ?? CARDANO_LOVELACE
    const orderLovelace = BigInt(orderOut.amount.find(a => a.unit === CARDANO_LOVELACE)?.quantity ?? '0')
    // The order's own terms: how much it sold (the refund evidence threshold)
    // and its max batcher fee (to separate bought ADA from the returned deposit).
    let swapAmount: bigint | null = null
    let maxBatcherFee: bigint | null = null
    try {
      if (orderOut.inline_datum) {
        const datum = decodeMinswapV2OrderDatum(hexBytes(orderOut.inline_datum))
        swapAmount = datum.swapAmount
        maxBatcherFee = datum.maxBatcherFee
      }
    } catch { /* classified below as needing the datum */ }

    // ── Find the spender ────────────────────────────────────────────────────
    let spender: { hash: string; tx: BfUtxos } | null = null
    let cursorOut: MinswapOrderScanCursor | null = null
    if (typeof orderOut.consumed_by_tx === 'string' && /^[0-9a-f]{64}$/i.test(orderOut.consumed_by_tx)) {
      const hash = orderOut.consumed_by_tx.toLowerCase()
      const tx = await bfJson<BfUtxos>(`txs/${hash}/utxos`, config)
      if (!tx.data) return unknown('the transaction that spent the order could not be read')
      spender = { hash, tx: tx.data }
    } else if (orderOut.consumed_by_tx === null) {
      // Indexed answer: this exact output is unspent.
      return { status: 'pending', state: 'source-confirmed', error: null, providerStatus: 'PENDING', providerSubstatus: 'ORDER_OPEN' }
    } else {
      // Field absent: fall back to the bounded, resumable scan.
      const meta = await bfJson<{ block_height?: number | null; index?: number }>(`txs/${req.txHash}`, config)
      const height = meta.data?.block_height
      if (typeof height !== 'number') return unknown('the order transaction is not in a block yet')
      const stored = [scanCursors.get(orderRef), req.orderScanCursor]
        .filter((c): c is MinswapOrderScanCursor => !!c && c.orderRef === orderRef
          && Number.isInteger(c.blockHeight) && Number.isInteger(c.txIndex))
      const start: MinswapOrderScanCursor = { orderRef, blockHeight: height, txIndex: typeof meta.data?.index === 'number' ? meta.data.index : -1 }
      const cursor = stored.reduce((best, c) => (ahead(c, best) ? { ...c } : best), start)
      const found = await scanForSpender(req.txHash, orderOut.output_index, height, wallet, cursor, config)
        .catch((e): SpenderSearch => ({ kind: 'incomplete', reason: e instanceof BlockfrostUnavailable ? e.message : 'scan failed' }))
      scanCursors.set(orderRef, cursor)
      cursorOut = cursor
      if (found.kind === 'incomplete') {
        return unknown(null, { providerSubstatus: 'SCAN_INCOMPLETE', message: found.reason, orderScanCursor: cursor })
      }
      if (found.kind === 'open') {
        return {
          status: 'pending', state: 'source-confirmed', error: null,
          providerStatus: 'PENDING', providerSubstatus: 'ORDER_OPEN', orderScanCursor: cursor,
        }
      }
      spender = { hash: found.hash, tx: found.tx }
    }

    // ── Classify from the spender's own inputs and outputs ──────────────────
    const { hash, tx } = spender
    const links = { destTxHash: hash, destExplorerUrl: cardanoscanTx(hash), orderScanCursor: cursorOut }
    const unexplained = (): CrossSwapStatus => unknown(null, {
      providerStatus: 'SPENT', providerSubstatus: 'UNEXPLAINED', message: MINSWAP_UNEXPLAINED_SPEND_MESSAGE, ...links,
    })
    if (swapAmount == null) return unexplained()

    const netBuy = netDelta(tx, wallet, buyUnit)
    const netSell = netDelta(tx, wallet, sellUnit)
    const boughtAda = buyUnit === CARDANO_LOVELACE
    // Refund: the sold asset back in at least the amount the order sold. For
    // ADA sold, a cancel returns sale + batcher fee + deposit less its own fee,
    // which is still at least the sale.
    const refunded = netSell >= swapAmount && (boughtAda || netBuy <= 0n)
    // Fill: the bought asset arrived, and the sold asset did not come back.
    const filled = !refunded && netBuy > 0n && (sellUnit === CARDANO_LOVELACE ? true : netSell <= 0n)

    if (refunded) {
      return {
        status: 'done', state: 'refunded', error: null,
        providerStatus: 'DONE', providerSubstatus: 'REFUNDED', ...links,
        deliveredAmountSource: 'onchain',
        delivered: { chain: 'cardano', address: sellUnit, symbol: null, decimals: null, amountRaw: netSell.toString() },
      }
    }
    if (!filled) return unexplained()

    // ADA bought arrives together with the returned deposit and any unused
    // batcher fee. Subtracting what the order locked BEYOND the batcher fee
    // (the deposit) keeps the figure at or above what was actually bought,
    // so the approved-minimum check can never misreport a shortfall.
    let amount = netBuy
    if (boughtAda) {
      if (maxBatcherFee == null) return unexplained()
      const deposit = orderLovelace - maxBatcherFee
      amount = deposit > 0n && netBuy > deposit ? netBuy - deposit : netBuy
    }
    return {
      status: 'done', state: 'completed', error: null,
      providerStatus: 'DONE', providerSubstatus: 'COMPLETED', ...links,
      receivedAmountRaw: amount.toString(),
      deliveredAmountSource: 'onchain',
      delivered: { chain: 'cardano', address: buyUnit, symbol: null, decimals: null, amountRaw: amount.toString() },
    }
  } catch (e) {
    return unknown(e instanceof BlockfrostUnavailable ? e.message : 'status read failed; will retry')
  }
}
