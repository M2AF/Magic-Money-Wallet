/**
 * Alchemy is the primary asset indexer; Moralis is the second source.
 *
 * When the shared Alchemy account hit its monthly capacity, every EVM chain went
 * blank — except Monad, whose NFTs were already coming from Moralis on a separate
 * key and a separate quota. These tests pin that same escape hatch onto the
 * Alchemy chains, for both tokens and NFTs.
 *
 * Deliberately NOT covered by the fallback: chains Moralis rejects with "chain
 * must be a valid enum value" (blast, zora, worldchain, soneium, apechain,
 * abstract, robinhood). Those must keep REPORTING the outage rather than
 * silently rendering an empty tab, which the last test asserts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

import { fetchAllTokens, fetchAllCollectibles } from './token-fetcher'

const config: WalletConfig = {
  alchemyKey: '', ankrKey: '', heliusKey: '', blockfrostKey: '', tatumKey: '',
  moralisKey: '', openseaKey: '', ordiscanKey: '', anvilKey: '',
  supabaseUrl: '', supabaseKey: '', walletConnectProjectId: '',
  swapProxyUrl: 'https://proxy.example', clientToken: 'test-client',
  simpleSwapApiKey: '', testnetMode: false, privacyMode: false,
  torBrowserEnabled: false, torBrowserPort: 9050, moneroRestoreHeight: 0,
  magicGuardEnabled: true, customChains: [], customTokens: [], customNfts: [],
}

const TOKEN = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const NFT_CONTRACT = '0xcccccccccccccccccccccccccccccccccccccccc'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** The live shape of a spent Alchemy capacity budget. */
const CAPACITY_MSG = 'Monthly capacity limit exceeded.'
const capacity429 = () => new Response(CAPACITY_MSG, { status: 429 })

let addr = 0
/** A fresh address per call defeats the 10s coalescing cache in alchemy-cache.ts. */
const nextAddress = () => `0x${String(++addr).padStart(40, '0')}`

beforeEach(() => { addr = 0 })
afterEach(() => { vi.unstubAllGlobals() })

describe('Moralis fallback when Alchemy is spent', () => {
  it('recovers a chain’s tokens, with metadata, from Moralis', async () => {
    const moralisChains: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      // Every Alchemy route is out of capacity.
      if (url.pathname.includes('/alchemy-data/') || url.pathname.includes('/rpc/alchemy/')) return capacity429()
      if (url.pathname.includes('/moralis/') && url.pathname.endsWith('/erc20')) {
        const chain = url.searchParams.get('chain') ?? ''
        moralisChains.push(chain)
        if (chain !== '0x1') return json([])
        return json([
          {
            token_address: TOKEN, symbol: 'RESCUE', name: 'Rescued Token',
            logo: null, decimals: 2, balance: '500', possible_spam: false,
          },
          // Moralis flags airdrop spam itself — never import it.
          {
            token_address: '0xdead', symbol: 'SPAM', name: 'Spam',
            logo: null, decimals: 18, balance: '1', possible_spam: true,
          },
        ])
      }
      // Every other source (Helius/Blockfrost/Monad RPC/Tron/Ordiscan) is empty.
      return json({})
    }))

    const result = await fetchAllTokens({ evm: nextAddress() }, config)

    const eth = result.tokens.filter(t => t.chain === 'ethereum')
    expect(eth).toEqual([
      expect.objectContaining({ contractAddress: TOKEN, symbol: 'RESCUE', name: 'Rescued Token', balance: '5' }),
    ])
    // Recovered means recovered: the chain must NOT be reported as unavailable.
    expect(result.chainErrors?.ethereum).toBeUndefined()
    // Only chains Moralis indexes are ever asked.
    expect(moralisChains).toContain('0x1')
    expect(moralisChains).not.toContain('0x1237')   // robinhood
  }, 30_000)

  it('still reports chains Moralis cannot serve', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.includes('/alchemy-data/') || url.pathname.includes('/rpc/alchemy/')) return capacity429()
      if (url.pathname.includes('/moralis/')) return json([])
      return json({})
    }))

    const result = await fetchAllTokens({ evm: nextAddress() }, config)

    // Robinhood and Blast have no second source, so the outage must stay visible.
    expect(result.chainErrors?.robinhood).toBeTruthy()
    expect(result.chainErrors?.blast).toBeTruthy()
    // Ethereum answered (empty, but truthfully) via Moralis.
    expect(result.chainErrors?.ethereum).toBeUndefined()
  }, 30_000)

  it('recovers a chain’s NFTs from Moralis', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.includes('/alchemy-nft/')) return capacity429()
      if (url.pathname.includes('/moralis/') && url.pathname.endsWith('/nft')) {
        if (url.searchParams.get('chain') !== '0x1') return json({ result: [], cursor: null })
        return json({
          result: [{
            token_address: NFT_CONTRACT, token_id: '7', contract_type: 'ERC721',
            name: 'Rescued Collection',
            normalized_metadata: {
              name: 'Rescued #7', description: 'via Moralis',
              image: 'ipfs://img-7', attributes: [{ trait_type: 'Fur', value: 'Gold' }],
            },
            media: null,
          }],
          cursor: null,
        })
      }
      return json({})
    }))

    const result = await fetchAllCollectibles(nextAddress(), undefined, config)

    expect(result.items.filter(n => n.chain === 'ethereum')).toEqual([
      expect.objectContaining({
        contractAddress: NFT_CONTRACT,
        tokenId: '7',
        name: 'Rescued #7',
        image: 'https://ipfs.io/ipfs/img-7',
        traits: [{ trait_type: 'Fur', value: 'Gold' }],
      }),
    ])
    expect(result.chainResults['ethereum']).toMatchObject({ count: 1, error: null })
    // No second source for Robinhood — it must still show the failure.
    expect(result.chainResults['robinhood']?.error).toBeTruthy()
  }, 30_000)
})
