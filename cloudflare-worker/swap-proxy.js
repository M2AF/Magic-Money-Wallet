/**
 * swap-proxy.js — MagicMoney Wallet security proxy (Cloudflare Worker)
 *
 * The wallet client NEVER calls aggregator APIs directly and NEVER holds their
 * API keys. It calls this worker, which injects the key server-side from
 * Cloudflare environment variables and returns a normalized response.
 *
 * Routes
 *   GET  /quote     ?chain&sell&buy&sellSymbol&buySymbol&amount&slippageBps&taker
 *   GET  /tokens    ?chain
 *   GET  /ss/estimate ?from&fromNet&to&toNet&amount&fixed
 *   POST /ss/exchange  { tickerFrom, networkFrom, tickerTo, networkTo, amount, addressTo, ... }
 *   GET  /ss/status/:id
 *   GET  /ss/pairs    ?fixed
 *   GET  /ss/currencies
 *
 * Required env (wrangler secret put …):
 *   ZEROX_API_KEY        — 0x Swap API v2
 *   ONEINCH_API_KEY      — 1inch (EVM fallback)
 *   JUPITER_API_KEY      — Jupiter (optional; public endpoint works keyless)
 *   LIFI_API_KEY         — LI.FI (cross-chain, optional)
 *   SIMPLESWAP_API_KEY   — SimpleSwap v3
 *   ALLOWED_ORIGIN       — optional CORS allowlist (defaults to '*')
 */

const EVM_CHAIN_IDS = {
  ethereum: 1, arbitrum: 42161, optimism: 10, base: 8453,
  polygon: 137, avalanche: 43114, bsc: 56,
}
const NATIVE_EVM = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const NATIVE_SET = new Set([NATIVE_EVM.toLowerCase(), '0x0000000000000000000000000000000000000000'])

function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}
const json = (env, obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors(env) } })
const err = (env, message, status = 400) => json(env, { error: message }, status)

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const { pathname } = url

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env) })

    try {
      if (pathname === '/quote') return await handleQuote(url, env)
      if (pathname === '/tokens') return await handleTokens(url, env)
      if (pathname === '/ss/estimate') return await ssEstimate(url, env)
      if (pathname === '/ss/exchange' && request.method === 'POST') return await ssExchange(request, env)
      if (pathname.startsWith('/ss/status/')) return await ssStatus(pathname.split('/').pop(), env)
      if (pathname === '/ss/pairs') return await ssPassthrough('pairs', url, env)
      if (pathname === '/ss/currencies') return await ssPassthrough('currencies', url, env)
      return err(env, 'Not found', 404)
    } catch (e) {
      return err(env, e && e.message ? e.message : 'Proxy error', 500)
    }
  },
}

// ─── DEX quote routing ────────────────────────────────────────────────────────

async function handleQuote(url, env) {
  const q = Object.fromEntries(url.searchParams)
  const chain = (q.chain || '').toLowerCase()
  if (!q.sell || !q.buy || !q.amount || !q.taker) return err(env, 'Missing quote parameters.')

  if (chain in EVM_CHAIN_IDS) {
    const primary = await zeroExQuote(chain, q, env).catch(e => ({ _error: e.message }))
    if (primary && !primary._error) return json(env, { quote: primary, error: null })
    const fb = await oneInchQuote(chain, q, env).catch(e => ({ _error: e.message }))
    if (fb && !fb._error) return json(env, { quote: fb, error: null })
    return json(env, { quote: null, error: (fb && fb._error) || (primary && primary._error) || 'No EVM route.' })
  }

  if (chain === 'solana') {
    const jup = await jupiterQuote(q, env).catch(e => ({ _error: e.message }))
    if (jup && !jup._error) return json(env, { quote: jup, error: null })
    return json(env, { quote: null, error: (jup && jup._error) || 'No Solana route.' })
  }

  if (chain === 'cardano') {
    const m = await muesliQuote(q, env).catch(e => ({ _error: e.message }))
    if (m && !m._error) return json(env, { quote: m, error: null })
    return json(env, { quote: null, error: (m && m._error) || 'No Cardano route.' })
  }

  return err(env, `Unsupported chain: ${chain}`)
}

