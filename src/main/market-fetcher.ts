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
// Stablecoins (USDT/USDC/DAI/BUSD) are skipped since they have no USDT pair.
async function patchPricesFromBinance(coins: MarketCoin[]): Promise<void> {
  const STABLE = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'USDP', 'GUSD'])
  const eligible = coins.filter(c => !STABLE.has(c.symbol))
  const binanceSymbols = eligible.map(c => `${c.symbol}USDT`)

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

export async function fetchMarketTop100(): Promise<MarketResult> {
  const now = Date.now()

  // Return cache immediately if still fresh
  if (_cache && now - _cacheTime < CACHE_TTL) {
    // Kick off a background Binance price patch if prices are stale (> 1 min)
    if (now - _lastPricePatch > PRICE_TTL && _cache.coins.length > 0) {
      _lastPricePatch = now
      patchPricesFromBinance(_cache.coins).then(() => {
        if (_cache) _cache.source = 'CoinGecko + Binance'
      }).catch(() => { /* silent — Binance optional */ })
    }
    return _cache
  }

  // Try CoinGecko first
  try {
    const coins = await fetchFromCoinGecko()
    _cache = { coins, fetchedAt: now, error: null, source: 'CoinGecko' }
    _cacheTime = now

    // Kick off Binance price patch in background (don't await — return CG data immediately)
    _lastPricePatch = now
    patchPricesFromBinance(coins).then(() => {
      if (_cache) _cache.source = 'CoinGecko + Binance'
    }).catch(() => { /* silent */ })

    return _cache
  } catch (cgErr) {
    const status = (cgErr as { status?: number }).status
    const isRateLimit = status === 429 || status === 503

    // CoinGecko failed — try Binance fallback
    try {
      const coins = await fetchFromBinance()
      const result: MarketResult = { coins, fetchedAt: now, error: null, source: 'Binance' }
      // Cache Binance data for a shorter period (no sparklines, so less valuable to cache long)
      _cache = result
      _cacheTime = now - (CACHE_TTL / 2)  // expire in 2.5 min instead of 5
      return result
    } catch (binanceErr) {
      // Both failed — return stale cache if available, or error
      if (_cache) return { ..._cache, error: null }
      const errMsg = isRateLimit ? 'Rate limited — try again in a minute' : String(cgErr)
      return { coins: [], fetchedAt: now, error: errMsg, source: 'CoinGecko' }
    }
  }
}

export async function searchMarketCoins(query: string): Promise<MarketCoin[]> {
  if (!query.trim()) return []
  try {
    const searchRes = await fetch(
      `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(10_000) }
    )
    if (!searchRes.ok) return []
    const searchJson = await searchRes.json() as {
      coins: Array<{ id: string }>
    }

    const ids = searchJson.coins.slice(0, 20).map(c => c.id)
    if (ids.length === 0) return []

    const priceRes = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids.join(',')}&sparkline=true&price_change_percentage=24h&order=market_cap_desc`,
      { signal: AbortSignal.timeout(10_000) }
    )
    if (!priceRes.ok) return []

    const priceJson = await priceRes.json() as Parameters<typeof mapCGCoin>[0][]
    return priceJson.map(mapCGCoin)
  } catch {
    return []
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

export async function fetchCoinChart(
  coinId: string,
  days: string
): Promise<Array<[number, number]>> {
  // Try CoinGecko first
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`,
      { signal: AbortSignal.timeout(15_000) }
    )
    if (res.ok) {
      const json = await res.json() as { prices: Array<[number, number]> }
      const prices = json.prices ?? []
      // Only return CG data if we got actual points — otherwise fall through to Binance
      if (prices.length > 0) return prices
    }
    // Rate limited or empty — fall through to Binance
  } catch { /* fall through */ }

  return fetchCoinChartBinance(coinId, days)
}
