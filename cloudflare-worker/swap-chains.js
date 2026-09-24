/**
 * swap-chains.js — which chain ids EACH provider routes, with the evidence for it.
 *
 * WHY THIS EXISTS
 *
 * Swap capability used to come only from a static matrix keyed to the wallet's
 * BUILT-IN networks, and then from LI.FI + Relay alone. Imported networks can
 * never share a built-in's chain id (`chain-config.ts` refuses to let an import
 * shadow one), and a chain routed only by 0x, 1inch, Uniswap, Rango or SwapKit
 * could never qualify at all. That made two providers the permanent eligibility
 * boundary for a wallet that integrates eight.
 *
 * This route answers "which providers route chain N, and how do we know?" for
 * every provider, so an imported network is judged on the same evidence a
 * built-in is.
 *
 * WHAT A LISTING IS, AND IS NOT
 *
 * A chain id appearing here makes the chain a CANDIDATE for that provider. It
 * does not make any pair on it routable, and it does not make a route safe. The
 * only thing that decides whether a user's swap can proceed is an actual quote
 * for the selected pair that passes the wallet's execution checks.
 *
 * Every provider entry carries where its list came from:
 *   source 'live'        fetched from the provider's own chain-list endpoint
 *   source 'documented'  the provider's published list, transcribed with the URL
 *                        and date it was read, used when no endpoint exists or
 *                        this Worker has no key for it
 * plus `fetchedAt` / `expiresAt` so a stale claim is visible as one.
 *
 * WHAT IT DOES NOT DO
 *
 * It takes no RPC URL and no user input: the wallet confirms an imported
 * chain's identity by calling that chain's RPC itself. Nothing here authorizes a
 * router, token list or contract address on the user's behalf.
 */

import { json, cacheGet, cachePut, rateLimit } from './lib.js'

const CACHE_KEY = 'swap:provider-chains:v2'
/** Live lists: long enough to be cheap, short enough to notice a change. */
export const LIVE_TTL_SECONDS = 6 * 60 * 60
/** Documented lists: re-read the provider's docs at least this often. */
export const DOCUMENTED_TTL_DAYS = 90

/**
 * Published lists, read 2026-09-21 from the raw page at each URL (not from a
 * summary). EVM chain ids only; non-EVM coverage is in `nonEvm`.
 *
 * Used when a provider has no chain-list endpoint (1inch, Uniswap), or has one
 * that needs a key this Worker does not hold (0x, Rango, SwapKit).
 */
export const DOCUMENTED_CHAINS = {
  '0x': {
    documentedAt: '2026-09-21',
    url: 'https://docs.0x.org/docs/introduction/supported-chains',
    chains: [1, 10, 56, 130, 137, 143, 146, 480, 999, 2741, 4217, 4663, 5000, 5042, 8453, 9745,
      42161, 43114, 57073, 59144, 80094, 534352],
    nonEvm: [],
  },
  '1inch': {
    documentedAt: '2026-09-21',
    url: 'https://business.1inch.com/portal/documentation/apis/swap/classic-swap/introduction',
    // The page also lists Solana (its id 501); the adapter here is EVM-only.
    chains: [1, 10, 25, 56, 100, 130, 137, 143, 146, 324, 999, 4663, 5042, 8453, 42161, 43114, 59144],
    nonEvm: [],
  },
  uniswap: {
    documentedAt: '2026-09-21',
    url: 'https://developers.uniswap.org/docs/trading/swapping-api/supported-chains',
    chains: [1, 10, 56, 130, 137, 143, 196, 324, 480, 1868, 4217, 4326, 4663, 5042, 8453, 42161,
      42220, 43114, 57073, 59144, 7777777],
    nonEvm: [],
  },
  swapkit: {
    documentedAt: '2026-09-21',
    url: 'https://docs.swapkit.dev/swapkit-api/providers-providers-status-and-identifiers-mapping',
    chains: [1, 10, 56, 100, 137, 143, 196, 999, 4663, 5042, 8453, 36900, 42161, 43114, 80094],
    nonEvm: ['solana', 'bitcoin', 'cardano'],
  },
  rango: {
    // Rango routes by its own blockchain NAME, not by chain id, so a documented
    // id is only usable where the adapter also knows the name. These are exactly
    // the chains in the adapter's static name map; any other chain needs the live
    // `meta` call (key required), which supplies chainId -> name.
    documentedAt: '2026-09-21',
    url: 'https://docs.rango.exchange/api-integration/basic-api-single-step/api-reference/get-blockchains-and-tokens',
    chains: [1, 10, 56, 137, 143, 8453, 42161, 43114],
    nonEvm: ['solana', 'bitcoin', 'cardano', 'polkadot'],
  },
  jupiter: {
    documentedAt: '2026-09-21',
    url: 'https://dev.jup.ag/docs',
    chains: [],
    nonEvm: ['solana'],
  },
}

