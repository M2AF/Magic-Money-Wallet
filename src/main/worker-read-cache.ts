/**
 * worker-read-cache.ts — a short read cache and in-flight de-duplication in
 * front of the MagicMoney Worker. Platform-free: installed by the Electron main
 * process, the extension service worker, and the Capacitor (Android/iOS) entry.
 *
 * WHY
 *
 * The Worker is on the Cloudflare free plan: 100,000 requests a day, and EVERY
 * request that reaches it counts — including the ones its own rate limiter
 * rejects. A wallet load fans out to ~110 Worker calls, and on 2026-10-11 two
 * things were measured: a reload a few seconds later re-sent all 112 requests
 * byte-for-byte, and within one load only 87 of 112 were distinct (one route
 * was asked the same question 16 times). So repeated opens/refreshes — the cheap
 * kind of abuse — cost the full fan-out every time.
 *
 * WHAT IT DOES
 *
 *   - Identical concurrent requests share one network call.
 *   - A successful answer to a whitelisted READ is reused for READ_TTL_MS.
 *   - Any send clears the whole cache, so a balance read after a send is fresh.
 *
 * WHAT IT NEVER CACHES (this list is the safety contract — see the test)
 *
 *   Nonces, eth_call, gas estimates and receipts: the swap executor's
 *   read-after-write checks (allowance visible after approve, explicit nonce
 *   floor) need them fresh. Sends. Swap quotes and status, exchange routes,
 *   profile/db routes, and anything not on the whitelist below. Non-2xx answers
 *   and JSON-RPC error bodies are never stored either.
 */

import { WORKER_HOSTS } from './worker-endpoint'

/** Hosts this cache fronts (current and legacy Worker addresses). */
const CACHED_HOSTS = new Set<string>(WORKER_HOSTS)

export const READ_TTL_MS = 30_000
const MAX_ENTRIES = 500

/** JSON-RPC methods whose answers may be ~30 s stale. Anything else is passed through. */
const CACHEABLE_RPC = new Set([
  'eth_getBalance',
  'alchemy_getTokenBalances',
  'alchemy_getTokenMetadata',
  'alchemy_getAssetTransfers',
  'getBalance',
  'getTokenAccountsByOwner',
  'getParsedTokenAccountsByOwner',
  'getSignaturesForAddress',
  'getAssetsByOwner',
  'state_getStorage', // Polkadot free balance (Tatum)
])

/** Methods that move funds: seeing one clears the cache. */
const SEND_RPC = new Set([
  'eth_sendRawTransaction',
  'eth_sendTransaction',
  'sendTransaction',
])

/** Non-RPC Worker routes that are plain reads of public chain/market data. */
const CACHEABLE_PATH = /^\/(alchemy-data|alchemy-nft|helius-api|moralis|blockfrost|ordinals|tokens|market)(\/|$)/

/** TRON HTTP API (/rpc/alchemy-tron/…): account and TRC-20 balance reads, and the one send. */
const TRON_READ = /^\/rpc\/alchemy-tron\/wallet\/(getaccount|triggerconstantcontract)$/
const TRON_SEND = /^\/rpc\/alchemy-tron\/wallet\/broadcasttransaction$/

type FetchFn = typeof fetch

interface Stored { status: number; statusText: string; headers: [string, string][]; body: ArrayBuffer }

function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

function rpcMethods(body: string): string[] | null {
  try {
    const j = JSON.parse(body)
    const calls = Array.isArray(j) ? j : [j]
    const methods = calls.map(c => (c && typeof c.method === 'string' ? c.method : ''))
    return methods.every(Boolean) ? methods : null
  } catch {
    return null
  }
}

/** Cache key with JSON-RPC ids stripped, so two callers asking the same thing match. */
function rpcKey(body: string): string {
  try {
    const j = JSON.parse(body)
    const strip = (c: { method?: unknown; params?: unknown }) => ({ method: c.method, params: c.params })
    return JSON.stringify(Array.isArray(j) ? j.map(strip) : strip(j))
  } catch {
    return body
  }
}

/** Re-number a cached JSON-RPC answer with the CURRENT caller's ids. */
function withIds(text: string, requestBody: string): string {
  try {
    const req = JSON.parse(requestBody)
    const res = JSON.parse(text)
    if (Array.isArray(req) && Array.isArray(res) && req.length === res.length) {
      return JSON.stringify(res.map((r, i) => ({ ...r, id: req[i]?.id })))
    }
    if (!Array.isArray(req) && res && typeof res === 'object' && !Array.isArray(res)) {
      return JSON.stringify({ ...res, id: req?.id })
    }
  } catch { /* fall through */ }
  return text
}

