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

/**
 * A saved config written by an older version holds the legacy default. Move it
 * to the current one; leave every other value (including '' = no proxy) alone.
 */
export function migrateWorkerUrl(url: string | undefined): string | undefined {
  return url?.trim().replace(/\/+$/, '') === LEGACY_WORKER_URL ? WORKER_URL : url
}