/** Rango blockchain names the adapter knows without the live meta call. */
export const RANGO_STATIC_NAMES = {
  1: 'ETH', 10: 'OPTIMISM', 56: 'BSC', 137: 'POLYGON', 143: 'MONAD', 8453: 'BASE',
  42161: 'ARBITRUM', 43114: 'AVAX_CCHAIN',
}

async function fetchJson(url, headers = {}, ms = 8000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: ctrl.signal })
    if (!res.ok) return { body: null, error: `HTTP ${res.status}` }
    return { body: await res.json(), error: null }
  } catch (e) {
    return { body: null, error: e && e.name === 'AbortError' ? 'timeout' : 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

/** A positive integer chain id from a number, decimal string or 0x-hex string. */
export function toChainId(v) {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 ? v : null
  if (typeof v !== 'string' || !v) return null
  const n = /^0x[0-9a-f]+$/i.test(v) ? Number.parseInt(v, 16) : /^[0-9]+$/.test(v) ? Number(v) : NaN
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

const uniq = (ids) => [...new Set(ids.filter(Boolean))].sort((a, b) => a - b)

/**
 * How each provider's list is obtained. `live` returns { chains, nonEvm?,
 * identifiers? } or null; a null (or no key) falls back to the documented list.
 */
const LIVE_SOURCES = {
  lifi: {
    url: 'https://li.quest/v1/chains?chainTypes=EVM,SVM',
    async live() {
      const { body, error } = await fetchJson(this.url)
      if (!body) return { error }
      const chains = uniq((body.chains || []).filter(c => c.chainType === 'EVM' || !c.chainType)
        .map(c => toChainId(c.id)))
      const nonEvm = (body.chains || []).some(c => c.chainType === 'SVM') ? ['solana'] : []
      return chains.length ? { chains, nonEvm } : { error: 'empty list' }
    },
  },
  relay: {
    url: 'https://api.relay.link/chains',
    async live() {
      const { body, error } = await fetchJson(this.url)
      if (!body) return { error }
      const enabled = (body.chains || []).filter(c => !c.disabled)
      // Relay lists non-EVM chains under their own ids (Solana is 792703809);
      // only EVM ids are chain ids in the sense the wallet matches on.
      const chains = uniq(enabled.filter(c => (c.vmType || 'evm') === 'evm').map(c => toChainId(c.id)))
      const nonEvm = enabled.some(c => c.vmType === 'svm') ? ['solana'] : []
      return chains.length ? { chains, nonEvm } : { error: 'empty list' }
    },
  },
  '0x': {
    url: 'https://api.0x.org/swap/chains',
    key: 'ZEROX_API_KEY',
    async live(env) {
      const { body, error } = await fetchJson(this.url, { '0x-api-key': env.ZEROX_API_KEY, '0x-version': 'v2' })
      if (!body) return { error }
      const chains = uniq((body.chains || []).map(c => toChainId(c.chainId)))
      return chains.length ? { chains } : { error: 'empty list' }
    },
  },
  rango: {
    url: 'https://api.rango.exchange/basic/meta',
    key: 'RANGO_API_KEY',
    async live(env) {
      const { body, error } = await fetchJson(`${this.url}?apiKey=${encodeURIComponent(env.RANGO_API_KEY)}`, {}, 10000)
      if (!body) return { error }
      const identifiers = {}
      const nonEvm = []
      for (const b of body.blockchains || []) {
        if (!b || b.enabled === false) continue
        if (b.type === 'EVM') {
          const id = toChainId(b.chainId)
          if (id && typeof b.name === 'string') identifiers[id] = b.name
        } else if (b.name === 'SOLANA') nonEvm.push('solana')
      }
      const chains = uniq(Object.keys(identifiers).map(Number))
      return chains.length ? { chains, nonEvm, identifiers } : { error: 'empty list' }
    },
  },
  swapkit: {
    url: 'https://api.swapkit.dev/providers',
    key: 'SWAPKIT_API_KEY',
    async live(env) {
      const { body, error } = await fetchJson(this.url, { 'x-api-key': env.SWAPKIT_API_KEY })
      if (!Array.isArray(body)) return { error: error || 'unexpected shape' }
      // `enabledChainIds` is evaluated against OUR key, which is what a quote
      // would actually be allowed to use.
      const chains = uniq(body.flatMap(p => (p.enabledChainIds || []).map(toChainId)))
      return chains.length ? { chains } : { error: 'empty list' }
    },
  },
}

/**
 * Resolve one provider's entry. Live when possible; documented otherwise, with
 * the reason the live list was not used.
 */
async function resolveProvider(name, env, now) {
  const src = LIVE_SOURCES[name]
  const doc = DOCUMENTED_CHAINS[name]
  let liveError = null
  if (src && (!src.key || env[src.key])) {
    const r = await src.live(env)
    if (r && r.chains) {
      return {
        chains: r.chains, nonEvm: r.nonEvm || (doc ? doc.nonEvm : []),
        identifiers: r.identifiers || null,
        source: 'live', evidence: 'discovered', url: src.url,
        fetchedAt: now, expiresAt: now + LIVE_TTL_SECONDS * 1000, error: null,
      }
    }
    liveError = (r && r.error) || 'no answer'
  } else if (src && src.key) {
    liveError = `${src.key} not configured`
  }
  if (doc) {
    const docAt = Date.parse(`${doc.documentedAt}T00:00:00Z`)
    return {
      chains: doc.chains, nonEvm: doc.nonEvm, identifiers: null,
      source: 'documented', evidence: 'documented', url: doc.url,
      documentedAt: doc.documentedAt,
      fetchedAt: docAt, expiresAt: docAt + DOCUMENTED_TTL_DAYS * 86400_000,
      error: liveError,
    }
  }
  return {
    chains: [], nonEvm: [], identifiers: null, source: 'unavailable', evidence: 'none',
    url: src ? src.url : null, fetchedAt: 0, expiresAt: 0, error: liveError || 'no source',
  }
}

export const CHAIN_PROVIDERS = ['lifi', 'relay', '0x', '1inch', 'uniswap', 'rango', 'swapkit', 'jupiter']

/**
 * Build (or read from cache) the per-provider index. Exported so /quote can ask
 * "does provider P list chain N" without an extra round trip.
 *
 * A live provider that fails keeps its previous live list if one is cached,
 * rather than dropping to documented, because a transient outage should not
 * shrink coverage. The entry says so.
 */
export async function providerChainIndex(env, ctx, { force = false } = {}) {
  const now = Date.now()
  const cached = await cacheGet(env, CACHE_KEY)
  if (!force && cached && cached.builtAt && now - cached.builtAt < LIVE_TTL_SECONDS * 1000) return cached

  const entries = await Promise.all(CHAIN_PROVIDERS.map(p => resolveProvider(p, env, now)))
  const providers = {}
  CHAIN_PROVIDERS.forEach((p, i) => {
    const fresh = entries[i]
    const prev = cached && cached.providers && cached.providers[p]
    providers[p] = fresh.source !== 'live' && prev && prev.source === 'live'
      ? { ...prev, stale: true, error: fresh.error }
      : { ...fresh, stale: false }
  })
  const value = { version: 2, builtAt: now, providers }
  cachePut(env, ctx, CACHE_KEY, value, LIVE_TTL_SECONDS)
  return value
}

/** True / false when the provider has a list; null when it has none to consult. */
export function providerListsChain(index, provider, chainId) {
  const p = index && index.providers && index.providers[provider]
  if (!p || p.source === 'unavailable') return null
  return p.chains.includes(Number(chainId))
}

/**
 * GET /swap/chains
 *   -> { version: 2, builtAt, providers: { <name>: {chains, nonEvm, source,
 *        evidence, url, fetchedAt, expiresAt, stale, error} },
 *        lifi, relay, fetchedAt, stale }            <- legacy v1 fields
 *
 * `identifiers` (Rango's id -> name map) is internal to quoting and not served.
 */
export async function handleSwapChains(request, url, env, ctx) {
  if (!(await rateLimit(request, env, ctx, { limit: 60, windowSec: 60, bucket: 'swapchains' }))) {
    return json(env, { error: 'Too many requests.' }, 429)
  }
  const index = await providerChainIndex(env, ctx)
  const providers = {}
  for (const [name, p] of Object.entries(index.providers)) {
    const { identifiers: _omit, ...pub } = p
    providers[name] = pub
  }
  const liveOk = (n) => providers[n] && providers[n].source === 'live'
  return json(env, {
    version: 2,
    builtAt: index.builtAt,
    providers,
    // v1 shape, for clients older than the aggregated resolver.
    lifi: providers.lifi ? providers.lifi.chains : [],
    relay: providers.relay ? providers.relay.chains : [],
    fetchedAt: index.builtAt,
    stale: !liveOk('lifi') && !liveOk('relay'),
  })
}
