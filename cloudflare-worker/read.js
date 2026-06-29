/**
 * read.js — read-path proxy routes for the keyed providers.
 *
 * The wallet client never holds Alchemy/Helius/Tatum/Blockfrost/Moralis/OpenSea
 * keys; it calls these routes and the Worker injects the key server-side. The
 * cross-user KV cache targets the shared/immutable/expensive trifecta — token
 * metadata (24h), OpenSea floors (10m), contract→slug maps (7d) — which is where
 * the monthly-quota savings come from. Per-user calls (balances, owner sweeps)
 * are passed straight through.
 *
 * Keyless, per-IP endpoints (CoinGecko, DexScreener, DefiLlama, Magic Eden,
 * mempool.space, Binance) are intentionally NOT proxied — they stay on the
 * client so each user keeps their own IP-based quota.
 *
 * Required env: ALCHEMY_KEY, HELIUS_KEY, TATUM_KEY, BLOCKFROST_KEY, MORALIS_KEY,
 *   OPENSEA_KEY. Optional: CACHE (KV), CLIENT_TOKEN, READ_RPM.
 */

import { json, err, passthrough, cacheGet, cachePut, clientOk, rateLimit, pathParts } from './lib.js'

// Alchemy network slugs we serve (mirrors chain-config.ts alchemyNetwork values).
const ALCHEMY_NETWORKS = new Set([
  'eth-mainnet', 'arb-mainnet', 'opt-mainnet', 'base-mainnet', 'polygon-mainnet',
  'avax-mainnet', 'blast-mainnet', 'gnosis-mainnet', 'abstract-mainnet',
  'apechain-mainnet', 'ronin-mainnet', 'soneium-mainnet', 'worldchain-mainnet', 'zora-mainnet',
])

const TATUM_GATEWAYS = {
  polkadot: 'https://polkadot-mainnet.gateway.tatum.io',
  bitcoin: 'https://bitcoin-mainnet.gateway.tatum.io',
}

// Ankr RPC slugs we allow proxying (rpc.ankr.com/<slug>/<key>) — keyed fallback.
const ANKR_CHAINS = new Set([
  'eth', 'arbitrum', 'optimism', 'base', 'polygon', 'avalanche', 'bsc', 'gnosis', 'blast', 'solana',
])

const READ_NS = new Set(['rpc', 'alchemy-nft', 'helius-api', 'blockfrost', 'moralis', 'opensea'])

// Alchemy TRON HTTP API host (separate from the `${network}.g.alchemy.com` JSON-RPC
// hosts — TRON uses path-based `wallet/*` methods under /v2/{key}/).
const ALCHEMY_TRON = (env) => `https://tron-mainnet.g.alchemy.com/v2/${env.ALCHEMY_KEY}`

const alchemyRpc = (network, env) => `https://${network}.g.alchemy.com/v2/${env.ALCHEMY_KEY}`
const alchemyNft = (network, env) => `https://${network}.g.alchemy.com/nft/v3/${env.ALCHEMY_KEY}`

