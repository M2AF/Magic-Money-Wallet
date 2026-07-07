/**
 * market.js — globally-shared Market Watch cache.
 *
 * Serves the top-500 coin list, per-coin charts, and coin search from KV so
 * every wallet user reads the SAME data instead of each burning their own
 * keyless CoinGecko quota. The list is refreshed by a cron trigger (see the
 * `scheduled` export in swap-proxy.js) — ~2 upstream calls per refresh serve
 * everyone, so this does NOT have the "collapse all users onto one IP"
 * problem that keeps other keyless endpoints client-side.
 *
 * Routes (GET, clientOk + rate-limited):
 *   /market/top               — top-500 list  { coins, fetchedAt }
 *   /market/chart/:id?days=D  — price chart   { prices: [ts, usd][], fetchedAt }
 *   /market/search?q=…        — coin search   { coins, fetchedAt }
 *
 * Optional env: COINGECKO_KEY (demo or pro — see cgBase),
 * COINMARKETCAP_API_KEY (authenticated fallback), MARKET_RPM.
 * A failed refresh never overwrites the stale KV copy — stale beats blank.
 */

import { json, err, cacheGet, cachePut, clientOk, rateLimit, pathParts } from './lib.js'

// ─── CoinGecko key handling (optional) ────────────────────────────────────────
// Demo keys (CG- prefix) ONLY work on api.coingecko.com — pro keys use
// pro-api.coingecko.com. Sending a demo key to the pro host (or vice versa) → 401.
const cgIsDemo = (env) => !!env.COINGECKO_KEY && env.COINGECKO_KEY.startsWith('CG-')
const cgBase = (env) =>
  env.COINGECKO_KEY && !cgIsDemo(env) ? 'https://pro-api.coingecko.com' : 'https://api.coingecko.com'
function cgHeaders(env) {
  // Workers' fetch sends no User-Agent and CoinGecko's edge 403s UA-less requests.
  const base = { accept: 'application/json', 'user-agent': 'MagicMoneyWallet/1.0' }
  if (!env.COINGECKO_KEY) return base
  return {
    ...base,
    [cgIsDemo(env) ? 'x-cg-demo-api-key' : 'x-cg-pro-api-key']: env.COINGECKO_KEY,
  }
}

// ─── CoinMarketCap fallback (optional secret) ────────────────────────────────

const CMC_BASE = 'https://pro-api.coinmarketcap.com'
function cmcHeaders(env) {
  if (!env.COINMARKETCAP_API_KEY) return null
  return { accept: 'application/json', 'X-CMC_PRO_API_KEY': env.COINMARKETCAP_API_KEY }
}

function cmcUsdQuote(c) {
  if (Array.isArray(c && c.quote)) return c.quote.find(q => q && (q.symbol === 'USD' || q.id === 2781)) || c.quote[0] || {}
  return (c && c.quote && c.quote.USD) || {}
}

function cmcLogoUrl(id) {
  return id ? `https://s2.coinmarketcap.com/static/img/coins/64x64/${id}.png` : ''
}

function trimCmcCoin(c, idx) {
  const quote = cmcUsdQuote(c)
  return {
    id: c.slug || String(c.symbol || '').toLowerCase(),
    rank: c.cmc_rank || idx + 1,
    name: c.name || c.symbol || 'Unknown',
    symbol: String(c.symbol || '').toUpperCase(),
    image: cmcLogoUrl(c.id),
    price: Number(quote.price) || 0,
    change24h: Number.isFinite(Number(quote.percent_change_24h)) ? Number(quote.percent_change_24h) : null,
    marketCap: Number.isFinite(Number(quote.market_cap)) ? Number(quote.market_cap) : null,
    sparkline: null,
  }
}

async function cmcJson(env, path, params, timeoutMs = 15_000) {
  const headers = cmcHeaders(env)
  if (!headers) throw new Error('CoinMarketCap key missing')
  const url = new URL(`${CMC_BASE}${path}`)
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }
  const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(timeoutMs) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`CoinMarketCap ${res.status}: ${(data.status && data.status.error_message) || 'request failed'}`)
  return data
}

