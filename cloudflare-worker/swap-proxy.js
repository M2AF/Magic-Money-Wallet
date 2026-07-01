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
 *   LIFI_API_KEY         — LI.FI (cross-chain; OPTIONAL — routing is keyless, key only raises rate limits)
 *   RANGO_API_KEY        — Rango (cross-chain fallback / exotic chains)
 *   SWAPKIT_API_KEY      — SwapKit (THORChain/Maya/Chainflip; native-BTC routes)
 *   SIMPLESWAP_API_KEY   — SimpleSwap v3
 *   CHANGENOW_API_KEY    — ChangeNOW v2 (deposit-address fallback; covers DOT)
 *   ALLOWED_ORIGIN       — optional CORS allowlist (defaults to '*')
 *
 * Fee / monetization vars (non-secret addresses; safe as [vars] or secrets):
 *   FEE_BPS              — affiliate/integrator fee in basis points (default 90 = 0.9%)
 *   FEE_EVM              — EVM fee recipient (0x…)
 *   FEE_SOLANA           — Solana fee referral account (token-referral pubkey)
 *   FEE_CARDANO / FEE_BITCOIN / FEE_POLKADOT — recipients for those chains (cross-chain affiliate)
 *   LIFI_INTEGRATOR      — LI.FI integrator string (required to attribute/collect the fee)
 *   JUPITER_REFERRAL_ACCOUNT — Jupiter referral account; fee skipped when unset
 *   ONEINCH_REFERRER     — 1inch referrer address (defaults to FEE_EVM)
 */

import { cors, json, err, productionConfigError } from './lib.js'
import { handleRead } from './read.js'
import { handleDb } from './db.js'

const EVM_CHAIN_IDS = {
  ethereum: 1, arbitrum: 42161, optimism: 10, base: 8453,
  polygon: 137, avalanche: 43114, bsc: 56, monad: 143,
}
const NATIVE_EVM = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const NATIVE_ZERO = '0x0000000000000000000000000000000000000000'
const NATIVE_SET = new Set([NATIVE_EVM.toLowerCase(), NATIVE_ZERO])
const isNativeEvm = (a) => NATIVE_SET.has((a || '').toLowerCase())

// Solana native sentinel (wrapped-SOL mint) the client sends.
const SOL_NATIVE_MINT = 'So11111111111111111111111111111111111111112'

// Our chain id → LI.FI chain id. EVM uses numeric chainId; Solana/Bitcoin use
// LI.FI's special ids. Validate against GET https://li.quest/v1/chains in testing.
const LIFI_CHAIN = {
  ethereum: 1, arbitrum: 42161, optimism: 10, base: 8453,
  polygon: 137, avalanche: 43114, bsc: 56, monad: 143,
  solana: 1151111081099710, bitcoin: 20000000000001,
}
// Our chain id → Rango blockchain identifier. Validate against
// GET https://api.rango.exchange/basic/meta in testing.
const RANGO_CHAIN = {
  ethereum: 'ETH', arbitrum: 'ARBITRUM', optimism: 'OPTIMISM', base: 'BASE',
  polygon: 'POLYGON', avalanche: 'AVAX_CCHAIN', bsc: 'BSC', monad: 'MONAD',
  solana: 'SOLANA', bitcoin: 'BTC', cardano: 'CARDANO', polkadot: 'POLKADOT',
}
// Our chain id → SwapKit chain code (THORChain/Maya/Chainflip aggregator).
// SwapKit/THORChain does NOT cover Monad/Cardano/Polkadot. Validate identifiers
// against SwapKit docs in testing; unsupported chains throw → other providers win.
const SWAPKIT_CHAIN = {
  ethereum: 'ETH', arbitrum: 'ARB', optimism: 'OP', base: 'BASE',
  polygon: 'POL', avalanche: 'AVAX', bsc: 'BSC', solana: 'SOL', bitcoin: 'BTC',
}

// Decimal-string ⇄ raw-integer-string helpers (the Worker has no BigNumber lib;
// SwapKit takes/returns human decimal amounts, our normalized quotes use raw).
function rawToDecimalStr(raw, decimals) {
  const d = Math.max(0, Number(decimals) || 0)
  const s = String(raw).replace(/[^0-9]/g, '') || '0'
  if (d === 0) return s.replace(/^0+(?=\d)/, '')
  const padded = s.padStart(d + 1, '0')
  const intPart = padded.slice(0, -d).replace(/^0+(?=\d)/, '')
  const frac = padded.slice(-d).replace(/0+$/, '')
  return frac ? `${intPart}.${frac}` : intPart
}
function decimalStrToRaw(dec, decimals) {
  const d = Math.max(0, Number(decimals) || 0)
  const [i = '0', f = ''] = String(dec).trim().split('.')
  const frac = (f + '0'.repeat(d)).slice(0, d)
  const digits = ((i.replace(/[^0-9]/g, '') || '0') + frac).replace(/^0+(?=\d)/, '')
  try { return BigInt(digits || '0').toString() } catch { return '0' }
}

