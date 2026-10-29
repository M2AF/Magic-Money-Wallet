/**
 * chained-swap.ts — one approved swap that runs as several hops across chains
 * (privileged layer). Out of Cardano, e.g. SNEK on Cardano -> BONK on Solana:
 *
 *   hop 1  cardano-dex    SNEK -> ADA on Cardano (Minswap / Danogo / SundaeSwap)   skipped for ADA
 *   hop 2  near-intents   ADA -> SOL (or the target, when NEAR delivers it)
 *   hop 3  dest-dex       SOL -> BONK on Solana (Jupiter / Relay / LI.FI)
 *
 * Into Cardano, e.g. a memecoin on Base -> SNEK on Cardano:
 *
 *   hop 1  src-dex        memecoin -> USDC on Base (SOL on Solana)   skipped when NEAR takes the token
 *   hop 2  near-intents   USDC -> ADA, paid to a deposit address on Base
 *   hop 3  cardano-dex    ADA -> SNEK on Cardano                     skipped for ADA
 *
 * The user approves ONCE: the route, the final minimum, and a minimum for every
 * hop. The wallet then runs each hop itself, as soon as the previous one has
 * been MEASURED on chain, through the same pipeline as any single swap:
 * a fresh quote, held to that hop's approved minimum; intent binding; the
 * record saved before anything is sent; no resend; delivery measured.
 *
 *   - A hop sells what ACTUALLY arrived, never the estimate (keeping back a
 *     small native balance on the destination chain for that hop's network fee).
 *   - A fresh quote below its approved minimum PAUSES the swap; the user sees
 *     where the funds are and decides whether to continue at the new minimum.
 *   - A locked wallet pauses the swap; it continues once unlocked.
 *   - A hop's intent id is saved BEFORE it executes, so after a crash the
 *     wallet can tell, from that intent's swap record, whether it was sent.
 *   - At most one Magic Money fee: only the final DEX hop may carry one.
 *
 * Progress is driven by `advanceChainedSwap`, which is idempotent and safe to
 * call from a status poll, on restart, or repeatedly.
 */

import type { NormalizedSwapQuote, SwapQuoteRequest, SwapQuoteResponse } from './swap-proxy'
import { INTO_CARDANO_BRIDGE } from '../shared/swap-networks'
export { INTO_CARDANO_BRIDGE }

export type HopKind = 'cardano-dex' | 'near-intents' | 'dest-dex' | 'src-dex'
export type HopState = 'pending' | 'executing' | 'submitted' | 'completed' | 'failed' | 'refunded' | 'needs-review'
export type ChainState = 'running' | 'paused' | 'completed' | 'stopped' | 'needs-review'

export interface ChainHop {
  kind: HopKind
  fromChain: string; toChain: string
  fromToken: string; toToken: string
  fromSymbol: string; toSymbol: string
  fromDecimals: number; toDecimals: number
  /** The minimum the user approved for this hop's output (raw units). */
  approvedMinOutRaw: string
  /** What this hop was planned to sell (an estimate from the previous hop's minimum). */
  plannedSellRaw: string
  state: HopState
  /** Saved BEFORE execution: the swap record of this intent tells whether it was sent. */
  intentId: string | null
  provider: string | null
  /** The route that actually ran this hop (the quote's bridgeTool, e.g. "SundaeSwap V3"). */
  via?: string | null
  txHash: string | null
  requestId: string | null
  sellRaw: string | null
  measuredOutRaw: string | null
  message: string | null
}

export interface ChainedSwap {
  version: 1
  id: string
  walletId: string
  accountIndex: number
  createdAt: number
  updatedAt: number
  hops: ChainHop[]
  finalMinRaw: string
  finalExpectedRaw: string
  state: ChainState
  /** Why the swap is paused or stopped, in words. */
  reason: string | null
}

export class ChainedSwapError extends Error {}
const fail = (why: string): never => { throw new ChainedSwapError(why) }