/** Returns a Response for a read route, or null if this isn't a read route. */
export async function handleRead(request, url, env, ctx) {
  const parts = pathParts(url.pathname)
  if (!READ_NS.has(parts[0])) return null

  if (!clientOk(request, env)) return err(env, 'Forbidden', 403)
  const limit = Number(env.READ_RPM) || 600
  if (!(await rateLimit(request, env, ctx, { limit, windowSec: 60, bucket: 'read' })))
    return err(env, 'Rate limited', 429)

  // ── Alchemy JSON-RPC: POST /rpc/alchemy/:network ──────────────────────────
  if (parts[0] === 'rpc' && parts[1] === 'alchemy' && request.method === 'POST') {
    const network = parts[2]
    if (!ALCHEMY_NETWORKS.has(network)) return err(env, `Unknown network: ${network}`)
    if (!env.ALCHEMY_KEY) return err(env, 'Alchemy key not configured', 500)
    const body = await request.json().catch(() => null)
    if (body == null) return err(env, 'Bad body')
    // Cross-user cache for token metadata (immutable per contract).
    if (isAllMetadata(body)) return json(env, await alchemyMetaCached(network, body, env, ctx))
    const res = await fetch(alchemyRpc(network, env), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    return passthrough(env, res)
  }

  // ── Alchemy TRON HTTP API: POST /rpc/alchemy-tron/* ───────────────────────
  // Forwards the TRON method sub-path (e.g. wallet/getaccount, wallet/
  // triggerconstantcontract, wallet/broadcasttransaction) to the keyed host.
  if (parts[0] === 'rpc' && parts[1] === 'alchemy-tron' && request.method === 'POST') {
    if (!env.ALCHEMY_KEY) return err(env, 'Alchemy key not configured', 500)
    const sub = parts.slice(2).join('/')
    if (!sub) return err(env, 'Missing TRON method')
    const res = await fetch(`${ALCHEMY_TRON(env)}/${sub}${url.search}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', accept: 'application/json' },
      body: await request.text(),
    })
    return passthrough(env, res)
  }

  // ── Ankr JSON-RPC: POST /rpc/ankr/:chain (inject key) ─────────────────────
  // Keyed fallback RPC. Ankr deprecated keyless access, so the wallet's public
  // fallback now routes the Ankr endpoint through here. :chain is Ankr's slug.
  if (parts[0] === 'rpc' && parts[1] === 'ankr' && request.method === 'POST') {
    const chain = parts[2]
    if (!ANKR_CHAINS.has(chain)) return err(env, `Unknown Ankr chain: ${chain}`)
    if (!env.ANKR_API_KEY) return err(env, 'Ankr key not configured', 500)
    const res = await fetch(`https://rpc.ankr.com/${chain}/${env.ANKR_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await request.text(),
    })
    return passthrough(env, res)
  }

  // ── Helius JSON-RPC: POST /rpc/helius ─────────────────────────────────────
  if (parts[0] === 'rpc' && parts[1] === 'helius' && request.method === 'POST') {
    if (!env.HELIUS_KEY) return err(env, 'Helius key not configured', 500)
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await request.text(),
    })
    return passthrough(env, res)
  }

  // ── Tatum gateway: POST /rpc/tatum/:gateway ───────────────────────────────
  if (parts[0] === 'rpc' && parts[1] === 'tatum' && request.method === 'POST') {
    const gw = TATUM_GATEWAYS[parts[2]]
    if (!gw) return err(env, `Unknown tatum gateway: ${parts[2]}`)
    if (!env.TATUM_KEY) return err(env, 'Tatum key not configured', 500)
    const res = await fetch(gw, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.TATUM_KEY },
      body: await request.text(),
    })
    return passthrough(env, res)
  }

  // ── Helius enhanced REST: GET /helius-api/* (inject api-key query) ────────
  if (parts[0] === 'helius-api' && request.method === 'GET') {
    if (!env.HELIUS_KEY) return err(env, 'Helius key not configured', 500)
    const u = new URL(`https://api.helius.xyz/${parts.slice(1).join('/')}`)
    url.searchParams.forEach((v, k) => u.searchParams.set(k, v))
    u.searchParams.set('api-key', env.HELIUS_KEY)
    return passthrough(env, await fetch(u.toString(), { headers: { accept: 'application/json' } }))
  }

  // ── Alchemy NFT REST: GET /alchemy-nft/:network/* ─────────────────────────
  if (parts[0] === 'alchemy-nft' && request.method === 'GET') {
    const network = parts[1]
    if (!ALCHEMY_NETWORKS.has(network)) return err(env, `Unknown network: ${network}`)
    if (!env.ALCHEMY_KEY) return err(env, 'Alchemy key not configured', 500)
    const rest = parts.slice(2).join('/')
    const res = await fetch(`${alchemyNft(network, env)}/${rest}${url.search}`, { headers: { accept: 'application/json' } })
    return passthrough(env, res)
  }

  // ── Blockfrost REST: /blockfrost/* (inject project_id) ────────────────────
  // GET: /assets/:unit is immutable token/NFT metadata → cache 24h; address/
  // account paths are per-user → passthrough. POST: tx/submit (CBOR), passthrough.
  if (parts[0] === 'blockfrost' && (request.method === 'GET' || request.method === 'POST')) {
    if (!env.BLOCKFROST_KEY) return err(env, 'Blockfrost key not configured', 500)
    const rest = parts.slice(1).join('/')
    const upstream = `https://cardano-mainnet.blockfrost.io/api/v0/${rest}${url.search}`
    if (request.method === 'POST') {
      const res = await fetch(upstream, {
        method: 'POST',
        headers: { project_id: env.BLOCKFROST_KEY, 'Content-Type': request.headers.get('Content-Type') || 'application/cbor' },
        body: await request.arrayBuffer(),
      })
      return passthrough(env, res)
    }
    const ckey = (parts[1] === 'assets' && parts.length >= 3) ? `bf:${rest}` : null
    if (ckey) { const hit = await cacheGet(env, ckey); if (hit) return json(env, hit) }
    const res = await fetch(upstream, { headers: { project_id: env.BLOCKFROST_KEY } })
    if (!res.ok) return passthrough(env, res)
    const data = await res.json().catch(() => null)
    if (ckey && data) cachePut(env, ctx, ckey, data, 86400)
    return json(env, data)
  }

  // ── Moralis REST: GET /moralis/* (inject X-API-Key) ───────────────────────
  // Per-address; short 60s cache only dedups refresh bursts.
  if (parts[0] === 'moralis' && request.method === 'GET') {
    if (!env.MORALIS_KEY) return err(env, 'Moralis key not configured', 500)
    const rest = parts.slice(1).join('/')
    const ckey = `mor:${rest}${url.search}`
    const hit = await cacheGet(env, ckey); if (hit) return json(env, hit)
    const res = await fetch(`https://deep-index.moralis.io/api/v2.2/${rest}${url.search}`, {
      headers: { 'X-API-Key': env.MORALIS_KEY, accept: 'application/json' },
    })
    if (!res.ok) return passthrough(env, res)
    const data = await res.json().catch(() => null)
    if (data) cachePut(env, ctx, ckey, data, 60)
    return json(env, data)
  }

  // ── OpenSea REST: GET /opensea/* (inject x-api-key) ───────────────────────
  // Floors → 10m; contract→slug → 7d (immutable); per-owner sweeps → no cache.
  if (parts[0] === 'opensea' && request.method === 'GET') {
    if (!env.OPENSEA_KEY) return err(env, 'OpenSea key not configured', 500)
    const rest = parts.slice(1).join('/')
    const ttl = openseaTtl(parts)
    const ckey = ttl ? `os:${rest}${url.search}` : null
    if (ckey) { const hit = await cacheGet(env, ckey); if (hit) return json(env, hit) }
    const res = await fetch(`https://api.opensea.io/api/v2/${rest}${url.search}`, {
      headers: { 'x-api-key': env.OPENSEA_KEY, accept: 'application/json' },
    })
    if (!res.ok) return passthrough(env, res)
    const data = await res.json().catch(() => null)
    if (ckey && data) cachePut(env, ctx, ckey, data, ttl)
    return json(env, data)
  }

  return err(env, 'Not found', 404)
}