// ── Fee config ────────────────────────────────────────────────────────────────
const feeBps = (env) => {
  const n = Number(env.FEE_BPS)
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? Math.round(n) : 90  // default 0.9%
}
const feePct = (env) => feeBps(env) / 10000   // 90 → 0.009
// Source-chain fee recipient (fees are collected on the chain the user spends from).
function feeRecipient(env, chain) {
  if (chain === 'solana') return env.FEE_SOLANA || ''
  if (chain === 'cardano') return env.FEE_CARDANO || ''
  if (chain === 'bitcoin') return env.FEE_BITCOIN || ''
  if (chain === 'polkadot') return env.FEE_POLKADOT || ''
  return env.FEE_EVM || ''   // all EVM chains
}

// cors / json / err live in lib.js (shared with the read + db route modules).

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const { pathname } = url

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env) })

    const configError = productionConfigError(env)
    if (pathname === '/health') return json(env, { ok: !configError, error: configError }, configError ? 500 : 200)
    if (configError) return err(env, `Worker production guard failed: ${configError}`, 500)

    try {
      // Read-path + Supabase routes — each returns null when its namespace
      // doesn't match, so the swap routes below still run unchanged.
      const read = await handleRead(request, url, env, ctx)
      if (read) return read
      const db = await handleDb(request, url, env, ctx)
      if (db) return db

      if (pathname === '/quote') return await handleQuote(url, env)
      if (pathname === '/swap/status') return await handleStatus(url, env)
      if (pathname === '/tokens') return await handleTokens(url, env)
      if (pathname === '/ss/estimate') return await ssEstimate(url, env)
      if (pathname === '/ss/ranges') return await ssRanges(url, env)
      if (pathname === '/ss/exchange' && request.method === 'POST') return await ssExchange(request, env)
      if (pathname.startsWith('/ss/status/')) return await ssStatus(pathname.split('/').pop(), env)
      if (pathname === '/ss/pairs') return await ssPassthrough('pairs', url, env)
      if (pathname === '/ss/currencies') return await ssPassthrough('currencies', url, env)
      if (pathname === '/cn/estimate') return await cnEstimate(url, env)
      if (pathname === '/cn/range') return await cnRange(url, env)
      if (pathname === '/cn/exchange' && request.method === 'POST') return await cnExchange(request, env)
      if (pathname.startsWith('/cn/status/')) return await cnStatus(pathname.split('/').pop(), env)
      return err(env, 'Not found', 404)
    } catch (e) {
      return err(env, e && e.message ? e.message : 'Proxy error', 500)
    }
  },
}

// ─── DEX quote routing ────────────────────────────────────────────────────────

