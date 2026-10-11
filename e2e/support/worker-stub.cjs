// Keeps every e2e run off the LIVE MagicMoney Worker.
//
// WHY: the Worker is on the Cloudflare free plan (100k requests/day), and a
// wallet load fans out to ~130 Worker calls (balances on every chain, tokens,
// NFTs, prices). The suite creates dozens of wallets per run, so CI plus local
// runs exhausted the daily quota on 2026-10-11 and every real user got
// `error code: 1027` until midnight UTC. Tests also passed or failed with
// whatever production returned that minute.
//
// The answers below are an EMPTY wallet: zero balances, no tokens, no NFTs, no
// market rows. They are shaped like the real responses so production code takes
// its normal path instead of its provider-failure fallbacks (which would reach
// public RPCs and make runs slow and flaky). Anything not recognised gets a fast
// 503, which the wallet already treats as "provider unavailable". Specs that
// need real-looking data keep stubbing it themselves at the bridge or with their
// own ctx.route — a route registered later takes precedence over this one.
//
// Used by e2e/electron-wrapper.cjs (desktop app, main + renderer) and by
// stubWorker() in worker-stub-browser.ts (extension specs).

// Current custom domain and the legacy workers.dev address (src/main/worker-endpoint.ts).
const WORKER_HOST = /^(api\.magicmoney\.dev|magicmoney-swap-proxy\.[a-z0-9-]+\.workers\.dev)$/i

function isWorkerUrl(url) {
  try { return WORKER_HOST.test(new URL(url).hostname) } catch { return false }
}

/** A JSON-RPC result that reads as "nothing here" for the methods a load uses. */
function rpcResult(method) {
  switch (method) {
    case 'alchemy_getTokenBalances': return { address: null, tokenBalances: [] }
    case 'alchemy_getTokenMetadata': return { name: null, symbol: null, decimals: null, logo: null }
    // Solana (Helius)
    case 'getBalance': return { context: { slot: 0 }, value: 0 }
    case 'getTokenAccountsByOwner':
    case 'getParsedTokenAccountsByOwner': return { context: { slot: 0 }, value: [] }
    case 'getSignaturesForAddress': return []
    case 'getAssetsByOwner': return { total: 0, limit: 0, page: 1, items: [] }
    default: return '0x0'
  }
}

function rpcReply(bodyText) {
  let body
  try { body = JSON.parse(bodyText || 'null') } catch { body = null }
  const one = (call) => ({ jsonrpc: '2.0', id: call && call.id != null ? call.id : 1, result: rpcResult(call && call.method) })
  return Array.isArray(body) ? body.map(one) : one(body)
}

/**
 * The canned answer for one Worker request: { status, body } with body already
 * a JSON string.
 */
function workerStubResponse(url, method, bodyText) {
  let path = '/'
  try { path = new URL(url).pathname } catch { /* keep '/' */ }
  const json = (status, value) => ({ status, body: JSON.stringify(value) })

  if (path.startsWith('/rpc/alchemy-tron')) return json(200, {})
  if (path.startsWith('/rpc/')) return json(200, rpcReply(bodyText))
  if (path.startsWith('/alchemy-data/')) return json(200, { data: [], ownedNfts: [], totalCount: 0, pageKey: null })
  if (path.startsWith('/alchemy-nft/')) return json(200, { ownedNfts: [], totalCount: 0, pageKey: null })
  if (path.startsWith('/helius-api/')) return json(200, [])
  if (path.startsWith('/moralis/')) return json(200, { result: [], cursor: null, page: 0, page_size: 0 })
  if (path.startsWith('/blockfrost/')) return json(404, { status_code: 404, error: 'Not Found', message: 'e2e stub: unused address' })
  if (path === '/tokens') return json(200, { tokens: [], chain: null, error: null })
  if (path === '/market/top') return json(200, { coins: [], fetchedAt: Date.now() })
  if (path.startsWith('/market/')) return json(200, { coins: [], prices: [], error: null })
  return json(503, { error: 'e2e: the live Worker is blocked in tests' })
}

module.exports = { isWorkerUrl, workerStubResponse }
