/**
 * minswap-client.ts — Minswap Aggregator quotes, fetched from THIS device.
 *
 * Why not through the Worker like the other same-chain providers: measured
 * 2026-09-26, `agg-api.minswap.org` rate-limits per IP after a handful of calls
 * a minute ("Rate limit exceeded, retry in 1 minute"), and 404s count. Every
 * wallet user behind the Worker's single egress IP would share that bucket. The
 * API is keyless, so there is no key to protect — the same reasoning as the
 * direct LI.FI call in swap-proxy.ts. Each target already reaches arbitrary
 * hosts from the privileged layer (Electron `net.fetch`, the extension's host
 * permissions, Capacitor's native bridge for non-CORS hosts).
 *
 * Only Minswap V2 batcher orders are requested, and the response is checked
 * before a transaction is even built: one path, every hop V2, a continuous token
 * chain from the sell token to the buy token. `include_protocols` is a request,
 * not a guarantee — measured the same day, SNEK<->ADA came back routed through
 * Minswap V1 despite it — so the pre-signing validator pins the order script
 * independently of anything here.
 *
 * Amounts are integer base units (the API default); ADA is `lovelace`.
 */

import type { NormalizedSwapQuote, CardanoOrderTerms } from '../shared/swap-quote'
import type { ExternalFeeRecord } from '../shared/swap-fee-policy'
import { feeFreeRecord } from '../shared/swap-fee-policy'
import { CARDANO_LOVELACE, isValidSwapAddress, normalizeSwapAddress } from '../shared/swap-token-identity'

export const MINSWAP_AGGREGATOR_URL = 'https://agg-api.minswap.org/aggregator'

/**
 * A quote is re-validated before signing anyway; this bounds how stale a
 * displayed price may get. It outlives the swap screen's 30 s Cardano refresh
 * (slower than other chains because of Minswap's per-IP rate limit).
 */
const QUOTE_TTL_MS = 60_000

export class MinswapQuoteError extends Error {}

export interface MinswapEstimateRequest {
  amount: string
  token_in: string
  token_out: string
  /** PERCENT, per hop (measured: a 2-hop minimum is out / (1 + s)^2). */
  slippage: number
  allow_multi_hops: boolean
  include_protocols: string[]
}

interface MinswapPathStep {
  token_in?: string
  token_out?: string
  protocol?: string
  amount_in?: string
  amount_out?: string
}

export interface MinswapEstimate {
  token_in?: string
  token_out?: string
  amount_in?: string
  amount_out?: string
  min_amount_out?: string
  total_dex_fee?: string
  deposits?: string
  aggregator_fee?: string | null
  avg_price_impact?: number
  paths?: MinswapPathStep[][]
}

export interface MinswapTerms {
  buyAmountRaw: string
  minBuyAmountRaw: string
  hops: number
  terms: CardanoOrderTerms
  priceImpactPct: number
}

const UINT = /^[0-9]+$/
const unit = (u: unknown): string => normalizeSwapAddress('cardano', String(u ?? ''))

/** The floor the user approved: expected output less the slippage they set, rounded down. */
export function approvedFloor(buyAmountRaw: string, slippageBps: number): bigint {
  return (BigInt(buyAmountRaw) * BigInt(10000 - slippageBps)) / 10000n
}

/**
 * Read an estimate into order terms, refusing anything that is not a single
 * Minswap V2 route between exactly the requested tokens and amount.
 */
export function termsFromEstimate(req: MinswapEstimateRequest, est: MinswapEstimate): MinswapTerms {
  const bad = (why: string): never => { throw new MinswapQuoteError(`Minswap returned an unusable route: ${why}.`) }
  if (unit(est.token_in) !== unit(req.token_in) || unit(est.token_out) !== unit(req.token_out)) bad('different tokens')
  if (String(est.amount_in ?? '') !== req.amount) bad('a different sell amount')
  for (const [name, v] of [['amount_out', est.amount_out], ['min_amount_out', est.min_amount_out],
    ['total_dex_fee', est.total_dex_fee], ['deposits', est.deposits]] as const) {
    if (typeof v !== 'string' || !UINT.test(v)) bad(`missing ${name}`)
  }
  const aggregatorFee = est.aggregator_fee == null ? '0' : String(est.aggregator_fee)
  if (!UINT.test(aggregatorFee)) bad('a malformed aggregator fee')
  if (BigInt(est.amount_out as string) <= 0n || BigInt(est.min_amount_out as string) <= 0n) bad('no output')

  // One order, not a split: each split path would be a separate order with its
  // own floor, and the transaction would lock the input across several of them.
  if (!Array.isArray(est.paths) || est.paths.length !== 1) bad('the route is split across several orders')
  const steps = (est.paths as MinswapPathStep[][])[0]
  if (!Array.isArray(steps) || steps.length === 0) bad('an empty route')
  const path: string[] = [unit(steps[0].token_in)]
  steps.forEach((s, i) => {
    if (s.protocol !== 'MinswapV2') bad(`hop ${i + 1} uses ${s.protocol ?? 'an unknown protocol'}, not Minswap V2`)
    if (unit(s.token_in) !== path[path.length - 1]) bad(`hop ${i + 1} does not continue the route`)
    const next = unit(s.token_out)
    if (!isValidSwapAddress('cardano', next)) bad(`hop ${i + 1} names an invalid token`)
    path.push(next)
  })
  if (path[0] !== unit(req.token_in) || path[path.length - 1] !== unit(req.token_out)) bad('the route ends at a different token')
  if (new Set(path).size !== path.length) bad('the route revisits a token')

  return {
    buyAmountRaw: est.amount_out as string,
    minBuyAmountRaw: est.min_amount_out as string,
    hops: steps.length,
    priceImpactPct: typeof est.avg_price_impact === 'number' && Number.isFinite(est.avg_price_impact) ? est.avg_price_impact : 0,
    terms: {
      protocol: 'MinswapV2',
      path,
      batcherFeeLovelace: est.total_dex_fee as string,
      depositLovelace: est.deposits as string,
      aggregatorFeeLovelace: aggregatorFee,
    },
  }
}