export const NATIVE: Readonly<Record<string, string>> = Object.freeze({
  solana: 'So11111111111111111111111111111111111111112',
  ethereum: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', base: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  arbitrum: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', optimism: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  monad: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', polygon: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  avalanche: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', robinhood: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
})
const NATIVE_META: Readonly<Record<string, { symbol: string; decimals: number }>> = Object.freeze({
  solana: { symbol: 'SOL', decimals: 9 }, ethereum: { symbol: 'ETH', decimals: 18 }, base: { symbol: 'ETH', decimals: 18 },
  arbitrum: { symbol: 'ETH', decimals: 18 }, optimism: { symbol: 'ETH', decimals: 18 }, monad: { symbol: 'MON', decimals: 18 },
  polygon: { symbol: 'POL', decimals: 18 }, avalanche: { symbol: 'AVAX', decimals: 18 }, robinhood: { symbol: 'ETH', decimals: 18 },
})
const nativeOf = (chain: string) => (chain === 'cardano' ? 'lovelace' : NATIVE[chain])
/**
 * A later hop that sells its chain's native coin keeps some back for that hop's
 * own network fee. The ADA a swap out of Cardano carries is the exception: its
 * small payment fee is paid from the wallet's other ADA, as before.
 */
const keepsReserve = (hop: Pick<ChainHop, 'kind' | 'fromChain' | 'fromToken'>, i: number) =>
  i > 0 && hop.fromToken === nativeOf(hop.fromChain) && !(hop.kind === 'near-intents' && hop.fromChain === 'cardano')
/** Ends every pause the wallet retries by itself (a quote or preparation that failed before anything was sent). */
export const RETRIED_AUTOMATICALLY = 'It is retried automatically.'
const UINT = /^[0-9]{1,78}$/

export interface ChainedSwapRequest {
  /** The chain the swap starts on; Cardano when omitted. */
  fromChain?: string
  fromToken: string; fromSymbol: string; fromDecimals: number
  toChain: string; toToken: string; toSymbol: string; toDecimals: number
  sellAmountRaw: string
  slippageBps: number
}

export interface ChainedSwapDeps {
  /** The wallet's normal quote entry (getSwapQuote). */
  quote(req: SwapQuoteRequest): Promise<SwapQuoteResponse>
  /**
   * PLANNING ONLY: the expected and minimum output of a Cardano swap the wallet
   * cannot build yet (it does not hold the ADA until earlier hops land), and the
   * ADA its order costs on top of the sale. The hop is quoted and checked for
   * real when it runs.
   */
  estimateCardano?(req: SwapQuoteRequest): Promise<{ buyAmountRaw: string; minBuyAmountRaw: string; overheadLovelace: string; provider: string }>
  /** This wallet's own addresses (never from the renderer). */
  addresses: { cardano: string; solana: string; evm: string }
  /** Native amount to keep for a destination-DEX hop's network fee, read from its quote. */
  feeReserve(chain: string, quote: NormalizedSwapQuote): Promise<bigint>
  /** Bind the quote to its request and this wallet; returns the intent id. */
  bind(req: SwapQuoteRequest, quote: NormalizedSwapQuote): string
  /** Execute a bound intent (mnemonic loaded inside; throws ChainedSwapLocked when locked). */
  execute(intentId: string, quote: NormalizedSwapQuote): Promise<{ txHash: string; requestId?: string | null }>
  /** Settlement of a submitted hop, measured on chain. */
  status(hop: ChainHop): Promise<{ state: string; deliveredRaw: string | null; message: string | null }>
  /** What the swap record of an intent says was sent (null: nothing recorded). */
  sentFor(intentId: string): Promise<{ txHash: string | null; requestId: string | null } | null>
  store: { get(id: string): Promise<ChainedSwap | null>; put(c: ChainedSwap): Promise<void> }
  now(): number
  newId(): string
}

export class ChainedSwapLocked extends Error {
  constructor() { super('Unlock the wallet to continue this swap.') }
}

const addressFor = (deps: ChainedSwapDeps, chain: string) =>
  chain === 'cardano' ? deps.addresses.cardano : chain === 'solana' ? deps.addresses.solana : deps.addresses.evm

