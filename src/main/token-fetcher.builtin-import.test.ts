/**
 * Manual token/NFT imports on a BUILT-IN chain.
 *
 * Importing by contract address started out custom-network-only, on the logic
 * that every supported chain is auto-detected anyway. It isn't reliable: Alchemy
 * misses fresh deploys, thin-liquidity ERC-20s and NFTs it hasn't indexed, and
 * the user had no fallback when it did. So an import now works on any EVM
 * network — and the load-bearing rule is that it must NEVER double-render
 * something the chain's own indexer already returned.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WalletConfig } from './secure-store'

vi.mock('./secure-store', () => ({
  loadFloorCache: vi.fn(async () => ({})),
  saveFloorCache: vi.fn(),
  loadTokenBalanceCache: vi.fn(async () => ({})),
  saveTokenBalanceCache: vi.fn(),
}))

vi.mock('./native-prices', () => ({
  getNativeUsd: vi.fn(async () => ({})),
  seedNativeUsd: vi.fn(),
}))

// The Alchemy auto-detect source. Mocked rather than driven through fetch: it
// keeps a 10s in-memory cache keyed by network:address, which would otherwise
// leak one test's balances into the next.
const alchemy = vi.hoisted(() => ({
  getTokenBalances: vi.fn(async (_network: string, _address: string, _config: unknown) =>
    [] as Array<{ contractAddress: string; tokenBalance: string }>),
}))
vi.mock('./alchemy-cache', () => ({ getTokenBalances: alchemy.getTokenBalances }))

import { fetchAllCollectibles, fetchAllTokens, resolveCustomToken } from './token-fetcher'

const EVM = '0x1111111111111111111111111111111111111111'
const TOKEN = '0xdddddddddddddddddddddddddddddddddddddddd'
const NFT_CONTRACT = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

// Proxy-mode URLs, so a built-in chain's RPC is a predictable string to match.
const ETH_RPC = 'https://proxy.example/rpc/alchemy/eth-mainnet?mm_client=test-client'
const BASE_RPC = 'https://proxy.example/rpc/alchemy/base-mainnet?mm_client=test-client'

const config: WalletConfig = {
  alchemyKey: '', ankrKey: '', heliusKey: '', blockfrostKey: '', tatumKey: '',
  moralisKey: '', openseaKey: '', ordiscanKey: '', anvilKey: '',
  supabaseUrl: '', supabaseKey: '', walletConnectProjectId: '',
  swapProxyUrl: 'https://proxy.example', clientToken: 'test-client',
  simpleSwapApiKey: '', testnetMode: false, privacyMode: false,
  torBrowserEnabled: false, torBrowserPort: 9050, moneroRestoreHeight: 0,
  magicGuardEnabled: true,
  customChains: [],
  customTokens: [],
  customNfts: [],
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** 32-byte left-padded hex value, as eth_call returns for uint256. */
function word(n: bigint): string {
  return `0x${n.toString(16).padStart(64, '0')}`
}

/** ABI-encoded dynamic string return (offset + length + padded data). */
function abiString(s: string): string {
  const hex = Buffer.from(s, 'utf8').toString('hex')
  const padded = hex.padEnd(Math.ceil(hex.length / 64) * 64, '0')
  return `0x${(32n).toString(16).padStart(64, '0')}${BigInt(s.length).toString(16).padStart(64, '0')}${padded}`
}

/** The single-call JSON-RPC body every import read sends. */
function callOf(init?: RequestInit): { to: string; data: string } {
  return (JSON.parse(String(init?.body)) as { params: [{ to: string; data: string }] }).params[0]
}

afterEach(() => {
  vi.unstubAllGlobals()
  alchemy.getTokenBalances.mockReset()
  alchemy.getTokenBalances.mockResolvedValue([])
})

