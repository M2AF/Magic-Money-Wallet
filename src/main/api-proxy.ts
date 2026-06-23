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
 * Keyless, per-IP endpoints (CoinGecko, DexScreener, DefiLlama, Magic Eden,
 * mempool.space, Binance) are deliberately NOT here — they stay direct so each
 * user keeps their own IP quota. Routing them through the Worker would collapse
 * every user onto one IP.
 */

import type { WalletConfig } from './secure-store'

export function proxyBase(config: WalletConfig): string | null {
  const b = (config.swapProxyUrl || '').trim().replace(/\/+$/, '')
  return b || null
}

// ─── Capability gates ─────────────────────────────────────────────────────────
// A provider is available when EITHER the proxy is configured OR the user supplied
// their own key. Use these instead of raw `config.xKey` truthiness so emptying the
// shipped keys (the security cutover) doesn't silently disable a feature.

const hasProxy = (c: WalletConfig) => !!proxyBase(c)
export const canAlchemy   = (c: WalletConfig) => hasProxy(c) || !!c.alchemyKey
export const canHelius    = (c: WalletConfig) => hasProxy(c) || !!c.heliusKey
export const canTatum     = (c: WalletConfig) => hasProxy(c) || !!c.tatumKey
export const canBlockfrost = (c: WalletConfig) => hasProxy(c) || !!c.blockfrostKey
export const canMoralis   = (c: WalletConfig) => hasProxy(c) || !!c.moralisKey
export const canOpensea   = (c: WalletConfig) => hasProxy(c) || !!c.openseaKey

// ─── URL-embedded-key providers (Alchemy, Helius) ─────────────────────────────

/** Alchemy JSON-RPC endpoint for a network slug (e.g. 'eth-mainnet'). */
export function alchemyRpcUrl(network: string, config: WalletConfig): string {
  const base = proxyBase(config)
  return base ? `${base}/rpc/alchemy/${network}` : `https://${network}.g.alchemy.com/v2/${config.alchemyKey}`
}

/** Alchemy NFT v3 base for a network slug. Callers append `/getNFTsForOwner?…`. */
export function alchemyNftBase(network: string, config: WalletConfig): string {
  const base = proxyBase(config)
  return base ? `${base}/alchemy-nft/${network}` : `https://${network}.g.alchemy.com/nft/v3/${config.alchemyKey}`
}

/** Helius (Solana) JSON-RPC endpoint. */
export function heliusRpcUrl(config: WalletConfig): string {
  const base = proxyBase(config)
  return base ? `${base}/rpc/helius` : `https://mainnet.helius-rpc.com/?api-key=${config.heliusKey}`
}

/**
 * Helius enhanced REST API (api.helius.xyz — distinct host from the RPC). `path`
 * is everything after the host (e.g. `v0/addresses/<addr>/transactions?limit=10`),
 * WITHOUT the api-key — the proxy/direct path adds it.
 */
export function heliusApiFetch(path: string, config: WalletConfig, timeoutMs = 12_000): Promise<Response> {
  const base = proxyBase(config)
  if (base) return fetch(`${base}/helius-api/${path}`, { signal: AbortSignal.timeout(timeoutMs) })
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

/** Tatum gateway JSON-RPC POST (gateway = 'polkadot' | 'bitcoin'). */
export function tatumFetch(gateway: string, body: unknown, config: WalletConfig, timeoutMs = 10_000): Promise<Response> {
  const base = proxyBase(config)
  const url = base ? `${base}/rpc/tatum/${gateway}` : `https://${gateway}-mainnet.gateway.tatum.io`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (!base) headers['x-api-key'] = config.tatumKey
  return fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
}

/**
 * Blockfrost request. `path` is everything after `/api/v0/` (e.g. `assets/<unit>`
 * or `tx/submit`). Defaults to GET; pass `init` for POST (e.g. CBOR tx submit).
 */
export function blockfrostFetch(path: string, config: WalletConfig, timeoutMs = 10_000, init?: RequestInit): Promise<Response> {
  const base = proxyBase(config)
  const url = base ? `${base}/blockfrost/${path}` : `https://cardano-mainnet.blockfrost.io/api/v0/${path}`
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) }
  if (!base) headers['project_id'] = config.blockfrostKey
  return fetch(url, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) })
}

/** Moralis GET. `path` is everything after `/api/v2.2/` (e.g. `<addr>/nft?chain=0x8f`). */
export function moralisFetch(path: string, config: WalletConfig, timeoutMs = 15_000): Promise<Response> {
  const base = proxyBase(config)
  const url = base ? `${base}/moralis/${path}` : `https://deep-index.moralis.io/api/v2.2/${path}`
  const headers: Record<string, string> = { accept: 'application/json' }
  if (!base) headers['X-API-Key'] = config.moralisKey
  return fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
}

/** OpenSea v2 GET. `path` is everything after `/api/v2/` (e.g. `collections/<slug>/stats`). */
export function openseaFetch(path: string, config: WalletConfig, timeoutMs = 8_000): Promise<Response> {
  const base = proxyBase(config)
  const url = base ? `${base}/opensea/${path}` : `https://api.opensea.io/api/v2/${path}`
  const headers: Record<string, string> = { accept: 'application/json' }
  if (!base) headers['x-api-key'] = config.openseaKey
  return fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
}
