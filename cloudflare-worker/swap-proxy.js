/**
 * swap-proxy.js — MagicMoney Wallet security proxy (Cloudflare Worker)
 *
 * The wallet client NEVER calls aggregator APIs directly and NEVER holds their
 * API keys. It calls this worker, which injects the key server-side from
 * Cloudflare environment variables and returns a normalized response.
 *
 * Routes
 *   GET  /quote     ?chain&sell&buy&sellSymbol&buySymbol&amount&slippageBps&taker
 *   GET  /tokens    ?chain[&q|&address][&limit]   — discovery, see tokens.js
 *   GET  /ss/estimate ?from&fromNet&to&toNet&amount&fixed
 *   POST /ss/exchange  { tickerFrom, networkFrom, tickerTo, networkTo, amount, addressTo, ... }
 *   GET  /ss/status/:id
 *   GET  /ss/pairs    ?fixed
 *   GET  /ss/currencies
 *   GET  /cn/estimate, /cn/range; POST /cn/exchange; GET /cn/status/:id
 *   (/ss/* and /cn/* are validated and rate limited in xchange.js)
 *
 * Required env (wrangler secret put …):
 *   ZEROX_API_KEY        — 0x Swap API v2
 *   ONEINCH_API_KEY      — 1inch (EVM fallback)
 *   JUPITER_API_KEY      — Jupiter (optional; public endpoint works keyless)
 *   LIFI_API_KEY         — LI.FI (cross-chain; OPTIONAL — routing is keyless, key only raises rate limits)
 *   RANGO_API_KEY        — Rango (cross-chain fallback / exotic chains)
 *   SWAPKIT_API_KEY      — SwapKit (THORChain/Maya/Chainflip; native-BTC routes)
 *   SIMPLESWAP_API_KEY   — SimpleSwap v3
 *   CHANGENOW_API_KEY    — ChangeNOW v2 (deposit-address fallback; covers DOT)
 *   ALLOWED_ORIGIN       — optional CORS allowlist (defaults to '*')
 *
 * Fee / monetization vars (non-secret addresses; safe as [vars] or secrets):
 *   FEE_BPS              — affiliate/integrator fee in basis points (default 90 = 0.9%)
 *   FEE_EVM              — EVM fee recipient (0x…)
 *   FEE_SOLANA           — Solana fee referral account (token-referral pubkey)
 *   FEE_CARDANO / FEE_BITCOIN / FEE_POLKADOT — recipients for those chains (cross-chain affiliate)
 *   LIFI_INTEGRATOR      — LI.FI integrator string (required to attribute/collect the fee)
 *   JUPITER_REFERRAL_ACCOUNT — Jupiter referral account; fee skipped when unset
 *   ONEINCH_REFERRER     — 1inch referrer address (defaults to FEE_EVM)
 */

import { cors, json, err, productionConfigError } from './lib.js'
import { handleRead } from './read.js'
import { handleDb } from './db.js'
import { handleMarket, refreshTop500 } from './market.js'
import { handleTokens } from './tokens.js'
import { handleXchange, bindingAllows } from './xchange.js'
import {
  SWAP_FEE_POLICY_VERSION, policyFeeBps, policyFeeRecipient, policyLifiIntegrator,
  emptyFeeRecord, feeFreeRecord, feeAmountMatches, effectiveBps, recipientBoundInCalldata,
  feeTierOf, providerCanVerifyAppFee, SWAP_FEE_PROVIDERS,
} from './swap-fee.js'
import { relayQuote, relayStatus } from './swap-relay.js'
import { handleSwapChains, DOCUMENTED_CHAINS, toChainId } from './swap-chains.js'
import { selectRoute, workerRouteMetrics } from './swap-routing.js'

// Wallet chain id -> numeric EVM chainId, for the SAME-CHAIN aggregators (0x,
// 1inch, Uniswap). Until 2026-09-21 this listed only 8 chains, which meant
// Robinhood/Arc/Abstract/HyperEVM/Zora/Soneium/Ronin/Gnosis/Blast/ApeChain never
// even tried these three aggregators same-chain, despite the wallet being able
// to sign transactions on all of them (src/main/swap-executor.ts EVM_CHAIN_ID).
// Kept as a separate literal map (like LIFI_CHAIN/RANGO_CHAIN/SWAPKIT_CHAIN
// below) because this file has no import path to the TS registry; parity with
// the executor's set is pinned by swap-chain-parity.test.ts.
export const EVM_CHAIN_IDS = {
  ethereum: 1, arbitrum: 42161, optimism: 10, base: 8453,
  polygon: 137, avalanche: 43114, bsc: 56, monad: 143,
  blast: 81457, gnosis: 100, abstract: 2741, apechain: 33139,
  robinhood: 4663, arc: 5042, ronin: 2020, soneium: 1868,
  worldchain: 480, zora: 7777777, hyperevm: 999,
}

/**
 * Does PROVIDER document/list support for this numeric chain id? A fast,
 * synchronous check against the documented/live-cached lists in swap-chains.js
 * — used to skip a call we already have evidence would fail, not to authorize
 * one. Unknown providers (no entry) are not gated: their own adapter already
 * throws a clear error when the chain is unsupported.
 */
export function providerDocumentsChain(provider, chainId) {
  const doc = DOCUMENTED_CHAINS[provider]
  if (!doc) return true
  return doc.chains.includes(chainId)
}
const NATIVE_EVM = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const NATIVE_ZERO = '0x0000000000000000000000000000000000000000'
const NATIVE_SET = new Set([NATIVE_EVM.toLowerCase(), NATIVE_ZERO])
const isNativeEvm = (a) => NATIVE_SET.has((a || '').toLowerCase())

// Solana native sentinel (wrapped-SOL mint) the client sends.
const SOL_NATIVE_MINT = 'So11111111111111111111111111111111111111112'

// Our chain id → LI.FI chain id. EVM uses numeric chainId; Solana/Bitcoin use
// LI.FI's special ids. Validate against GET https://li.quest/v1/chains in testing.
const LIFI_CHAIN = {
  ethereum: 1, arbitrum: 42161, optimism: 10, base: 8453,
  polygon: 137, avalanche: 43114, bsc: 56, monad: 143,
  solana: 1151111081099710, bitcoin: 20000000000001,
}
// Our chain id → Rango blockchain identifier. Validate against
// GET https://api.rango.exchange/basic/meta in testing.
const RANGO_CHAIN = {
  ethereum: 'ETH', arbitrum: 'ARBITRUM', optimism: 'OPTIMISM', base: 'BASE',
  polygon: 'POLYGON', avalanche: 'AVAX_CCHAIN', bsc: 'BSC', monad: 'MONAD',
  solana: 'SOLANA', bitcoin: 'BTC', cardano: 'CARDANO', polkadot: 'POLKADOT',
}
// Our chain id → SwapKit chain code (THORChain/Maya/Chainflip aggregator).
// SwapKit/THORChain does NOT cover Monad/Cardano/Polkadot. Validate identifiers
// against SwapKit docs in testing; unsupported chains throw → other providers win.
const SWAPKIT_CHAIN = {
  ethereum: 'ETH', arbitrum: 'ARB', optimism: 'OP', base: 'BASE',
  polygon: 'POL', avalanche: 'AVAX', bsc: 'BSC', solana: 'SOL', bitcoin: 'BTC',
}

// Decimal-string ⇄ raw-integer-string helpers (the Worker has no BigNumber lib;
// SwapKit takes/returns human decimal amounts, our normalized quotes use raw).
function rawToDecimalStr(raw, decimals) {
  const d = Math.max(0, Number(decimals) || 0)
  const s = String(raw).replace(/[^0-9]/g, '') || '0'
  if (d === 0) return s.replace(/^0+(?=\d)/, '')
  const padded = s.padStart(d + 1, '0')
  const intPart = padded.slice(0, -d).replace(/^0+(?=\d)/, '')
  const frac = padded.slice(-d).replace(/0+$/, '')
  return frac ? `${intPart}.${frac}` : intPart
}
function decimalStrToRaw(dec, decimals) {
  const d = Math.max(0, Number(decimals) || 0)
  const [i = '0', f = ''] = String(dec).trim().split('.')
  const frac = (f + '0'.repeat(d)).slice(0, d)
  const digits = ((i.replace(/[^0-9]/g, '') || '0') + frac).replace(/^0+(?=\d)/, '')
  try { return BigInt(digits || '0').toString() } catch { return '0' }
}

// ── Minimum received ──────────────────────────────────────────────────────────
// The floor the transaction reverts below — the real slippage protection, and
// what the executor checks before it will sign a non-curated token
// (src/main/swap-policy.ts). A provider's OWN figure is always preferred: it is
// the number actually encoded in the calldata. `deriveMinOut` is the fallback
// for providers that don't return one, and is only a restatement of terms the
// user already accepted, not a guarantee the router enforces it.
//
// Verified live against the providers: Jupiter `otherAmountThreshold` and LI.FI
// `estimate.toAmountMin` both came back at exactly (1 - slippage) x output.
// The keyed providers' field names follow their docs and fall back to derived
// if absent, so a renamed field degrades instead of shipping a bogus floor.
function deriveMinOut(outRaw, slippageBps) {
  const out = String(outRaw || '').replace(/[^0-9]/g, '')
  if (!out) return undefined
  const bps = Math.max(0, Math.min(10000, Math.round(Number(slippageBps) || 0)))
  try { return ((BigInt(out) * BigInt(10000 - bps)) / 10000n).toString() } catch { return undefined }
}
/**
 * Emit BOTH the floor and where it came from.
 *
 * The distinction is load-bearing downstream: src/main/swap-policy.ts will only
 * execute a token outside the wallet's curated list on a 'provider' floor,
 * because that is the bound actually encoded in the payload. A derived value
 * restates terms the user accepted and is enforced by nothing — so if a
 * provider renames its field, this degrades to 'derived' and broad execution is
 * refused rather than silently proceeding on a verified-looking number.
 */