// 0x Swap API v2 (allowance-holder). Docs: https://0x.org/docs/api
async function zeroExQuote(chain, q, env) {
  if (!env.ZEROX_API_KEY) throw new Error('0x key not configured')
  const chainId = EVM_CHAIN_IDS[chain]
  const params = new URLSearchParams({
    chainId: String(chainId),
    sellToken: q.sell,
    buyToken: q.buy,
    sellAmount: q.amount,
    taker: q.taker,
    slippageBps: q.slippageBps || '50',
  })
  const res = await fetch(`https://api.0x.org/swap/allowance-holder/quote?${params}`, {
    headers: { '0x-api-key': env.ZEROX_API_KEY, '0x-version': 'v2' },
  })
  const d = await res.json()
  if (!res.ok) throw new Error(d.reason || d.message || `0x ${res.status}`)
  if (!d.liquidityAvailable) throw new Error('0x: no liquidity')

  // Approval: 0x v2 surfaces an allowance issue with the spender to approve.
  let approvalTx = null
  const spender = d.issues && d.issues.allowance && d.issues.allowance.spender
  if (spender && !NATIVE_SET.has(q.sell.toLowerCase())) {
    approvalTx = { to: q.sell, data: erc20ApproveData(spender), value: '0x0' }
  }

  const sellAmt = Number(q.amount), buyAmt = Number(d.buyAmount)
  return {
    provider: '0x',
    fromChain: chain, toChain: chain,
    fromTokenAddress: q.sell, toTokenAddress: q.buy,
    fromTokenSymbol: q.sellSymbol || '', toTokenSymbol: q.buySymbol || '',
    sellAmountRaw: q.amount, buyAmountRaw: String(d.buyAmount),
    estimatedGasRaw: String((d.transaction && d.transaction.gas) || '0'),
    slippageBps: Number(q.slippageBps || 50),
    priceImpactPct: d.priceImpactPct != null ? Number(d.priceImpactPct) : 0,
    rate: sellAmt > 0 ? buyAmt / sellAmt : 0,
    expiresAt: Date.now() + 30_000,
    txData: {
      to: d.transaction && d.transaction.to,
      data: d.transaction && d.transaction.data,
      value: (d.transaction && d.transaction.value) || '0',
    },
    approvalTx,
  }
}

// 1inch Swap API v6 (EVM fallback). Docs: https://portal.1inch.dev
async function oneInchQuote(chain, q, env) {
  if (!env.ONEINCH_API_KEY) throw new Error('1inch key not configured')
  const chainId = EVM_CHAIN_IDS[chain]
  const params = new URLSearchParams({
    src: q.sell, dst: q.buy, amount: q.amount, from: q.taker,
    slippage: String(Number(q.slippageBps || 50) / 100), disableEstimate: 'true',
  })
  const res = await fetch(`https://api.1inch.dev/swap/v6.0/${chainId}/swap?${params}`, {
    headers: { Authorization: `Bearer ${env.ONEINCH_API_KEY}`, accept: 'application/json' },
  })
  const d = await res.json()
  if (!res.ok) throw new Error(d.description || d.error || `1inch ${res.status}`)

  let approvalTx = null
  if (!NATIVE_SET.has(q.sell.toLowerCase())) {
    // 1inch exposes the router via /approve/spender; encode max approve to it.
    const sp = await fetch(`https://api.1inch.dev/swap/v6.0/${chainId}/approve/spender`, {
      headers: { Authorization: `Bearer ${env.ONEINCH_API_KEY}`, accept: 'application/json' },
    }).then(r => r.json()).catch(() => null)
    if (sp && sp.address) approvalTx = { to: q.sell, data: erc20ApproveData(sp.address), value: '0x0' }
  }

  const sellAmt = Number(q.amount), buyAmt = Number(d.dstAmount)
  return {
    provider: '1inch',
    fromChain: chain, toChain: chain,
    fromTokenAddress: q.sell, toTokenAddress: q.buy,
    fromTokenSymbol: q.sellSymbol || '', toTokenSymbol: q.buySymbol || '',
    sellAmountRaw: q.amount, buyAmountRaw: String(d.dstAmount),
    estimatedGasRaw: String((d.tx && d.tx.gas) || '0'),
    slippageBps: Number(q.slippageBps || 50),
    priceImpactPct: 0,
    rate: sellAmt > 0 ? buyAmt / sellAmt : 0,
    expiresAt: Date.now() + 30_000,
    txData: { to: d.tx && d.tx.to, data: d.tx && d.tx.data, value: (d.tx && d.tx.value) || '0' },
    approvalTx,
  }
}

