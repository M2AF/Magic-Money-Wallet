/**
 * Regression: Monad NFTs must not depend on Moralis alone.
 *
 * fetchMonadNFTs used Moralis as its ONLY source. When the Moralis plan was
 * paused (401 "Free usage is paused", 2026-09-28) every Monad NFT vanished while
 * Monad tokens — read straight from RPC — kept showing. Alchemy's NFT API serves
 * monad-mainnet, so it is now the primary source with Moralis as the fallback.
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
  getNativeUsd: vi.fn(async (ids: string[]) => Object.fromEntries(ids.map(id => [id, 1]))),
}))

import { fetchAllCollectibles } from './token-fetcher'

const config: WalletConfig = {
  alchemyKey: '', ankrKey: '', heliusKey: '', blockfrostKey: '', tatumKey: '',
  moralisKey: '', openseaKey: '', ordiscanKey: '', anvilKey: '',
  supabaseUrl: '', supabaseKey: '', walletConnectProjectId: '',
  swapProxyUrl: 'https://proxy.example', clientToken: 'test-client',
  simpleSwapApiKey: '', testnetMode: false, privacyMode: false,
  torBrowserEnabled: false, torBrowserPort: 9050, moneroRestoreHeight: 0,
  magicGuardEnabled: true, customChains: [], customTokens: [], customNfts: [],
}

const NFT_CONTRACT = '0xdddddddddddddddddddddddddddddddddddddddd'
let n = 0
const nextAddress = () => `0x${(0x5000 + ++n).toString(16).padStart(40, '0')}`

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const alchemyNft = {
  tokenId: '758',
  contract: { address: NFT_CONTRACT, name: 'Monmilios', tokenType: 'ERC721' },
  name: 'Monmilio #758',
  image: { cachedUrl: 'https://cdn.example/758.png' },
  raw: { metadata: {} },
}

afterEach(() => { vi.unstubAllGlobals() })

function stub(monadAlchemy: 'ok' | 'down') {
  const hits = { alchemyMonad: 0, moralisMonad: 0 }
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.pathname.includes('/alchemy-nft/monad-mainnet/')) {
      hits.alchemyMonad++
      return monadAlchemy === 'ok'
        ? json({ ownedNfts: [alchemyNft], pageKey: null })
        : new Response('Monthly capacity limit exceeded', { status: 429 })
    }
    if (url.pathname.includes('/alchemy-nft/')) return json({ ownedNfts: [], pageKey: null })
    if (url.pathname.includes('/moralis/') && url.searchParams.get('chain') === '0x8f') {
      hits.moralisMonad++
      return json({ result: [{
        token_address: NFT_CONTRACT, token_id: '9', contract_type: 'ERC721', name: 'Monmilios',
        normalized_metadata: { name: 'Monmilio #9', image: 'https://cdn.example/9.png' },
        media: { media_collection: { medium: { url: 'https://cdn.example/9-small.webp' } }, original_media_url: 'https://cdn.example/9-full.png' },
      }], cursor: null })
    }
    return new Response('not found', { status: 404 })
  }))
  return hits
}

const monadItems = (r: { items: Array<{ chain: string }> }) => r.items.filter(i => i.chain === 'monad')

describe('Monad NFTs', () => {
  it('come from Alchemy monad-mainnet without touching Moralis', async () => {
    const hits = stub('ok')
    const result = await fetchAllCollectibles(nextAddress(), undefined, config)

    expect(monadItems(result)).toEqual([
      expect.objectContaining({ name: 'Monmilio #758', tokenId: '758', contractAddress: NFT_CONTRACT, chainLabel: 'Monad' }),
    ])
    expect(hits).toEqual({ alchemyMonad: 1, moralisMonad: 0 })
  })

  it('fall back to Moralis when Alchemy cannot answer', async () => {
    const hits = stub('down')
    const result = await fetchAllCollectibles(nextAddress(), undefined, config)

    expect(monadItems(result)).toEqual([expect.objectContaining({ name: 'Monmilio #9', tokenId: '9', image: 'https://cdn.example/9-full.png', thumbnailUrl: 'https://cdn.example/9-small.webp' })])
    expect(hits.moralisMonad).toBe(1)
  })
})
