/**
 * Regression: Robinhood NFTs must be able to carry a floor price.
 *
 * Robinhood was added as a first-class chain and registered for Alchemy NFT
 * fetching, so its NFTs appeared in Collectibles — but it was never added to
 * OPENSEA_NFT_CHAIN. Every Robinhood item therefore took the `!osChain` branch,
 * got no floor task queued, and could never show a price the way every other
 * chain's NFTs do. Alchemy's inline `openSeaMetadata.floorPrice` does not cover
 * the chain either, so that map was the ONLY route to a floor.
 *
 * OpenSea does serve the chain (it is listed in GET /chains as `robinhood`, and
 * `chain/robinhood/...` answers), so the fix is the one-line map entry that this
 * test pins in place.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WalletConfig } from './secure-store'

vi.mock('./secure-store', () => ({
  loadFloorCache: vi.fn(async () => ({})),
  saveFloorCache: vi.fn(),
  loadTokenBalanceCache: vi.fn(async () => ({})),
  saveTokenBalanceCache: vi.fn(),
  loadTokenMetaCache: vi.fn(async () => ({})),
  saveTokenMetaCache: vi.fn(),
}))

vi.mock('./native-prices', () => ({
  // Robinhood's native coin is ETH, so the floor converts at the ether price.
  getNativeUsd: vi.fn(async (ids: string[]) => Object.fromEntries(
    ids.map(id => [id, id === 'ethereum' ? 4000 : 1])
  )),
}))

import { fetchNftFloor } from './token-fetcher'

const config: WalletConfig = {
  alchemyKey: '', ankrKey: '', heliusKey: '', blockfrostKey: '', tatumKey: '',
  moralisKey: '', openseaKey: '', ordiscanKey: '', anvilKey: '',
  supabaseUrl: '', supabaseKey: '', walletConnectProjectId: '',
  swapProxyUrl: 'https://proxy.example', clientToken: 'test-client',
  simpleSwapApiKey: '', testnetMode: false, privacyMode: false,
  torBrowserEnabled: false, torBrowserPort: 9050, moneroRestoreHeight: 0,
  magicGuardEnabled: true, customChains: [], customTokens: [], customNfts: [],
}

const NFT_CONTRACT = '0xcccccccccccccccccccccccccccccccccccccccc'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('Robinhood NFT floor', () => {
  it('resolves through the OpenSea robinhood chain and converts ETH to USD', async () => {
    const paths: string[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      paths.push(url.pathname)
      if (url.pathname.includes(`/opensea/chain/robinhood/contract/${NFT_CONTRACT}`)) {
        return json({ collection: 'hoodemons' })
      }
      if (url.pathname.includes('/opensea/collections/hoodemons/stats')) {
        return json({ total: { floor_price: 0.25, floor_price_symbol: 'ETH' } })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchNftFloor('robinhood', NFT_CONTRACT, config)

    // The chain slug must be 'robinhood' — the whole bug was this call never
    // being made at all.
    expect(paths).toEqual([
      `/opensea/chain/robinhood/contract/${NFT_CONTRACT}`,
      '/opensea/collections/hoodemons/stats',
    ])
    // Raw USD number, not display text — the renderer converts and formats it.
    expect(result).toEqual({ floor: '0.2500', currency: 'ETH', floorUsd: 1000 })
  })
})