function quoteReq(deps: ChainedSwapDeps, hop: Pick<ChainHop, 'fromChain' | 'toChain' | 'fromToken' | 'toToken' | 'fromSymbol' | 'toSymbol' | 'fromDecimals' | 'toDecimals'>, sellRaw: string, slippageBps: number): SwapQuoteRequest {
  return {
    fromChain: hop.fromChain as never, toChain: hop.toChain as never, fromToken: hop.fromToken, toToken: hop.toToken,
    fromSymbol: hop.fromSymbol, toSymbol: hop.toSymbol, sellAmountRaw: sellRaw, slippageBps,
    taker: addressFor(deps, hop.fromChain), toAddress: addressFor(deps, hop.toChain),
    fromDecimals: hop.fromDecimals, toDecimals: hop.toDecimals,
  }
}

async function mustQuote(deps: ChainedSwapDeps, req: SwapQuoteRequest, label: string): Promise<NormalizedSwapQuote> {
  const r = await deps.quote(req)
  if (!r.quote || !r.quote.minBuyAmountRaw || !UINT.test(r.quote.minBuyAmountRaw)) {
    return fail(`${label}: ${r.error ?? 'no route'}`)
  }
  return r.quote
}

const hopOf = (kind: HopKind, f: Omit<ChainHop, 'kind' | 'state' | 'intentId' | 'provider' | 'txHash' | 'requestId' | 'sellRaw' | 'measuredOutRaw' | 'message'>): ChainHop =>
  ({ kind, ...f, state: 'pending', intentId: null, provider: null, txHash: null, requestId: null, sellRaw: null, measuredOutRaw: null, message: null })

export interface ChainedPlan {
  hops: ChainHop[]
  /** The first hop's live quote, executed as-is when the user approves in time. */
  firstQuote: NormalizedSwapQuote
  finalMinRaw: string
  finalExpectedRaw: string
  expiresAt: number
  /** Each hop's provider-stated route, for display. */
  routes: Array<{ kind: HopKind; provider: string; fromSymbol: string; toSymbol: string; minOutRaw: string; chain: string }>
}

/**
 * Plan the hops for a Cardano token -> destination token swap and quote each on
 * the previous hop's MINIMUM, so every hop minimum the user approves is a floor
 * the route can meet even at the worst case of the hop before it.
 */
