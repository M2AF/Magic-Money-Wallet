/**
 * market-fetcher.ts — Market Watch data (main process / extension service worker).
 *
 * Source order: Worker global cache (cron-refreshed top-500, shared by every
 * user) → direct keyless CoinGecko → Binance. Live prices are patched from
 * Binance client-side (keyless, per-user IP). Search filters the cached top-500
 * locally before touching any API; charts and searches are cached + deduped so
 * rapid timeframe flips and repeat searches never re-fetch.
 */

import type { WalletConfig } from './secure-store'
import { proxyBase, proxyHeaders } from './api-proxy'
import { seedNativeUsd } from './native-prices'

export interface MarketCoin {
  id: string
  rank: number
  name: string
  symbol: string
  image: string
  price: number
  change24h: number | null
  marketCap: number | null
  sparkline: number[] | null
}

export interface MarketResult {
  coins: MarketCoin[]
  fetchedAt: number
  error: string | null
  source?: string
}

// ─── Cache ───────────────────────────────────────────────────────────────────

let _cache: MarketResult | null = null
let _cacheTime = 0
const CACHE_TTL = 5 * 60 * 1000  // 5 min — CoinGecko data (sparklines, market caps)
const PRICE_TTL = 60 * 1000       // 1 min — Binance price patch

// ─── Binance symbol → CoinGecko ID map ───────────────────────────────────────
// Used to: (a) build Binance batch ticker requests, (b) map Binance fallback coins

const BINANCE_TO_CG: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', BNB: 'binancecoin', SOL: 'solana',
  XRP: 'ripple', ADA: 'cardano', AVAX: 'avalanche-2', DOGE: 'dogecoin',
  TRX: 'tron', LINK: 'chainlink', DOT: 'polkadot', MATIC: 'matic-network',
  LTC: 'litecoin', UNI: 'uniswap', ATOM: 'cosmos', ETC: 'ethereum-classic',
  NEAR: 'near', APT: 'aptos', ARB: 'arbitrum', OP: 'optimism',
  SUI: 'sui', INJ: 'injective-protocol', HBAR: 'hedera-hashgraph',
  VET: 'vechain', AAVE: 'aave', MKR: 'maker', RUNE: 'thorchain',
  ALGO: 'algorand', XLM: 'stellar', XMR: 'monero', FTM: 'fantom',
  ZEC: 'zcash', XTZ: 'tezos', SHIB: 'shiba-inu', PEPE: 'pepe',
  FLOKI: 'floki', WIF: 'dogwifcoin', BONK: 'bonk', SEI: 'sei-network',
  TIA: 'celestia', PYTH: 'pyth-network', JUP: 'jupiter-exchange-solana',
  RENDER: 'render-token', FET: 'fetch-ai', GRT: 'the-graph',
  LDO: 'lido-dao', COMP: 'compound-governance-token', SNX: 'havven',
  CRV: 'curve-dao-token', SUSHI: 'sushi', GMX: 'gmx', RPL: 'rocket-pool',
  KSM: 'kusama', ROSE: 'oasis-network', FLOW: 'flow', FIL: 'filecoin',
  EOS: 'eos', CAKE: 'pancakeswap-token', CHZ: 'chiliz', ENJ: 'enjincoin',
  BAT: 'basic-attention-token', SAND: 'the-sandbox', MANA: 'decentraland',
  '1INCH': '1inch', AUDIO: 'audius', STORJ: 'storj', ANKR: 'ankr',
  BAND: 'band-protocol', CRO: 'crypto-com-chain', EGLD: 'elrond-erd-2',
  MON: 'monad', HYPE: 'hyperliquid', W: 'wormhole', JTO: 'jito-governance-token',
  STRK: 'starknet', BLUR: 'blur', DYDX: 'dydx-chain', ZRX: '0x',
  IOTA: 'iota', WAVES: 'waves', ZIL: 'zilliqa', YFI: 'yearn-finance',
  BAL: 'balancer', CVX: 'convex-finance',
}

const CG_TO_BINANCE: Record<string, string> = Object.fromEntries(
  Object.entries(BINANCE_TO_CG).map(([sym, id]) => [id, sym])
)

// ─── CoinGecko (primary) ─────────────────────────────────────────────────────