describe('imports on a built-in chain', () => {
  it('renders an ERC-20 Alchemy never returned', async () => {
    const cfg: WalletConfig = {
      ...config,
      customTokens: [{ chain: 'ethereum', contractAddress: TOKEN, name: 'Ghost Coin', symbol: 'GHOST', decimals: 18 }],
    }
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === ETH_RPC) {
        const { to, data } = callOf(init)
        expect(to).toBe(TOKEN)
        expect(data.startsWith('0x70a08231')).toBe(true)   // balanceOf(address)
        expect(data.endsWith(EVM.slice(2))).toBe(true)
        return json({ jsonrpc: '2.0', id: 1, result: word(2n * 10n ** 18n) })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAllTokens({ evm: EVM }, cfg)

    expect(result.tokens.filter(t => t.symbol === 'GHOST')).toEqual([
      expect.objectContaining({
        chain: 'ethereum',
        chainLabel: 'Ethereum',
        contractAddress: TOKEN,
        name: 'Ghost Coin',
        decimals: 18,
        balance: '2',
      }),
    ])
  })

  it('does not render an imported ERC-20 twice when Alchemy also returns it', async () => {
    alchemy.getTokenBalances.mockImplementation(async (network: string) =>
      network === 'eth-mainnet' ? [{ contractAddress: TOKEN, tokenBalance: word(5n * 10n ** 18n) }] : []
    )
    const cfg: WalletConfig = {
      ...config,
      customTokens: [{ chain: 'ethereum', contractAddress: TOKEN, name: 'Ghost Coin', symbol: 'GHOST', decimals: 18 }],
    }
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === ETH_RPC) {
        // alchemy_getTokenMetadata arrives as a BATCH; the import's balanceOf doesn't.
        if (Array.isArray(JSON.parse(String(init?.body)))) {
          return json([{ id: 1, result: { name: 'Ghost Coin', symbol: 'GHOST', decimals: 18, logo: null } }])
        }
        return json({ jsonrpc: '2.0', id: 1, result: word(5n * 10n ** 18n) })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAllTokens({ evm: EVM }, cfg)

    // Exactly one row — the auto-detected one wins, the import is dropped.
    expect(result.tokens.filter(t => t.contractAddress.toLowerCase() === TOKEN)).toHaveLength(1)
  })

  it('renders an imported NFT and counts it against its chain', async () => {
    const cfg: WalletConfig = {
      ...config,
      customNfts: [{ chain: 'base', contractAddress: NFT_CONTRACT, tokenId: '7', type: 'ERC-721' }],
    }
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url === BASE_RPC) {
        const { data } = callOf(init)
        if (data.startsWith('0x6352211e')) return json({ jsonrpc: '2.0', id: 1, result: word(BigInt(EVM)) })                   // ownerOf
        if (data.startsWith('0xc87b56dd')) return json({ jsonrpc: '2.0', id: 1, result: abiString('https://meta.example/7') }) // tokenURI
        if (data.startsWith('0x06fdde03')) return json({ jsonrpc: '2.0', id: 1, result: abiString('Ghosts') })                 // name()
        return json({ jsonrpc: '2.0', id: 1, result: '0x' })
      }
      if (url === 'https://meta.example/7') {
        return json({ name: 'Ghost #7', image: 'ipfs://ghost', attributes: [{ trait_type: 'Rank', value: 'A' }] })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAllCollectibles(EVM, undefined, cfg)

    expect(result.items.filter(n => n.contractAddress === NFT_CONTRACT)).toEqual([
      expect.objectContaining({
        id: `base:${NFT_CONTRACT}:7`,
        chain: 'base',
        tokenId: '7',
        name: 'Ghost #7',
        collectionName: 'Ghosts',
        contractType: 'ERC-721',
      }),
    ])
    // The Collectibles tab reads its per-chain counts from here, so an import
    // that isn't folded in makes the chain under-report.
    expect(result.chainResults['base']?.count).toBe(1)
  })

  it('does not render an imported NFT twice when Alchemy also returns it', async () => {
    const cfg: WalletConfig = {
      ...config,
      customNfts: [{ chain: 'base', contractAddress: NFT_CONTRACT, tokenId: '7', type: 'ERC-721' }],
    }
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/alchemy-nft/base-mainnet/getNFTsForOwner')) {
        return json({
          ownedNfts: [{
            contract: { address: NFT_CONTRACT, name: 'Ghosts', tokenType: 'ERC721' },
            tokenId: '7', name: 'Ghost #7',
          }],
        })
      }
      if (url === BASE_RPC) {
        const { data } = callOf(init)
        if (data.startsWith('0x6352211e')) return json({ jsonrpc: '2.0', id: 1, result: word(BigInt(EVM)) })
        if (data.startsWith('0xc87b56dd')) return json({ jsonrpc: '2.0', id: 1, result: abiString('https://meta.example/7') })
        if (data.startsWith('0x06fdde03')) return json({ jsonrpc: '2.0', id: 1, result: abiString('Ghosts') })
        return json({ jsonrpc: '2.0', id: 1, result: '0x' })
      }
      if (url === 'https://meta.example/7') return json({ name: 'Ghost #7' })
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAllCollectibles(EVM, undefined, cfg)

    expect(result.items.filter(n => n.contractAddress === NFT_CONTRACT)).toHaveLength(1)
    expect(result.chainResults['base']?.count).toBe(1)
  })

  it('drops an imported NFT this wallet no longer owns', async () => {
    const cfg: WalletConfig = {
      ...config,
      customNfts: [{ chain: 'base', contractAddress: NFT_CONTRACT, tokenId: '7', type: 'ERC-721' }],
    }
    const someoneElse = '0x2222222222222222222222222222222222222222'
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === BASE_RPC) {
        const { data } = callOf(init)
        if (data.startsWith('0x6352211e')) return json({ jsonrpc: '2.0', id: 1, result: word(BigInt(someoneElse)) })
        return json({ jsonrpc: '2.0', id: 1, result: '0x' })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAllCollectibles(EVM, undefined, cfg)
    expect(result.items.filter(n => n.contractAddress === NFT_CONTRACT)).toHaveLength(0)
  })

  it('resolves a token contract against a built-in chain RPC', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === ETH_RPC) {
        const { data } = callOf(init)
        if (data === '0x06fdde03') return json({ jsonrpc: '2.0', id: 1, result: abiString('Ghost Coin') })
        if (data === '0x95d89b41') return json({ jsonrpc: '2.0', id: 1, result: abiString('GHOST') })
        if (data === '0x313ce567') return json({ jsonrpc: '2.0', id: 1, result: word(18n) })
        return json({ jsonrpc: '2.0', id: 1, result: word(4n * 10n ** 18n) })   // balanceOf
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(resolveCustomToken('ethereum', TOKEN, EVM, config)).resolves.toEqual({
      name: 'Ghost Coin', symbol: 'GHOST', decimals: 18, balance: '4',
    })
  })

  it('rejects a chain the wallet does not know', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({})))
    await expect(resolveCustomToken('not-a-chain', TOKEN, EVM, config)).rejects.toThrow('Unknown network')
  })
})
