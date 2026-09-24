/**
 * tokens.js — DEX token discovery for the MagicMoney Worker.
 *
 * Replaces the `/tokens` stub that returned an empty list, which is why the
 * picker could only ever offer the ~30 hand-written tokens bundled in the client
 * (two on Base, three on Solana). Three modes, all on the same route so the
 * existing client contract `{ tokens, chain, error }` still holds:
 *
 *   /tokens?chain=base                      suggestions (opening list)
 *   /tokens?chain=base&q=degen              search by name or symbol
 *   /tokens?chain=base&address=0x4ed4…      resolve one exact contract/mint
 *
 * Sources, chosen because each covers what the others miss:
 *   Solana  Jupiter tokens/v2  — search by name/symbol/mint, batch mint lookup,
 *                                liquidity + tokenProgram (Token-2022 matters).
 *   EVM     Relay currencies/v2 — chain-scoped search, exact-address resolution,
 *                                and `useExternalSearch` to reach past its index.
 *   EVM     LI.FI /v1/tokens    — bulk catalogue, requested with minPriceUSD=0
 *                                because the DEFAULT (0.0001) hides long-tail
 *                                tokens: Base returns 1074 by default and 1694
 *                                at 0, so a third of the chain is invisible to a
 *                                caller that takes the default. Unit price is not
 *                                liquidity and is not safety — it is not a filter
 *                                worth losing 620 tokens to.
 *
 * ⚠ Normalization here is a hand-kept port of `src/shared/swap-token-identity.ts`
 * (same arrangement as `asset-filter-key.js` in the chainlens repo). The Worker
 * has no TypeScript build step, so the rules are duplicated, not imported — if
 * you change an address or decimals rule there, change it here too. The client
 * re-validates everything this route returns, so a drift is a display bug rather
 * than a wrong-token trade, but it is still a bug.
 *
 * Discovery is NOT a tradability claim: a token found here may still have no
 * executable route at the requested size. Only a quote settles that.
 */

import { json, cacheGet, cachePut, rateLimit } from './lib.js'

const NATIVE_EVM = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const NATIVE_ZERO = '0x0000000000000000000000000000000000000000'
const SOL_NATIVE_MINT = 'So11111111111111111111111111111111111111112'
const SOL_SYSTEM_PROGRAM = '11111111111111111111111111111111'

// Mirrors EVM_CHAIN_IDS in swap-proxy.js and EVM_SWAP_CHAINS in
// src/shared/swap-token-identity.ts (swap-chain-set-parity.test.ts). It listed
// only the original 8 until 2026-09-22, so /tokens returned an empty list for
// Robinhood, Arc and every other network added since.
export const EVM_CHAIN_IDS = {
  ethereum: 1, arbitrum: 42161, optimism: 10, base: 8453,
  polygon: 137, avalanche: 43114, bsc: 56, monad: 143,
  blast: 81457, gnosis: 100, abstract: 2741, apechain: 33139,
  robinhood: 4663, arc: 5042, ronin: 2020, soneium: 1868,
  worldchain: 480, zora: 7777777, hyperevm: 999,
}

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/

// Cache TTLs (seconds). KV enforces a 60s floor, so nothing below that is real.
const TTL_SEARCH = 60        // a query's result set
const TTL_RESOLVE = 3600     // one token's metadata — decimals/symbol don't churn
const TTL_NEGATIVE = 60      // "no such token", so a typo isn't re-fetched in a loop
const TTL_CATALOGUE = 3600   // LI.FI bulk list
const MAX_LIMIT = 50

const isEvmChain = (c) => Object.prototype.hasOwnProperty.call(EVM_CHAIN_IDS, c)
const isSolanaChain = (c) => c === 'solana'

function isNativeAddress(chain, address) {
  const raw = (address || '').trim()
  if (!raw) return false
  if (isEvmChain(chain)) {
    const lower = raw.toLowerCase()
    return lower === NATIVE_EVM || lower === NATIVE_ZERO
  }
  if (isSolanaChain(chain)) return raw === SOL_NATIVE_MINT || raw === SOL_SYSTEM_PROGRAM
  return false
}

/** EVM lowercases (checksum is advisory); Solana is case-SENSITIVE and is left alone. */
function normalizeAddress(chain, address) {
  const raw = (address || '').trim()
  if (!raw) return ''
  if (isEvmChain(chain)) return isNativeAddress(chain, raw) ? NATIVE_EVM : raw.toLowerCase()
  if (isSolanaChain(chain)) return isNativeAddress(chain, raw) ? SOL_NATIVE_MINT : raw
  return raw
}

