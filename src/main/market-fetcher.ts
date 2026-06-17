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
}

let _cache: MarketResult | null = null
let _cacheTime = 0
const CACHE_TTL = 2 * 60 * 1000

function mapCoin(c: {
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

export async function fetchMarketTop100(): Promise<MarketResult> {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache

  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=24h',
      { signal: AbortSignal.timeout(15_000) }
    )
    if (!res.ok) return { coins: [], fetchedAt: Date.now(), error: `HTTP ${res.status}` }

    const json = await res.json() as Parameters<typeof mapCoin>[0][]
    const coins = json.map(mapCoin)

    _cache = { coins, fetchedAt: Date.now(), error: null }
    _cacheTime = Date.now()
    return _cache
  } catch (e) {
    return { coins: [], fetchedAt: Date.now(), error: String(e) }
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

    const priceJson = await priceRes.json() as Parameters<typeof mapCoin>[0][]
    return priceJson.map(mapCoin)
  } catch {
    return []
  }
}

export async function fetchCoinChart(
  coinId: string,
  days: string
): Promise<Array<[number, number]>> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`,
      { signal: AbortSignal.timeout(15_000) }
    )
    if (!res.ok) return []
    const json = await res.json() as { prices: Array<[number, number]> }
    return json.prices ?? []
  } catch {
    return []
  }
}