function mapCGCoin(c: {
  id: string
  market_cap_rank: number
  name: string
  symbol: string
  image: string
  current_price: number
  price_change_percentage_24h: number | null
  market_cap: number | null
  sparkline_in_7d?: { price: number[] }
}): MarketCoin {
  return {
    id: c.id,
    rank: c.market_cap_rank,
    name: c.name,
    symbol: c.symbol.toUpperCase(),
    image: c.image,
    price: c.current_price ?? 0,
    change24h: c.price_change_percentage_24h ?? null,
    marketCap: c.market_cap ?? null,
    sparkline: c.sparkline_in_7d?.price ?? null
  }
}

async function fetchFromCoinGecko(): Promise<MarketCoin[]> {
  const res = await fetch(
    'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=24h',
    { signal: AbortSignal.timeout(15_000) }
  )
  if (!res.ok) throw Object.assign(new Error(`CoinGecko ${res.status}`), { status: res.status })
  const json = await res.json() as Parameters<typeof mapCGCoin>[0][]
  return json.map(mapCGCoin)
}

// ─── Worker global cache (primary source) ────────────────────────────────────
// GET /market/top on the MagicMoney Worker — a cron-refreshed top-500 list in
// KV shared by every user. Coins arrive pre-trimmed to the MarketCoin shape.

async function fetchFromWorker(config: WalletConfig): Promise<MarketCoin[]> {
  const base = proxyBase(config)
  if (!base) throw new Error('No proxy configured')
  const res = await fetch(`${base}/market/top`, {
    headers: proxyHeaders(config, { accept: 'application/json' }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw Object.assign(new Error(`Worker market ${res.status}`), { status: res.status })
  const json = await res.json() as { coins?: MarketCoin[] }
  if (!Array.isArray(json.coins) || json.coins.length === 0) throw new Error('Worker market empty')
  return json.coins
}

// ─── Binance (price refresh + fallback) ──────────────────────────────────────

type BinanceTicker = {
  symbol: string
  lastPrice: string
  priceChangePercent: string
  quoteVolume: string
}

async function fetchBinanceTickers(symbols: string[]): Promise<BinanceTicker[]> {
  const encoded = encodeURIComponent(JSON.stringify(symbols))
  const res = await fetch(
    `https://api.binance.com/api/v3/ticker/24hr?symbols=${encoded}`,
    { signal: AbortSignal.timeout(8_000) }
  )
  if (!res.ok) throw new Error(`Binance ${res.status}`)
  return res.json() as Promise<BinanceTicker[]>
}

// Patches price + 24h% in-place on a coin array using Binance real-time data.
// Only coins whose symbol↔id pair is in BINANCE_TO_CG are requested: Binance's
// batch `symbols=` endpoint 400s the WHOLE request if any symbol is unlisted,
// and the top-500 list is full of coins with no USDT pair. The id check also
// stops a same-symbol impostor coin from receiving the real coin's price.
async function patchPricesFromBinance(coins: MarketCoin[]): Promise<void> {
  const STABLE = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'USDP', 'GUSD'])
  const eligible = coins.filter(c => !STABLE.has(c.symbol) && BINANCE_TO_CG[c.symbol] === c.id)
  if (eligible.length === 0) return
  const binanceSymbols = [...new Set(eligible.map(c => `${c.symbol}USDT`))]

  const tickers = await fetchBinanceTickers(binanceSymbols)
  const bySymbol = new Map(tickers.map(t => [t.symbol, t]))

  for (const coin of eligible) {
    const ticker = bySymbol.get(`${coin.symbol}USDT`)
    if (!ticker) continue
    coin.price = parseFloat(ticker.lastPrice)
    coin.change24h = parseFloat(ticker.priceChangePercent)
  }
}

// Full Binance fallback — used when CoinGecko is rate-limited.
// Returns simplified data: no sparklines, no logos, no market cap.
async function fetchFromBinance(): Promise<MarketCoin[]> {
  const res = await fetch(
    'https://api.binance.com/api/v3/ticker/24hr',
    { signal: AbortSignal.timeout(12_000) }
  )
  if (!res.ok) throw new Error(`Binance ${res.status}`)

  const all = await res.json() as BinanceTicker[]

  const STABLE = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'USDP', 'GUSD'])
  const usdtPairs = all
    .filter(t =>
      t.symbol.endsWith('USDT') &&
      !t.symbol.includes('UP') &&
      !t.symbol.includes('DOWN') &&
      !t.symbol.includes('BEAR') &&
      !t.symbol.includes('BULL')
    )
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, 100)

  return usdtPairs.map((t, i) => {
    const sym = t.symbol.replace(/USDT$/, '')
    const cgId = BINANCE_TO_CG[sym] ?? sym.toLowerCase()
    return {
      id: cgId,
      rank: i + 1,
      name: sym,
      symbol: sym,
      image: '',  // no image available from Binance
      price: parseFloat(t.lastPrice),
      change24h: parseFloat(t.priceChangePercent),
      marketCap: null,
      sparkline: null,
      ...(STABLE.has(sym) ? { price: 1, change24h: 0 } : {})
    }
  })
}