function minOutFields(providerValue, outRaw, slippageBps) {
  const v = String(providerValue ?? '')
  if (/^[0-9]+$/.test(v) && v !== '0') {
    return { minBuyAmountRaw: v, minReceivedSource: 'provider' }
  }
  const derived = deriveMinOut(outRaw, slippageBps)
  return derived ? { minBuyAmountRaw: derived, minReceivedSource: 'derived' } : {}
}

/**
 * Read a provider response as JSON, or fail with something a user can act on.
 *
 * Providers return HTML when they are down, rate-limiting, behind a CDN error
 * page, or when a key is missing. `res.json()` on that throws
 * "Unexpected token '<', <!DOCTYPE..." and, because each adapter's message
 * becomes the reason shown in the swap screen, THAT is what the user was being
 * told a swap had failed for. It named the parser, not the problem.
 */
async function readProviderJson(res, label) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    const kind = /^\s*<(?:!doctype|html)/i.test(text) ? 'an HTML error page' : 'a non-JSON response'
    throw new Error(`${label} returned ${kind} (HTTP ${res.status})`)
  }
}

/** LI.FI includedSteps reduced to type/tool/toChainId/toToken. Descriptive only. */
function compactLifiSteps(steps) {
  if (!Array.isArray(steps)) return null
  return steps.slice(0, 16).map(st => {
    const a = (st && st.action) || {}
    const t = a.toToken || {}
    return {
      type: typeof st.type === 'string' ? st.type : '',
      tool: typeof st.tool === 'string' ? st.tool : null,
      action: {
        toChainId: a.toChainId != null ? a.toChainId : null,
        toToken: {
          address: typeof t.address === 'string' ? t.address : null,
          symbol: typeof t.symbol === 'string' ? t.symbol : null,
          decimals: Number.isInteger(t.decimals) ? t.decimals : null,
        },
      },
    }
  })
}

// ── Fee config ────────────────────────────────────────────────────────────────
// The rate and the beneficiaries come from swap-fee.js (mirror of
// src/shared/swap-fee-policy.ts), not from a local default. A FEE_BPS or FEE_*
// value that disagrees with the policy THROWS rather than quietly overriding it:
// the wallet validates recipients against its own copy of the same table and
// would refuse to sign, so serving such a quote only moves the failure later.
const feeBps = (env) => policyFeeBps(env)
const feePct = (env) => policyFeeBps(env) / 10000   // 100 -> 0.01
const feeRecipient = (env, chain) => policyFeeRecipient(env, chain)

// cors / json / err live in lib.js (shared with the read + db route modules).

// ── Wallet-app origins (Android/iOS WebView) ─────────────────────────────────
// The mobile app's browser-fetch path runs from a FIXED WebView origin. The
// website keeps getting env.ALLOWED_ORIGIN exactly as before; only these two
// known app origins are reflected per-request (single choke point in fetch()).
// Requests routed through the app's native bridge carry no Origin and are
// untouched — CORS is a browser-side gate, the x-mm-client token stays the
// actual access control either way.
const APP_ORIGINS = new Set(['https://localhost', 'capacitor://localhost'])

function reflectAppOrigin(request, response) {
  const origin = request.headers.get('Origin')
  if (!origin || !APP_ORIGINS.has(origin)) return response
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', origin)
  headers.append('Vary', 'Origin')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

async function handleFetch(request, env, ctx) {
    const url = new URL(request.url)
    const { pathname } = url

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env) })

    const configError = productionConfigError(env)
    if (pathname === '/health') return json(env, { ok: !configError, error: configError }, configError ? 500 : 200)
    if (configError) return err(env, `Worker production guard failed: ${configError}`, 500)

    try {
      // Read-path + Supabase + market routes — each returns null when its
      // namespace doesn't match, so the swap routes below still run unchanged.
      const read = await handleRead(request, url, env, ctx)
      if (read) return read
      const db = await handleDb(request, url, env, ctx)
      if (db) return db
      const market = await handleMarket(request, url, env, ctx)
      if (market) return market

      // Exchange (/ss/*, /cn/*): validated and rate limited in xchange.js.
      const xchange = await handleXchange(request, url, env, ctx)
      if (xchange) return xchange

      // DEX quote and status spend keyed provider quota (0x, 1inch, Uniswap,
      // LI.FI, Rango, SwapKit, Relay) on every call, so they are metered per IP.
      if (pathname === '/quote' || pathname === '/swap/status') {
        const quote = pathname === '/quote'
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
        if (!(await bindingAllows(env, quote ? 'SWAP_QUOTE_LIMITER' : 'SWAP_STATUS_LIMITER', `${quote ? 'quote' : 'status'}:${ip}`))) {
          return new Response(JSON.stringify({ error: 'Too many swap requests. Please wait a minute and try again.' }), {
            status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60', ...cors(env) },
          })
        }
        return quote ? await handleQuote(url, env) : await handleStatus(url, env)
      }
      if (pathname === '/swap/chains') return await handleSwapChains(request, url, env, ctx)
      if (pathname === '/tokens') return await handleTokens(request, url, env, ctx)
      return err(env, 'Not found', 404)
    } catch (e) {
      return err(env, e && e.message ? e.message : 'Proxy error', 500)
    }
}

export default {
  async fetch(request, env, ctx) {
    return reflectAppOrigin(request, await handleFetch(request, env, ctx))
  },

  // Cron trigger (wrangler.toml [triggers]) — keeps the global Market Watch
  // top-500 list warm in KV. Runs outside the fetch-time prod guard; a failed
  // refresh logs and leaves the previous (stale) KV copy in place.
  async scheduled(event, env, ctx) {
    try {
      await refreshTop500(env)
    } catch (e) {
      console.log('market cron refresh failed:', e && e.message ? e.message : e)
    }
  },
}

// ─── DEX quote routing ────────────────────────────────────────────────────────

/**
 * Route selection (see cloudflare-worker/swap-routing.js / the routing-policy
 * ADR at src/shared/swap-routing-policy.ts for the full rule).
 *
 * Replaces the old two-tier rule, where ANY verified fee-paying route beat
 * EVERY fee-free route outright, however much less it returned. Now: the best
 * real net result wins; a fee-paying route is preferred over it only within a
 * documented, versioned tolerance (fee support is a tie-breaker, never a
 * barrier). Every candidate that produced an output is ranked, not only the
 * winner, so the response can show alternatives.
 */
export function pickBestRoute(candidates, bps) {
  const usable = candidates.filter(c => c && c.quote && c.quote.buyAmountRaw && c.quote.buyAmountRaw !== '0')
  const notes = []
  for (const c of usable) {
    const { reason } = feeTierOf(c.quote, bps)
    if (reason) notes.push(reason)
  }
  if (!usable.length) return { winner: null, candidates: [], alternatives: [], routing: null, notes }

  const metrics = usable.map(c =>
    workerRouteMetrics(c.name, c.quote, feeTierOf(c.quote, bps).tier === 'fee-paying'))
  const selection = selectRoute(metrics)
  if (!selection) return { winner: null, candidates: [], alternatives: [], routing: null, notes }

  const byKey = new Map(usable.map(c => [c.name, c]))
  const winner = byKey.get(selection.selectedKey) ?? null
  // Every usable candidate, best first, as FULL quotes: the wallet re-checks
  // each against its own signing gate and re-ranks, so a route this Worker
  // ranks first but the wallet cannot sign does not hide a safe one behind it.
  const candidatesRanked = selection.ranked.map(r => byKey.get(r.key)).filter(Boolean).map(c => c.quote)
  const alternatives = selection.alternatives
    .map(a => byKey.get(a.key))
    .filter(Boolean)
    .map(c => ({
      provider: c.quote.provider,
      buyAmountRaw: c.quote.buyAmountRaw,
      minBuyAmountRaw: c.quote.minBuyAmountRaw ?? null,
      feeBps: c.quote.appFee ? (c.quote.appFee.appliedBps ?? 0) : 0,
      bridgeTool: c.quote.bridgeTool ?? null,
      estimatedDurationSec: c.quote.estimatedDurationSec ?? null,
    }))
  return {
    winner,
    candidates: candidatesRanked,
    alternatives,
    routing: {
      policyVersion: selection.policyVersion,
      reason: selection.reason,
      shortfallBps: selection.shortfallBps,
      costsNormalized: selection.costsNormalized,
    },
    notes,
  }
}

