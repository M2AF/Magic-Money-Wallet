/**
 * lib.js — shared helpers for the MagicMoney Worker.
 *
 * CORS + JSON responses, a fail-open KV cache (the cross-user quota lever), an
 * approximate per-IP rate limiter, and a lightweight client gate. Imported by
 * swap-proxy.js (the entry) and the read/db route modules.
 */

export function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    // x-mm-client is the (non-secret) client tag checked by clientOk().
    'Access-Control-Allow-Headers': 'Content-Type, x-mm-client',
  }
}

export const json = (env, obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors(env) } })

export const err = (env, message, status = 400) => json(env, { error: message }, status)

export function productionConfigError(env) {
  if (env.ALLOW_INSECURE_DEV === 'true') return null
  if (!env.ALLOWED_ORIGIN || env.ALLOWED_ORIGIN === '*') return 'ALLOWED_ORIGIN must be set to a specific production origin.'
  if (!env.CLIENT_TOKEN) return 'CLIENT_TOKEN must be set before production deploy.'
  if (!env.CACHE) return 'CACHE KV binding is required for production rate limits and replay protection.'
  return null
}

/** Forward an upstream Response back to the client verbatim, with CORS attached. */
export async function passthrough(env, upstream) {
  const body = await upstream.text()
  return new Response(body, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'application/json', ...cors(env) },
  })
}

export function pathParts(pathname) {
  return pathname.split('/').filter(Boolean)
}

// ─── KV cache (env.CACHE) ─────────────────────────────────────────────────────
// Every helper is fail-open: a KV hiccup must NEVER break a wallet read.

export async function cacheGet(env, key) {
  if (!env.CACHE) return null
  try { return await env.CACHE.get(key, 'json') } catch { return null }
}

/**
 * Write-behind cache put. Uses ctx.waitUntil so the network response isn't
 * blocked on the KV write. KV's minimum expirationTtl is 60s.
 */
export function cachePut(env, ctx, key, value, ttlSeconds) {
  if (!env.CACHE) return
  const p = env.CACHE.put(key, JSON.stringify(value), { expirationTtl: Math.max(60, ttlSeconds) }).catch(() => {})
  if (ctx && ctx.waitUntil) ctx.waitUntil(p)
}

// ─── Client gate + rate limit (applied to the NEW routes only) ────────────────

/**
 * Shared client tag. NOT a secret — it ships in the client bundle. It only
 * filters drive-by abuse of the open proxy. Skipped entirely when CLIENT_TOKEN
 * is unset, so the proxy works before the client starts sending the header.
 */
export function clientOk(request, env) {
  if (!env.CLIENT_TOKEN) return true
  const url = new URL(request.url)
  return request.headers.get('x-mm-client') === env.CLIENT_TOKEN || url.searchParams.get('mm_client') === env.CLIENT_TOKEN
}

/**
 * Fixed-window per-IP counter. Approximate and fail-open — this is abuse
 * mitigation, not a hard guarantee. Returns true when the request is allowed.
 *
 * Hybrid memory/KV design to respect the KV free tier's 1,000 writes/day cap
 * (the old write-per-request version exhausted it on its own, which starved
 * every other cache on the Worker):
 *  - Counts live in per-isolate memory; clients under `limit/4` in a window
 *    never touch KV at all (the overwhelming majority of traffic).
 *  - A client that crosses that floor is merged with the cross-isolate KV
 *    count and persisted at most every 25th request, so a real abuser is
 *    still blocked across isolates/colos for pennies of write quota.
 */
const _rlMem = new Map()  // `${bucket}:${ip}:${window}` → in-isolate count

export async function rateLimit(request, env, ctx, { limit = 600, windowSec = 60, bucket = 'rl' } = {}) {
  if (!env.CACHE) return true
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const window = Math.floor(Date.now() / 1000 / windowSec)
  const key = `${bucket}:${ip}:${window}`

  // Bound memory: when the map grows, drop entries from past windows.
  if (_rlMem.size > 5000) {
    for (const k of _rlMem.keys()) if (!k.endsWith(`:${window}`)) _rlMem.delete(k)
  }
  const mem = (_rlMem.get(key) || 0) + 1
  _rlMem.set(key, mem)

  const floor = Math.max(10, Math.floor(limit / 4))
  if (mem < floor) return true  // cold client — zero KV traffic

  let kvCount = 0
  try { kvCount = (await env.CACHE.get(key, 'json')) || 0 } catch { return true }
  const count = Math.max(mem, kvCount + 1)
  if (count >= limit) return false
  if (mem === floor || mem % 25 === 0) cachePut(env, ctx, key, count, windowSec + 5)
  return true
}
