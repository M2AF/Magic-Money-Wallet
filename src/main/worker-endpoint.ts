/**
 * worker-endpoint.ts — where the MagicMoney Worker lives. One source of truth
 * for the config defaults (Electron, extension, Capacitor), the swap-proxy host
 * allowlist, the read cache, the Android fetch router and the desktop CSP.
 *
 * WHY A CUSTOM DOMAIN
 *
 * Every request that reaches the Worker counts against its daily quota, even
 * one its own rate limiter rejects. A Cloudflare rate-limiting rule stops abuse
 * BEFORE the Worker runs, but those rules belong to a zone — a workers.dev
 * address has none. So the wallet talks to api.magicmoney.dev, which has the
 * rule; workers.dev stays allowed for installs that predate the move.
 */

export const WORKER_URL = 'https://api.magicmoney.dev'
export const LEGACY_WORKER_URL = 'https://magicmoney-swap-proxy.guildfordking.workers.dev'

/** Hosts trusted as the swap proxy (its answers become calldata the wallet signs). */
export const WORKER_HOSTS: readonly string[] = [
  new URL(WORKER_URL).hostname,
  new URL(LEGACY_WORKER_URL).hostname,
]

/** The public client tag the Worker's clientOk() expects (config.clientToken's default). */
export const CLIENT_TAG = 'magicmoney-wallet-v1'

export interface MidnightEndpoints {
  indexerHttp: string
  indexerWs: string
  nodeRpc: string
  nodeRpcWs: string
}

/**
 * Midnight indexer + node endpoints.
 *
 * Mainnet goes through the Worker's /midnight/* routes, which add the
 * Blockfrost project key: Midnight's own indexer was decommissioned on
 * 2026-10-09 (HTTP 410) and Blockfrost needs a key the client must never hold.
 * The Midnight SDK opens these as plain URLs/WebSockets (no custom headers), so
 * the client tag rides as ?mm_client=.
 *
 * Preprod has no Blockfrost key configured yet; its Midnight-hosted endpoints
 * were also shut down on 2026-10-09, so Testnet-mode Midnight stays unavailable.
 */
export function midnightEndpoints(network: 'mainnet' | 'preprod'): MidnightEndpoints {
  if (network === 'preprod') {
    return {
      indexerHttp: 'https://indexer.preprod.midnight.network/api/v4/graphql',
      indexerWs: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
      nodeRpc: 'https://rpc.preprod.midnight.network',
      nodeRpcWs: 'wss://rpc.preprod.midnight.network',
    }
  }
  const tagged = (path: string, ws = false) => {
    const u = new URL(`${WORKER_URL}${path}`)
    if (ws) u.protocol = 'wss:'
    u.searchParams.set('mm_client', CLIENT_TAG)
    return u.toString()
  }
  return {
    indexerHttp: tagged('/midnight/indexer'),
    indexerWs: tagged('/midnight/indexer/ws', true),
    nodeRpc: tagged('/midnight/rpc'),
    nodeRpcWs: tagged('/midnight/rpc/ws', true),
  }
}

/**
 * A saved config written by an older version holds the legacy default. Move it
 * to the current one; leave every other value (including '' = no proxy) alone.
 */
export function migrateWorkerUrl(url: string | undefined): string | undefined {
  return url?.trim().replace(/\/+$/, '') === LEGACY_WORKER_URL ? WORKER_URL : url
}