/** A slow provider must not hold up the whole concurrent batch. */
const PROVIDER_DEADLINE_MS = 9000
function withTimeout(promise, label, ms = PROVIDER_DEADLINE_MS) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function handleQuote(url, env) {
  const q = Object.fromEntries(url.searchParams)
  const fromChain = (q.fromChain || q.chain || '').toLowerCase()
  const toChain = (q.toChain || fromChain).toLowerCase()
  q.fromChain = fromChain
  q.toChain = toChain
  if (!q.sell || !q.buy || !q.amount || !q.taker) return err(env, 'Missing quote parameters.')

  const sameChain = fromChain === toChain
  const STD_FEE_BPS = feeBps(env)

  /**
   * Run a provider, once with the app fee and -- only if that could not produce
   * a tier-1 result -- again with NO fee at all.
   *
   * The re-ask matters: a provider that was sent a 1% fee it cannot account for
   * would otherwise charge the user 1% that nobody can attribute. Asking for
   * nothing turns that into a fact we can state ("no Magic Money fee on this
   * route") instead of an unknown we would have to disclose as one.
   */
  const withFallback = async (name, run) => {
    // A provider that can never reach tier 1 is asked ONCE, fee-free. Running the
    // fee-bearing pass first would be two identical upstream calls for the same
    // answer, and upstream quota is shared across the whole user base.
    const usable = (q) => !!(q && q.buyAmountRaw && q.buyAmountRaw !== '0')
    if (!providerCanVerifyAppFee(name)) {
      try {
        const free = await withTimeout(run(true), name)
        return usable(free) ? { name, quote: free } : { name, error: 'no route' }
      } catch (e) {
        return { name, error: e && e.message ? e.message : 'route error' }
      }
    }

    // Tier-1 attempt. A tier-2 result from this pass is KEPT rather than
    // discarded: if the fee-free re-ask then fails (rate limit, a transient
    // upstream error), losing a working route would be exactly the outcome this
    // policy exists to prevent.
    let firstError = null
    let paidButUnverified = null
    try {
      const paid = await withTimeout(run(false), name)
      if (usable(paid)) {
        if (feeTierOf(paid, STD_FEE_BPS).tier === 'fee-paying') return { name, quote: paid }
        paidButUnverified = paid
      }
    } catch (e) {
      // A provider that cannot quote WITH a fee may still quote without one
      // (Jupiter with no fee account for the output mint is exactly this case),
      // so the fee-free attempt still runs rather than being skipped.
      firstError = e && e.message ? e.message : 'route error'
    }

    // Prefer an EXPLICITLY fee-free quote: it lets us say "no Magic Money fee"
    // instead of billing 1% that cannot be attributed to anyone.
    try {
      const free = await withTimeout(run(true), name)
      if (usable(free)) return { name, quote: free }
    } catch (e2) {
      firstError = firstError || (e2 && e2.message ? e2.message : 'route error')
    }
    if (paidButUnverified) return { name, quote: paidButUnverified }
    return { name, error: firstError || 'no route' }
  }

  /** Ask every candidate CONCURRENTLY and pick with the routing policy. */
  const resolveBest = async (tries) => {
    const settled = await Promise.all(tries.map(([name, run]) => withFallback(name, run)))
    const { winner, candidates, alternatives, routing, notes } = pickBestRoute(settled, STD_FEE_BPS)
    if (winner) return json(env, { quote: winner.quote, candidates, alternatives, routing, error: null })
    const errors = settled.filter(s => s.error).map(s => `${s.name}: ${s.error}`).concat(notes)
    return json(env, { quote: null, error: errors.join(' | ') || 'No route available for this pair.' })
  }

  // Same-chain EVM: every applicable provider is queried CONCURRENTLY — the
  // three native same-chain aggregators plus LI.FI and Rango, which both quote
  // same-chain pairs too. This used to be staged (the trio first, LI.FI/Rango
  // only if the trio produced NOTHING at all), which meant a materially better
  // LI.FI or Rango route was never even seen whenever the trio returned
  // anything, however weak. Maximizing route availability means trying every
  // applicable provider and comparing real results, not stopping early.
  //
  // `chainId` falls back to the RPC-verified numeric id an IMPORTED network
  // sends (fromChainId) when the wallet chain-id STRING matches no built-in.
  const chainId = EVM_CHAIN_IDS[fromChain] ?? toChainId(q.fromChainId)
  if (sameChain && chainId != null) {
    const tries = [
      ['0x', (noFee) => zeroExQuote(fromChain, q, env, noFee)],
      ['1inch', (noFee) => oneInchQuote(fromChain, q, env, noFee)],
      ['uniswap', (noFee) => uniswapQuote(fromChain, q, env, noFee)],
      ['lifi', (noFee) => lifiQuote(q, env, noFee)],
      ['rango', (noFee) => rangoQuote(q, env, noFee)],
      // Relay also fills same-chain swaps (measured 2026-09-21: EMO -> MON on
      // Monad = approve + swap, both on chain 143, our fee applied). Keyless,
      // so it can serve pairs the key-gated aggregators cannot.
      ['relay', (noFee) => relayQuote(q, env, noFee)],
    ].filter(([name]) => providerDocumentsChain(name, chainId))
    return resolveBest(tries)
  }

  const tries = []
  if (sameChain && fromChain === 'solana') {
    tries.push(['jupiter', (noFee) => jupiterQuote(q, env, noFee)])
    tries.push(['lifi', (noFee) => lifiQuote(q, env, noFee)])
    tries.push(['rango', (noFee) => rangoQuote(q, env, noFee)])
  } else {
    // Cross-chain (any -> any). The client calls LI.FI directly (its IP isn't rate-
    // limited like our shared Worker IP) and sets skipLifi; only try LI.FI here as a
    // last resort when the client didn't.
    //
    // Relay is included alongside the others, not staged ahead of them: it is a
    // solver, so a route that cannot be filled is refunded rather than leaving
    // the user holding a bridged intermediate, and it quotes pairs the others
    // refuse (EMO/Monad -> PIXL/Ethereum quotes here and nowhere else
    // configured) — but that is a reason it is WORTH including, not a reason it
    // should win before the others are even compared.
    tries.push(['relay', (noFee) => relayQuote(q, env, noFee)])
    tries.push(['rango', (noFee) => rangoQuote(q, env, noFee)])
    tries.push(['swapkit', (noFee) => swapkitQuote(q, env, noFee)])
    if (q.skipLifi !== '1') tries.push(['lifi', (noFee) => lifiQuote(q, env, noFee)])
  }
  return resolveBest(tries)
}