function base58ByteLength(value) {
  if (!value || !BASE58_RE.test(value)) return -1
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const bytes = []
  for (const char of value) {
    let carry = ALPHABET.indexOf(char)
    if (carry < 0) return -1
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58
      bytes[i] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  let leadingZeros = 0
  for (const char of value) {
    if (char !== '1') break
    leadingZeros++
  }
  return bytes.length + leadingZeros
}

function isValidAddress(chain, address) {
  const raw = (address || '').trim()
  if (!raw) return false
  if (isEvmChain(chain)) return EVM_ADDRESS_RE.test(raw)
  if (isSolanaChain(chain)) return base58ByteLength(raw) === 32
  return false
}

function cleanText(value, fallback = '') {
  if (typeof value !== 'string') return fallback
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()
  return stripped.slice(0, 64) || fallback
}

/** https: only — token logos are attacker-controlled (anyone can mint a token). */
function cleanLogo(value) {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (raw.length > 512) return null
  return /^https:\/\//i.test(raw) ? raw : null
}

function finite(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Build one output record. Returns null when the token cannot be trusted —
 * notably when decimals are absent or not a plain integer. Defaulting decimals to
 * 18 would misstate a 6-decimal token's amount by a factor of a trillion, so a
 * token we cannot describe exactly is a token we do not offer.
 */
function makeToken(chain, { address, symbol, name, decimals, logo, verified, source, priceUsd, liquidityUsd, tokenProgram }) {
  if (!isValidAddress(chain, address)) return null
  const dec = typeof decimals === 'number' ? decimals : Number(decimals)
  if (!Number.isInteger(dec) || dec < 0 || dec > 32) return null
  const sym = cleanText(symbol)
  if (!sym) return null
  return {
    chain,
    symbol: sym,
    name: cleanText(name, sym),
    address: normalizeAddress(chain, address),
    decimals: dec,
    logoUri: cleanLogo(logo),
    isNative: isNativeAddress(chain, address),
    verified: typeof verified === 'boolean' ? verified : null,
    source,
    priceUsd: finite(priceUsd),
    liquidityUsd: finite(liquidityUsd),
    tokenProgram: typeof tokenProgram === 'string' ? tokenProgram : null,
  }
}

function dedupe(...lists) {
  const out = new Map()
  for (const list of lists) {
    for (const token of list || []) {
      if (!token) continue
      const key = `${token.chain}:${token.address}`
      const held = out.get(key)
      if (!held) { out.set(key, { ...token }); continue }
      if (held.logoUri == null && token.logoUri != null) held.logoUri = token.logoUri
      if (held.verified == null && token.verified != null) held.verified = token.verified
      if (held.priceUsd == null && token.priceUsd != null) held.priceUsd = token.priceUsd
      if (held.liquidityUsd == null && token.liquidityUsd != null) held.liquidityUsd = token.liquidityUsd
      if (held.tokenProgram == null && token.tokenProgram != null) held.tokenProgram = token.tokenProgram
    }
  }
  return [...out.values()]
}

/** Bounded fetch — one slow provider must not hold the picker open. */
async function fetchJson(url, init, ms = 6000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// ─── Jupiter (Solana) ────────────────────────────────────────────────────────
// tokens/v2/search takes a name, a symbol, a mint, or a comma-separated list of
// mints. `isVerified` is absent rather than false for unverified mints, so it is
// only read as a positive assertion.

function jupiterBase(env) {
  return env.JUPITER_API_KEY ? 'https://api.jup.ag' : 'https://lite-api.jup.ag'
}

function jupiterHeaders(env) {
  const headers = { accept: 'application/json' }
  if (env.JUPITER_API_KEY) headers['x-api-key'] = env.JUPITER_API_KEY
  return headers
}

/** Shared mapper — search and the top-tokens list return the same record shape. */
function jupiterTokens(data, limit) {
  if (!Array.isArray(data)) return []
  return data.slice(0, limit).map(t => makeToken('solana', {
    address: t.id,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    logo: t.icon,
    verified: t.isVerified === true ? true : null,
    source: 'jupiter',
    priceUsd: t.usdPrice,
    liquidityUsd: t.liquidity,
    tokenProgram: t.tokenProgram,
  })).filter(Boolean)
}

async function jupiterSearch(query, env, limit) {
  const data = await fetchJson(
    `${jupiterBase(env)}/tokens/v2/search?query=${encodeURIComponent(query)}`,
    { headers: jupiterHeaders(env) })
  return jupiterTokens(data, limit)
}

/**
 * Popular Solana tokens for the opening list.
 *
 * NOT a text search for "verified" — that was the first attempt and it returned
 * pump.fun tokens literally NAMED "VERIFIED", because a symbol search matches
 * symbols. This endpoint is Jupiter's own ranking and leads with SOL/USDC/USDT.
 */
async function jupiterTop(env, limit) {
  const data = await fetchJson(
    `${jupiterBase(env)}/tokens/v2/toporganicscore/24h?limit=${Math.min(limit, MAX_LIMIT)}`,
    { headers: jupiterHeaders(env) })
  return jupiterTokens(data, limit)
}

// ─── Relay (EVM) ─────────────────────────────────────────────────────────────
// currencies/v2 accepts a term that may be a name, a symbol OR an exact address,
// and `useExternalSearch` lets it consult another index when its own misses —
// which is what makes a freshly launched token findable by address.

async function relaySearch(chain, term, limit, useExternalSearch) {
  const chainId = EVM_CHAIN_IDS[chain]
  if (!chainId) return []
  const body = { chainIds: [chainId], limit: Math.min(limit, MAX_LIMIT), useExternalSearch: !!useExternalSearch }
  if (term) body.term = term
  const data = await fetchJson('https://api.relay.link/currencies/v2', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!Array.isArray(data)) return []
  return data.map(t => makeToken(chain, {
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    logo: t.metadata && t.metadata.logoURI,
    verified: t.metadata && t.metadata.verified === true ? true : null,
    source: 'relay',
  })).filter(Boolean)
}

// ─── LI.FI catalogue (EVM) ───────────────────────────────────────────────────
// One bulk list per chain, cached, then filtered in-Worker. minPriceUSD=0 is
// deliberate (see the header): the default silently drops ~36% of Base's tokens.

async function lifiCatalogue(chain, env, ctx) {
  const chainId = EVM_CHAIN_IDS[chain]
  if (!chainId) return []
  const key = `tok:lifi:${chain}`
  const hit = await cacheGet(env, key)
  if (hit) return hit

  const headers = { accept: 'application/json' }
  if (env.LIFI_API_KEY) headers['x-lifi-api-key'] = env.LIFI_API_KEY
  const data = await fetchJson(
    `https://li.quest/v1/tokens?chains=${chainId}&minPriceUSD=0`, { headers }, 10000)
  const raw = (data && data.tokens && data.tokens[String(chainId)]) || []
  const tokens = raw.map(t => makeToken(chain, {
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    logo: t.logoURI,
    verified: t.verificationStatus === 'verified' ? true : null,
    source: 'lifi',
    priceUsd: t.priceUSD,
  })).filter(Boolean)

  if (tokens.length) cachePut(env, ctx, key, tokens, TTL_CATALOGUE)
  return tokens
}

function filterCatalogue(tokens, term, limit) {
  const q = term.toLowerCase()
  const out = []
  for (const t of tokens) {
    if (t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.address.toLowerCase() === q) {
      out.push(t)
      if (out.length >= limit) break
    }
  }
  return out
}

// ─── Route ───────────────────────────────────────────────────────────────────

/**
 * Suggestions are the opening list, before the user types. Relay's default
 * (term-less) response is already an ordered, mostly-verified set per chain, and
 * Jupiter's "verified" query is the Solana equivalent; the client merges its own
 * curated entries and the user's holdings on top.
 */
async function suggestions(chain, env, ctx, limit) {
  const key = `tok:sugg:${chain}:${limit}`
  const hit = await cacheGet(env, key)
  if (hit) return hit

  let tokens = []
  if (isSolanaChain(chain)) {
    tokens = await jupiterTop(env, limit)
  } else if (isEvmChain(chain)) {
    tokens = await relaySearch(chain, '', limit, false)
    if (!tokens.length) tokens = (await lifiCatalogue(chain, env, ctx)).slice(0, limit)
  }
  if (tokens.length) cachePut(env, ctx, key, tokens, TTL_CATALOGUE)
  return tokens
}

/**
 * Exact contract/mint lookup. This is the path that makes a token nobody has
 * listed yet reachable, so it must not be gated on a verification list.
 */
async function resolveExact(chain, address, env, ctx) {
  if (!isValidAddress(chain, address)) return []
  const normalized = normalizeAddress(chain, address)
  const key = `tok:res:${chain}:${normalized}`
  const hit = await cacheGet(env, key)
  if (hit) return hit

  let tokens = []
  if (isSolanaChain(chain)) {
    tokens = await jupiterSearch(normalized, env, 5)
    // Jupiter matches on substrings too; keep only the exact mint.
    tokens = tokens.filter(t => t.address === normalized)
  } else if (isEvmChain(chain)) {
    tokens = await relaySearch(chain, normalized, 5, true)
    tokens = tokens.filter(t => t.address === normalized)
    if (!tokens.length) {
      const cat = await lifiCatalogue(chain, env, ctx)
      tokens = cat.filter(t => t.address === normalized)
    }
  }

  // Cache the miss too, briefly, so a mistyped address isn't re-fetched per keystroke.
  cachePut(env, ctx, key, tokens, tokens.length ? TTL_RESOLVE : TTL_NEGATIVE)
  return tokens
}

async function search(chain, term, env, ctx, limit) {
  const key = `tok:q:${chain}:${term.toLowerCase()}:${limit}`
  const hit = await cacheGet(env, key)
  if (hit) return hit

  let tokens = []
  if (isSolanaChain(chain)) {
    tokens = await jupiterSearch(term, env, limit)
  } else if (isEvmChain(chain)) {
    // Relay's OWN index first. Measured 2026-09-24 on PEPE, USDC, DEGEN, PENGU,
    // USDT and BRETT: ~0.1 s cold, canonical token ranked first, up to 20 hits.
    // With `useExternalSearch` the same text queries took 1-3.3 s cold and came
    // back THINNER (USDC on Base: 2 hits instead of 20) — which then triggered
    // the bulk LI.FI catalogue fetch serially behind it. External search stays
    // for exact-address lookups (resolveExact), where it is what finds a token
    // Relay has not indexed, and as a fallback here when the index is thin.
    const own = await relaySearch(chain, term, limit, false)
    let fallback = []
    if (own.length < 5) {
      const [external, catalogue] = await Promise.all([
        relaySearch(chain, term, limit, true),
        lifiCatalogue(chain, env, ctx),
      ])
      fallback = dedupe(external, filterCatalogue(catalogue, term, limit))
    }
    tokens = dedupe(own, fallback)
  }

  tokens = tokens.slice(0, limit)
  cachePut(env, ctx, key, tokens, tokens.length ? TTL_SEARCH : TTL_NEGATIVE)
  return tokens
}

/**
 * GET /tokens?chain=&q=&address=&limit=
 *
 * Always 200 with `{ tokens, chain, error }`. A provider outage returns an empty
 * list rather than an error status, because the client falls back to its curated
 * entries and a hard failure would take the whole picker down with one provider.
 *
 * Rate-limited per IP on its own bucket: this route spends Jupiter/Relay quota on
 * every keystroke that misses the cache, and those quotas are per-key for the
 * whole user base, not per user.
 */
export async function handleTokens(request, url, env, ctx) {
  const p = url.searchParams
  const chain = (p.get('chain') || '').trim().toLowerCase()
  if (!chain) return json(env, { tokens: [], chain, error: 'Missing chain.' })

  const limitRpm = Number(env.TOKENS_RPM) || 120
  if (!(await rateLimit(request, env, ctx, { limit: limitRpm, windowSec: 60, bucket: 'tokens' }))) {
    return json(env, { tokens: [], chain, error: 'Too many token searches — slow down.' }, 429)
  }
  if (!isEvmChain(chain) && !isSolanaChain(chain)) {
    // Bitcoin/Cardano/Polkadot have no DEX discovery — an empty list is correct,
    // not an error: those chains reach the exchange flow instead.
    return json(env, { tokens: [], chain, error: null })
  }

  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(p.get('limit')) || 20))
  const address = (p.get('address') || '').trim()
  const term = (p.get('q') || '').trim().slice(0, 64)

  try {
    let tokens
    if (address) tokens = await resolveExact(chain, address, env, ctx)
    else if (term) {
      // A term that IS an address resolves exactly rather than fuzzily.
      tokens = isValidAddress(chain, term)
        ? await resolveExact(chain, term, env, ctx)
        : await search(chain, term, env, ctx, limit)
    } else tokens = await suggestions(chain, env, ctx, limit)

    return json(env, { tokens: tokens.slice(0, limit), chain, error: null })
  } catch (e) {
    return json(env, { tokens: [], chain, error: e && e.message ? e.message : 'Token discovery failed.' })
  }
}
