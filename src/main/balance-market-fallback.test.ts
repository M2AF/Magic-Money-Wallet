/**
 * Networks-tab prices must survive CoinGecko refusing this device.
 *
 * Measured 2026-09-29: keyless api.coingecko.com answered every call from the
 * user's IP with a CloudFront "Request blocked" 403. The last-good cache is
 * in-memory, so after an app restart every network showed $0.00. The Worker's
 * keyed top-500 list (the Market tab's source) now backfills missing coins.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { WalletConfig } from './secure-store'

const market = vi.hoisted(() => ({ fetchMarketTop100: vi.fn() }))
vi.mock('./market-fetcher', () => market)

import { fetchMarketData } from './balance-fetcher'

const config = { swapProxyUrl: 'https://proxy.example', clientToken: 't' } as WalletConfig
const blocked = () => new Response('<H1>403 ERROR</H1> Request blocked.', { status: 403 })
const coin = (id: string, price: number) => ({
  id, rank: 1, name: id, symbol: id, image: '', price, change24h: 1.5, marketCap: null, sparkline: [price, price],
})

beforeEach(() => { market.fetchMarketTop100.mockReset() })
afterEach(() => { vi.unstubAllGlobals() })

describe('fetchMarketData fallback', () => {
  it('prices every coin from the Worker list when CoinGecko is blocked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => blocked()))
    market.fetchMarketTop100.mockResolvedValue({ coins: [coin('monad', 0.027), coin('cardano', 0.25)], fetchedAt: 0, error: null })

    const out = await fetchMarketData(['monad', 'cardano', 'unlisted-coin'], config)

    expect(out.monad).toEqual({ price: 0.027, change24h: 1.5, sparkline: [0.027, 0.027] })
    expect(out.cardano.price).toBe(0.25)
    expect(out['unlisted-coin']).toBeUndefined()
    expect(market.fetchMarketTop100).toHaveBeenCalledWith(config)
  })

  it('does not touch the Worker list when CoinGecko answers for every coin', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([
      { id: 'dogecoin', current_price: 0.09, price_change_percentage_24h: 0.4, sparkline_in_7d: { price: [0.09] } },
    ])))

    const out = await fetchMarketData(['dogecoin'], config)

    expect(out.dogecoin.price).toBe(0.09)
    expect(market.fetchMarketTop100).not.toHaveBeenCalled()
  })

  it('keeps last-known prices when both sources fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([
      { id: 'tron', current_price: 0.33, price_change_percentage_24h: null },
    ])))
    await fetchMarketData(['tron'], config)

    vi.stubGlobal('fetch', vi.fn(async () => blocked()))
    market.fetchMarketTop100.mockRejectedValue(new Error('Worker market 500'))

    expect((await fetchMarketData(['tron'], config)).tron.price).toBe(0.33)
  })
})