export async function planChainedSwap(req: ChainedSwapRequest, deps: ChainedSwapDeps): Promise<ChainedPlan> {
  if (!UINT.test(req.sellAmountRaw) || req.sellAmountRaw === '0') fail('Invalid amount.')
  const from = req.fromChain ?? 'cardano'
  if (from !== 'cardano') {
    if (req.toChain !== 'cardano') fail('A multi-step swap starts or ends on Cardano.')
    return planIntoCardano({ ...req, fromChain: from }, deps)
  }
  if (req.toChain === 'cardano') fail('A multi-step swap leaves Cardano.')
  const native = NATIVE[req.toChain], nativeMeta = NATIVE_META[req.toChain]
  if (!native || !nativeMeta) fail(`Swaps from Cardano to ${req.toChain} are not available.`)
  const hops: ChainHop[] = []
  const quotes: NormalizedSwapQuote[] = []

  // ── hop 1: token -> ADA on Cardano ─────────────────────────────────────────
  let adaRaw = req.sellAmountRaw
  if (req.fromToken !== 'lovelace') {
    const h = hopOf('cardano-dex', { fromChain: 'cardano', toChain: 'cardano', fromToken: req.fromToken, toToken: 'lovelace',
      fromSymbol: req.fromSymbol, toSymbol: 'ADA', fromDecimals: req.fromDecimals, toDecimals: 6, approvedMinOutRaw: '0', plannedSellRaw: req.sellAmountRaw })
    const q = await mustQuote(deps, quoteReq(deps, h, req.sellAmountRaw, req.slippageBps), `${req.fromSymbol} -> ADA`)
    h.approvedMinOutRaw = q.minBuyAmountRaw as string
    hops.push(h); quotes.push(q)
    adaRaw = h.approvedMinOutRaw
  }

  // ── hop 2: ADA -> the target directly, or -> the destination's native token ─
  const direct = hopOf('near-intents', { fromChain: 'cardano', toChain: req.toChain, fromToken: 'lovelace', toToken: req.toToken,
    fromSymbol: 'ADA', toSymbol: req.toSymbol, fromDecimals: 6, toDecimals: req.toDecimals, approvedMinOutRaw: '0', plannedSellRaw: adaRaw })
  const directQuote = await deps.quote(quoteReq(deps, direct, adaRaw, req.slippageBps)).catch(() => null)
  if (directQuote?.quote?.minBuyAmountRaw && UINT.test(directQuote.quote.minBuyAmountRaw)) {
    direct.approvedMinOutRaw = directQuote.quote.minBuyAmountRaw
    hops.push(direct); quotes.push(directQuote.quote)
  } else {
    const bridge = hopOf('near-intents', { fromChain: 'cardano', toChain: req.toChain, fromToken: 'lovelace', toToken: native,
      fromSymbol: 'ADA', toSymbol: nativeMeta.symbol, fromDecimals: 6, toDecimals: nativeMeta.decimals, approvedMinOutRaw: '0', plannedSellRaw: adaRaw })
    const bq = await mustQuote(deps, quoteReq(deps, bridge, adaRaw, req.slippageBps), `ADA -> ${nativeMeta.symbol}`)
    bridge.approvedMinOutRaw = bq.minBuyAmountRaw as string
    hops.push(bridge); quotes.push(bq)

    // ── hop 3: native -> target on the destination chain ─────────────────────
    const swap = hopOf('dest-dex', { fromChain: req.toChain, toChain: req.toChain, fromToken: native, toToken: req.toToken,
      fromSymbol: nativeMeta.symbol, toSymbol: req.toSymbol, fromDecimals: nativeMeta.decimals, toDecimals: req.toDecimals,
      approvedMinOutRaw: '0', plannedSellRaw: bridge.approvedMinOutRaw })
    const probe = await mustQuote(deps, quoteReq(deps, swap, bridge.approvedMinOutRaw, req.slippageBps), `${nativeMeta.symbol} -> ${req.toSymbol}`)
    const reserve = await deps.feeReserve(req.toChain, probe)
    const sell = BigInt(bridge.approvedMinOutRaw) - reserve
    if (sell <= 0n) fail(`The amount is too small to cover the ${nativeMeta.symbol} network fee on ${req.toChain}.`)
    const dq = await mustQuote(deps, quoteReq(deps, swap, sell.toString(), req.slippageBps), `${nativeMeta.symbol} -> ${req.toSymbol}`)
    swap.plannedSellRaw = sell.toString()
    swap.approvedMinOutRaw = dq.minBuyAmountRaw as string
    hops.push(swap); quotes.push(dq)
  }

  const last = quotes[quotes.length - 1]
  return {
    hops, firstQuote: quotes[0],
    finalMinRaw: hops[hops.length - 1].approvedMinOutRaw, finalExpectedRaw: last.buyAmountRaw,
    expiresAt: Math.min(...quotes.map(q => q.expiresAt)),
    routes: hops.map((h, i) => ({ kind: h.kind, provider: quotes[i].provider, fromSymbol: h.fromSymbol, toSymbol: h.toSymbol,
      minOutRaw: h.approvedMinOutRaw, chain: h.toChain })),
  }
}