async function refreshTop500FromCmc(env) {
  const data = await cmcJson(env, '/v3/cryptocurrency/listings/latest', {
    start: 1,
    limit: 500,
    convert: 'USD',
    sort: 'market_cap',
    sort_dir: 'desc',
  }, 20_000)
  const rows = Array.isArray(data && data.data) ? data.data : []
  if (rows.length === 0) throw new Error('CoinMarketCap empty listings')
  return { coins: rows.map(trimCmcCoin), fetchedAt: Date.now(), source: 'CoinMarketCap' }
}

async function cmcQuote(env, q) {
  const query = String(q || '').trim()
  if (!query) throw new Error('CoinMarketCap empty query')
  const attempts = []
  if (/^[a-z0-9$@]{1,15}$/i.test(query)) attempts.push({ symbol: query.toUpperCase(), convert: 'USD', skip_invalid: true })
  attempts.push({ slug: query.toLowerCase().replace(/\s+/g, '-'), convert: 'USD', skip_invalid: true })

  let lastErr
  for (const params of attempts) {
    try {
      const data = await cmcJson(env, '/v3/cryptocurrency/quotes/latest', params, 10_000)
      const rows = (Array.isArray(data && data.data) ? data.data : Object.values((data && data.data) || {})).flat()
      const coin = rows.find(Boolean)
      if (coin) return trimCmcCoin(coin, 0)
      lastErr = new Error('CoinMarketCap no quote')
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('CoinMarketCap no quote')
}

async function symbolForMarketId(env, id) {
  const normalized = String(id || '').toLowerCase()
  const hit = await cacheGet(env, TOP_KEY)
  const coins = Array.isArray(hit && hit.coins) ? hit.coins : []
  const coin = coins.find(c =>
    String(c.id || '').toLowerCase() === normalized ||
    String(c.symbol || '').toLowerCase() === normalized ||
    String(c.name || '').toLowerCase() === normalized
  )
  return coin && coin.symbol ? coin.symbol : (normalized.length <= 12 ? normalized.toUpperCase() : '')
}

async function cmcChart(env, id, days) {
  const symbol = await symbolForMarketId(env, id)
  if (!symbol) throw new Error('CoinMarketCap symbol unavailable')
  const intervals = { '1': '1h', '7': '4h', '30': '1d', '365': '7d', max: '30d' }
  const counts = { '1': 24, '7': 42, '30': 30, '365': 53, max: 120 }
  const data = await cmcJson(env, '/v3/cryptocurrency/quotes/historical', {
    symbol,
    interval: intervals[days] || '4h',
    count: counts[days] || 42,
    convert: 'USD',
    skip_invalid: true,
  }, 15_000)
  const container = data && data.data && (data.data[symbol] || Object.values(data.data)[0])
  const quotes = Array.isArray(container && container.quotes) ? container.quotes : []
  const prices = quotes
    .map(q => [Date.parse(q.timestamp), Number(q.quote && q.quote.USD && q.quote.USD.price)])
    .filter(([ts, price]) => Number.isFinite(ts) && price > 0)
    .sort((a, b) => a[0] - b[0])
  if (prices.length < 2) throw new Error('CoinMarketCap empty chart')
  return prices
}

// ─── Cache policy ─────────────────────────────────────────────────────────────
const TOP_KEY = 'market:top500'
const TOP_LOCK_KEY = 'market:top500:lock'
const TOP_FRESH_MS = 20 * 60 * 1000        // cron refreshes every 15 min; 20 min = grace
const STORE_TTL = 86400                    // KV retention — stale data still beats blank
const SEARCH_FRESH_MS = 2 * 60 * 60 * 1000
// Chart freshness tiers sized against the demo key's 10k calls/month budget.
const CHART_FRESH_MS = {
  '1': 15 * 60 * 1000,
  '7': 60 * 60 * 1000,
  '30': 4 * 60 * 60 * 1000,
  '365': 24 * 60 * 60 * 1000,
  'max': 24 * 60 * 60 * 1000,
}

// ─── Shaping helpers ──────────────────────────────────────────────────────────

/** Evenly thin an array to ≤ n points, always keeping first and last. */
function downsample(arr, n) {
  if (!Array.isArray(arr) || arr.length <= n) return arr
  const step = (arr.length - 1) / (n - 1)
  const out = new Array(n)
  for (let i = 0; i < n; i++) out[i] = arr[Math.round(i * step)]
  return out
}

// Raw CoinGecko coin → the client's exact MarketCoin shape (market-fetcher.ts).
// Sparklines are thinned 168 → 42 pts, which keeps the 500-coin payload ~250 KB.
// market_cap_rank can be null on deep pages, so fall back to list position.
function trimCoin(c, idx) {
  return {
    id: c.id,
    rank: c.market_cap_rank ?? idx + 1,
    name: c.name,
    symbol: (c.symbol || '').toUpperCase(),
    image: c.image || '',
    price: c.current_price ?? 0,
    change24h: c.price_change_percentage_24h ?? null,
    marketCap: c.market_cap ?? null,
    sparkline: Array.isArray(c.sparkline_in_7d?.price) ? downsample(c.sparkline_in_7d.price, 42) : null,
  }
}

// ─── Top-500 refresh (shared by the cron trigger and the /market/top route) ───

export async function refreshTop500(env) {
  if (!env.CACHE) throw new Error('CACHE KV binding missing')
  let value
  try {
    const coins = []
    for (const page of [1, 2]) {
      const res = await fetch(
        `${cgBase(env)}/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=true&price_change_percentage=24h`,
        { headers: cgHeaders(env), signal: AbortSignal.timeout(20_000) }
      )
      if (!res.ok) throw new Error(`CoinGecko ${res.status} (page ${page})`)
      const arr = await res.json()
      if (!Array.isArray(arr) || arr.length === 0) throw new Error(`CoinGecko empty page ${page}`)
      for (const c of arr) coins.push(trimCoin(c, coins.length))
    }
    value = { coins, fetchedAt: Date.now(), source: 'CoinGecko' }
  } catch (e) {
    console.log('market top500 CoinGecko failed, trying CoinMarketCap:', e && e.message ? e.message : e)
    value = await refreshTop500FromCmc(env)
  }
  // Awaited (not write-behind): the cron invocation must not end before the put.
  // Fail-open like every other cache write — on the KV free tier the daily write
  // quota can be exhausted (the per-request rateLimit counters burn it), and a
  // fetched list must still be served even if it can't be cached.
  try {
    await env.CACHE.put(TOP_KEY, JSON.stringify(value), { expirationTtl: STORE_TTL })
  } catch (e) {
    console.log('market top500 KV put failed:', e && e.message ? e.message : e)
  }
  return value
}

// Stampede guard for stale-triggered background refreshes. KV is eventually
// consistent so this is approximate — good enough to damp a thundering herd.
async function tryRefreshLocked(env, ctx) {
  if (await cacheGet(env, TOP_LOCK_KEY)) return
  cachePut(env, ctx, TOP_LOCK_KEY, 1, 60)
  try { await refreshTop500(env) } catch { /* stale copy survives */ }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** Returns a Response for a market route, or null if this isn't one. */
export async function handleMarket(request, url, env, ctx) {
  const parts = pathParts(url.pathname)
  if (parts[0] !== 'market') return null

  if (!clientOk(request, env)) return err(env, 'Forbidden', 403)
  const limit = Number(env.MARKET_RPM) || 120
  if (!(await rateLimit(request, env, ctx, { limit, windowSec: 60, bucket: 'market' })))
    return err(env, 'Rate limited', 429)
  if (request.method !== 'GET') return err(env, 'Not found', 404)

  if (parts[1] === 'top' && parts.length === 2) return marketTop(env, ctx)
  if (parts[1] === 'chart' && parts.length === 3) return marketChart(parts[2], url, env, ctx)
  if (parts[1] === 'search' && parts.length === 2) return marketSearch(url, env, ctx)
  return err(env, 'Not found', 404)
}

async function marketTop(env, ctx) {
  const hit = await cacheGet(env, TOP_KEY)
  if (hit && Array.isArray(hit.coins) && hit.coins.length > 0) {
    // Serve stale immediately; refresh in the background (cron is the primary
    // refresher — this only covers cron gaps/failures).
    if (Date.now() - (hit.fetchedAt || 0) > TOP_FRESH_MS && ctx && ctx.waitUntil)
      ctx.waitUntil(tryRefreshLocked(env, ctx))
    return json(env, hit)
  }
  try {
    return json(env, await refreshTop500(env))
  } catch (e) {
    return err(env, `Market data unavailable: ${e && e.message}`, 503)
  }
}

async function marketChart(id, url, env, ctx) {
  if (!/^[a-z0-9-]{1,100}$/.test(id)) return err(env, 'Bad coin id')
  const days = url.searchParams.get('days') || '7'
  if (!(days in CHART_FRESH_MS)) return err(env, 'Bad days — use 1|7|30|365|max')

  const key = `market:chart:${id}:${days}`
  const hit = await cacheGet(env, key)
  if (hit && Array.isArray(hit.prices) && Date.now() - (hit.fetchedAt || 0) < CHART_FRESH_MS[days])
    return json(env, hit)

  try {
    let prices
    try {
      prices = await cgChart(env, id, days)
    } catch (e) {
      // Public/demo CoinGecko caps history at 365 days, so days=max 401s.
      // A 1-year chart under the ALL tab still beats "No chart data".
      if (days === 'max') {
        try {
          prices = await cgChart(env, id, '365')
        } catch (cg365) {
          console.log('market chart CoinGecko failed, trying CoinMarketCap:', cg365 && cg365.message ? cg365.message : cg365)
          prices = await cmcChart(env, id, days)
        }
      } else {
        console.log('market chart CoinGecko failed, trying CoinMarketCap:', e && e.message ? e.message : e)
        prices = await cmcChart(env, id, days)
      }
    }
    if (days === '365' || days === 'max') prices = downsample(prices, 500)
    const value = { prices, fetchedAt: Date.now() }
    cachePut(env, ctx, key, value, STORE_TTL)
    return json(env, value)
  } catch (e) {
    if (hit && Array.isArray(hit.prices)) return json(env, hit) // stale beats blank
    return err(env, `Chart unavailable: ${e && e.message}`, 503)
  }
}

async function cgChart(env, id, days) {
  const res = await fetch(
    `${cgBase(env)}/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`,
    { headers: cgHeaders(env), signal: AbortSignal.timeout(15_000) }
  )
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`)
  const data = await res.json()
  const prices = Array.isArray(data && data.prices) ? data.prices : []
  if (prices.length < 2) throw new Error('empty chart')
  return prices
}

async function marketSearch(url, env, ctx) {
  const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 64)
  if (!q) return err(env, 'Missing q')

  const key = `market:search:${q}`
  const hit = await cacheGet(env, key)
  if (hit && Array.isArray(hit.coins) && Date.now() - (hit.fetchedAt || 0) < SEARCH_FRESH_MS)
    return json(env, hit)

  try {
    let coins = []
    try {
      const sres = await fetch(
        `${cgBase(env)}/api/v3/search?query=${encodeURIComponent(q)}`,
        { headers: cgHeaders(env), signal: AbortSignal.timeout(10_000) }
      )
      if (!sres.ok) throw new Error(`CoinGecko ${sres.status}`)
      const sjson = await sres.json()
      const ids = ((sjson && sjson.coins) || []).slice(0, 20).map((c) => c.id)

      if (ids.length > 0) {
        const mres = await fetch(
          `${cgBase(env)}/api/v3/coins/markets?vs_currency=usd&ids=${ids.join(',')}&order=market_cap_desc&sparkline=true&price_change_percentage=24h`,
          { headers: cgHeaders(env), signal: AbortSignal.timeout(10_000) }
        )
        if (!mres.ok) throw new Error(`CoinGecko ${mres.status}`)
        const mjson = await mres.json()
        coins = (Array.isArray(mjson) ? mjson : []).map(trimCoin)
      }
    } catch (e) {
      console.log('market search CoinGecko failed, trying CoinMarketCap:', e && e.message ? e.message : e)
      coins = [await cmcQuote(env, q)]
    }

    if (coins.length === 0 && env.COINMARKETCAP_API_KEY) {
      try { coins = [await cmcQuote(env, q)] } catch { /* real empty result remains cacheable */ }
    }
    // A successful empty result ("no coin named that") IS cacheable; failures
    // throw above and never overwrite the stale copy.
    const value = { coins, fetchedAt: Date.now() }
    cachePut(env, ctx, key, value, STORE_TTL)
    return json(env, value)
  } catch (e) {
    if (hit && Array.isArray(hit.coins)) return json(env, hit)
    return err(env, `Search unavailable: ${e && e.message}`, 503)
  }
}
