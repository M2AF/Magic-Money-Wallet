/**
 * midnight.js — Midnight mainnet indexer + node RPC through Blockfrost.
 *
 * WHY
 *
 * Midnight's public indexer (indexer.mainnet.midnight.network) was
 * decommissioned on 2026-10-09 and answers HTTP 410; the indexer and RPC are now
 * provided by Blockfrost, which needs a per-network project token
 * (MIDNIGHT_BLOCKFROST_KEY, a `nightmainnet…` id). The token stays here: the
 * wallet and dApps talk to these routes, the Worker adds the key upstream.
 *
 * ROUTES (mainnet only — there is no Preprod token yet)
 *
 *   POST /midnight/indexer      GraphQL queries/mutations
 *   GET  /midnight/indexer/ws   GraphQL subscriptions (WebSocket upgrade)
 *   POST /midnight/rpc          node JSON-RPC
 *   GET  /midnight/rpc/ws       node JSON-RPC over WebSocket (tx relay)
 *
 * The Midnight SDK and browser WebSockets cannot set headers, so the client tag
 * may arrive as ?mm_client= (clientOk accepts both) and the key goes upstream
 * as ?project_id=. Answers carry `Access-Control-Allow-Origin: *`: the wallet's
 * dApp connector hands these URLs to Midnight dApps, and the data is public
 * chain data. Per-IP rate limiting bounds what any one caller can spend.
 */
import { clientOk, rateLimit, pathParts } from './lib.js'

const INDEXER = 'https://midnight-mainnet.blockfrost.io/api/v0'
const RPC = 'https://rpc.midnight-mainnet.blockfrost.io'

const OPEN_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-mm-client',
}
const fail = (message, status) =>
  new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json', ...OPEN_CORS } })

/** Returns a Response for /midnight/*, or null for any other path. */
export async function handleMidnight(request, url, env, ctx) {
  const parts = pathParts(url.pathname)
  if (parts[0] !== 'midnight') return null
  if (request.method === 'OPTIONS') return new Response(null, { headers: OPEN_CORS })

  if (!clientOk(request, env)) return fail('Forbidden', 403)
  const limit = Number(env.MIDNIGHT_RPM) || 600
  if (!(await rateLimit(request, env, ctx, { limit, windowSec: 60, bucket: 'midnight' }))) return fail('Rate limited', 429)
  if (!env.MIDNIGHT_BLOCKFROST_KEY) return fail('Midnight indexer key not configured', 503)

  const target = parts[1] === 'indexer' ? INDEXER : parts[1] === 'rpc' ? RPC : null
  if (!target || parts.length > 3 || (parts[2] !== undefined && parts[2] !== 'ws')) return fail('Not found', 404)

  // WebSocket: hand the upgrade straight to Blockfrost; the 101 response carries
  // the socket back to the caller. Subprotocol headers pass through unchanged.
  if (parts[2] === 'ws') {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return fail('Expected a WebSocket upgrade', 426)
    const upstream = new URL(target === INDEXER ? `${INDEXER}/ws` : RPC)
    upstream.searchParams.set('project_id', env.MIDNIGHT_BLOCKFROST_KEY)
    const headers = new Headers(request.headers)
    headers.delete('x-mm-client')
    try { return await fetch(upstream.href, { headers }) } catch { return fail('Midnight indexer unreachable', 502) }
  }

  if (request.method !== 'POST') return fail('POST only', 405)
  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', project_id: env.MIDNIGHT_BLOCKFROST_KEY },
      body: await request.text(),
    })
    return new Response(await res.text(), {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json', ...OPEN_CORS },
    })
  } catch {
    // This route runs ahead of the router's try/catch (see swap-proxy.js).
    return fail('Midnight indexer unreachable', 502)
  }
}

