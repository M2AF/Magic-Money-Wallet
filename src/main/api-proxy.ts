/**
 * api-proxy.ts — client-side routing for all KEYED providers.
 *
 * Proxy-first: when `config.swapProxyUrl` is set (the deployed MagicMoney Worker),
 * every keyed provider call routes through it so the wallet bundle never carries
 * Alchemy/Helius/Tatum/Blockfrost/Moralis/OpenSea keys. When no proxy is set, it
 * falls back to a direct keyed call — which only works if the user supplied their
 * own key in Settings (a clean self-hoster path now that the shipped defaults are
 * empty).
 *
 * Two provider shapes:
 *  - URL-embedded key (Alchemy, Helius): a URL builder is enough — the same
 *    string works for plain fetch, viem's http() transport, and Solana's
 *    Connection. The proxy URL carries no key; the Worker injects it.
 *  - Header key (Tatum, Blockfrost, Moralis, OpenSea): a fetch helper that also
 *    drops the auth header when proxying (the Worker adds it server-side).
 *
 * Keyless, per-IP endpoints (DexScreener, DefiLlama, Magic Eden, mempool.space,
 * Binance) are deliberately NOT here — they stay direct so each user keeps their
 * own IP quota. Routing them per-request through the Worker would collapse every
 * user onto one IP. Exception: Market Watch data (market-fetcher.ts) reads the
 * Worker's /market/* routes — a CRON-refreshed global KV cache, not per-request
 * proxying, so a handful of upstream CoinGecko calls serve every user.
 */

import type { WalletConfig } from './secure-store'

export function proxyBase(config: WalletConfig): string | null {
  const b = (config.swapProxyUrl || '').trim().replace(/\/+$/, '')
  return b || null
}

export function proxyHeaders(config: WalletConfig, headers: Record<string, string> = {}): Record<string, string> {
  const token = (config.clientToken || '').trim()
  return token ? { ...headers, 'x-mm-client': token } : headers
}

export function proxyUrl(url: string, config: WalletConfig): string {
  const token = (config.clientToken || '').trim()
  if (!token) return url
  const u = new URL(url)
  u.searchParams.set('mm_client', token)
  return u.toString()
}

// ─── Capability gates ─────────────────────────────────────────────────────────
// A provider is available when EITHER the proxy is configured OR the user supplied
// their own key. Use these instead of raw `config.xKey` truthiness so emptying the
// shipped keys (the security cutover) doesn't silently disable a feature.

const hasProxy = (c: WalletConfig) => !!proxyBase(c)
export const canAlchemy   = (c: WalletConfig) => hasProxy(c) || !!c.alchemyKey
export const canAnkr      = (c: WalletConfig) => hasProxy(c) || !!c.ankrKey
export const canHelius    = (c: WalletConfig) => hasProxy(c) || !!c.heliusKey
export const canTatum     = (c: WalletConfig) => hasProxy(c) || !!c.tatumKey
export const canBlockfrost = (c: WalletConfig) => hasProxy(c) || !!c.blockfrostKey
export const canMoralis   = (c: WalletConfig) => hasProxy(c) || !!c.moralisKey
export const canOpensea   = (c: WalletConfig) => hasProxy(c) || !!c.openseaKey
export const canOrdiscan  = (c: WalletConfig) => hasProxy(c) || !!c.ordiscanKey
export const canAnvil     = (c: WalletConfig) => hasProxy(c) || !!c.anvilKey

// ─── URL-embedded-key providers (Alchemy, Helius) ─────────────────────────────

/** Alchemy JSON-RPC endpoint for a network slug (e.g. 'eth-mainnet'). */
export function alchemyRpcUrl(network: string, config: WalletConfig): string {
  const base = proxyBase(config)
  return base ? proxyUrl(`${base}/rpc/alchemy/${network}`, config) : `https://${network}.g.alchemy.com/v2/${config.alchemyKey}`
}

/** Alchemy NFT v3 URL for a path such as `getNFTsForOwner?owner=...`. */
export function alchemyNftUrl(network: string, path: string, config: WalletConfig): string {
  const base = proxyBase(config)
  const p = path.replace(/^\/+/, '')
  return base
    ? proxyUrl(`${base}/alchemy-nft/${network}/${p}`, config)
    : `https://${network}.g.alchemy.com/nft/v3/${config.alchemyKey}/${p}`
}

/**
 * Alchemy Portfolio/Data API POST. `path` is after `/data/v1/{key}/` (e.g.
 * `assets/tokens/by-address`). Lives on a different rate bucket than the
 * JSON-RPC `alchemy_getTokenBalances` method and covers Abstract, so it's the
 * token-balance source that survives when the JSON-RPC method is throttled.
 * Proxy injects the key (route /alchemy-data/*); direct mode uses the user key.
 */