// Jupiter Swap API v1. Keyed host: api.jup.ag; free host: lite-api.jup.ag.
// Docs: https://dev.jup.ag/docs/swap-api
async function jupiterQuote(q, env) {
  const base = env.JUPITER_API_KEY ? 'https://api.jup.ag' : 'https://lite-api.jup.ag'
  const headers = env.JUPITER_API_KEY ? { 'x-api-key': env.JUPITER_API_KEY } : {}
  const params = new URLSearchParams({
    inputMint: q.sell, outputMint: q.buy, amount: q.amount,
    slippageBps: q.slippageBps || '50',
  })
  const quoteRes = await fetch(`${base}/swap/v1/quote?${params}`, { headers })
  const quote = await quoteRes.json()
  if (!quoteRes.ok || !quote.outAmount) throw new Error(quote.error || `Jupiter ${quoteRes.status}`)

  const swapRes = await fetch(`${base}/swap/v1/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey: q.taker, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
  })
  const swap = await swapRes.json()
  if (!swapRes.ok || !swap.swapTransaction) throw new Error(swap.error || `Jupiter swap ${swapRes.status}`)

  const sellAmt = Number(q.amount), buyAmt = Number(quote.outAmount)
  return {
    provider: 'jupiter',
    fromChain: 'solana', toChain: 'solana',
    fromTokenAddress: q.sell, toTokenAddress: q.buy,
    fromTokenSymbol: q.sellSymbol || '', toTokenSymbol: q.buySymbol || '',
    sellAmountRaw: q.amount, buyAmountRaw: String(quote.outAmount),
    estimatedGasRaw: '5000',
    slippageBps: Number(q.slippageBps || 50),
    priceImpactPct: quote.priceImpactPct != null ? Number(quote.priceImpactPct) : 0,
    rate: sellAmt > 0 ? buyAmt / sellAmt : 0,
    expiresAt: Date.now() + 20_000,
    txData: { swapTransaction: swap.swapTransaction },
    approvalTx: null,
  }
}

// MuesliSwap (Cardano). Returns unsigned CBOR for the wallet to sign+submit.
async function muesliQuote(_q, _env) {
  // Endpoint shape varies; left as an explicit stub until Cardano signing is wired.
  throw new Error('Cardano DEX routing not yet enabled')
}

// ─── Token lists ────────────────────────────────────────────────────────────

async function handleTokens(url, env) {
  const chain = (url.searchParams.get('chain') || '').toLowerCase()
  // The wallet ships a curated fallback list; this route exists for parity and
  // future dynamic lists. Return empty so the client uses its built-in list.
  return json(env, { tokens: [], chain, error: null })
}

// ─── SimpleSwap passthrough (key injection) ──────────────────────────────────

const SS = 'https://api.simpleswap.io/v3'
function ssKey(env) {
  if (!env.SIMPLESWAP_API_KEY) throw new Error('SimpleSwap key not configured')
  return env.SIMPLESWAP_API_KEY
}

async function ssEstimate(url, env) {
  const p = url.searchParams
  const params = new URLSearchParams({
    tickerFrom: p.get('from') || '', networkFrom: p.get('fromNet') || '',
    tickerTo: p.get('to') || '', networkTo: p.get('toNet') || '',
    amount: p.get('amount') || '', fixed: p.get('fixed') || 'false', reverse: 'false',
  })
  const res = await fetch(`${SS}/estimates?${params}`, { headers: { 'x-api-key': ssKey(env) } })
  return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json', ...cors(env) } })
}

async function ssExchange(request, env) {
  const body = await request.json()
  const res = await fetch(`${SS}/exchanges`, {
    method: 'POST',
    headers: { 'x-api-key': ssKey(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json', ...cors(env) } })
}

async function ssStatus(id, env) {
  const res = await fetch(`${SS}/exchanges/${encodeURIComponent(id)}`, { headers: { 'x-api-key': ssKey(env) } })
  return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json', ...cors(env) } })
}

async function ssPassthrough(path, url, env) {
  const qs = url.searchParams.toString()
  const res = await fetch(`${SS}/${path}${qs ? `?${qs}` : ''}`, { headers: { 'x-api-key': ssKey(env) } })
  return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json', ...cors(env) } })
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// ERC-20 approve(spender, 2^256-1) calldata — 0x095ea7b3 + spender + max uint256.
function erc20ApproveData(spender) {
  const addr = spender.toLowerCase().replace(/^0x/, '').padStart(64, '0')
  const max = 'f'.repeat(64)
  return `0x095ea7b3${addr}${max}`
}