function rpcFailed(text: string): boolean {
  try {
    const j = JSON.parse(text)
    return (Array.isArray(j) ? j : [j]).some(r => r && r.error != null)
  } catch {
    return true
  }
}

/** Settle with `job`, or reject with the caller's abort reason if its signal fires first. */
function raceSignal<T>(job: Promise<T>, signal: AbortSignal | null): Promise<T> {
  if (!signal) return job
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    job.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export interface WorkerReadCache {
  fetch: FetchFn
  clear(): void
  /** For tests and diagnostics. */
  stats(): { hits: number; misses: number; shared: number; entries: number }
}

/**
 * Wrap a fetch implementation. Requests that are not to a Worker host, not a
 * cacheable read, or carry a non-string body go straight to `inner`.
 */
export function createWorkerReadCache(inner: FetchFn, now: () => number = Date.now): WorkerReadCache {
  const store = new Map<string, { at: number; value: Stored }>()
  const pending = new Map<string, Promise<Stored>>()
  let hits = 0, misses = 0, shared = 0

  const toResponse = (s: Stored, body?: string): Response =>
    new Response(body ?? s.body.slice(0), { status: s.status, statusText: s.statusText, headers: s.headers })

  const wrapped: FetchFn = async (input, init) => {
    const url = urlOf(input)
    let parsed: URL
    try { parsed = new URL(url) } catch { return inner(input, init) }
    if (!CACHED_HOSTS.has(parsed.hostname)) return inner(input, init)

    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const body = typeof init?.body === 'string' ? init.body : null
    const isRpc = parsed.pathname.startsWith('/rpc/') && !parsed.pathname.startsWith('/rpc/alchemy-tron')

    let key: string | null = null
    if (TRON_SEND.test(parsed.pathname)) { store.clear(); return inner(input, init) }
    if (TRON_READ.test(parsed.pathname) && method === 'POST' && body != null) {
      key = `POST ${parsed.href} ${body}`
    } else if (isRpc && method === 'POST' && body != null) {
      const methods = rpcMethods(body)
      if (methods?.some(m => SEND_RPC.has(m))) { store.clear(); return inner(input, init) }
      if (methods && methods.every(m => CACHEABLE_RPC.has(m))) key = `POST ${parsed.href} ${rpcKey(body)}`
    } else if (!isRpc && CACHEABLE_PATH.test(parsed.pathname) && (method === 'GET' || (method === 'POST' && body != null))) {
      key = `${method} ${parsed.href} ${body ?? ''}`
    }
    if (key == null || init?.signal?.aborted) return inner(input, init)

    const hit = store.get(key)
    if (hit && now() - hit.at < READ_TTL_MS) {
      hits++
      return isRpc && body ? toResponse(hit.value, withIds(new TextDecoder().decode(hit.value.body), body)) : toResponse(hit.value)
    }

    let job = pending.get(key)
    if (job) shared++
    else {
      misses++
      // The shared call ignores any one caller's AbortSignal: aborting it would
      // fail every other caller waiting on the same answer. Each caller still
      // gets its own abort below.
      const { signal: _signal, ...rest } = init ?? {}
      job = inner(input, rest).then(async res => {
        const headers: [string, string][] = []
        res.headers.forEach((v, k) => { headers.push([k, v]) })
        const value: Stored = { status: res.status, statusText: res.statusText, headers, body: await res.arrayBuffer() }
        const okToKeep = res.ok && !(isRpc && rpcFailed(new TextDecoder().decode(value.body)))
        if (okToKeep) {
          if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value as string)
          store.set(key!, { at: now(), value })
        }
        return value
      }).finally(() => pending.delete(key!))
      pending.set(key, job)
    }
    const value = await raceSignal(job, init?.signal ?? null)
    return isRpc && body ? toResponse(value, withIds(new TextDecoder().decode(value.body), body)) : toResponse(value)
  }

  return {
    fetch: wrapped,
    clear: () => store.clear(),
    stats: () => ({ hits, misses, shared, entries: store.size }),
  }
}

let installed: WorkerReadCache | null = null

/**
 * Put the cache in front of globalThis.fetch for this process/realm. Idempotent.
 * Call it once at startup, before anything reads from the Worker.
 */
export function installWorkerReadCache(): WorkerReadCache {
  if (installed) return installed
  installed = createWorkerReadCache(globalThis.fetch.bind(globalThis))
  globalThis.fetch = installed.fetch
  return installed
}
