/**
 * fetch-guard.ts — hybrid fetch router (Android)
 *
 * v1 enabled CapacitorHttp's global fetch patch, funneling EVERY request over
 * the native bridge. That bypasses WebView CORS (needed for some hosts) but
 * each call pays plugin-bridge marshalling, and the portfolio's ~dozens of
 * parallel requests serialized into a visibly slow load — desktop/extension
 * fetch in parallel with HTTP/2 and none of that overhead.
 *
 * v2 (this file): the WebView's own fetch is the DEFAULT — fast, parallel,
 * streamed, honors AbortSignal natively. It works for every host that grants
 * CORS to the app's fixed origin (https://localhost):
 *   - the Cloudflare Worker (reflects app origins since swap-proxy.js
 *     reflectAppOrigin — that's where most portfolio traffic goes)
 *   - the public APIs that send Access-Control-Allow-Origin: *
 * Only requests to OTHER cross-origin hosts (TronGrid, Koios, Subscan,
 * Binance RPC, …) drop to the native bridge via CapacitorHttp.request(),
 * wrapped back into a standard Response — with the AbortSignal race
 * re-implemented, since the native layer ignores signals.
 *
 * The global CapacitorHttp fetch patch is now DISABLED in capacitor.config.ts;
 * this wrapper is the only fetch indirection.
 */

import { CapacitorHttp } from '@capacitor/core'

// Hosts safe for direct WebView fetch. The Worker reflects the app origin;
// the rest are public APIs that serve Access-Control-Allow-Origin: * (verified
// against real browser usage). Anything NOT listed silently takes the native
// path, so a wrong guess degrades to v1 behavior — never to a broken request.
const BROWSER_HOSTS = new Set([
  'magicmoney-swap-proxy.guildfordking.workers.dev',
  'api.coingecko.com',
  'api.dexscreener.com',
  'mempool.space',
  'blockstream.info',
  'api.github.com',
  // Verified 2026-07-13 (curl with Origin: https://localhost):
  'rpc.monad.xyz',              // reflects origin (Monad token reads + dApp RPC)
  'rpc1.monad.xyz',             // reflects origin
  'rpc2.monad.xyz',             // reflects origin  (rpc-mainnet.monadinfra.com sends empty ACAO — native)
  'coins.llama.fi',             // * (DefiLlama price backfill in enrichWithPrices)
  'api.trongrid.io',            // *
  'apilist.tronscanapi.com',    // *
  'api.blockcypher.com',        // *
  'api-mainnet.magiceden.dev',  // reflects origin (NFT floors)
  // api.koios.rest sends NO ACAO — stays on the native path.
])

const NULL_BODY_STATUS = new Set([101, 204, 205, 304])

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function normalizeHeaders(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!h) return out
  if (h instanceof Headers) { h.forEach((v, k) => { out[k] = v }); return out }
  if (Array.isArray(h)) { for (const [k, v] of h) out[k] = v; return out }
  return { ...h }
}

function headerGet(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase()
  for (const k of Object.keys(headers)) if (k.toLowerCase() === lower) return headers[k]
  return undefined
}

/** Drop hop-by-hop/encoding headers — the native layer already decoded the body. */
function sanitizeResponseHeaders(h: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(h ?? {})) {
    const lower = k.toLowerCase()
    if (lower === 'content-encoding' || lower === 'content-length' || lower === 'transfer-encoding') continue
    out[k] = String(v)
  }
  return out
}

async function nativeRequest(input: RequestInfo | URL, init: RequestInit | undefined, url: string): Promise<Response> {
  const req = input instanceof Request ? input : undefined
  const method = (init?.method ?? req?.method ?? 'GET').toUpperCase()
  const headers = normalizeHeaders(init?.headers ?? req?.headers)
  const signal = init?.signal ?? req?.signal

  const rawBody = init?.body
  if (rawBody != null && typeof rawBody !== 'string') {
    // No current caller sends binary bodies to a native-path host; refuse
    // loudly instead of silently corrupting the payload over the bridge.
    throw new TypeError('MagicMoney native HTTP path supports string bodies only')
  }
  // CapacitorHttp wants JSON payloads as objects (it re-serializes them).
  let data: unknown = rawBody ?? undefined
  if (typeof rawBody === 'string' && (headerGet(headers, 'Content-Type') ?? '').includes('application/json')) {
    try { data = JSON.parse(rawBody) } catch { /* send the raw string */ }
  }

  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
  }

  const call = CapacitorHttp.request({ url, method, headers, data, responseType: 'text' }).then(r => {
    if (typeof r.status !== 'number' || r.status < 200 || r.status > 599) {
      throw new TypeError(`Network request failed (${url})`)
    }
    const text = typeof r.data === 'string' ? r.data : r.data == null ? '' : JSON.stringify(r.data)
    return new Response(NULL_BODY_STATUS.has(r.status) ? null : text, {
      status: r.status,
      headers: sanitizeResponseHeaders(r.headers),
    })
  })

  if (!signal) return call

  // Re-arm AbortSignal semantics: reject the JS promise when the signal fires
  // (the native request may still complete in the background — discarded).
  return new Promise<Response>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    call.then(
      v => { signal.removeEventListener('abort', onAbort); resolve(v) },
      e => { signal.removeEventListener('abort', onAbort); reject(e) }
    )
  })
}

export function installFetchGuard(): void {
  const browserFetch = window.fetch.bind(window)

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input)

    // Relative / same-origin (app assets) and CORS-friendly hosts → the fast path.
    let host: string | null = null
    try { host = new URL(url, window.location.href).host } catch { /* leave null */ }
    const sameOrigin = host === null || host === window.location.host

    if (sameOrigin || (host && BROWSER_HOSTS.has(host))) {
      return browserFetch(input, init)
    }
    return nativeRequest(input, init, url)
  }) as typeof window.fetch
}