async function handleQuote(url, env) {
  const q = Object.fromEntries(url.searchParams)
  const fromChain = (q.fromChain || q.chain || '').toLowerCase()
  const toChain = (q.toChain || fromChain).toLowerCase()
  q.fromChain = fromChain
  q.toChain = toChain
  if (!q.sell || !q.buy || !q.amount || !q.taker) return err(env, 'Missing quote parameters.')

  const sameChain = fromChain === toChain

  // Same-chain EVM: run the native aggregators in PARALLEL and return the BEST output
  // (buyAmountRaw is already net of each provider's fee). LI.FI/Rango stay as fallbacks
  // only if all three fail. (Other branches keep first-success ordering below.)
  if (sameChain && fromChain in EVM_CHAIN_IDS) {
    const primary = [
      ['0x', () => zeroExQuote(fromChain, q, env)],
      ['1inch', () => oneInchQuote(fromChain, q, env)],
      ['uniswap', () => uniswapQuote(fromChain, q, env)],
    ]
    const settled = await Promise.all(primary.map(([name, run]) =>
      run().then(quote => ({ name, quote })).catch(e => ({ name, error: e && e.message ? e.message : 'route error' }))
    ))
    const wins = settled.filter(s => s.quote && s.quote.buyAmountRaw && s.quote.buyAmountRaw !== '0')
    if (wins.length) {
      // Compare each output NET OF OUR STANDARD FEE. A provider that doesn't apply our
      // fee (e.g. Uniswap until it's enabled on the key) would otherwise win just by
      // skipping it — so discount its output by the fee gap. The winner's real quote is
      // returned unchanged (if Uniswap still wins, the user simply gets the un-fee'd amount).
      const STD = feeBps(env)
      const cmp = (qt) => {
        try {
          const gap = Math.max(0, STD - (Number(qt.feeBps) || 0))   // 0 for 0x/1inch, ~90 for Uniswap
          return BigInt(qt.buyAmountRaw) * BigInt(10000 - gap) / 10000n
        } catch { return 0n }
      }
      wins.sort((a, b) => {
        const av = cmp(a.quote), bv = cmp(b.quote)
        return av > bv ? -1 : av < bv ? 1 : 0   // highest fee-adjusted output first
      })
      return json(env, { quote: wins[0].quote, error: null })
    }
    const errors = settled.map(s => `${s.name}: ${s.error || 'no route'}`)
    for (const [name, run] of [['lifi', () => lifiQuote(q, env)], ['rango', () => rangoQuote(q, env)]]) {
      const r = await run().catch(e => ({ _error: e && e.message ? e.message : 'route error' }))
      if (r && !r._error) return json(env, { quote: r, error: null })
      if (r && r._error) errors.push(`${name}: ${r._error}`)
    }
    return json(env, { quote: null, error: errors.join(' | ') || 'No route available for this pair.' })
  }

  const tries = []
  if (sameChain && fromChain === 'solana') {
    tries.push(['jupiter', () => jupiterQuote(q, env)])
    tries.push(['lifi', () => lifiQuote(q, env)])
    tries.push(['rango', () => rangoQuote(q, env)])
  } else {
    // Cross-chain (any → any). The client calls LI.FI directly (its IP isn't rate-
    // limited like our shared Worker IP) and sets skipLifi; only try LI.FI here as a
    // last resort when the client didn't. Rango + SwapKit are the real fallbacks.
    tries.push(['rango', () => rangoQuote(q, env)])
    tries.push(['swapkit', () => swapkitQuote(q, env)])
    if (q.skipLifi !== '1') tries.push(['lifi', () => lifiQuote(q, env)])
  }

  // Try each in order; return the first success. On total failure, report EVERY
  // provider's reason (labeled) so failures are diagnosable instead of masked.
  const errors = []
  for (const [name, run] of tries) {
    const r = await run().catch(e => ({ _error: e && e.message ? e.message : 'route error' }))
    if (r && !r._error) return json(env, { quote: r, error: null })
    if (r && r._error) errors.push(`${name}: ${r._error}`)
  }
  return json(env, { quote: null, error: errors.join(' | ') || 'No route available for this pair.' })
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
  // Affiliate fee — 0x takes it in an ERC-20 (not native), so prefer the buy token,
  // fall back to the sell token, and skip on native↔native pairs.
  const recipient = env.FEE_EVM || ''
  const feeToken = !isNativeEvm(q.buy) ? q.buy : (!isNativeEvm(q.sell) ? q.sell : null)
  if (recipient && feeToken && feeBps(env) > 0) {
    params.set('swapFeeRecipient', recipient)
    params.set('swapFeeBps', String(feeBps(env)))
    params.set('swapFeeToken', feeToken)
  }
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
    isCrossChain: false,
    feeBps: recipient && feeToken ? feeBps(env) : 0,
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
  // 1inch affiliate: fee is a percentage (0–3); referrer collects it.
  const referrer = env.ONEINCH_REFERRER || env.FEE_EVM || ''
  if (referrer && feeBps(env) > 0) {
    params.set('fee', String(feeBps(env) / 100))   // 90 bps → "0.9"
    params.set('referrer', referrer)
  }
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
    isCrossChain: false,
    feeBps: referrer ? feeBps(env) : 0,
    txData: { to: d.tx && d.tx.to, data: d.tx && d.tx.data, value: (d.tx && d.tx.value) || '0' },
    approvalTx,
  }
}