// 0x Swap API v2 (allowance-holder). Docs: https://0x.org/docs/api
async function zeroExQuote(chain, q, env, noFee = false) {
  if (!env.ZEROX_API_KEY) throw new Error('0x key not configured')
  // Falls back to the RPC-verified numeric id for an imported network, which
  // EVM_CHAIN_IDS (keyed by wallet chain-id STRING) has no entry for.
  const chainId = EVM_CHAIN_IDS[chain] ?? toChainId(q.fromChainId)
  if (!chainId) throw new Error('0x: unsupported chain')
  const params = new URLSearchParams({
    chainId: String(chainId),
    sellToken: q.sell,
    buyToken: q.buy,
    sellAmount: q.amount,
    taker: q.taker,
    slippageBps: q.slippageBps || '50',
  })
  // App fee. 0x takes it in an ERC-20 (never native), so prefer the BUY token and
  // fall back to the sell token. A native-to-native pair has no eligible fee
  // token -- that used to throw and lose the route; it now simply falls to tier 2.
  const recipient = noFee ? null : feeRecipient(env, chain)
  const feeToken = noFee ? null
    : (!isNativeEvm(q.buy) ? q.buy : (!isNativeEvm(q.sell) ? q.sell : null))
  const bps = feeBps(env)
  const takeFee = !noFee && !!feeToken
  if (takeFee) {
    params.set('swapFeeRecipient', recipient)
    params.set('swapFeeBps', String(bps))
    params.set('swapFeeToken', feeToken)
  }
  const res = await fetch(`https://api.0x.org/swap/allowance-holder/quote?${params}`, {
    headers: { '0x-api-key': env.ZEROX_API_KEY, '0x-version': 'v2' },
  })
  const d = await readProviderJson(res, '0x')
  if (!res.ok) throw new Error(d.reason || d.message || `0x ${res.status}`)
  if (!d.liquidityAvailable) throw new Error('0x: no liquidity')

  // Approval: 0x v2 surfaces an allowance issue with the spender to approve.
  let approvalTx = null
  const spender = d.issues && d.issues.allowance && d.issues.allowance.spender
  if (spender && !NATIVE_SET.has(q.sell.toLowerCase())) {
    approvalTx = { to: q.sell, data: erc20ApproveData(spender), value: '0x0' }
  }

  // ---- App fee -------------------------------------------------------------
  // 0x v2 states what it charged in `fees.integratorFee` ({ amount, token }).
  // The request parameters are not evidence; this reconciles the amount it
  // reports against the policy rate applied to the base 0x says it used, and
  // looks for our recipient's bytes in the calldata that will execute.
  //
  // NOT exercised against a live key here. If the field is absent or renamed the
  // record stays unverified, which under the two-tier policy means this route is
  // a tier-2 candidate -- it is not dropped, and the caller will re-ask 0x for an
  // explicitly fee-free quote rather than charge a fee nobody can account for.
  let appFee
  if (takeFee) {
    appFee = emptyFeeRecord('0x', chain, bps)
    const feeOnBuy = String(feeToken).toLowerCase() === String(q.buy).toLowerCase()
    appFee.base = feeOnBuy ? 'output' : 'input'
    appFee.tokenAddress = feeToken
    appFee.tokenSymbol = feeOnBuy ? (q.buySymbol || null) : (q.sellSymbol || null)
    appFee.recipient = recipient
    appFee.recipientKind = 'onchain-address'
    const integ = (d.fees && d.fees.integratorFee) || null
    if (integ && integ.amount != null) {
      const amount = String(integ.amount).replace(/[^0-9]/g, '')
      // 0x reports buyAmount NET of a buy-token fee, so the base it applied the
      // percentage to is the gross output, not the net one.
      const feeBase = feeOnBuy
        ? (BigInt(String(d.buyAmount).replace(/[^0-9]/g, '') || '0') + BigInt(amount || '0')).toString()
        : q.amount
      appFee.amountRaw = amount || null
      appFee.appliedBps = effectiveBps(amount, feeBase)
      appFee.evidence.push('fees.integratorFee reported by 0x')
      if (integ.token && String(integ.token).toLowerCase() !== String(feeToken).toLowerCase()) {
        appFee.evidence.push('fee token did not match the requested one')
      } else if (feeAmountMatches(amount, feeBase, bps)) {
        appFee.appliedBps = bps
        appFee.verification = 'applied-verified'
        appFee.evidence.push(`amount reconciles to ${bps} bps of the ${appFee.base}`)
        if (recipientBoundInCalldata(d.transaction && d.transaction.data, recipient)) {
          appFee.evidence.push('recipient bytes present in swap calldata')
        }
      } else {
        appFee.evidence.push('reported amount did not reconcile to the policy rate')
      }
    } else {
      appFee.evidence.push('0x response carried no fees.integratorFee')
    }
  } else {
    appFee = feeFreeRecord('0x', chain, noFee
      ? 'quoted without an app fee (tier-2 fallback)'
      : 'native-to-native pair has no ERC-20 for 0x to take a fee in')
  }

  const sellAmt = Number(q.amount), buyAmt = Number(d.buyAmount)
  return {
    provider: '0x',
    fromChain: chain, toChain: chain,
    fromTokenAddress: q.sell, toTokenAddress: q.buy,
    fromTokenSymbol: q.sellSymbol || '', toTokenSymbol: q.buySymbol || '',
    sellAmountRaw: q.amount, buyAmountRaw: String(d.buyAmount),
    ...minOutFields(d.minBuyAmount, d.buyAmount, q.slippageBps || 50),
    estimatedGasRaw: String((d.transaction && d.transaction.gas) || '0'),
    slippageBps: Number(q.slippageBps || 50),
    priceImpactPct: d.priceImpactPct != null ? Number(d.priceImpactPct) : 0,
    rate: sellAmt > 0 ? buyAmt / sellAmt : 0,
    expiresAt: Date.now() + 30_000,
    isCrossChain: false,
    feeBps: appFee.appliedBps ?? 0,
    appFee,
    externalFees: [],
    txData: {
      to: d.transaction && d.transaction.to,
      data: d.transaction && d.transaction.data,
      value: (d.transaction && d.transaction.value) || '0',
    },
    approvalTx,
  }
}

// 1inch Swap API v6 (EVM fallback). Docs: https://portal.1inch.dev
async function oneInchQuote(chain, q, env, noFee = false) {
  if (!env.ONEINCH_API_KEY) throw new Error('1inch key not configured')
  const chainId = EVM_CHAIN_IDS[chain] ?? toChainId(q.fromChainId)
  if (!chainId) throw new Error('1inch: unsupported chain')
  const params = new URLSearchParams({
    src: q.sell, dst: q.buy, amount: q.amount, from: q.taker,
    slippage: String(Number(q.slippageBps || 50) / 100), disableEstimate: 'true',
  })
  // 1inch v6 /swap states NO applied-fee field, so a fee we requested here could
  // never be reconciled -- it would be a 1% charge we cannot attribute. Rather
  // than bill the user for that, 1inch is quoted fee-free and serves as a
  // fully-eligible tier-2 route. (`SWAP_FEE_PROVIDERS['1inch'].maxVerification`
  // is what would change if a measured response ever states the amount.)
  //
  // `noFee` is accepted for signature parity with the other adapters; 1inch is
  // fee-free either way, and the record says which of the two reasons applies.
  const bps = feeBps(env)
  const res = await fetch(`https://api.1inch.dev/swap/v6.0/${chainId}/swap?${params}`, {
    headers: { Authorization: `Bearer ${env.ONEINCH_API_KEY}`, accept: 'application/json' },
  })
  const d = await readProviderJson(res, '1inch')
  if (!res.ok) throw new Error(d.description || d.error || `1inch ${res.status}`)

  let approvalTx = null
  if (!NATIVE_SET.has(q.sell.toLowerCase())) {
    // 1inch exposes the router via /approve/spender; encode max approve to it.
    const sp = await fetch(`https://api.1inch.dev/swap/v6.0/${chainId}/approve/spender`, {
      headers: { Authorization: `Bearer ${env.ONEINCH_API_KEY}`, accept: 'application/json' },
    }).then(r => r.json()).catch(() => null)
    if (sp && sp.address) approvalTx = { to: q.sell, data: erc20ApproveData(sp.address), value: '0x0' }
  }

  const appFee = feeFreeRecord('1inch', chain,
    'no app fee requested: 1inch v6 /swap states no applied-fee amount to reconcile')

  const sellAmt = Number(q.amount), buyAmt = Number(d.dstAmount)
  return {
    provider: '1inch',
    fromChain: chain, toChain: chain,
    fromTokenAddress: q.sell, toTokenAddress: q.buy,
    fromTokenSymbol: q.sellSymbol || '', toTokenSymbol: q.buySymbol || '',
    sellAmountRaw: q.amount, buyAmountRaw: String(d.dstAmount),
    // 1inch v6 /swap states no floor of its own, so this is always an estimate —
    // which is why 1inch cannot carry a broad token (see swap-policy.ts).
    ...minOutFields(null, d.dstAmount, q.slippageBps || 50),
    estimatedGasRaw: String((d.tx && d.tx.gas) || '0'),
    slippageBps: Number(q.slippageBps || 50),
    priceImpactPct: 0,
    rate: sellAmt > 0 ? buyAmt / sellAmt : 0,
    expiresAt: Date.now() + 30_000,
    isCrossChain: false,
    feeBps: appFee.appliedBps ?? 0,
    appFee,
    externalFees: [],
    txData: { to: d.tx && d.tx.to, data: d.tx && d.tx.data, value: (d.tx && d.tx.value) || '0' },
    approvalTx,
  }
}

