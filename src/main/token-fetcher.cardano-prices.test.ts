/**
 * Regression: Cardano native assets DexScreener has no pair for must still be
 * priced and get a logo.
 *
 * DexScreener was the only Cardano token price source, and it lists no pool at
 * all for many real holdings (HUNT, WALDO, OMNI, USDCx …) — those rendered at
 * $0 with no icon. Minswap's aggregator token list covers them by the same
 * Blockfrost `unit`, so enrichWithPrices backfills from it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WalletConfig } from './secure-store'

const blockfrost = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('./api-proxy', async importOriginal => ({
  ...await importOriginal<typeof import('./api-proxy')>(),
  blockfrostFetch: blockfrost.fetch,
}))

vi.mock('./secure-store', () => ({
  loadFloorCache: vi.fn(async () => ({})),
  saveFloorCache: vi.fn(),
  loadTokenBalanceCache: vi.fn(async () => ({})),
  saveTokenBalanceCache: vi.fn(),
  loadTokenMetaCache: vi.fn(async () => ({})),
  saveTokenMetaCache: vi.fn(),
}))

vi.mock('./native-prices', () => ({
  getNativeUsd: vi.fn(async (ids: string[]) => Object.fromEntries(
    ids.map(id => [id, id === 'cardano' ? 0.25 : 1])
  )),
}))

import { fetchAllTokens } from './token-fetcher'

const config: WalletConfig = {
  alchemyKey: '', ankrKey: '', heliusKey: '', blockfrostKey: '', tatumKey: '',
  moralisKey: '', openseaKey: '', ordiscanKey: '', anvilKey: '',
  supabaseUrl: '', supabaseKey: '', walletConnectProjectId: '',
  swapProxyUrl: 'https://proxy.example', clientToken: 'test-client',
  simpleSwapApiKey: '', testnetMode: false, privacyMode: false,
  torBrowserEnabled: false, torBrowserPort: 9050, moneroRestoreHeight: 0,
  magicGuardEnabled: true, customChains: [], customTokens: [], customNfts: [],
}

const ADDRESS = 'addr1test'
const policy = 'b'.repeat(56)
const DEX = `${policy}01`        // has a DexScreener pair
const MINSWAP = `${policy}02`    // DexScreener has nothing; Minswap prices it
const UNKNOWN_DEC = `${policy}03` // no registry decimals, but Minswap says 6

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => {
  vi.unstubAllGlobals()
  blockfrost.fetch.mockReset()
})

describe('Cardano token prices', () => {
  it('backfills price and logo from Minswap where DexScreener has no pair', async () => {
    blockfrost.fetch.mockImplementation(async (path: string) => {
      if (path === `addresses/${ADDRESS}`) {
        return json({ amount: [
          { unit: 'lovelace', quantity: '5000000' },
          { unit: DEX, quantity: '2000000' },
          { unit: MINSWAP, quantity: '3000000' },
          { unit: UNKNOWN_DEC, quantity: '4000000' },
        ] })
      }
      if (path === `assets/${DEX}`) return json({ quantity: '1000000000', metadata: { name: 'Dex', ticker: 'DEX', decimals: 6 } })
      if (path === `assets/${MINSWAP}`) return json({ quantity: '1000000000', metadata: { name: 'Minned', ticker: 'MIN2', decimals: 6 } })
      if (path === `assets/${UNKNOWN_DEC}`) return json({ quantity: '1000000000', asset_name: '554e4b' })
      throw new Error(`Unexpected ${path}`)
    })

    const minswapBodies: Array<{ assets: string[] }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/alchemy-data/assets/tokens/by-address')) return json({ data: { tokens: [] } })
      if (url.startsWith('https://api.dexscreener.com/latest/dex/tokens/')) {
        return json({ pairs: [{
          chainId: 'cardano', priceUsd: '0.5',
          baseToken: { address: DEX },
          info: { imageUrl: 'https://cdn.dexscreener.com/dex.png' },
          liquidity: { usd: 50_000 },
        }] })
      }
      if (url === 'https://agg-api.minswap.org/aggregator/tokens') {
        const body = JSON.parse(String(init?.body)) as { assets: string[] }
        minswapBodies.push(body)
        return json({ tokens: [
          { token_id: MINSWAP, price_by_usd: 2, logo: `https://asset-logos.minswap.org/${MINSWAP}`, decimals: 6 },
          { token_id: UNKNOWN_DEC, price_by_usd: 1, logo: `https://asset-logos.minswap.org/${UNKNOWN_DEC}`, decimals: 6 },
        ] })
      }
      return new Response('not found', { status: 404 })
    }))

    const result = await fetchAllTokens({ evm: '0x3333333333333333333333333333333333333333', cardano: ADDRESS }, config)
    const byUnit = new Map(result.tokens.filter(t => t.chain === 'cardano').map(t => [t.contractAddress, t]))

    // DexScreener already priced and imaged DEX, so only the other two are asked about.
    expect(minswapBodies).toEqual([expect.objectContaining({ assets: [MINSWAP, UNKNOWN_DEC] })])
    expect(byUnit.get(DEX)).toMatchObject({ usdValue: 1, logoUri: 'https://cdn.dexscreener.com/dex.png' })
    expect(byUnit.get(MINSWAP)).toMatchObject({ usdValue: 6, logoUri: `https://asset-logos.minswap.org/${MINSWAP}` })
    // Balance is the raw 4,000,000 (decimals unknown); pricing it at $1 per WHOLE
    // token would claim $4M. The logo is still safe to use.
    expect(byUnit.get(UNKNOWN_DEC)).toMatchObject({ usdValue: 0, logoUri: `https://asset-logos.minswap.org/${UNKNOWN_DEC}` })
  })
})