// /opensea/collections/:slug/stats → 10m ; /opensea/chain/:chain/contract/:contract → 7d
function openseaTtl(parts) {
  if (parts[1] === 'collections' && parts[3] === 'stats') return 600
  if (parts[1] === 'chain' && parts[3] === 'contract') return 604800
  return 0
}

function isAllMetadata(body) {
  const arr = Array.isArray(body) ? body : [body]
  return arr.length > 0 && arr.every(c => c && c.method === 'alchemy_getTokenMetadata')
}

/**
 * Resolve a (possibly batched) alchemy_getTokenMetadata request from KV per
 * contract, fetching only the misses upstream as a smaller batch. Token metadata
 * is identical across all users, so this is the highest-value cross-user cache.
 * Results are returned positionally (request order) — matching how the client
 * reads them back by index.
 */
async function alchemyMetaCached(network, body, env, ctx) {
  const calls = Array.isArray(body) ? body : [body]
  const out = new Array(calls.length)
  const misses = []

  for (let i = 0; i < calls.length; i++) {
    const contract = String(calls[i]?.params?.[0] || '').toLowerCase()
    const hit = contract ? await cacheGet(env, `alcmeta:${network}:${contract}`) : null
    if (hit) out[i] = { jsonrpc: '2.0', id: calls[i].id, result: hit }
    else misses.push({ i, contract, id: calls[i].id })
  }

  if (misses.length) {
    const upstreamBody = misses.map(m => ({ jsonrpc: '2.0', id: m.id, method: 'alchemy_getTokenMetadata', params: [m.contract] }))
    const res = await fetch(alchemyRpc(network, env), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(upstreamBody),
    })
    const arr = await res.json().catch(() => [])
    const list = Array.isArray(arr) ? arr : [arr]
    const byId = new Map(list.map(r => [r.id, r]))
    for (const m of misses) {
      const r = byId.get(m.id)
      out[m.i] = r ?? { jsonrpc: '2.0', id: m.id, result: null }
      if (r && r.result && m.contract) cachePut(env, ctx, `alcmeta:${network}:${m.contract}`, r.result, 86400)
    }
  }

  return Array.isArray(body) ? out : out[0]
}