// ─── Public API ──────────────────────────────────────────────────────────────

let _lastPricePatch = 0
let _inflightTop: Promise<MarketResult> | null = null

// Kept as fetchMarketTop100 for the IPC surface, but now returns up to 500
// coins (the renderer displays the top 100; search covers the full list).
export async function fetchMarketTop100(config?: WalletConfig): Promise<MarketResult> {
  const now = Date.now()

  // Return cache immediately if still fresh
  if (_cache && now - _cacheTime < CACHE_TTL) {
    // Kick off a background Binance price patch if prices are stale (> 1 min)
    if (now - _lastPricePatch > PRICE_TTL && _cache.coins.length > 0) {
      _lastPricePatch = now
      patchPricesFromBinance(_cache.coins).then(() => {
        if (_cache && _cache.source && !_cache.source.includes('Binance')) _cache.source += ' + Binance'
      }).catch(() => { /* silent — Binance optional */ })
    }
    return _cache
  }

  // Coalesce concurrent refreshes (Market mount + a search can race).
  if (_inflightTop) return _inflightTop
  const p = refreshMarket(config).finally(() => { if (_inflightTop === p) _inflightTop = null })
  _inflightTop = p
  return p
}

// Adopt a full CoinGecko-shaped list: cache it, share its prices with the
// app-wide native-price cache, and patch live prices from Binance in the
// background (don't await — return the list immediately).
function adoptRichList(coins: MarketCoin[], now: number): MarketResult {
  _cache = { coins, fetchedAt: now, error: null, source: 'CoinGecko' }
  _cacheTime = now
  seedNativeUsd(Object.fromEntries(coins.filter(c => c.price > 0).map(c => [c.id, c.price])))
  _lastPricePatch = now
  patchPricesFromBinance(coins).then(() => {
    if (_cache) _cache.source = 'CoinGecko + Binance'
  }).catch(() => { /* silent */ })
  return _cache
}

async function refreshMarket(config?: WalletConfig): Promise<MarketResult> {
  const now = Date.now()

  // 1) Worker global cache — cron-refreshed top 500, shared by every user.
  if (config && proxyBase(config)) {
    try {
      return adoptRichList(await fetchFromWorker(config), now)
    } catch { /* fall through to direct CoinGecko */ }
  }

  // 2) Direct keyless CoinGecko (self-hoster path / Worker outage)
  try {
    return adoptRichList(await fetchFromCoinGecko(), now)
  } catch (cgErr) {
    const status = (cgErr as { status?: number }).status
    const isRateLimit = status === 429 || status === 503

    // 3) A stale rich list beats a fresh skeleton: keep the cached caps and
    //    sparklines, refresh only the prices from Binance. (Replacing the rich
    //    list here is what used to blank the MKT CAP / 7D columns.)
    if (_cache && _cache.coins.some(c => c.marketCap != null)) {
      try {
        await patchPricesFromBinance(_cache.coins)
        _lastPricePatch = Date.now()
        _cache.source = 'CoinGecko + Binance'
      } catch { /* stale prices still beat a skeleton list */ }
      _cacheTime = now - (CACHE_TTL / 2)  // retry the rich sources in ~2.5 min
      return _cache
    }

    // 4) Binance skeleton — only when there is nothing rich to show.
    try {
      const coins = await fetchFromBinance()
      const result: MarketResult = { coins, fetchedAt: now, error: null, source: 'Binance' }
      _cache = result
      _cacheTime = now - (CACHE_TTL / 2)  // expire in 2.5 min instead of 5
      return result
    } catch {
      // Everything failed — return stale cache if available, or error
      if (_cache) return { ..._cache, error: null }
      const errMsg = isRateLimit ? 'Rate limited — try again in a minute' : String(cgErr)
      return { coins: [], fetchedAt: now, error: errMsg, source: 'CoinGecko' }
    }
  }
}