export function alchemyDataFetch(path: string, body: unknown, config: WalletConfig, timeoutMs = 12_000): Promise<Response> {
  const base = proxyBase(config)
  const p = path.replace(/^\/+/, '')
  const url = base ? proxyUrl(`${base}/alchemy-data/${p}`, config) : `https://api.g.alchemy.com/data/v1/${config.alchemyKey}/${p}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json', accept: 'application/json' }
  if (base) Object.assign(headers, proxyHeaders(config))
  return fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
}

/**
 * Alchemy TRON HTTP API endpoint. `path` is the TRON method after the key, e.g.
 * 'wallet/getaccount' or 'wallet/broadcasttransaction'. The Worker injects the key
 * (route /rpc/alchemy-tron/*); direct mode needs a user-supplied Alchemy key.
 */
export function tronApiUrl(path: string, config: WalletConfig): string {
  const base = proxyBase(config)
  const p = path.replace(/^\/+/, '')
  return base ? proxyUrl(`${base}/rpc/alchemy-tron/${p}`, config) : `https://tron-mainnet.g.alchemy.com/v2/${config.alchemyKey}/${p}`
}

// Our chain id → Ankr RPC slug (rpc.ankr.com/<slug>). Only chains the current Ankr
// key is entitled to — Solana is omitted (this key 403s on it; Helius + public
// Solana RPCs cover it anyway).
const ANKR_CHAIN: Record<string, string> = {
  ethereum: 'eth', arbitrum: 'arbitrum', optimism: 'optimism', base: 'base',
  polygon: 'polygon', avalanche: 'avalanche', bsc: 'bsc', gnosis: 'gnosis', blast: 'blast',
}

/**
 * Keyed Ankr JSON-RPC endpoint for a wallet chain id, used as a reliable read/send
 * fallback (Ankr deprecated keyless access). Proxy injects the key; direct mode
 * needs a user-supplied Ankr key. Returns undefined for chains Ankr doesn't serve
 * or when no key/proxy is available (callers skip undefined fallbacks).
 */
export function ankrRpcUrl(chainId: string, config: WalletConfig): string | undefined {
  const slug = ANKR_CHAIN[chainId]
  if (!slug) return undefined
  const base = proxyBase(config)
  if (base) return proxyUrl(`${base}/rpc/ankr/${slug}`, config)
  return config.ankrKey ? `https://rpc.ankr.com/${slug}/${config.ankrKey}` : undefined
}

/** Helius (Solana) JSON-RPC endpoint. */
export function heliusRpcUrl(config: WalletConfig): string {
  const base = proxyBase(config)
  return base ? proxyUrl(`${base}/rpc/helius`, config) : `https://mainnet.helius-rpc.com/?api-key=${config.heliusKey}`
}

/**
 * Helius enhanced REST API (api.helius.xyz — distinct host from the RPC). `path`
 * is everything after the host (e.g. `v0/addresses/<addr>/transactions?limit=10`),
 * WITHOUT the api-key — the proxy/direct path adds it.
 */
export function heliusApiFetch(path: string, config: WalletConfig, timeoutMs = 12_000): Promise<Response> {
  const base = proxyBase(config)
  if (base) return fetch(proxyUrl(`${base}/helius-api/${path}`, config), { headers: proxyHeaders(config), signal: AbortSignal.timeout(timeoutMs) })
  const sep = path.includes('?') ? '&' : '?'
  return fetch(`https://api.helius.xyz/${path}${sep}api-key=${config.heliusKey}`, { signal: AbortSignal.timeout(timeoutMs) })
}

/**
 * POST a read-only JSON-RPC body to the first endpoint that answers with a
 * non-error result. Used for native-balance reads so a throttled/exhausted proxy
 * key degrades to a public node instead of showing "—". Pass
 * `[alchemyRpcUrl(net, config), ...chain.publicRpcs]`. NOT for sends — public
 * nodes are unreliable for broadcast, so keep eth_sendRawTransaction on the proxy.
 */
export async function rpcReadWithFallback(
  urls: Array<string | undefined>, body: unknown, timeoutMs = 10_000
): Promise<{ result?: unknown; error?: { message?: string } } | null> {
  for (const url of urls) {
    if (!url) continue
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) continue
      const json = await res.json() as { result?: unknown; error?: { message?: string } }
      if (json && json.error) continue   // try the next endpoint on RPC error
      return json
    } catch { continue }
  }
  return null
}

// ─── Header-key providers (Tatum, Blockfrost, Moralis, OpenSea) ───────────────
// Each returns a Response so callers keep their existing .ok / .json() handling.

/** Tatum gateway JSON-RPC POST (gateway = 'polkadot' | 'bitcoin' | EVM slug). */
export function tatumFetch(gateway: string, body: unknown, config: WalletConfig, timeoutMs = 10_000): Promise<Response> {
  const base = proxyBase(config)
  const url = base ? proxyUrl(`${base}/rpc/tatum/${gateway}`, config) : `https://${gateway}-mainnet.gateway.tatum.io`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (base) Object.assign(headers, proxyHeaders(config))
  else headers['x-api-key'] = config.tatumKey
  return fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
}