export type MinswapFetch = (url: string, init: RequestInit) => Promise<Response>

async function post<T>(fetchFn: MinswapFetch, path: string, body: unknown): Promise<T> {
  const res = await fetchFn(`${MINSWAP_AGGREGATOR_URL}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const data = await res.json().catch(() => null) as (T & { message?: string; error?: string }) | null
  if (res.status === 429) {
    throw new MinswapQuoteError('Minswap is limiting requests from this device. Wait a minute, then refresh the quote.')
  }
  if (!res.ok || !data) {
    const why = data && typeof data.message === 'string' ? data.message.slice(0, 200) : `HTTP ${res.status}`
    throw new MinswapQuoteError(`Minswap could not quote this swap: ${why}`)
  }
  return data
}

export interface MinswapQuoteInput {
  sellUnit: string
  buyUnit: string
  sellAmountRaw: string
  slippageBps: number
  /** The wallet's own Cardano address — the order's owner and receiver. */
  sender: string
  fromSymbol: string
  toSymbol: string
}

/**
 * Estimate, check, then build the unsigned order transaction for `sender`.
 *
 * The floor is Minswap's OWN `min_amount_out`, passed back to build-tx unchanged
 * (measured: a stricter floor of our own is sometimes refused with
 * InvalidOrderOptionsError). Minswap applies slippage PER HOP, so a multi-hop
 * route asked for the user's full slippage would enforce a weaker floor than the
 * one on screen; when that happens it is re-asked with the slippage divided
 * across the hops, which never compounds below the approved floor.
 */
export async function minswapQuoteDirect(input: MinswapQuoteInput, fetchFn: MinswapFetch): Promise<NormalizedSwapQuote> {
  const sell = unit(input.sellUnit)
  const buy = unit(input.buyUnit)
  if (!isValidSwapAddress('cardano', sell) || !isValidSwapAddress('cardano', buy)) {
    throw new MinswapQuoteError('Not a Cardano token.')
  }
  if (!Number.isInteger(input.slippageBps) || input.slippageBps <= 0 || input.slippageBps >= 10000) {
    throw new MinswapQuoteError('Invalid slippage for a Minswap order.')
  }

  const request = (slippagePct: number): MinswapEstimateRequest => ({
    amount: input.sellAmountRaw,
    token_in: sell,
    token_out: buy,
    slippage: slippagePct,
    allow_multi_hops: true,
    include_protocols: ['MinswapV2'],
  })

  let req = request(input.slippageBps / 100)
  let terms = termsFromEstimate(req, await post<MinswapEstimate>(fetchFn, 'estimate', req))
  const floorHolds = (t: MinswapTerms) => BigInt(t.minBuyAmountRaw) >= approvedFloor(t.buyAmountRaw, input.slippageBps)
  if (!floorHolds(terms) && terms.hops > 1) {
    req = request(input.slippageBps / 100 / terms.hops)
    terms = termsFromEstimate(req, await post<MinswapEstimate>(fetchFn, 'estimate', req))
  }
  if (!floorHolds(terms)) {
    throw new MinswapQuoteError('Minswap\'s minimum for this route is looser than your slippage setting, so it is not offered.')
  }

  const built = await post<{ cbor?: string }>(fetchFn, 'build-tx', {
    sender: input.sender,
    min_amount_out: terms.minBuyAmountRaw,
    estimate: req,
  })
  if (typeof built.cbor !== 'string' || !/^([0-9a-fA-F]{2})+$/.test(built.cbor)) {
    throw new MinswapQuoteError('Minswap did not return a transaction to sign.')
  }

  const ada = (name: string, amountRaw: string): ExternalFeeRecord => ({
    name, tokenSymbol: 'ADA', tokenDecimals: 6, amountRaw, includedInQuotedOutput: false,
  })
  const externalFees: ExternalFeeRecord[] = [ada('Minswap batcher fee', terms.terms.batcherFeeLovelace)]
  if (terms.terms.aggregatorFeeLovelace !== '0') externalFees.push(ada('Minswap aggregator fee', terms.terms.aggregatorFeeLovelace))

  const sellNum = Number(input.sellAmountRaw)
  return {
    provider: 'minswap',
    fromChain: 'cardano',
    toChain: 'cardano',
    fromTokenAddress: sell === CARDANO_LOVELACE ? CARDANO_LOVELACE : sell,
    toTokenAddress: buy,
    fromTokenSymbol: input.fromSymbol,
    toTokenSymbol: input.toSymbol,
    sellAmountRaw: input.sellAmountRaw,
    buyAmountRaw: terms.buyAmountRaw,
    minBuyAmountRaw: terms.minBuyAmountRaw,
    // The floor is written into the order datum, and the batcher cannot pay
    // less; the wallet reads it back out of the transaction before signing.
    minReceivedSource: 'provider',
    estimatedGasRaw: '0',
    slippageBps: input.slippageBps,
    priceImpactPct: terms.priceImpactPct,
    rate: sellNum > 0 ? Number(terms.buyAmountRaw) / sellNum : 0,
    expiresAt: Date.now() + QUOTE_TTL_MS,
    isCrossChain: false,
    toAddress: input.sender,
    bridgeTool: 'Minswap V2',
    estimatedDurationSec: 60,
    feeBps: 0,
    // Minswap's API has no integrator fee, so this route carries no Magic Money
    // fee and is never counted as revenue. Its own fees are reported separately.
    appFee: feeFreeRecord('minswap', 'cardano', 'Minswap aggregator has no integrator fee mechanism'),
    externalFees,
    requestId: null,
    txData: { cbor: built.cbor.toLowerCase() },
    approvalTx: null,
    cardanoOrder: terms.terms,
  }
}

// ── Token discovery ───────────────────────────────────────────────────────────

interface MinswapToken {
  token_id?: string
  ticker?: string
  project_name?: string
  decimals?: number
  logo?: string
  is_verified?: boolean
  price_by_usd?: number
}

/** Raw discovery record; the caller re-validates it through sanitizeDiscoveredToken. */
export interface MinswapDiscovered {
  address: string
  symbol: string
  name: string
  decimals: number | undefined
  logoUri: string | null
  verified: boolean | null
  source: 'minswap'
  priceUsd: number | null
  isNative: boolean
}

const SEARCH_TTL_MS = 5 * 60_000
const searchCache = new Map<string, { at: number; tokens: MinswapDiscovered[] }>()

export function __clearMinswapSearchCache(): void { searchCache.clear() }

/**
 * Search Minswap's token index by name, ticker or FULL unit.
 *
 * Returned records carry the full unit as the address and Minswap's verified
 * flag as provenance — a ticker is never identity (a live search for "USDCx"
 * returns three different policies carrying that asset name). A token Minswap
 * gives no decimals for is returned without them and dropped by the caller:
 * converting an amount with a guessed decimal count misprices the trade.
 *
 * Cached per query, and never throws: discovery runs per keystroke against a
 * per-IP rate limit the QUOTE also needs, so a miss degrades to an empty list.
 */
export async function minswapTokenSearch(query: string, limit: number, fetchFn: MinswapFetch): Promise<MinswapDiscovered[]> {
  const term = query.trim().slice(0, 120)
  if (term.length < 2) return []
  const key = term.toLowerCase()
  const hit = searchCache.get(key)
  if (hit && Date.now() - hit.at < SEARCH_TTL_MS) return hit.tokens.slice(0, limit)

  const out: MinswapDiscovered[] = []
  try {
    let cursor: unknown = undefined
    // Two pages at most: enough for a picker, cheap on the shared rate limit.
    for (let page = 0; page < 2 && out.length < limit; page++) {
      const body: Record<string, unknown> = { query: term, only_verified: false }
      if (cursor !== undefined) body.search_after = cursor
      const data = await post<{ tokens?: MinswapToken[]; search_after?: unknown }>(fetchFn, 'tokens', body)
      for (const t of data.tokens ?? []) {
        const address = String(t.token_id ?? '').toLowerCase()
        if (!isValidSwapAddress('cardano', address)) continue
        out.push({
          address,
          symbol: String(t.ticker ?? t.project_name ?? '').trim(),
          name: String(t.project_name ?? t.ticker ?? '').trim(),
          decimals: typeof t.decimals === 'number' ? t.decimals : undefined,
          logoUri: typeof t.logo === 'string' ? t.logo : null,
          verified: typeof t.is_verified === 'boolean' ? t.is_verified : null,
          source: 'minswap',
          priceUsd: typeof t.price_by_usd === 'number' && Number.isFinite(t.price_by_usd) ? t.price_by_usd : null,
          isNative: address === CARDANO_LOVELACE,
        })
      }
      cursor = data.search_after
      if (!Array.isArray(cursor) || cursor.length === 0) break
    }
  } catch {
    return out.slice(0, limit)
  }
  searchCache.set(key, { at: Date.now(), tokens: out })
  return out.slice(0, limit)
}