/** Another chain -> Cardano: [src-dex] -> near-intents -> [cardano-dex], each on the previous minimum. */
async function planIntoCardano(req: ChainedSwapRequest & { fromChain: string }, deps: ChainedSwapDeps): Promise<ChainedPlan> {
  const src = req.fromChain
  const native = NATIVE[src], nativeMeta = NATIVE_META[src]
  if (!native || !nativeMeta) fail(`Swaps from ${src} into Cardano are not available.`)
  const hops: ChainHop[] = []
  const quotes: Array<{ provider: string; buyAmountRaw: string; expiresAt: number }> = []

  // ── NEAR takes the token as it is? ─────────────────────────────────────────
  const direct = hopOf('near-intents', { fromChain: src, toChain: 'cardano', fromToken: req.fromToken, toToken: 'lovelace',
    fromSymbol: req.fromSymbol, toSymbol: 'ADA', fromDecimals: req.fromDecimals, toDecimals: 6, approvedMinOutRaw: '0', plannedSellRaw: req.sellAmountRaw })
  const dq = await deps.quote(quoteReq(deps, direct, req.sellAmountRaw, req.slippageBps)).catch(() => null)
  if (dq?.quote?.minBuyAmountRaw && UINT.test(dq.quote.minBuyAmountRaw)) {
    direct.approvedMinOutRaw = dq.quote.minBuyAmountRaw
    hops.push(direct); quotes.push(dq.quote)
  } else {
    // ── hop 1: token -> the bridge asset on the source chain ──────────────────
    const bridge = INTO_CARDANO_BRIDGE[src]
    if (!bridge) fail(`From ${src}, only ${nativeMeta.symbol} can be swapped into Cardano.`)
    const swap = hopOf('src-dex', { fromChain: src, toChain: src, fromToken: req.fromToken, toToken: bridge.token,
      fromSymbol: req.fromSymbol, toSymbol: bridge.symbol, fromDecimals: req.fromDecimals, toDecimals: bridge.decimals,
      approvedMinOutRaw: '0', plannedSellRaw: req.sellAmountRaw })
    const sq = await mustQuote(deps, quoteReq(deps, swap, req.sellAmountRaw, req.slippageBps), `${req.fromSymbol} -> ${bridge.symbol}`)
    swap.approvedMinOutRaw = sq.minBuyAmountRaw as string
    hops.push(swap); quotes.push(sq)

    // ── hop 2: bridge asset -> ADA through NEAR ───────────────────────────────
    const near = hopOf('near-intents', { fromChain: src, toChain: 'cardano', fromToken: bridge.token, toToken: 'lovelace',
      fromSymbol: bridge.symbol, toSymbol: 'ADA', fromDecimals: bridge.decimals, toDecimals: 6, approvedMinOutRaw: '0', plannedSellRaw: swap.approvedMinOutRaw })
    let sell = BigInt(swap.approvedMinOutRaw)
    if (keepsReserve(near, 1)) {
      const probe = await mustQuote(deps, quoteReq(deps, near, sell.toString(), req.slippageBps), `${bridge.symbol} -> ADA`)
      sell -= await deps.feeReserve(src, probe)
      if (sell <= 0n) fail(`The amount is too small to cover the ${nativeMeta.symbol} network fee on ${src}.`)
    }
    const nq = await mustQuote(deps, quoteReq(deps, near, sell.toString(), req.slippageBps), `${bridge.symbol} -> ADA`)
    near.plannedSellRaw = sell.toString()
    near.approvedMinOutRaw = nq.minBuyAmountRaw as string
    hops.push(near); quotes.push(nq)
  }

  // ── last hop: ADA -> the Cardano token ─────────────────────────────────────
  if (req.toToken !== 'lovelace') {
    const estimate = deps.estimateCardano
    if (!estimate) return fail('Cardano token routes cannot be planned here.')
    const adaMin = BigInt(hops[hops.length - 1].approvedMinOutRaw)
    const dex = hopOf('cardano-dex', { fromChain: 'cardano', toChain: 'cardano', fromToken: 'lovelace', toToken: req.toToken,
      fromSymbol: 'ADA', toSymbol: req.toSymbol, fromDecimals: 6, toDecimals: req.toDecimals, approvedMinOutRaw: '0', plannedSellRaw: adaMin.toString() })
    const ask = (amount: bigint) => estimate(quoteReq(deps, dex, amount.toString(), req.slippageBps))
      .catch(e => fail(`ADA -> ${req.toSymbol}: ${e instanceof Error ? e.message : 'no route'}`))
    // Kept back: the order's fees and refundable deposit, paid in ADA on top of the sale.
    const probe = await ask(adaMin)
    const sell = adaMin - BigInt(probe.overheadLovelace) - CARDANO_FEE_MARGIN
    if (sell <= 0n) fail("The amount is too small to cover the Cardano order's fees and deposit.")
    const e = await ask(sell)
    dex.plannedSellRaw = sell.toString()
    dex.approvedMinOutRaw = e.minBuyAmountRaw
    hops.push(dex); quotes.push({ provider: e.provider, buyAmountRaw: e.buyAmountRaw, expiresAt: Number.POSITIVE_INFINITY })
  }

  const last = quotes[quotes.length - 1]
  return {
    hops, firstQuote: quotes[0] as NormalizedSwapQuote,
    finalMinRaw: hops[hops.length - 1].approvedMinOutRaw, finalExpectedRaw: last.buyAmountRaw,
    expiresAt: Math.min(...quotes.map(q => q.expiresAt)),
    routes: hops.map((h, i) => ({ kind: h.kind, provider: quotes[i].provider, fromSymbol: h.fromSymbol, toSymbol: h.toSymbol,
      minOutRaw: h.approvedMinOutRaw, chain: h.toChain })),
  }
}