// Wallet chain.id → Tatum gateway key (Worker TATUM_GATEWAYS). Only chains whose
// native-balance/RPC reads benefit from a keyed fallback beyond Alchemy + the
// sparse public nodes: Abstract (no public RPC), HyperEVM (one backup), Monad
// (has its own rotation but a keyed node is a fine extra safety net).
const TATUM_EVM_GATEWAY: Record<string, string> = {
  abstract: 'abstract',
  monad: 'monad',
  hyperevm: 'hyperevm',
}

/**
 * Tatum EVM gateway URL for a wallet chain.id, as a keyed last-resort entry in a
 * `rpcReadWithFallback` / viem `fallback` ladder (JSON-RPC eth_* over POST).
 * Proxy-only: the Tatum key is a Worker secret, and the fallback executor can't
 * attach a per-URL x-api-key header — so direct mode (no proxy) returns undefined
 * rather than leak/omit the key. Returns undefined for unsupported chains.
 */
export function tatumRpcUrl(chainId: string, config: WalletConfig): string | undefined {
  const gw = TATUM_EVM_GATEWAY[chainId]
  if (!gw) return undefined
  const base = proxyBase(config)
  if (!base) return undefined
  return proxyUrl(`${base}/rpc/tatum/${gw}`, config)
}

/**
 * Blockfrost request. `path` is everything after `/api/v0/` (e.g. `assets/<unit>`
 * or `tx/submit`). Defaults to GET; pass `init` for POST (e.g. CBOR tx submit).
 */
export function blockfrostFetch(path: string, config: WalletConfig, timeoutMs = 10_000, init?: RequestInit): Promise<Response> {
  const base = proxyBase(config)
  const url = base ? proxyUrl(`${base}/blockfrost/${path}`, config) : `https://cardano-mainnet.blockfrost.io/api/v0/${path}`
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) }
  if (base) Object.assign(headers, proxyHeaders(config))
  else headers['project_id'] = config.blockfrostKey
  return fetch(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) })
}

/** Moralis GET. `path` is everything after `/api/v2.2/` (e.g. `<addr>/nft?chain=0x8f`). */
export function moralisFetch(path: string, config: WalletConfig, timeoutMs = 15_000): Promise<Response> {
  const base = proxyBase(config)
  const url = base ? proxyUrl(`${base}/moralis/${path}`, config) : `https://deep-index.moralis.io/api/v2.2/${path}`
  const headers: Record<string, string> = { accept: 'application/json' }
  if (base) Object.assign(headers, proxyHeaders(config))
  else headers['X-API-Key'] = config.moralisKey
  return fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
}

/** OpenSea v2 GET. `path` is everything after `/api/v2/` (e.g. `collections/<slug>/stats`). */
export function openseaFetch(path: string, config: WalletConfig, timeoutMs = 8_000): Promise<Response> {
  const base = proxyBase(config)
  const url = base ? proxyUrl(`${base}/opensea/${path}`, config) : `https://api.opensea.io/api/v2/${path}`
  const headers: Record<string, string> = { accept: 'application/json' }
  if (base) Object.assign(headers, proxyHeaders(config))
  else headers['x-api-key'] = config.openseaKey
  return fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
}

/** Ordiscan (Bitcoin Ordinals/Runes/BRC-20) GET. `path` is after `/v1/` (e.g. `address/<addr>/inscriptions`). */
export function ordinalsFetch(path: string, config: WalletConfig, timeoutMs = 12_000): Promise<Response> {
  const base = proxyBase(config)
  const url = base ? proxyUrl(`${base}/ordinals/${path}`, config) : `https://api.ordiscan.com/v1/${path}`
  const headers: Record<string, string> = { accept: 'application/json' }
  if (base) Object.assign(headers, proxyHeaders(config))
  else headers['Authorization'] = `Bearer ${config.ordiscanKey}`
  return fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
}

/**
 * Anvil (Cardano marketplace) GET. `path` is everything after `/v2/services/`
 * (e.g. `marketplace/collections/<policyId>/assets?orderBy=priceAsc`). Used to
 * value Cardano NFTs by collection floor. Proxy injects the X-Api-Key; direct mode
 * needs a user-supplied Anvil key.
 */
export function anvilFetch(path: string, config: WalletConfig, timeoutMs = 10_000): Promise<Response> {
  const base = proxyBase(config)
  const url = base ? proxyUrl(`${base}/anvil/${path}`, config) : `https://prod.api.ada-anvil.app/v2/services/${path}`
  const headers: Record<string, string> = { accept: 'application/json' }
  if (base) Object.assign(headers, proxyHeaders(config))
  else headers['X-Api-Key'] = config.anvilKey
  return fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
}