// ─── Search ──────────────────────────────────────────────────────────────────
// Local-first: the cached top-500 list answers most queries instantly with zero
// API calls. Remote (Worker cache → direct CoinGecko) only on zero local hits.

const SEARCH_TTL = 5 * 60 * 1000
const _searchCache = new Map<string, { coins: MarketCoin[]; exp: number }>()
const _searchInflight = new Map<string, Promise<MarketCoin[]>>()

function searchLocal(coins: MarketCoin[], q: string): MarketCoin[] {
  return coins
    .filter(c => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.id.includes(q))
    .sort((a, b) => {
      const aExact = a.symbol.toLowerCase() === q || a.name.toLowerCase() === q ? 0 : 1
      const bExact = b.symbol.toLowerCase() === q || b.name.toLowerCase() === q ? 0 : 1
      return aExact - bExact || a.rank - b.rank
    })
    .slice(0, 50)
}

async function searchFromWorker(q: string, config: WalletConfig): Promise<MarketCoin[]> {
  const base = proxyBase(config)
  if (!base) throw new Error('No proxy configured')
  const res = await fetch(`${base}/market/search?q=${encodeURIComponent(q)}`, {
    headers: proxyHeaders(config, { accept: 'application/json' }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Worker search ${res.status}`)
  const json = await res.json() as { coins?: MarketCoin[] }
  if (!Array.isArray(json.coins)) throw new Error('Worker search bad payload')
  return json.coins
}

// Direct keyless CoinGecko search — last resort. Throws on failure so callers
// can tell "no such coin" (cacheable) from "rate limited" (never cached).
async function searchDirectCG(q: string): Promise<MarketCoin[]> {
  const searchRes = await fetch(
    `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`,
    { signal: AbortSignal.timeout(10_000) }
  )
  if (!searchRes.ok) throw new Error(`CoinGecko ${searchRes.status}`)
  const searchJson = await searchRes.json() as {
    coins: Array<{ id: string }>
  }

  const ids = searchJson.coins.slice(0, 20).map(c => c.id)
  if (ids.length === 0) return []

  const priceRes = await fetch(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids.join(',')}&sparkline=true&price_change_percentage=24h&order=market_cap_desc`,
    { signal: AbortSignal.timeout(10_000) }
  )
  if (!priceRes.ok) throw new Error(`CoinGecko ${priceRes.status}`)

  const priceJson = await priceRes.json() as Parameters<typeof mapCGCoin>[0][]
  return priceJson.map(mapCGCoin)
}

export async function searchMarketCoins(query: string, config?: WalletConfig): Promise<MarketCoin[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const cached = _searchCache.get(q)
  if (cached && cached.exp > Date.now()) return cached.coins

  const inflight = _searchInflight.get(q)
  if (inflight) return inflight

  const p = doSearch(q, config).finally(() => {
    if (_searchInflight.get(q) === p) _searchInflight.delete(q)
  })
  _searchInflight.set(q, p)
  return p
}

async function doSearch(q: string, config?: WalletConfig): Promise<MarketCoin[]> {
  // Top-500 local filter — self-loads the list first (the extension service
  // worker restarts with empty module state, so it may not be loaded yet).
  const market = await fetchMarketTop100(config)
  const local = searchLocal(market.coins, q)
  if (local.length > 0) {
    _searchCache.set(q, { coins: local, exp: Date.now() + SEARCH_TTL })
    return local
  }

  try {
    let coins: MarketCoin[] | null = null
    if (config && proxyBase(config)) {
      try { coins = await searchFromWorker(q, config) } catch { coins = null }
    }
    if (coins == null) coins = await searchDirectCG(q)
    _searchCache.set(q, { coins, exp: Date.now() + SEARCH_TTL })
    return coins
  } catch {
    // Failure (not "no results") — serve an expired entry if we have one, and
    // never cache the failure so the next attempt retries.
    return _searchCache.get(q)?.coins ?? []
  }
}

// ─── Chart data ──────────────────────────────────────────────────────────────

const DAYS_TO_BINANCE: Record<string, { interval: string; limit: number }> = {
  '1':   { interval: '1h',  limit: 24  },
  '7':   { interval: '4h',  limit: 42  },
  '30':  { interval: '1d',  limit: 30  },
  '365': { interval: '1d',  limit: 365 },
  'max': { interval: '1w',  limit: 200 },
}

async function fetchCoinChartBinance(
  coinId: string,
  days: string
): Promise<Array<[number, number]>> {
  const binanceSym = CG_TO_BINANCE[coinId]
  if (!binanceSym) return []

  const { interval, limit } = DAYS_TO_BINANCE[days] ?? { interval: '1d', limit: 30 }
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${binanceSym}USDT&interval=${interval}&limit=${limit}`,
    { signal: AbortSignal.timeout(10_000) }
  )
  if (!res.ok) return []

  const rows = await res.json() as Array<[number, string, string, string, string, ...unknown[]]>
  // rows[i] = [openTime, open, high, low, close, ...]
  return rows.map(r => [r[0] + (typeof r[0] === 'number' ? 0 : 0), parseFloat(r[4])] as [number, number])
}

// Charts are cached per (coin, timeframe) and deduped so flipping through
// 1D/7D/1M/1Y/ALL is instant on revisit. Expired entries are kept: on total
// upstream failure a stale chart still beats "No chart data".
const CHART_TTL = 5 * 60 * 1000
const _chartCache = new Map<string, { prices: Array<[number, number]>; exp: number }>()
const _chartInflight = new Map<string, Promise<Array<[number, number]>>>()

export async function fetchCoinChart(
  coinId: string,
  days: string,
  config?: WalletConfig
): Promise<Array<[number, number]>> {
  const key = `${coinId}:${days}`
  const cached = _chartCache.get(key)
  if (cached && cached.exp > Date.now()) return cached.prices

  const inflight = _chartInflight.get(key)
  if (inflight) return inflight

  const p = doFetchChart(coinId, days, config).finally(() => {
    if (_chartInflight.get(key) === p) _chartInflight.delete(key)
  })
  _chartInflight.set(key, p)
  return p
}

async function doFetchChart(
  coinId: string,
  days: string,
  config?: WalletConfig
): Promise<Array<[number, number]>> {
  const key = `${coinId}:${days}`
  const keep = (prices: Array<[number, number]>) => {
    _chartCache.set(key, { prices, exp: Date.now() + CHART_TTL })
    return prices
  }

  // ALL: Binance weekly klines first — ~4y of keyless history, while CoinGecko's
  // public API caps at 365 days (the Worker serves a degraded 1-year "max").
  if (days === 'max') {
    try {
      const prices = await fetchCoinChartBinance(coinId, days)
      if (prices.length >= 2) return keep(prices)
    } catch { /* fall through */ }
  }

  // 1) Worker global cache (KV-cached per coin+timeframe, shared by all users)
  if (config && proxyBase(config)) {
    try {
      const res = await fetch(`${proxyBase(config)}/market/chart/${encodeURIComponent(coinId)}?days=${days}`, {
        headers: proxyHeaders(config, { accept: 'application/json' }),
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) {
        const json = await res.json() as { prices?: Array<[number, number]> }
        if (Array.isArray(json.prices) && json.prices.length >= 2) return keep(json.prices)
      }
    } catch { /* fall through */ }
  }

  // 2) Direct keyless CoinGecko
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`,
      { signal: AbortSignal.timeout(15_000) }
    )
    if (res.ok) {
      const json = await res.json() as { prices: Array<[number, number]> }
      const prices = json.prices ?? []
      if (prices.length >= 2) return keep(prices)
    }
    // Rate limited or empty — fall through to Binance
  } catch { /* fall through */ }

  // 3) Binance klines (limited symbol coverage)
  try {
    const prices = await fetchCoinChartBinance(coinId, days)
    if (prices.length >= 2) return keep(prices)
  } catch { /* fall through */ }

  // 4) Total failure — serve the last chart we ever had, even if expired.
  return _chartCache.get(key)?.prices ?? []
}