/** ADA kept on top of a Cardano order's stated fees and deposit, for the network fee's variation. */
export const CARDANO_FEE_MARGIN = 300_000n

/** Create the persisted swap from an approved plan (nothing executes yet). */
export async function createChainedSwap(plan: ChainedPlan, identity: { walletId: string; accountIndex: number }, deps: ChainedSwapDeps): Promise<ChainedSwap> {
  const now = deps.now()
  const c: ChainedSwap = {
    version: 1, id: deps.newId(), walletId: identity.walletId, accountIndex: identity.accountIndex, createdAt: now, updatedAt: now,
    hops: plan.hops.map(h => ({ ...h })), finalMinRaw: plan.finalMinRaw, finalExpectedRaw: plan.finalExpectedRaw, state: 'running', reason: null,
  }
  await deps.store.put(c)
  return c
}

const locks = new Map<string, Promise<ChainedSwap>>()

/**
 * Move a swap forward by at most one step. Idempotent; concurrent calls for the
 * same swap share one run. `acceptNewMinimum` is the user's explicit choice to
 * continue a paused hop at its current, lower minimum.
 */
export function advanceChainedSwap(id: string, deps: ChainedSwapDeps, opts: { acceptNewMinimum?: boolean; stop?: boolean } = {}): Promise<ChainedSwap> {
  const running = locks.get(id)
  if (running) return running
  const run = step(id, deps, opts).finally(() => locks.delete(id))
  locks.set(id, run)
  return run
}

