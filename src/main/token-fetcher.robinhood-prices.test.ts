/**
 * Regression: Robinhood ERC-20s must be priced and get a logo.
 *
 * Robinhood was never added to DS_CHAIN, so enrichWithPrices dropped every
 * DexScreener pair for the chain (`pair.chainId !== dsChain`). Tokens rendered
 * at $0 with no icon even though DexScreener lists the chain as `robinhood`.
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
  getNativeUsd: vi.fn(async (ids: string[]) => Object.fromEntries(
    ids.map(id => [id, id === 'ethereum' ? 4000 : 1])
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

const EVM_ADDRESS = '0x2222222222222222222222222222222222222222'
const TOKEN = '0x008df4b3e857d06c4603aeb11f267ccd32ce2005'
const IMAGE = 'https://cdn.dexscreener.com/cms/images/hood.png'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('Robinhood token prices', () => {
  it('prices Robinhood ERC-20s and takes their logo from DexScreener', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)

      if (url.includes('/alchemy-data/assets/tokens/by-address')) {
        const body = JSON.parse(String(init?.body)) as { addresses: Array<{ networks: string[] }> }
        return body.addresses[0].networks[0] === 'robinhood-mainnet'
          ? json({ data: { tokens: [{ tokenAddress: TOKEN, tokenBalance: '0x0a' }] } })
          : json({ data: { tokens: [] } })
      }
      if (url.includes('/rpc/alchemy/robinhood-mainnet')) {
        const requests = JSON.parse(String(init?.body)) as Array<{ id: number }>
        return json(requests.map(req => ({
          jsonrpc: '2.0', id: req.id,
          result: { name: 'Robinhood', symbol: 'ROBINHOOD', decimals: 0, logo: null },
        })))
      }
      if (url.startsWith('https://api.dexscreener.com/latest/dex/tokens/')) {
        return json({ pairs: [{
          chainId: 'robinhood',
          priceUsd: '0.5',
          baseToken: { address: '0x008Df4b3E857D06c4603Aeb11F267ccD32ce2005' },
          info: { imageUrl: IMAGE },
          liquidity: { usd: 100_000 },
        }] })
      }
      // Every other source (Monad RPC, etc.) is irrelevant here.
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAllTokens({ evm: EVM_ADDRESS }, config)
    const hood = result.tokens.filter(t => t.chain === 'robinhood')

    expect(hood).toEqual([
      expect.objectContaining({ contractAddress: TOKEN, symbol: 'ROBINHOOD', balance: '10', usdValue: 5, logoUri: IMAGE }),
    ])
    expect(hood[0].suspectedSpam).toBeFalsy()
  })
})