// Uniswap Trading API — classic v2/v3/v4. Docs: https://developers.uniswap.org/docs/trading
// Three POSTs so the normalized quote is self-contained (like 0x): check_approval
// (ERC-20 → Permit2) + quote (CLASSIC, permit-as-transaction so no off-chain signature)
// + swap. Our fee is a portion of the OUTPUT token → FEE_EVM. Field-name fallbacks are
// defensive (the key can't be exercised from CI; validate the exact shapes live).
const UNISWAP_API = 'https://trade-api.gateway.uniswap.org/v1'
async function uniswapPost(path, body, env) {
  const res = await fetch(`${UNISWAP_API}${path}`, {
    method: 'POST',
    headers: { 'x-api-key': env.UNISWAP_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((d && (d.detail || d.message || d.error || d.errorCode)) || `Uniswap ${res.status}`)
  return d
}

async function uniswapQuote(chain, q, env, noFee = false) {
  if (!env.UNISWAP_API_KEY) throw new Error('Uniswap key not configured')
  const chainId = EVM_CHAIN_IDS[chain] ?? toChainId(q.fromChainId)
  if (!chainId) throw new Error('Uniswap: unsupported chain')
  const bps = feeBps(env)
  const takeFee = !noFee
  const recipient = takeFee ? feeRecipient(env, chain) : null
  const uniTok = (a) => isNativeEvm(a) ? NATIVE_ZERO : a
  const sellNative = isNativeEvm(q.sell)

  // a. ERC-20 → Permit2 approval (native input needs none).
  let approvalTx = null
  if (!sellNative) {
    const ap = await uniswapPost('/check_approval', {
      walletAddress: q.taker, token: q.sell, amount: q.amount, chainId,
    }, env)
    const a = ap.approval
    if (a && a.to && a.data) approvalTx = { to: a.to, data: a.data, value: a.value || '0x0' }
  }

  // b. CLASSIC quote — permit generated as a tx (no off-chain signature).
  const qd = await uniswapPost('/quote', {
    type: 'EXACT_INPUT',
    amount: q.amount,
    tokenInChainId: chainId,
    tokenOutChainId: chainId,
    tokenIn: uniTok(q.sell),
    tokenOut: uniTok(q.buy),
    swapper: q.taker,
    slippageTolerance: Number(q.slippageBps || 50) / 100,   // 50 bps → 0.5(%)
    routingPreference: 'BEST_PRICE',   // request enum is BEST_PRICE|FASTEST; response `routing` may be CLASSIC/DUTCH/…
    generatePermitAsTransaction: true,
    // The integrator portion must be enabled on the API key by Uniswap Labs; until
    // then the request fields are ignored and the response reports no portion,
    // which leaves this route in tier 2 rather than dropping it.
    ...(takeFee ? { portionBips: bps, portionRecipient: recipient } : {}),
  }, env)
  // We can only execute on-chain CLASSIC routes here; DUTCH/UniswapX needs /order + an
  // off-chain order signature (out of scope) — throw so Uniswap drops out for those.
  if (qd.routing && qd.routing !== 'CLASSIC') throw new Error(`Uniswap: ${qd.routing} route not supported`)
  const quote = qd.quote || qd
  const outAmount = String((quote.output && quote.output.amount) || quote.quote || quote.amountOut || '0')
  if (outAmount === '0') throw new Error('Uniswap: no route')
  const portionBips = Number(quote.portionBips || 0)
  // ---- App fee, and the output normalization it forces ----------------------
  // Uniswap's EXACT_INPUT quote states the output BEFORE the integrator portion
  // is removed (unlike 0x/Jupiter/LI.FI, whose outputs are already net). So the
  // portion is subtracted exactly once, here, and every downstream number --
  // ranking, minimum received, the amount shown to the user -- is the real
  // receipt. Subtracting it twice would understate the trade just as badly as
  // not subtracting it overstates it.
  const portionAmount = String(
    quote.portionAmount || (quote.output && quote.output.portionAmount) || '',
  ).replace(/[^0-9]/g, '')
  const portionRecipient = String(quote.portionRecipient || (quote.output && quote.output.portionRecipient) || '')
  const appFee = takeFee
    ? emptyFeeRecord('uniswap', chain, bps)
    : feeFreeRecord('uniswap', chain, 'quoted without an app fee (tier-2 fallback)')
  if (takeFee) {
    appFee.base = 'output'
    appFee.tokenAddress = q.buy
    appFee.tokenSymbol = q.buySymbol || null
    appFee.recipient = portionRecipient || recipient
  }
  if (takeFee && portionAmount && portionBips > 0) {
    appFee.amountRaw = portionAmount
    appFee.appliedBps = portionBips
    appFee.evidence.push('portionBips/portionAmount reported by Uniswap')
    const recipientOk = !portionRecipient
      || portionRecipient.toLowerCase() === String(recipient).toLowerCase()
    if (!recipientOk) {
      appFee.evidence.push('portionRecipient did not match the configured recipient')
    } else if (portionBips === bps && feeAmountMatches(portionAmount, outAmount, bps)) {
      appFee.verification = 'applied-verified'
      appFee.evidence.push(`portion reconciles to ${bps} bps of the gross output`)
    } else {
      appFee.evidence.push('portion did not reconcile to the policy rate')
    }
  } else if (takeFee) {
    appFee.evidence.push('Uniswap reported no integrator portion (fee not enabled on this key)')
  }
  const subtractPortion = (raw) => {
    if (!takeFee || !portionAmount || !/^[0-9]+$/.test(String(raw || ''))) return raw
    try {
      const net = BigInt(raw) - BigInt(portionAmount)
      return (net > 0n ? net : 0n).toString()
    } catch { return raw }
  }
  const netOutAmount = subtractPortion(outAmount)
  const pt = qd.permitTransaction || quote.permitTransaction || null
  const permitTx = pt && pt.to && pt.data ? { to: pt.to, data: pt.data, value: pt.value || '0x0' } : null

  // c. Swap calldata (the permit was applied on-chain via permitTx / check_approval).
  const sd = await uniswapPost('/swap', { quote, simulateTransaction: false }, env)
  const swap = sd.swap || sd
  if (!swap.to || !swap.data) throw new Error('Uniswap: no swap calldata')

  const sellAmt = Number(q.amount), buyAmt = Number(netOutAmount)
  return {
    provider: 'uniswap',
    fromChain: chain, toChain: chain,
    fromTokenAddress: q.sell, toTokenAddress: q.buy,
    fromTokenSymbol: q.sellSymbol || '', toTokenSymbol: q.buySymbol || '',
    sellAmountRaw: q.amount, buyAmountRaw: netOutAmount,
    // The provider's floor is stated on the same gross basis as its output, so
    // the portion comes off it too -- otherwise the displayed minimum would sit
    // above what the user can actually receive.
    ...(() => {
      const stated = (quote.output && (quote.output.minAmount || quote.output.amountMin)) || quote.minimumAmountOut
      const fields = minOutFields(stated, outAmount, q.slippageBps || 50)
      if (fields.minBuyAmountRaw && fields.minReceivedSource === 'provider') {
        fields.minBuyAmountRaw = subtractPortion(fields.minBuyAmountRaw)
      } else if (fields.minBuyAmountRaw) {
        fields.minBuyAmountRaw = deriveMinOut(netOutAmount, q.slippageBps || 50)
      }
      return fields
    })(),
    estimatedGasRaw: String(swap.gasLimit || (quote.gasFee && quote.gasFee.gasLimit) || '0'),
    slippageBps: Number(q.slippageBps || 50),
    priceImpactPct: quote.priceImpact != null ? Number(quote.priceImpact) : 0,
    rate: sellAmt > 0 ? buyAmt / sellAmt : 0,
    expiresAt: Date.now() + 30_000,
    isCrossChain: false,
    feeBps: appFee.appliedBps ?? 0,
    appFee,
    externalFees: [],
    txData: { to: swap.to, data: swap.data, value: swap.value || '0' },
    permitTx,
    approvalTx,
  }
}

// Jupiter Swap API v1. Keyed host: api.jup.ag; free host: lite-api.jup.ag.
// Docs: https://dev.jup.ag/docs/swap-api
async function jupiterQuote(q, env, noFee = false) {
  const base = env.JUPITER_API_KEY ? 'https://api.jup.ag' : 'https://lite-api.jup.ag'
  const headers = env.JUPITER_API_KEY ? { 'x-api-key': env.JUPITER_API_KEY } : {}
  // `solFeeAccount` is the referral TOKEN account for the OUTPUT mint, derived AND
  // validated on-chain by the wallet before it is sent (src/main/swap-fee-solana.ts).
  //
  // The fee-free retry that used to live here is gone. It caught any error whose
  // message mentioned "fee", "account" or "referral" and re-ran the quote with no
  // platform fee, so the most common Solana case -- a meme token whose referral
  // account has never been created -- silently produced a swap Magic Money earned
  // nothing on. Under this policy a missing fee account makes the route
  // unavailable and the error says which token needs the account.
  //
  // The blanket fee-less RETRY that used to live here is still gone. What
  // replaced it is a deliberate tier-2 path: a mint with no fee account produces
  // an explicitly fee-free quote (`noFee`), chosen by the router only when no
  // fee-paying route exists. The difference from the old behaviour is that this
  // is decided by the router with both options in hand and reported honestly as
  // "no Magic Money fee", rather than being silently substituted inside the
  // adapter on any error whose message happened to mention "fee".
  const feeAccount = noFee ? '' : (q.solFeeAccount || '')
  if (!noFee && !feeAccount) {
    throw new Error(
      'no Magic Money fee account for this output token, so no app fee can be collected on this route')
  }
  return jupiterInner(q, base, headers, feeAccount, env)
}

async function jupiterInner(q, base, headers, feeAccount, env) {
  const bps = feeBps(env)
  const takeFee = !!feeAccount
  const params = new URLSearchParams({
    inputMint: q.sell, outputMint: q.buy, amount: q.amount,
    slippageBps: q.slippageBps || '50',
  })
  if (takeFee) params.set('platformFeeBps', String(bps))
  const quoteRes = await fetch(`${base}/swap/v1/quote?${params}`, { headers })
  const quote = await quoteRes.json()
  if (!quoteRes.ok || !quote.outAmount) throw new Error(quote.error || `Jupiter ${quoteRes.status}`)

  // Measured 2026-09-19: once the quote carries a platformFee, /swap REFUSES to
  // build without a feeAccount (400 NOT_SUPPORTED). It does not, however, check
  // that the account exists or matches the fee mint -- it simply embeds whatever
  // pubkey it is given -- so the wallet validates the account on-chain and then
  // confirms this same pubkey is present in the transaction it is about to sign.
  const swapBody = {
    quoteResponse: quote, userPublicKey: q.taker,
    wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
  }
  if (takeFee) swapBody.feeAccount = feeAccount
  const swapRes = await fetch(`${base}/swap/v1/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(swapBody),
  })
  const swap = await swapRes.json()
  if (!swapRes.ok || !swap.swapTransaction) throw new Error(swap.error || `Jupiter swap ${swapRes.status}`)

  // ---- App fee verification -------------------------------------------------
  // Measured live: quote.platformFee = { amount, feeBps } where amount is exactly
  // floor(grossOut * bps / 10000) and outAmount is already NET of it. The base is
  // therefore the gross output, reconstructed as net + fee.
  const appFee = takeFee
    ? emptyFeeRecord('jupiter', 'solana', bps)
    : feeFreeRecord('jupiter', 'solana', 'no app fee requested: no fee account for this output mint')
  if (takeFee) {
    appFee.base = 'output'
    appFee.tokenAddress = q.buy
    appFee.tokenSymbol = q.buySymbol || null
    appFee.recipient = feeAccount
    appFee.recipientKind = 'referral-token-account'
  }
  const pf = takeFee ? (quote.platformFee || null) : null
  if (pf && pf.amount != null) {
    const amount = String(pf.amount).replace(/[^0-9]/g, '')
    let grossOut = String(quote.outAmount)
    try { grossOut = (BigInt(quote.outAmount) + BigInt(amount || '0')).toString() } catch { /* keep net */ }
    appFee.amountRaw = amount || null
    appFee.appliedBps = Number(pf.feeBps) || effectiveBps(amount, grossOut)
    appFee.evidence.push('quote.platformFee reported by Jupiter')
    if (Number(pf.feeBps) === bps && feeAmountMatches(amount, grossOut, bps)) {
      appFee.appliedBps = bps
      appFee.verification = 'applied-verified'
      appFee.evidence.push(`amount reconciles to ${bps} bps of the gross output`)
      appFee.evidence.push('fee account requested in the /swap build')
    } else {
      appFee.evidence.push('platformFee did not reconcile to the policy rate')
    }
  } else if (takeFee) {
    appFee.evidence.push('Jupiter quote carried no platformFee')
  }

  const sellAmt = Number(q.amount), buyAmt = Number(quote.outAmount)
  return {
    provider: 'jupiter',
    fromChain: 'solana', toChain: 'solana',
    fromTokenAddress: q.sell, toTokenAddress: q.buy,
    fromTokenSymbol: q.sellSymbol || '', toTokenSymbol: q.buySymbol || '',
    sellAmountRaw: q.amount, buyAmountRaw: String(quote.outAmount),
    // Verified live: otherAmountThreshold === outAmount x (1 - slippage) for ExactIn.
    ...minOutFields(quote.otherAmountThreshold, quote.outAmount, q.slippageBps || 50),
    estimatedGasRaw: '5000',
    slippageBps: Number(q.slippageBps || 50),
    priceImpactPct: quote.priceImpactPct != null ? Number(quote.priceImpactPct) : 0,
    rate: sellAmt > 0 ? buyAmt / sellAmt : 0,
    expiresAt: Date.now() + 20_000,
    isCrossChain: false,
    feeBps: appFee.appliedBps ?? 0,
    appFee,
    externalFees: [],
    txData: { swapTransaction: swap.swapTransaction },
    approvalTx: null,
  }
}

// LI.FI — same-chain + cross-chain routing. Keyless (an API key only raises rate
// limits). Integrator fee accrues to LI.FI's FeeCollector under LIFI_INTEGRATOR.
// Docs: https://docs.li.fi — GET https://li.quest/v1/quote
/**
 * Read LI.FI's own accounting of who is being paid what.
 *
 * MEASURED 2026-09-19 (keyless li.quest/v1/quote, 0.1 ETH on Base, fee=0.01):
 *
 *   estimate.feeCosts[0].feeSplit = {
 *     lifiFee:       "250000000000000",   // LI.FI's own 0.25%, charged either way
 *     integratorFee: "1000000000000000",  // exactly 100 bps of the INPUT
 *     recipients: [{name:"lifi", ...}, {name:"ChainLens", fee:"1000000000000000"}]
 *   }
 *
 * Two things make this real evidence rather than an echo: the integrator is
 * NAMED in `recipients`, and requesting a fee as an unregistered integrator is
 * rejected with HTTP 400 ("not configured for collecting fees") instead of
 * silently returning a fee-free route.
 *
 * `included: true` means the quoted output already has both fees removed, so
 * nothing downstream may subtract them again. LI.FI's own cut is reported as an
 * EXTERNAL cost -- it is a cost to the user, never Magic Money revenue.
 */
function lifiFeeRecords(est, chain, sellToken, sellSymbol, sellAmountRaw, integrator, bps) {
  const takeFee = bps > 0
  const appFee = takeFee
    ? emptyFeeRecord('lifi', chain, bps)
    : feeFreeRecord('lifi', chain, 'quoted without an app fee (tier-2 fallback)')
  if (takeFee) {
    appFee.base = 'input'
    appFee.tokenAddress = sellToken
    appFee.tokenSymbol = sellSymbol || null
    appFee.recipient = integrator
    appFee.recipientKind = 'registered-integrator'
  }

  const externalFees = []
  const costs = Array.isArray(est && est.feeCosts) ? est.feeCosts : []
  for (const cost of costs) {
    const split = cost && cost.feeSplit
    const token = (cost && cost.token) || {}
    if (takeFee && split && split.integratorFee != null) {
      const amount = String(split.integratorFee).replace(/[^0-9]/g, '')
      const named = Array.isArray(split.recipients)
        && split.recipients.some(r => r && r.name === integrator)
      appFee.amountRaw = amount || null
      appFee.tokenDecimals = typeof token.decimals === 'number' ? token.decimals : null
      if (token.symbol) appFee.tokenSymbol = token.symbol
      appFee.appliedBps = effectiveBps(amount, sellAmountRaw)
      appFee.evidence.push('estimate.feeCosts[].feeSplit reported by LI.FI')
      if (!named) {
        appFee.evidence.push('integrator was not named in feeSplit.recipients')
      } else if (feeAmountMatches(amount, sellAmountRaw, bps)) {
        appFee.appliedBps = bps
        appFee.verification = 'applied-verified'
        appFee.evidence.push(`integrator named in recipients; amount reconciles to ${bps} bps of the input`)
      } else {
        appFee.evidence.push('integrator fee did not reconcile to the policy rate')
      }
    }
    // LI.FI's own fixed fee is a cost to the USER, not revenue to us.
    const lifiCut = split && split.lifiFee != null ? String(split.lifiFee).replace(/[^0-9]/g, '') : ''
    if (lifiCut && lifiCut !== '0') {
      externalFees.push({
        name: 'LI.FI fee',
        tokenSymbol: token.symbol || null,
        tokenDecimals: typeof token.decimals === 'number' ? token.decimals : null,
        amountRaw: lifiCut,
        includedInQuotedOutput: cost.included !== false,
      })
    }
  }
  if (takeFee && !appFee.amountRaw) appFee.evidence.push('LI.FI response carried no integrator fee split')
  return { appFee, externalFees }
}

async function lifiQuote(q, env, noFee = false) {
  // Falls back to the RPC-verified numeric id for an imported network, which
  // LIFI_CHAIN (keyed by wallet chain-id STRING) has no entry for.
  const fromId = LIFI_CHAIN[q.fromChain] ?? toChainId(q.fromChainId)
  const toId = LIFI_CHAIN[q.toChain] ?? toChainId(q.toChainId)
  if (fromId == null || toId == null) throw new Error('LI.FI: unsupported chain')

  // Token addressing: EVM native → zero address; Solana native → system address.
  const toLifiToken = (chain, addr) =>
    chain === 'solana'
      ? (addr === SOL_NATIVE_MINT ? '11111111111111111111111111111111' : addr)
      : (isNativeEvm(addr) ? NATIVE_ZERO : addr)

  const params = new URLSearchParams({
    fromChain: String(fromId), toChain: String(toId),
    fromToken: toLifiToken(q.fromChain, q.sell),
    toToken: toLifiToken(q.toChain, q.buy),
    fromAmount: q.amount,
    fromAddress: q.taker,
    toAddress: q.toAddress || q.taker,
    slippage: String(Number(q.slippageBps || 50) / 10000),   // 50 bps → 0.005
  })
  // LI.FI REFUSES (HTTP 400) a fee request from an integrator that is not
  // configured for fee collection, so a wrong integrator fails loudly here
  // rather than quietly routing fee-free. The integrator is always sent (it is
  // also our attribution); only the fee is conditional.
  const integrator = policyLifiIntegrator(env)
  const bps = feeBps(env)
  params.set('integrator', integrator)
  if (!noFee) params.set('fee', String(bps / 10000))   // 100 bps -> 0.01
  const headers = { accept: 'application/json' }
  if (env.LIFI_API_KEY) headers['x-lifi-api-key'] = env.LIFI_API_KEY

  const res = await fetch(`https://li.quest/v1/quote?${params}`, { headers })
  const d = await readProviderJson(res, 'LI.FI')
  if (!res.ok) throw new Error((d && (d.message || d.error)) || `LI.FI ${res.status}`)
  const est = d.estimate || {}
  const tr = d.transactionRequest || {}

  // Source-chain payload: EVM = calldata (+ approval); Solana = base64 serialized tx.
  let txData, approvalTx = null
  if (q.fromChain === 'solana') {
    if (!tr.data) throw new Error('LI.FI: no Solana transaction')
    txData = { swapTransaction: tr.data }
  } else {
    if (!tr.to || !tr.data) throw new Error('LI.FI: no EVM calldata')
    txData = { to: tr.to, data: tr.data, value: tr.value || '0' }
    if (!isNativeEvm(q.sell) && est.approvalAddress) {
      approvalTx = { to: q.sell, data: erc20ApproveData(est.approvalAddress), value: '0x0' }
    }
  }
  const { appFee, externalFees } = lifiFeeRecords(
    est, q.fromChain, q.sell, q.sellSymbol, q.amount, integrator, noFee ? 0 : bps)

  const sellAmt = Number(q.amount), buyAmt = Number(est.toAmount || 0)
  // LI.FI prices the output AND the gas it estimates, both in USD, which is
  // exactly what the routing policy needs to compare this against a route whose
  // gas is paid differently. Gas here is paid in the NATIVE asset, separately
  // from the output token, so it is a genuine cost on top -- not already netted
  // out of `toAmount` the way Relay's guaranteed output is.
  const outUsd = est.toAmountUSD != null ? Number(est.toAmountUSD) : null
  const gasCostUsd = Array.isArray(est.gasCosts)
    ? est.gasCosts.reduce((sum, g) => sum + (Number(g && g.amountUSD) || 0), 0)
    : null
  return {
    provider: 'lifi',
    fromChain: q.fromChain, toChain: q.toChain,
    fromTokenAddress: q.sell, toTokenAddress: q.buy,
    fromTokenSymbol: q.sellSymbol || '', toTokenSymbol: q.buySymbol || '',
    valuation: {
      outputUsd: Number.isFinite(outUsd) ? outUsd : null,
      sourceCostUsd: Array.isArray(est.gasCosts) && est.gasCosts.length ? gasCostUsd : null,
    },
    sellAmountRaw: q.amount, buyAmountRaw: String(est.toAmount || '0'),
    // Verified live: toAmountMin === toAmount x (1 - slippage).
    ...minOutFields(est.toAmountMin, est.toAmount, q.slippageBps || 50),
    estimatedGasRaw: String(tr.gasLimit || '0'),
    slippageBps: Number(q.slippageBps || 50),
    priceImpactPct: 0,
    rate: sellAmt > 0 ? buyAmt / sellAmt : 0,
    expiresAt: Date.now() + 30_000,
    isCrossChain: q.fromChain !== q.toChain,
    toAddress: q.toAddress || q.taker,
    bridgeTool: d.tool || (d.toolDetails && d.toolDetails.key) || null,
    // Route shape, passed through for the CLIENT to interpret. The Worker does not
    // decide what the minimum guarantees -- src/shared/swap-destination.ts does,
    // and it re-sanitizes this list rather than trusting it.
    routeSteps: compactLifiSteps(d.includedSteps),
    estimatedDurationSec: Number(est.executionDuration || 0),
    feeBps: appFee.appliedBps ?? 0,
    appFee,
    externalFees,
    requestId: null,
    txData,
    approvalTx,
  }
}

// Rango — cross-chain fallback (Basic API). EVM source only (Solana routes via
// LI.FI). Blockchain identifiers + amount units should be validated against
// GET https://api.rango.exchange/basic/meta during testing.
async function rangoQuote(q, env, noFee = false) {
  if (!env.RANGO_API_KEY) throw new Error('Rango key not configured')
  if (q.fromChain === 'solana') throw new Error('Rango: Solana source unsupported here')
  const fromBc = RANGO_CHAIN[q.fromChain], toBc = RANGO_CHAIN[q.toChain]
  if (!fromBc || !toBc) throw new Error('Rango: unsupported chain')

  const asset = (bc, chain, symbol, addr) => {
    const sym = (symbol || '').toUpperCase()
    const native = chain === 'solana' ? addr === SOL_NATIVE_MINT : isNativeEvm(addr)
    return native ? `${bc}.${sym}` : `${bc}.${sym}--${addr}`
  }
  // Rango's Basic response states no applied referrer fee to reconcile, so a fee
  // requested here could never be attributed. It is therefore quoted fee-free
  // and serves as a fully-eligible tier-2 route rather than being excluded.
  const bps = feeBps(env)
  const sp = new URLSearchParams({
    from: asset(fromBc, q.fromChain, q.sellSymbol, q.sell),
    to: asset(toBc, q.toChain, q.buySymbol, q.buy),
    amount: q.amount,
    fromAddress: q.taker,
    toAddress: q.toAddress || q.taker,
    slippage: String(Number(q.slippageBps || 50) / 100),   // percent
    apiKey: env.RANGO_API_KEY,
  })


  const res = await fetch(`https://api.rango.exchange/basic/swap?${sp}`, { headers: { accept: 'application/json' } })
  const d = await readProviderJson(res, 'Rango')
  if (!res.ok) throw new Error((d && (d.error || d.errorMessage)) || `Rango ${res.status}`)
  if (d.error || d.resultType === 'NO_ROUTE' || !d.tx) throw new Error(d.error || 'Rango: no route')
  const tx = d.tx
  if (tx.type !== 'EVM' || !tx.txTo) throw new Error('Rango: unsupported tx type')

  let approvalTx = null
  if (!isNativeEvm(q.sell)) {
    if (tx.approveData) approvalTx = { to: q.sell, data: tx.approveData, value: '0x0' }
    else if (tx.approveTo) approvalTx = { to: q.sell, data: erc20ApproveData(tx.approveTo), value: '0x0' }
  }

  const out = (d.route && (d.route.outputAmount || d.route.outputAmountMin)) || '0'
  const sellAmt = Number(q.amount), buyAmt = Number(out)
  return {
    provider: 'rango',
    fromChain: q.fromChain, toChain: q.toChain,
    fromTokenAddress: q.sell, toTokenAddress: q.buy,
    fromTokenSymbol: q.sellSymbol || '', toTokenSymbol: q.buySymbol || '',
    sellAmountRaw: q.amount, buyAmountRaw: String(out),
    ...minOutFields(d.route && d.route.outputAmountMin, out, q.slippageBps || 50),
    estimatedGasRaw: String(tx.gasLimit || '0'),
    slippageBps: Number(q.slippageBps || 50),
    priceImpactPct: 0,
    rate: sellAmt > 0 ? buyAmt / sellAmt : 0,
    expiresAt: Date.now() + 30_000,
    isCrossChain: q.fromChain !== q.toChain,
    toAddress: q.toAddress || q.taker,
    bridgeTool: (d.route && d.route.swapper && d.route.swapper.id) || null,
    estimatedDurationSec: Number((d.route && d.route.estimatedTimeInSeconds) || 0),
    feeBps: 0,
    appFee: feeFreeRecord('rango', q.fromChain,
      'no app fee requested: Rango Basic reports no applied referrer fee to reconcile'),
    externalFees: [],
    requestId: d.requestId || null,
    txData: { to: tx.txTo, data: tx.txData, value: tx.value || '0' },
    approvalTx,
  }
}

// SwapKit / THORChain — native cross-chain (e.g. ETH/SOL → native BTC). EVM/Solana
// source only (UTXO/ADA/DOT sources are deposit-address, not signed locally).
// POST /v3/quote → pick best route → POST /v3/swap → signable tx. Asset format
// CHAIN.TICKER[-0xcontract]; amounts are human decimals. Affiliate fee in bps.
async function swapkitQuote(q, env, noFee = false) {
  if (!env.SWAPKIT_API_KEY) throw new Error('SwapKit key not configured')
  const fromC = SWAPKIT_CHAIN[q.fromChain], toC = SWAPKIT_CHAIN[q.toChain]
  if (!fromC || !toC) throw new Error('SwapKit: unsupported chain')
  if (q.fromChain !== 'solana' && !(q.fromChain in EVM_CHAIN_IDS)) {
    throw new Error('SwapKit: source not locally signable')
  }
  const fromDec = Number(q.fromDecimals) || (q.fromChain === 'solana' ? 9 : 18)
  const toDec = Number(q.toDecimals) || 8
  // SwapKit's affiliate beneficiaries live in their partner dashboard, which this
  // code cannot read, so a returned affiliate fee could not be attributed to us.
  // Quoted fee-free; fully eligible as a tier-2 route.
  const skBps = feeBps(env)

  const asset = (chain, code, symbol, addr) => {
    const sym = (symbol || '').toUpperCase()
    const native = chain === 'solana' ? addr === SOL_NATIVE_MINT : isNativeEvm(addr)
    return native ? `${code}.${sym}` : `${code}.${sym}-${addr}`
  }
  const headers = { 'x-api-key': env.SWAPKIT_API_KEY, 'content-type': 'application/json', accept: 'application/json' }
  const quoteRes = await fetch('https://api.swapkit.dev/v3/quote', {
    method: 'POST', headers,
    body: JSON.stringify({
      sellAsset: asset(q.fromChain, fromC, q.sellSymbol, q.sell),
      buyAsset: asset(q.toChain, toC, q.buySymbol, q.buy),
      sellAmount: rawToDecimalStr(q.amount, fromDec),
      sourceAddress: q.taker,
      destinationAddress: q.toAddress || q.taker,
      slippage: Number(q.slippageBps || 50) / 100,
    }),
  })
  const qd = await quoteRes.json()
  if (!quoteRes.ok) throw new Error((qd && (qd.message || qd.error)) || `SwapKit ${quoteRes.status}`)
  const routes = Array.isArray(qd.routes) ? qd.routes : []
  if (!routes.length) throw new Error('SwapKit: no route')
  const route = routes.find(r => r.meta && Array.isArray(r.meta.tags) && r.meta.tags.includes('RECOMMENDED')) || routes[0]
  if (!route.routeId) throw new Error('SwapKit: route missing id')

  const swapRes = await fetch('https://api.swapkit.dev/v3/swap', {
    method: 'POST', headers, body: JSON.stringify({ routeId: route.routeId }),
  })
  const sd = await swapRes.json()
  if (!swapRes.ok) throw new Error((sd && (sd.message || sd.error)) || `SwapKit swap ${swapRes.status}`)
  const tx = sd.tx || sd.transaction || sd.evmTransactionDetails || {}

  let txData, approvalTx = null
  if (q.fromChain === 'solana') {
    const serialized = tx.serializedTx || tx.data || sd.swapTransaction
    if (!serialized) throw new Error('SwapKit: no Solana transaction')
    txData = { swapTransaction: serialized }
  } else {
    const to = tx.to || tx.txTo, data = tx.data || tx.txData
    if (!to || !data) throw new Error('SwapKit: no EVM calldata')
    txData = { to, data, value: tx.value || '0' }
    const spender = tx.approvalTarget || route.approvalTarget || sd.approvalTarget
    if (!isNativeEvm(q.sell) && spender) {
      approvalTx = { to: q.sell, data: erc20ApproveData(spender), value: '0x0' }
    }
  }
  const outRaw = decimalStrToRaw(route.expectedBuyAmount || '0', toDec)
  const sellAmt = Number(q.amount), buyAmt = Number(outRaw)
  return {
    provider: 'swapkit',
    fromChain: q.fromChain, toChain: q.toChain,
    fromTokenAddress: q.sell, toTokenAddress: q.buy,
    fromTokenSymbol: q.sellSymbol || '', toTokenSymbol: q.buySymbol || '',
    sellAmountRaw: q.amount, buyAmountRaw: outRaw,
    ...minOutFields(
      route.expectedBuyAmountMaxSlippage ? decimalStrToRaw(route.expectedBuyAmountMaxSlippage, toDec) : '',
      outRaw, q.slippageBps || 50),
    estimatedGasRaw: '0',
    slippageBps: Number(q.slippageBps || 50),
    priceImpactPct: 0,
    rate: sellAmt > 0 ? buyAmt / sellAmt : 0,
    expiresAt: Date.now() + 30_000,
    isCrossChain: q.fromChain !== q.toChain,
    toAddress: q.toAddress || q.taker,
    bridgeTool: Array.isArray(route.providers) ? route.providers.join('/') : 'THORChain',
    estimatedDurationSec: Number((route.estimatedTime && route.estimatedTime.total) || 0),
    feeBps: 0,
    appFee: feeFreeRecord('swapkit', q.fromChain,
      'no app fee requested: SwapKit affiliate beneficiaries are not readable from here'),
    externalFees: [],
    requestId: route.routeId,
    txData,
    approvalTx,
  }
}

// ── Cross-chain status ────────────────────────────────────────────────────────

async function handleStatus(url, env) {
  const p = url.searchParams
  // Relay identifies a request by requestId, not by the source transaction hash.
  if (!p.get('txHash') && !(p.get('provider') === 'relay' && p.get('requestId'))) {
    return err(env, 'Missing txHash')
  }
  const provider = p.get('provider')
  try {
    const r = provider === 'relay' ? await relayStatus(p, env)
      : provider === 'rango' ? await rangoStatus(p, env)
      : provider === 'swapkit' ? await swapkitStatus(p, env)
      : await lifiStatus(p, env)
    return json(env, r)
  } catch (e) {
    // Transient/unknown — tell the client to keep polling rather than error out.
    return json(env, { status: 'pending', error: e && e.message ? e.message : 'status error' })
  }
}

// SwapKit routes are THORChain-settled — track the inbound tx on THORNode.
async function swapkitStatus(p, env) {
  const hash = (p.get('txHash') || '').replace(/^0x/, '')
  const res = await fetch(`https://thornode.ninerealms.com/thorchain/tx/status/${hash}`, { headers: { accept: 'application/json' } })
  const d = await res.json().catch(() => null)
  if (!res.ok || !d) return { status: 'pending', error: null }
  const stages = d.stages || {}
  const done = stages.outbound_signed ? stages.outbound_signed.completed : (stages.swap_finalised && stages.swap_finalised.completed)
  const out = d.out_txs && d.out_txs[0]
  return {
    status: done ? 'done' : 'pending',
    substatus: stages.swap_status && stages.swap_status.pending ? 'swapping' : null,
    receivedAmountRaw: (out && Array.isArray(out.coins) && out.coins[0] && out.coins[0].amount) ? String(out.coins[0].amount) : null,
    destTxHash: (out && out.id) || null,
    destExplorerUrl: null,
    error: null,
  }
}

/**
 * LI.FI status, passed through rather than interpreted.
 *
 * This used to collapse `DONE` to `done` and discard the substatus, so
 * DONE/PARTIAL and DONE/REFUNDED both reported success. The meaning of these
 * fields now lives in src/shared/swap-lifecycle.ts, where it is unit-testable;
 * the Worker's job is to inject the key and hand back what the provider said —
 * including WHICH asset actually arrived, which is the part a refund changes.
 *
 * `status`/`substatus` remain in the legacy shape for older clients.
 */
async function lifiStatus(p, env) {
  const params = new URLSearchParams({ txHash: p.get('txHash') })
  if (p.get('bridge')) params.set('bridge', p.get('bridge'))
  const fromId = LIFI_CHAIN[(p.get('fromChain') || '').toLowerCase()]
  const toId = LIFI_CHAIN[(p.get('toChain') || '').toLowerCase()]
  if (fromId != null) params.set('fromChain', String(fromId))
  if (toId != null) params.set('toChain', String(toId))
  const headers = { accept: 'application/json' }
  if (env.LIFI_API_KEY) headers['x-lifi-api-key'] = env.LIFI_API_KEY
  const res = await fetch(`https://li.quest/v1/status?${params}`, { headers })
  const d = await res.json().catch(() => null)

  // A hash LI.FI has not indexed yet 404s (code 1003). That is UNKNOWN, not
  // failure — a fresh source transaction routinely 404s for a while.
  if (res.status === 404 || (d && d.code === 1003)) {
    return { status: 'unknown', notFound: true, provider: 'lifi', error: null }
  }
  if (!res.ok || !d) return { status: 'pending', provider: 'lifi', error: null }

  const s = (d && d.status) || ''
  const recv = (d && d.receiving) || {}
  const tok = recv.token || {}
  return {
    // Legacy field, kept so an older client still behaves as it did.
    status: s === 'DONE' ? 'done' : s === 'FAILED' ? 'failed' : 'pending',
    substatus: (d && d.substatus) || null,
    // Raw provider vocabulary — the client maps these.
    provider: 'lifi',
    providerStatus: s || null,
    providerSubstatus: (d && d.substatus) || null,
    receivedAmountRaw: recv.amount ? String(recv.amount) : null,
    receivedTokenAddress: tok.address || null,
    receivedTokenSymbol: tok.symbol || null,
    receivedTokenDecimals: typeof tok.decimals === 'number' ? tok.decimals : null,
    receivedTokenChain: recv.chainId != null ? String(recv.chainId) : null,
    destTxHash: recv.txHash || null,
    destExplorerUrl: recv.txLink || null,
    error: null,
  }
}

async function rangoStatus(p, env) {
  const requestId = p.get('requestId')
  if (!requestId) throw new Error('Rango: missing requestId')
  const params = new URLSearchParams({ requestId, txId: p.get('txHash'), apiKey: env.RANGO_API_KEY || '' })
  const res = await fetch(`https://api.rango.exchange/basic/status?${params}`, { headers: { accept: 'application/json' } })
  const d = await readProviderJson(res, 'Rango status')
  const s = (d && d.status) || ''
  const out = (d && d.output) || {}
  const link = d && Array.isArray(d.explorerUrl) && d.explorerUrl[0]
  return {
    status: s === 'success' ? 'done' : s === 'failed' ? 'failed' : 'pending',
    substatus: out.type || null,
    provider: 'rango',
    providerStatus: s || null,
    // Rango's output.type distinguishes REVERTED_TO_INPUT (a refund) from a
    // normal delivery, which the client needs to tell those apart.
    providerSubstatus: out.type || null,
    receivedAmountRaw: out.amount ? String(out.amount) : null,
    receivedTokenAddress: (out.asset && out.asset.address) || null,
    receivedTokenSymbol: (out.asset && out.asset.symbol) || null,
    receivedTokenChain: (out.asset && out.asset.blockchain) || null,
    destTxHash: (d && d.bridgeData && d.bridgeData.destTxHash) || null,
    destExplorerUrl: (link && link.url) || null,
    error: null,
  }
}

// MuesliSwap (Cardano). Returns unsigned CBOR for the wallet to sign+submit.
async function muesliQuote(_q, _env) {
  // Endpoint shape varies; left as an explicit stub until Cardano signing is wired.
  throw new Error('Cardano DEX routing not yet enabled')
}

// ─── Token lists ────────────────────────────────────────────────────────────
// Discovery lives in tokens.js (Jupiter / Relay / LI.FI + KV cache). It used to
// be a stub here that returned an empty list unconditionally, which is why the
// picker never had more than its bundled entries.

// ─── helpers ──────────────────────────────────────────────────────────────────

// ERC-20 approve(spender, 2^256-1) calldata — 0x095ea7b3 + spender + max uint256.
function erc20ApproveData(spender) {
  const addr = spender.toLowerCase().replace(/^0x/, '').padStart(64, '0')
  const max = 'f'.repeat(64)
  return `0x095ea7b3${addr}${max}`
}