async function step(id: string, deps: ChainedSwapDeps, opts: { acceptNewMinimum?: boolean; stop?: boolean }): Promise<ChainedSwap> {
  const c = await deps.store.get(id)
  if (!c) return fail('This swap is not recorded.')
  if (c.state === 'completed' || c.state === 'stopped' || c.state === 'needs-review') return c
  const save = async (patch: Partial<ChainedSwap>) => {
    Object.assign(c, patch, { updatedAt: deps.now() })
    await deps.store.put(c)
    return c
  }
  const i = c.hops.findIndex(h => h.state !== 'completed')
  if (i < 0) return save({ state: 'completed', reason: null })
  const hop = c.hops[i]
  const holding = i === 0 ? `${hop.fromSymbol} on ${hop.fromChain}` : `${c.hops[i - 1].toSymbol} on ${c.hops[i - 1].toChain}`

  if (opts.stop) {
    if (hop.state === 'pending' || (hop.state === 'executing' && !hop.txHash)) {
      return save({ state: 'stopped', reason: `Stopped before step ${i + 1}. Your funds are ${holding}.` })
    }
    return c   // a sent hop is followed to its outcome, never abandoned
  }

  // ── A hop whose execution was interrupted: did it get sent? ────────────────
  if (hop.state === 'executing') {
    const sent = hop.intentId ? await deps.sentFor(hop.intentId) : null
    if (sent?.txHash) {
      Object.assign(hop, { state: 'submitted', txHash: sent.txHash, requestId: sent.requestId })
      return save({})
    }
    Object.assign(hop, { state: 'pending', intentId: null })   // nothing was sent: safe to quote again
    return save({})
  }

  // ── A sent hop: follow it to its measured outcome ──────────────────────────
  if (hop.state === 'submitted') {
    const s = await deps.status(hop).catch(() => null)
    if (!s) return c
    if (s.state === 'completed' && s.deliveredRaw && UINT.test(s.deliveredRaw)) {
      Object.assign(hop, { state: 'completed', measuredOutRaw: s.deliveredRaw, message: null })
      return save(c.hops.every(h => h.state === 'completed') ? { state: 'completed', reason: null } : {})
    }
    if (s.state === 'refunded') {
      Object.assign(hop, { state: 'refunded', message: s.message })
      return save({ state: 'stopped', reason: `Step ${i + 1} was refunded. Your funds are ${holding}. ${s.message ?? ''}`.trim() })
    }
    if (s.state === 'failed' || s.state === 'partial') {
      Object.assign(hop, { state: s.state === 'failed' ? 'failed' : 'needs-review', message: s.message })
      return save({ state: 'needs-review', reason: `Step ${i + 1} did not complete as approved. ${s.message ?? ''}`.trim() })
    }
    hop.message = s.message
    return save({})
  }

  // ── A pending hop: quote what actually arrived, check, and execute ─────────
  if (c.state === 'paused' && !opts.acceptNewMinimum && c.reason && !c.reason.startsWith('Unlock') && !c.reason.endsWith(RETRIED_AUTOMATICALLY)) return c
  let sell = i === 0 ? hop.plannedSellRaw : c.hops[i - 1].measuredOutRaw
  if (!sell || !UINT.test(sell)) return save({ state: 'needs-review', reason: `The amount for step ${i + 1} was not measured.` })
  let req = quoteReq(deps, hop, sell, 100)
  let quote: NormalizedSwapQuote
  try {
    quote = await mustQuote(deps, req, `Step ${i + 1}`)
    if (keepsReserve(hop, i)) {
      const reserve = await deps.feeReserve(hop.fromChain, quote)
      const net = BigInt(sell) - reserve
      if (net <= 0n) return save({ state: 'paused', reason: `Not enough ${hop.fromSymbol} arrived to pay the network fee for step ${i + 1}. Your funds are ${holding}.` })
      sell = net.toString()
      // The bound request must be the one this quote answers: the sale net of the reserve.
      req = quoteReq(deps, hop, sell, 100)
      quote = await mustQuote(deps, req, `Step ${i + 1}`)
    }
  } catch (e) {
    return save({ state: 'paused', reason: `Step ${i + 1} could not be quoted (${e instanceof Error ? e.message : 'no route'}). Your funds are ${holding}. ${RETRIED_AUTOMATICALLY}` })
  }
  if (BigInt(quote.minBuyAmountRaw as string) < BigInt(hop.approvedMinOutRaw)) {
    if (!opts.acceptNewMinimum) {
      return save({ state: 'paused', reason: `The price moved: step ${i + 1} now guarantees less than you approved. Your funds are ${holding}. Continue at the new minimum, or stop here.` })
    }
    hop.approvedMinOutRaw = quote.minBuyAmountRaw as string   // the user's explicit new approval
    if (i === c.hops.length - 1) c.finalMinRaw = hop.approvedMinOutRaw
  }

  // Save the intent BEFORE executing: after a crash it tells whether this hop was sent.
  let intentId: string
  try { intentId = deps.bind(req, quote) } catch (e) {
    // Nothing was sent or recorded: say why, and quote again on the next poll.
    return save({ state: 'paused', reason: `Step ${i + 1} could not be prepared (${e instanceof Error ? e.message : 'error'}). Your funds are ${holding}. ${RETRIED_AUTOMATICALLY}` })
  }
  Object.assign(hop, { state: 'executing', intentId, provider: quote.provider, via: quote.bridgeTool ?? null, sellRaw: sell, message: null })
  await save({ state: 'running', reason: null })
  try {
    const r = await deps.execute(intentId, quote)
    Object.assign(hop, { state: 'submitted', txHash: r.txHash, requestId: r.requestId ?? null })
    return save({})
  } catch (e) {
    if (e instanceof ChainedSwapLocked) {
      Object.assign(hop, { state: 'pending', intentId: null })
      return save({ state: 'paused', reason: 'Unlock the wallet to continue this swap.' })
    }
    // Whether it was sent is decided by its swap record, not by the error.
    // A record that cannot be read is not proof of "not sent": never resend on it.
    let sent: Awaited<ReturnType<ChainedSwapDeps['sentFor']>>
    try { sent = await deps.sentFor(intentId) } catch {
      Object.assign(hop, { state: 'needs-review', message: e instanceof Error ? e.message : null })
      return save({ state: 'needs-review', reason: `Step ${i + 1} may have been sent; its record could not be read, so it is not sent again. Your funds are ${holding} or on their way.` })
    }
    if (sent?.txHash) {
      Object.assign(hop, { state: 'submitted', txHash: sent.txHash, requestId: sent.requestId, message: e instanceof Error ? e.message : null })
      return save({})
    }
    Object.assign(hop, { state: 'pending', intentId: null, message: e instanceof Error ? e.message : 'failed' })
    return save({ state: 'paused', reason: `Step ${i + 1} was not sent (${e instanceof Error ? e.message : 'error'}). Your funds are ${holding}. ${RETRIED_AUTOMATICALLY}` })
  }
}

