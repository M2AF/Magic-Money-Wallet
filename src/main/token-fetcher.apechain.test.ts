import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WalletConfig } from './secure-store'

vi.mock('./secure-store', () => ({
  loadFloorCache: vi.fn(async () => ({})),
  saveFloorCache: vi.fn(),
  loadTokenBalanceCache: vi.fn(async () => ({})),
  saveTokenBalanceCache: vi.fn(),
}))

vi.mock('./native-prices', () => ({
  getNativeUsd: vi.fn(async (ids: string[]) => Object.fromEntries(
    ids.map(id => [id, id === 'apecoin' ? 2 : 1])
  )),
}))

import { fetchAllCollectibles, fetchAllTokens, fetchNftFloor } from './token-fetcher'

const config: WalletConfig = {
  alchemyKey: '',
  ankrKey: '',
  heliusKey: '',
  blockfrostKey: '',
  tatumKey: '',
  moralisKey: '',
  openseaKey: '',
  ordiscanKey: '',
  anvilKey: '',
  supabaseUrl: '',
  supabaseKey: '',
  walletConnectProjectId: '',
  swapProxyUrl: 'https://proxy.example',
  clientToken: 'test-client',
  simpleSwapApiKey: '',
  testnetMode: true,
  privacyMode: false,
  torBrowserEnabled: false,
  torBrowserPort: 9050,
  moneroRestoreHeight: 0,
  magicGuardEnabled: true,
  customChains: [],
}

const EVM_ADDRESS = '0x1111111111111111111111111111111111111111'
const TOKEN_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TOKEN_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const NFT_CONTRACT = '0xcccccccccccccccccccccccccccccccccccccccc'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ApeChain portfolio assets', () => {
  it('loads every paginated ApeChain token and its metadata', async () => {
    const seenNetworks: string[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)

      if (url.includes('/alchemy-data/assets/tokens/by-address')) {
        const body = JSON.parse(String(init?.body)) as {
          addresses: Array<{ networks: string[] }>
          pageKey?: string
        }
        const network = body.addresses[0].networks[0]
        seenNetworks.push(network)
        if (network !== 'apechain-curtis') return json({ data: { tokens: [] } })
        if (!body.pageKey) {
          return json({
            data: {
              tokens: [{ tokenAddress: TOKEN_A, tokenBalance: '0x01' }],
              pageKey: 'ape-token-page-2',
            },
          })
        }
        expect(body.pageKey).toBe('ape-token-page-2')
        return json({
          data: { tokens: [{ tokenAddress: TOKEN_B, tokenBalance: '0x02' }] },
        })
      }

      if (url.includes('/rpc/alchemy/apechain-curtis')) {
        const requests = JSON.parse(String(init?.body)) as Array<{
          id: number
          params: [string]
        }>
        // Deliberately reverse the JSON-RPC batch response: response order is
        // not guaranteed and metadata must be matched by id, not array index.
        return json(requests.map(req => ({
          jsonrpc: '2.0',
          id: req.id,
          result: {
            name: req.params[0].toLowerCase() === TOKEN_A ? 'Ape Token A' : 'Ape Token B',
            symbol: req.params[0].toLowerCase() === TOKEN_A ? 'APEA' : 'APEB',
            decimals: 0,
            logo: null,
          },
        })).reverse())
      }

      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAllTokens({ evm: EVM_ADDRESS }, config)

    expect(seenNetworks).toContain('apechain-curtis')
    expect(result.error).toBeNull()
    expect(result.tokens.filter(t => t.chain === 'apechain')).toEqual([
      expect.objectContaining({ contractAddress: TOKEN_A, symbol: 'APEA', balance: '1', chainLabel: 'ApeChain Curtis' }),
      expect.objectContaining({ contractAddress: TOKEN_B, symbol: 'APEB', balance: '2', chainLabel: 'ApeChain Curtis' }),
    ])
  })

  it('fetches paginated ApeChain NFTs and uses raw metadata fallbacks', async () => {
    const apeRequests: URL[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (!url.pathname.includes('/alchemy-nft/')) throw new Error(`Unexpected request: ${url}`)
      if (!url.pathname.includes('/apechain-curtis/')) return json({ ownedNfts: [] })

      apeRequests.push(url)
      const pageKey = url.searchParams.get('pageKey')
      if (!pageKey) {
        return json({
          ownedNfts: [{
            tokenId: '1',
            contract: { address: NFT_CONTRACT, name: 'Ape Collection', tokenType: 'ERC721' },
            name: null,
            description: null,
            raw: { metadata: {
              name: 'Ape NFT #1',
              description: 'On-chain metadata',
              image: 'ipfs://image-one',
              animation_url: 'ipfs://animation-one',
              attributes: [{ trait_type: 'Fur', value: 'Gold' }],
            } },
          }],
          pageKey: 'ape-nft-page-2',
        })
      }

      expect(pageKey).toBe('ape-nft-page-2')
      return json({
        ownedNfts: [{
          tokenId: '2',
          contract: { address: NFT_CONTRACT, name: 'Ape Collection', tokenType: 'ERC1155' },
          name: 'Ape NFT #2',
          description: 'Second page',
          image: { cachedUrl: 'https://cdn.example/2.png', pngUrl: null, thumbnailUrl: null, originalUrl: null },
          raw: { metadata: { attributes: [] } },
        }],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAllCollectibles(EVM_ADDRESS, undefined, config)

    expect(apeRequests).toHaveLength(2)
    expect(apeRequests[0].searchParams.get('pageSize')).toBe('100')
    expect(result.chainResults.apechain).toEqual({ count: 2, error: null })
    expect(result.items.filter(n => n.chain === 'apechain')).toEqual([
      expect.objectContaining({
        name: 'Ape NFT #1',
        description: 'On-chain metadata',
        image: 'https://ipfs.io/ipfs/image-one',
        animationUrl: 'https://ipfs.io/ipfs/animation-one',
        traits: [{ trait_type: 'Fur', value: 'Gold' }],
      }),
      expect.objectContaining({
        name: 'Ape NFT #2',
        image: 'https://cdn.example/2.png',
        contractType: 'ERC1155',
      }),
    ])
  })

  it('uses the OpenSea ape_chain floor and converts APE to USD', async () => {
    const paths: string[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      paths.push(url.pathname)
      if (url.pathname.includes(`/opensea/chain/ape_chain/contract/${NFT_CONTRACT}`)) {
        return json({ collection: 'ape-collection' })
      }
      if (url.pathname.includes('/opensea/collections/ape-collection/stats')) {
        return json({ total: { floor_price: 2.65, floor_price_symbol: 'APE' } })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchNftFloor('apechain', NFT_CONTRACT, config)

    expect(paths).toEqual([
      `/opensea/chain/ape_chain/contract/${NFT_CONTRACT}`,
      '/opensea/collections/ape-collection/stats',
    ])
    expect(result).toEqual({ floor: '2.6500', currency: 'APE', floorUsd: '$5.30' })
  })
})