// Uniswap Trading API — classic v2/v3/v4. Docs: https://developers.uniswap.org/docs/trading
// Three POSTs so the normalized quote is self-contained (like 0x): check_approval
// (ERC-20 → Permit2) + quote (CLASSIC, permit-as-transaction so no off-chain signature)
// + swap. Our fee is a portion of the OUTPUT token → FEE_EVM. Field-name fallbacks are
// defensive (the key can't be exercised from CI; validate the exact shapes live).
const UNISWAP_API = 'https://trade-api.gateway.uniswap.org/v1'
async function uniswapPost(path, body, env) {
  const res = await fetch(`${UNISWAP_API}${path}`, {
    method: 'POST',
    headers: { 'x-api-key': env.UNISWAP_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((d && (d.detail || d.message || d.error || d.errorCode)) || `Uniswap ${res.status}`)
  return d
}

async function uniswapQuote(chain, q, env) {
  if (!env.UNISWAP_API_KEY) throw new Error('Uniswap key not configured')
  const chainId = EVM_CHAIN_IDS[chain]
  if (!chainId) throw new Error('Uniswap: unsupported chain')
  const uniTok = (a) => isNativeEvm(a) ? NATIVE_ZERO : a
  const sellNative = isNativeEvm(q.sell)

  // a. ERC-20 → Permit2 approval (native input needs none).
  let approvalTx = null
  if (!sellNative) {
    const ap = await uniswapPost('/check_approval', {
      walletAddress: q.taker, token: q.sell, amount: q.amount, chainId,
    }, env)
    const a = ap.approval
    if (a && a.to && a.data) approvalTx = { to: a.to, data: a.data, value: a.value || '0x0' }
  }

  // b. CLASSIC quote — permit generated as a tx (no off-chain signature).
  const qd = await uniswapPost('/quote', {
    type: 'EXACT_INPUT',
    amount: q.amount,
    tokenInChainId: chainId,
    tokenOutChainId: chainId,
    tokenIn: uniTok(q.sell),
    tokenOut: uniTok(q.buy),
    swapper: q.taker,
    slippageTolerance: Number(q.slippageBps || 50) / 100,   // 50 bps → 0.5(%)
    routingPreference: 'BEST_PRICE',   // request enum is BEST_PRICE|FASTEST; response `routing` may be CLASSIC/DUTCH/…
    generatePermitAsTransaction: true,
    // portion fee is enabled on the API key by Uniswap Labs (request fields are ignored
    // until then) — sent anyway so it activates automatically once enabled.
    ...(feeBps(env) > 0 && env.FEE_EVM ? { portionBips: feeBps(env), portionRecipient: env.FEE_EVM } : {}),
  }, env)
  // We can only execute on-chain CLASSIC routes here; DUTCH/UniswapX needs /order + an
  // off-chain order signature (out of scope) — throw so Uniswap drops out for those.
  if (qd.routing && qd.routing !== 'CLASSIC') throw new Error(`Uniswap: ${qd.routing} route not supported`)
  const quote = qd.quote || qd
  const outAmount = String((quote.output && quote.output.amount) || quote.quote || quote.amountOut || '0')
  if (outAmount === '0') throw new Error('Uniswap: no route')
  const portionBips = Number(quote.portionBips || 0)
  const pt = qd.permitTransaction || quote.permitTransaction || null
  const permitTx = pt && pt.to && pt.data ? { to: pt.to, data: pt.data, value: pt.value || '0x0' } : null

  // c. Swap calldata (the permit was applied on-chain via permitTx / check_approval).
  const sd = await uniswapPost('/swap', { quote, simulateTransaction: false }, env)
  const swap = sd.swap || sd
  if (!swap.to || !swap.data) throw new Error('Uniswap: no swap calldata')

  const sellAmt = Number(q.amount), buyAmt = Number(outAmount)
  return {
    provider: 'uniswap',
    fromChain: chain, toChain: chain,
    fromTokenAddress: q.sell, toTokenAddress: q.buy,
    fromTokenSymbol: q.sellSymbol || '', toTokenSymbol: q.buySymbol || '',
    sellAmountRaw: q.amount, buyAmountRaw: outAmount,
    estimatedGasRaw: String(swap.gasLimit || (quote.gasFee && quote.gasFee.gasLimit) || '0'),
    slippageBps: Number(q.slippageBps || 50),
    priceImpactPct: quote.priceImpact != null ? Number(quote.priceImpact) : 0,
    rate: sellAmt > 0 ? buyAmt / sellAmt : 0,
    expiresAt: Date.now() + 30_000,
    isCrossChain: false,
    feeBps: portionBips,
    txData: { to: swap.to, data: swap.data, value: swap.value || '0' },
    permitTx,
    approvalTx,
  }
}

// Jupiter Swap API v1. Keyed host: api.jup.ag; free host: lite-api.jup.ag.
// Docs: https://dev.jup.ag/docs/swap-api
async function jupiterQuote(q, env) {
  const base = env.JUPITER_API_KEY ? 'https://api.jup.ag' : 'https://lite-api.jup.ag'
  const headers = env.JUPITER_API_KEY ? { 'x-api-key': env.JUPITER_API_KEY } : {}
  // `solFeeAccount` is the referral TOKEN account (a PDA) derived client-side from
  // the output mint. If that mint's referral ATA hasn't been created, Jupiter rejects
  // it — so retry once fee-less rather than fail the swap.
  const feeAccount = q.solFeeAccount || ''
  const wantFee = feeAccount && feeBps(env) > 0
  try {
    return await jupiterInner(q, base, headers, wantFee ? feeAccount : '', env)
  } catch (e) {
    const m = String((e && e.message) || e).toLowerCase()
    if (wantFee && (m.includes('fee') || m.includes('account') || m.includes('referral'))) {
      return await jupiterInner(q, base, headers, '', env)
    }
    throw e
  }
}

async function jupiterInner(q, base, headers, feeAccount, env) {
  const takeFee = !!feeAccount
  const params = new URLSearchParams({
    inputMint: q.sell, outputMint: q.buy, amount: q.amount,
    slippageBps: q.slippageBps || '50',
  })
  if (takeFee) params.set('platformFeeBps', String(feeBps(env)))
  const quoteRes = await fetch(`${base}/swap/v1/quote?${params}`, { headers })
  const quote = await quoteRes.json()
  if (!quoteRes.ok || !quote.outAmount) throw new Error(quote.error || `Jupiter ${quoteRes.status}`)

  const swapBody = { quoteResponse: quote, userPublicKey: q.taker, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }
  if (takeFee) swapBody.feeAccount = feeAccount
  const swapRes = await fetch(`${base}/swap/v1/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(swapBody),
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
    isCrossChain: false,
    feeBps: takeFee ? feeBps(env) : 0,
    txData: { swapTransaction: swap.swapTransaction },
    approvalTx: null,
  }
}

// LI.FI — same-chain + cross-chain routing. Keyless (an API key only raises rate
// limits). Integrator fee accrues to LI.FI's FeeCollector under LIFI_INTEGRATOR.
// Docs: https://docs.li.fi — GET https://li.quest/v1/quote
async function lifiQuote(q, env) {
  const fromId = LIFI_CHAIN[q.fromChain], toId = LIFI_CHAIN[q.toChain]
  if (fromId == null || toId == null) throw new Error('LI.FI: unsupported chain')

  // Token addressing: EVM native → zero address; Solana native → system address.
  const toLifiToken = (chain, addr) =>
    chain === 'solana'
      ? (addr === SOL_NATIVE_MINT ? '11111111111111111111111111111111' : addr)
      : (isNativeEvm(addr) ? NATIVE_ZERO : addr)

  const params = new URLSearchParams({
    fromChain: String(fromId), toChain: String(toId),
    fromToken: toLifiToken(q.fromChain, q.sell),
    toToken: toLifiToken(q.toChain, q.buy),
    fromAmount: q.amount,
    fromAddress: q.taker,
    toAddress: q.toAddress || q.taker,
    slippage: String(Number(q.slippageBps || 50) / 10000),   // 50 bps → 0.005
  })
  if (env.LIFI_INTEGRATOR) {
    params.set('integrator', env.LIFI_INTEGRATOR)
    if (feePct(env) > 0) params.set('fee', String(feePct(env)))   // 0.009
  }
  const headers = { accept: 'application/json' }
  if (env.LIFI_API_KEY) headers['x-lifi-api-key'] = env.LIFI_API_KEY

  const res = await fetch(`https://li.quest/v1/quote?${params}`, { headers })
  const d = await res.json()
  if (!res.ok) throw new Error((d && (d.message || d.error)) || `LI.FI ${res.status}`)
  const est = d.estimate || {}
  const tr = d.transactionRequest || {}

  // Source-chain payload: EVM = calldata (+ approval); Solana = base64 serialized tx.
  let txData, approvalTx = null
  if (q.fromChain === 'solana') {
    if (!tr.data) throw new Error('LI.FI: no Solana transaction')
    txData = { swapTransaction: tr.data }
  } else {
    if (!tr.to || !tr.data) throw new Error('LI.FI: no EVM calldata')
    txData = { to: tr.to, data: tr.data, value: tr.value || '0' }
    if (!isNativeEvm(q.sell) && est.approvalAddress) {
      approvalTx = { to: q.sell, data: erc20ApproveData(est.approvalAddress), value: '0x0' }
    }
  }
  const sellAmt = Number(q.amount), buyAmt = Number(est.toAmount || 0)
  return {
    provider: 'lifi',
    fromChain: q.fromChain, toChain: q.toChain,
    fromTokenAddress: q.sell, toTokenAddress: q.buy,
    fromTokenSymbol: q.sellSymbol || '', toTokenSymbol: q.buySymbol || '',
    sellAmountRaw: q.amount, buyAmountRaw: String(est.toAmount || '0'),
    estimatedGasRaw: String(tr.gasLimit || '0'),
    slippageBps: Number(q.slippageBps || 50),
    priceImpactPct: 0,
    rate: sellAmt > 0 ? buyAmt / sellAmt : 0,
    expiresAt: Date.now() + 30_000,
    isCrossChain: q.fromChain !== q.toChain,
    toAddress: q.toAddress || q.taker,
    bridgeTool: d.tool || (d.toolDetails && d.toolDetails.key) || null,
    estimatedDurationSec: Number(est.executionDuration || 0),
    feeBps: env.LIFI_INTEGRATOR ? feeBps(env) : 0,
    requestId: null,
    txData,
    approvalTx,
  }
}

// Rango — cross-chain fallback (Basic API). EVM source only (Solana routes via
// LI.FI). Blockchain identifiers + amount units should be validated against
// GET https://api.rango.exchange/basic/meta during testing.
async function rangoQuote(q, env) {
  if (!env.RANGO_API_KEY) throw new Error('Rango key not configured')
  if (q.fromChain === 'solana') throw new Error('Rango: Solana source unsupported here')
  const fromBc = RANGO_CHAIN[q.fromChain], toBc = RANGO_CHAIN[q.toChain]
  if (!fromBc || !toBc) throw new Error('Rango: unsupported chain')

  const asset = (bc, chain, symbol, addr) => {
    const sym = (symbol || '').toUpperCase()
    const native = chain === 'solana' ? addr === SOL_NATIVE_MINT : isNativeEvm(addr)
    return native ? `${bc}.${sym}` : `${bc}.${sym}--${addr}`
  }
  const referrerAddress = feeRecipient(env, q.fromChain)
  const sp = new URLSearchParams({
    from: asset(fromBc, q.fromChain, q.sellSymbol, q.sell),
    to: asset(toBc, q.toChain, q.buySymbol, q.buy),
    amount: q.amount,
    fromAddress: q.taker,
    toAddress: q.toAddress || q.taker,
    slippage: String(Number(q.slippageBps || 50) / 100),   // percent
    apiKey: env.RANGO_API_KEY,
  })
  if (referrerAddress && feeBps(env) > 0) {
    sp.set('referrerAddress', referrerAddress)
    sp.set('referrerFee', String(feeBps(env) / 100))   // percent
  }

  const res = await fetch(`https://api.rango.exchange/basic/swap?${sp}`, { headers: { accept: 'application/json' } })
  const d = await res.json()
  if (!res.ok) throw new Error((d && (d.error || d.errorMessage)) || `Rango ${res.status}`)
  if (d.error || d.resultType === 'NO_ROUTE' || !d.tx) throw new Error(d.error || 'Rango: no route')
  const tx = d.tx
  if (tx.type !== 'EVM' || !tx.txTo) throw new Error('Rango: unsupported tx type')

  let approvalTx = null
  if (!isNativeEvm(q.sell)) {
    if (tx.approveData) approvalTx = { to: q.sell, data: tx.approveData, value: '0x0' }
    else if (tx.approveTo) approvalTx = { to: q.sell, data: erc20ApproveData(tx.approveTo), value: '0x0' }
  }

  const out = (d.route && (d.route.outputAmount || d.route.outputAmountMin)) || '0'
  const sellAmt = Number(q.amount), buyAmt = Number(out)
  return {
    provider: 'rango',
    fromChain: q.fromChain, toChain: q.toChain,
    fromTokenAddress: q.sell, toTokenAddress: q.buy,
    fromTokenSymbol: q.sellSymbol || '', toTokenSymbol: q.buySymbol || '',
    sellAmountRaw: q.amount, buyAmountRaw: String(out),
    estimatedGasRaw: String(tx.gasLimit || '0'),
    slippageBps: Number(q.slippageBps || 50),
    priceImpactPct: 0,
    rate: sellAmt > 0 ? buyAmt / sellAmt : 0,
    expiresAt: Date.now() + 30_000,
    isCrossChain: q.fromChain !== q.toChain,
    toAddress: q.toAddress || q.taker,
    bridgeTool: (d.route && d.route.swapper && d.route.swapper.id) || null,
    estimatedDurationSec: Number((d.route && d.route.estimatedTimeInSeconds) || 0),
    feeBps: referrerAddress ? feeBps(env) : 0,
    requestId: d.requestId || null,
    txData: { to: tx.txTo, data: tx.txData, value: tx.value || '0' },
    approvalTx,
  }
}

// SwapKit / THORChain — native cross-chain (e.g. ETH/SOL → native BTC). EVM/Solana
// source only (UTXO/ADA/DOT sources are deposit-address, not signed locally).
// POST /v3/quote → pick best route → POST /v3/swap → signable tx. Asset format
// CHAIN.TICKER[-0xcontract]; amounts are human decimals. Affiliate fee in bps.
async function swapkitQuote(q, env) {
  if (!env.SWAPKIT_API_KEY) throw new Error('SwapKit key not configured')
  const fromC = SWAPKIT_CHAIN[q.fromChain], toC = SWAPKIT_CHAIN[q.toChain]
  if (!fromC || !toC) throw new Error('SwapKit: unsupported chain')
  if (q.fromChain !== 'solana' && !(q.fromChain in EVM_CHAIN_IDS)) {
    throw new Error('SwapKit: source not locally signable')
  }
  const fromDec = Number(q.fromDecimals) || (q.fromChain === 'solana' ? 9 : 18)
  const toDec = Number(q.toDecimals) || 8

  const asset = (chain, code, symbol, addr) => {
    const sym = (symbol || '').toUpperCase()
    const native = chain === 'solana' ? addr === SOL_NATIVE_MINT : isNativeEvm(addr)
    return native ? `${code}.${sym}` : `${code}.${sym}-${addr}`
  }
  const headers = { 'x-api-key': env.SWAPKIT_API_KEY, 'content-type': 'application/json', accept: 'application/json' }
  const quoteRes = await fetch('https://api.swapkit.dev/v3/quote', {
    method: 'POST', headers,
    body: JSON.stringify({
      sellAsset: asset(q.fromChain, fromC, q.sellSymbol, q.sell),
      buyAsset: asset(q.toChain, toC, q.buySymbol, q.buy),
      sellAmount: rawToDecimalStr(q.amount, fromDec),
      sourceAddress: q.taker,
      destinationAddress: q.toAddress || q.taker,
      slippage: Number(q.slippageBps || 50) / 100,
      affiliateFee: feeBps(env),
    }),
  })
  const qd = await quoteRes.json()
  if (!quoteRes.ok) throw new Error((qd && (qd.message || qd.error)) || `SwapKit ${quoteRes.status}`)
  const routes = Array.isArray(qd.routes) ? qd.routes : []
  if (!routes.length) throw new Error('SwapKit: no route')
  const route = routes.find(r => r.meta && Array.isArray(r.meta.tags) && r.meta.tags.includes('RECOMMENDED')) || routes[0]
  if (!route.routeId) throw new Error('SwapKit: route missing id')

  const swapRes = await fetch('https://api.swapkit.dev/v3/swap', {
    method: 'POST', headers, body: JSON.stringify({ routeId: route.routeId }),
  })
  const sd = await swapRes.json()
  if (!swapRes.ok) throw new Error((sd && (sd.message || sd.error)) || `SwapKit swap ${swapRes.status}`)
  const tx = sd.tx || sd.transaction || sd.evmTransactionDetails || {}

  let txData, approvalTx = null
  if (q.fromChain === 'solana') {
    const serialized = tx.serializedTx || tx.data || sd.swapTransaction
    if (!serialized) throw new Error('SwapKit: no Solana transaction')
    txData = { swapTransaction: serialized }
  } else {
    const to = tx.to || tx.txTo, data = tx.data || tx.txData
    if (!to || !data) throw new Error('SwapKit: no EVM calldata')
    txData = { to, data, value: tx.value || '0' }
    const spender = tx.approvalTarget || route.approvalTarget || sd.approvalTarget
    if (!isNativeEvm(q.sell) && spender) {
      approvalTx = { to: q.sell, data: erc20ApproveData(spender), value: '0x0' }
    }
  }
  const outRaw = decimalStrToRaw(route.expectedBuyAmount || '0', toDec)
  const sellAmt = Number(q.amount), buyAmt = Number(outRaw)
  return {
    provider: 'swapkit',
    fromChain: q.fromChain, toChain: q.toChain,
    fromTokenAddress: q.sell, toTokenAddress: q.buy,
    fromTokenSymbol: q.sellSymbol || '', toTokenSymbol: q.buySymbol || '',
    sellAmountRaw: q.amount, buyAmountRaw: outRaw,
    estimatedGasRaw: '0',
    slippageBps: Number(q.slippageBps || 50),
    priceImpactPct: 0,
    rate: sellAmt > 0 ? buyAmt / sellAmt : 0,
    expiresAt: Date.now() + 30_000,
    isCrossChain: q.fromChain !== q.toChain,
    toAddress: q.toAddress || q.taker,
    bridgeTool: Array.isArray(route.providers) ? route.providers.join('/') : 'THORChain',
    estimatedDurationSec: Number((route.estimatedTime && route.estimatedTime.total) || 0),
    feeBps: feeBps(env),
    requestId: route.routeId,
    txData,
    approvalTx,
  }
}

// ── Cross-chain status ────────────────────────────────────────────────────────

async function handleStatus(url, env) {
  const p = url.searchParams
  if (!p.get('txHash')) return err(env, 'Missing txHash')
  const provider = p.get('provider')
  try {
    const r = provider === 'rango' ? await rangoStatus(p, env)
      : provider === 'swapkit' ? await swapkitStatus(p, env)
      : await lifiStatus(p, env)
    return json(env, r)
  } catch (e) {
    // Transient/unknown — tell the client to keep polling rather than error out.
    return json(env, { status: 'pending', error: e && e.message ? e.message : 'status error' })
  }
}

// SwapKit routes are THORChain-settled — track the inbound tx on THORNode.
async function swapkitStatus(p, env) {
  const hash = (p.get('txHash') || '').replace(/^0x/, '')
  const res = await fetch(`https://thornode.ninerealms.com/thorchain/tx/status/${hash}`, { headers: { accept: 'application/json' } })
  const d = await res.json().catch(() => null)
  if (!res.ok || !d) return { status: 'pending', error: null }
  const stages = d.stages || {}
  const done = stages.outbound_signed ? stages.outbound_signed.completed : (stages.swap_finalised && stages.swap_finalised.completed)
  const out = d.out_txs && d.out_txs[0]
  return {
    status: done ? 'done' : 'pending',
    substatus: stages.swap_status && stages.swap_status.pending ? 'swapping' : null,
    receivedAmountRaw: (out && Array.isArray(out.coins) && out.coins[0] && out.coins[0].amount) ? String(out.coins[0].amount) : null,
    destTxHash: (out && out.id) || null,
    destExplorerUrl: null,
    error: null,
  }
}

async function lifiStatus(p, env) {
  const params = new URLSearchParams({ txHash: p.get('txHash') })
  if (p.get('bridge')) params.set('bridge', p.get('bridge'))
  const fromId = LIFI_CHAIN[(p.get('fromChain') || '').toLowerCase()]
  const toId = LIFI_CHAIN[(p.get('toChain') || '').toLowerCase()]
  if (fromId != null) params.set('fromChain', String(fromId))
  if (toId != null) params.set('toChain', String(toId))
  const headers = { accept: 'application/json' }
  if (env.LIFI_API_KEY) headers['x-lifi-api-key'] = env.LIFI_API_KEY
  const res = await fetch(`https://li.quest/v1/status?${params}`, { headers })
  const d = await res.json()
  const s = (d && d.status) || ''
  const status = s === 'DONE' ? 'done' : s === 'FAILED' ? 'failed' : 'pending'
  const recv = (d && d.receiving) || {}
  return {
    status,
    substatus: (d && d.substatus) || null,
    receivedAmountRaw: recv.amount ? String(recv.amount) : null,
    destTxHash: recv.txHash || null,
    destExplorerUrl: recv.txLink || null,
    error: null,
  }
}

async function rangoStatus(p, env) {
  const requestId = p.get('requestId')
  if (!requestId) throw new Error('Rango: missing requestId')
  const params = new URLSearchParams({ requestId, txId: p.get('txHash'), apiKey: env.RANGO_API_KEY || '' })
  const res = await fetch(`https://api.rango.exchange/basic/status?${params}`, { headers: { accept: 'application/json' } })
  const d = await res.json()
  const s = (d && d.status) || ''
  const status = s === 'success' ? 'done' : s === 'failed' ? 'failed' : 'pending'
  const out = (d && d.output) || {}
  const link = d && Array.isArray(d.explorerUrl) && d.explorerUrl[0]
  return {
    status,
    substatus: out.type || null,
    receivedAmountRaw: out.amount ? String(out.amount) : null,
    destTxHash: (d && d.bridgeData && d.bridgeData.destTxHash) || null,
    destExplorerUrl: (link && link.url) || null,
    error: null,
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

async function ssRanges(url, env) {
  const p = url.searchParams
  const params = new URLSearchParams({
    tickerFrom: p.get('from') || '', networkFrom: p.get('fromNet') || '',
    tickerTo: p.get('to') || '', networkTo: p.get('toNet') || '',
    fixed: p.get('fixed') || 'false',
  })
  const res = await fetch(`${SS}/ranges?${params}`, { headers: { 'x-api-key': ssKey(env) } })
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

// ─── ChangeNOW v2 passthrough (key injection) ────────────────────────────────
// Second deposit-address provider. Used as a FALLBACK behind SimpleSwap for pairs
// SimpleSwap can't do (e.g. Polkadot/DOT). The client sends ChangeNOW-native query
// params; the worker only injects the key. Affiliate commission is configured on
// the ChangeNOW partner account, not per-request.

const CN = 'https://api.changenow.io/v2'
function cnHeaders(env) {
  if (!env.CHANGENOW_API_KEY) throw new Error('ChangeNOW key not configured')
  return { 'x-changenow-api-key': env.CHANGENOW_API_KEY, accept: 'application/json' }
}
const cnJson = (env, res, body) =>
  new Response(body, { status: res.status, headers: { 'Content-Type': 'application/json', ...cors(env) } })

async function cnEstimate(url, env) {
  const res = await fetch(`${CN}/exchange/estimated-amount?${url.searchParams.toString()}`, { headers: cnHeaders(env) })
  return cnJson(env, res, await res.text())
}
async function cnRange(url, env) {
  const res = await fetch(`${CN}/exchange/range?${url.searchParams.toString()}`, { headers: cnHeaders(env) })
  return cnJson(env, res, await res.text())
}
async function cnExchange(request, env) {
  const body = await request.text()
  const res = await fetch(`${CN}/exchange`, { method: 'POST', headers: { ...cnHeaders(env), 'content-type': 'application/json' }, body })
  return cnJson(env, res, await res.text())
}
async function cnStatus(id, env) {
  const res = await fetch(`${CN}/exchange/by-id?id=${encodeURIComponent(id)}`, { headers: cnHeaders(env) })
  return cnJson(env, res, await res.text())
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// ERC-20 approve(spender, 2^256-1) calldata — 0x095ea7b3 + spender + max uint256.
function erc20ApproveData(spender) {
  const addr = spender.toLowerCase().replace(/^0x/, '').padStart(64, '0')
  const max = 'f'.repeat(64)
  return `0x095ea7b3${addr}${max}`
}