/** Closed-schema parse of a stored swap (unknown shapes are refused, never coerced). */
export function parseChainedSwap(json: string): ChainedSwap {
  let v: unknown
  try { v = JSON.parse(json) } catch { return fail('Stored swap is unreadable.') }
  const c = v as ChainedSwap
  if (!c || c.version !== 1 || typeof c.id !== 'string' || typeof c.walletId !== 'string' || !Array.isArray(c.hops)
      || c.hops.length < 1 || c.hops.length > 3 || !['running', 'paused', 'completed', 'stopped', 'needs-review'].includes(c.state)
      || !UINT.test(c.finalMinRaw)) fail('Stored swap is malformed.')
  for (const h of c.hops) {
    if (!h || !['cardano-dex', 'near-intents', 'dest-dex', 'src-dex'].includes(h.kind) || !UINT.test(h.approvedMinOutRaw)
        || !['pending', 'executing', 'submitted', 'completed', 'failed', 'refunded', 'needs-review'].includes(h.state)) fail('Stored swap hop is malformed.')
    if ((h.state === 'submitted' || h.state === 'completed') && !h.txHash) fail('A sent hop lost its transaction hash.')
    if (h.via != null && (typeof h.via !== 'string' || h.via.length > 60)) fail('Stored swap hop is malformed.')
  }
  return c
}

/** A map-backed store with a write queue and a guard: a recorded hop hash is never replaced. */
export function chainedSwapStore(load: () => Promise<Record<string, string>>, save: (m: Record<string, string>) => Promise<void>) {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    async get(id: string): Promise<ChainedSwap | null> {
      const m = await load()
      return Object.prototype.hasOwnProperty.call(m, id) ? parseChainedSwap(m[id]) : null
    },
    async list(): Promise<ChainedSwap[]> {
      const m = await load()
      return Object.values(m).flatMap(j => { try { return [parseChainedSwap(j)] } catch { return [] } })
    },
    put(c: ChainedSwap): Promise<void> {
      const run = tail.then(async () => {
        const json = JSON.stringify(c)
        parseChainedSwap(json)
        const m = await load()
        if (m[c.id]) {
          const prev = parseChainedSwap(m[c.id])
          prev.hops.forEach((p, k) => {
            if (p.txHash && c.hops[k]?.txHash !== p.txHash) fail('A recorded hop transaction is never replaced.')
          })
          if ((prev.state === 'completed' || prev.state === 'stopped') && c.state !== prev.state) fail('A finished swap cannot be reopened.')
        }
        await save({ ...m, [c.id]: json })
      })
      tail = run.catch(() => {})
      return run
    },
  }
}
