/**
 * Custom (user-added) chain assets: Blockscout auto-detect for tokens + NFTs,
 * and manual ERC-20 imports read straight off the chain's own RPC.
 *
 * These are the only asset sources arbitrary chains can have — no Alchemy or
 * Moralis coverage exists for a network the user typed in by hand.
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
  getNativeUsd: vi.fn(async () => ({})),
  seedNativeUsd: vi.fn(),
}))

import { fetchAllCollectibles, fetchAllTokens, resolveCustomToken, resolveCustomNft } from './token-fetcher'

const EVM = '0x1111111111111111111111111111111111111111'
const TOKEN_AUTO = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TOKEN_MANUAL = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const NFT_CONTRACT = '0xcccccccccccccccccccccccccccccccccccccccc'
const RPC = 'https://rpc.mychain.example'
const EXPLORER = 'https://scan.mychain.example'

// Testnet mode is ON for every case here EXCEPT where noted: it short-circuits
// the ~20 built-in mainnet chain fetches, so a test only has to answer the
// requests the custom-chain path makes. Custom chains are mainnet-only, so the
// base config below keeps testnetMode false and stubs the built-ins to empty.
const config: WalletConfig = {
  alchemyKey: '', ankrKey: '', heliusKey: '', blockfrostKey: '', tatumKey: '',
  moralisKey: '', openseaKey: '', ordiscanKey: '', anvilKey: '',
  supabaseUrl: '', supabaseKey: '', walletConnectProjectId: '',
  swapProxyUrl: 'https://proxy.example', clientToken: 'test-client',
  simpleSwapApiKey: '', testnetMode: false, privacyMode: false,
  torBrowserEnabled: false, torBrowserPort: 9050, moneroRestoreHeight: 0,
  magicGuardEnabled: true,
  customChains: [{
    id: 'custom-9999', name: 'My Chain', chainId: 9999,
    nativeSymbol: 'MYC', rpcUrl: RPC, explorerUrl: EXPLORER,
  }],
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

afterEach(() => { vi.unstubAllGlobals() })

describe('custom chain assets', () => {
  it('auto-detects ERC-20s from a Blockscout explorer', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === `${EXPLORER}/api/v2/addresses/${EVM}/token-balances`) {
        return json([
          {
            value: '2500000',
            token: { address: TOKEN_AUTO, name: 'Auto Coin', symbol: 'AUTO', decimals: '6', type: 'ERC-20', icon_url: 'https://cdn.example/auto.png' },
          },
          // Zero balances and non-ERC-20 rows must be dropped — 721s belong on
          // the Collectibles tab, not the Tokens tab.
          { value: '0', token: { address: TOKEN_MANUAL, symbol: 'ZERO', decimals: '18', type: 'ERC-20' } },
          { value: '1', token: { address: NFT_CONTRACT, symbol: 'NFT', decimals: '0', type: 'ERC-721' } },
        ])
      }
      // Every built-in mainnet source: answer empty so only the custom path contributes.
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAllTokens({ evm: EVM }, config)
    const mine = result.tokens.filter(t => t.chain === 'custom-9999')

    expect(mine).toEqual([
      expect.objectContaining({
        contractAddress: TOKEN_AUTO,
        name: 'Auto Coin',
        symbol: 'AUTO',
        decimals: 6,
        balance: '2.5',
        chainLabel: 'My Chain',
        chainColor: '#FFFFFF',
        nativeSymbol: 'MYC',
        logoUri: 'https://cdn.example/auto.png',
        usdValue: null,      // no price source exists for an arbitrary chain
      }),
    ])
  })

  it('reads manually imported ERC-20s via balanceOf, skipping duplicates of auto-detect', async () => {
    const cfg: WalletConfig = {
      ...config,
      customTokens: [
        { chain: 'custom-9999', contractAddress: TOKEN_MANUAL, name: 'Manual Coin', symbol: 'MAN', decimals: 18 },
        // Already returned by Blockscout below — must not render twice.
        { chain: 'custom-9999', contractAddress: TOKEN_AUTO, name: 'Auto Coin', symbol: 'AUTO', decimals: 6 },
      ],
    }
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/v2/addresses/')) {
        return json([{ value: '1000000', token: { address: TOKEN_AUTO, name: 'Auto Coin', symbol: 'AUTO', decimals: '6', type: 'ERC-20' } }])
      }
      if (url === RPC) {
        const body = JSON.parse(String(init?.body)) as { method: string; params: [{ to: string; data: string }] }
        expect(body.method).toBe('eth_call')
        // balanceOf(address) selector, holder right-aligned in the calldata word
        expect(body.params[0].data.startsWith('0x70a08231')).toBe(true)
        expect(body.params[0].data.endsWith(EVM.slice(2))).toBe(true)
        expect(body.params[0].to).toBe(TOKEN_MANUAL)
        return json({ jsonrpc: '2.0', id: 1, result: word(3_000_000_000_000_000_000n) })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAllTokens({ evm: EVM }, cfg)
    const mine = result.tokens.filter(t => t.chain === 'custom-9999')

    expect(mine.map(t => t.symbol).sort()).toEqual(['AUTO', 'MAN'])
    expect(mine.find(t => t.symbol === 'MAN')).toEqual(
      expect.objectContaining({ balance: '3', name: 'Manual Coin', decimals: 18 })
    )
    // Exactly one AUTO row despite being both auto-detected and imported.
    expect(mine.filter(t => t.symbol === 'AUTO')).toHaveLength(1)
  })

  it('never flags a hand-imported token as spam', async () => {
    // Spam heuristics fire on claim-bait names with no USD value — which is every
    // token on a custom chain, so imports have to be exempt.
    const cfg: WalletConfig = {
      ...config,
      customTokens: [{
        chain: 'custom-9999', contractAddress: TOKEN_MANUAL,
        name: 'Claim your reward at freeclaim.example', symbol: 'CLAIM', decimals: 18,
      }],
    }
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/api/v2/addresses/')) return json([])
      if (url === RPC) return json({ jsonrpc: '2.0', id: 1, result: word(10n ** 18n) })
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAllTokens({ evm: EVM }, cfg)
    const claim = result.tokens.find(t => t.symbol === 'CLAIM')
    expect(claim).toBeDefined()
    expect(claim?.suspectedSpam).toBeUndefined()
  })

  it('auto-detects NFTs from a Blockscout explorer', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes(`${EXPLORER}/api/v2/addresses/${EVM}/nft`)) {
        expect(url).toContain('type=ERC-721%2CERC-1155')
        return json({
          items: [{
            id: '42',
            token_type: 'ERC-721',
            image_url: 'ipfs://my-image',
            metadata: { name: 'My NFT #42', description: 'On a custom chain', attributes: [{ trait_type: 'Rank', value: 'A' }] },
            token: { address: NFT_CONTRACT, name: 'My Collection', type: 'ERC-721' },
          }],
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAllCollectibles(EVM, undefined, config)

    expect(result.chainResults['custom-9999']).toEqual({ count: 1, error: null })
    expect(result.items.filter(n => n.chain === 'custom-9999')).toEqual([
      expect.objectContaining({
        id: `custom-9999:${NFT_CONTRACT}:42`,
        name: 'My NFT #42',
        image: 'https://ipfs.io/ipfs/my-image',
        collectionName: 'My Collection',
        chainLabel: 'My Chain',
        chainColor: '#FFFFFF',
        tokenId: '42',
        traits: [{ trait_type: 'Rank', value: 'A' }],
      }),
    ])
  })

  it('yields nothing when the explorer is not Blockscout', async () => {
    // A non-Blockscout explorer 404s the /api/v2 probe; the chain still works for
    // balances and sends, it just contributes no tokens or NFTs.
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('/api/v2/')) return json({ message: 'Not found' }, 404)
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const tokens = await fetchAllTokens({ evm: EVM }, config)
    const nfts = await fetchAllCollectibles(EVM, undefined, config)

    expect(tokens.tokens.filter(t => t.chain === 'custom-9999')).toEqual([])
    expect(nfts.items.filter(n => n.chain === 'custom-9999')).toEqual([])
    expect(tokens.error).toBeNull()
    expect(nfts.error).toBeNull()
  })

  it('resolves an ERC-20 for the import form and rejects a non-token address', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) !== RPC) return json({})
      const body = JSON.parse(String(init?.body)) as { params: [{ data: string }] }
      const sel = body.params[0].data.slice(0, 10)
      if (sel === '0x06fdde03') return json({ result: abiString('Manual Coin') })   // name()
      if (sel === '0x95d89b41') return json({ result: abiString('MAN') })           // symbol()
      if (sel === '0x313ce567') return json({ result: word(18n) })                  // decimals()
      if (sel === '0x70a08231') return json({ result: word(5n * 10n ** 18n) })      // balanceOf()
      return json({ result: '0x' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(resolveCustomToken('custom-9999', TOKEN_MANUAL, EVM, config)).resolves.toEqual({
      name: 'Manual Coin', symbol: 'MAN', decimals: 18, balance: '5',
    })

    // An address with no ERC-20 interface returns '0x' for every call → reject.
    vi.stubGlobal('fetch', vi.fn(async () => json({ result: '0x' })))
    await expect(resolveCustomToken('custom-9999', TOKEN_MANUAL, EVM, config))
      .rejects.toThrow(/does not look like an ERC-20/)
  })

  // ── Manually imported NFTs ────────────────────────────────────────────────
  // Selector reference: supportsInterface 0x01ffc9a7, ownerOf 0x6352211e,
  // tokenURI 0xc87b56dd, uri 0x0e89341c, balanceOf(addr,id) 0x00fdd58e,
  // balanceOf(addr) 0x70a08231, tokenOfOwnerByIndex 0x2f745c59, name 0x06fdde03.

  /** An ERC-721 that owns #7, with metadata served as a data: URI. */
  function erc721Mock(opts: { owner?: string; enumerable?: boolean } = {}) {
    const owner = opts.owner ?? EVM
    const meta = { name: 'Rock #7', description: 'A rock', image: 'ipfs://rock-seven', attributes: [{ trait_type: 'Hard', value: 'Yes' }] }
    const dataUri = `data:application/json;base64,${Buffer.from(JSON.stringify(meta)).toString('base64')}`
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) !== RPC) return json({})
      const data = (JSON.parse(String(init?.body)) as { params: [{ data: string }] }).params[0].data
      const sel = data.slice(0, 10)
      if (sel === '0x01ffc9a7') {
        const iface = data.slice(10, 18)
        return json({ result: word(iface === '80ac58cd' ? 1n : 0n) })
      }
      if (sel === '0x6352211e') return json({ result: word(BigInt(owner)) })
      if (sel === '0xc87b56dd') return json({ result: abiString(dataUri) })
      if (sel === '0x06fdde03') return json({ result: abiString('Rocks') })
      if (sel === '0x70a08231') return json({ result: word(opts.enumerable ? 1n : 0n) })
      if (sel === '0x2f745c59') return json({ result: opts.enumerable ? word(7n) : '0x' })
      return json({ result: '0x' })
    })
  }

  it('previews an ERC-721 by token id, decoding data: URI metadata', async () => {
    vi.stubGlobal('fetch', erc721Mock())

    const r = await resolveCustomNft('custom-9999', NFT_CONTRACT, '7', EVM, config)

    expect(r.type).toBe('ERC-721')
    expect(r.collectionName).toBe('Rocks')
    expect(r.owned).toEqual([
      // The image is what makes the confirmation visual — ipfs:// must be resolved.
      { tokenId: '7', name: 'Rock #7', image: 'https://ipfs.io/ipfs/rock-seven' },
    ])
  })

  it('lists the wallet’s own tokens when no id is given (Enumerable ERC-721)', async () => {
    vi.stubGlobal('fetch', erc721Mock({ enumerable: true }))

    const r = await resolveCustomNft('custom-9999', NFT_CONTRACT, undefined, EVM, config)

    expect(r.owned.map(o => o.tokenId)).toEqual(['7'])
    expect(r.owned[0].name).toBe('Rock #7')
  })

  it('refuses to import an NFT this wallet does not own', async () => {
    vi.stubGlobal('fetch', erc721Mock({ owner: '0x9999999999999999999999999999999999999999' }))

    await expect(resolveCustomNft('custom-9999', NFT_CONTRACT, '7', EVM, config))
      .rejects.toThrow(/does not own that token ID/)
  })

  it('rejects an address that is not an NFT collection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ result: '0x' })))

    await expect(resolveCustomNft('custom-9999', NFT_CONTRACT, '7', EVM, config))
      .rejects.toThrow(/does not look like an NFT collection/)
  })

  it('requires an explicit token id for ERC-1155', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) !== RPC) return json({})
      const data = (JSON.parse(String(init?.body)) as { params: [{ data: string }] }).params[0].data
      if (data.startsWith('0x01ffc9a7')) {
        return json({ result: word(data.slice(10, 18) === 'd9b67a26' ? 1n : 0n) })
      }
      return json({ result: '0x' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(resolveCustomNft('custom-9999', NFT_CONTRACT, undefined, EVM, config))
      .rejects.toThrow(/Enter the token ID for an ERC-1155/)
  })

  it('renders imported NFTs in the portfolio and drops ones no longer owned', async () => {
    const cfg: WalletConfig = {
      ...config,
      customNfts: [
        { chain: 'custom-9999', contractAddress: NFT_CONTRACT, tokenId: '7', type: 'ERC-721' },
        // Transferred away since import — must silently disappear, not 404 forever.
        { chain: 'custom-9999', contractAddress: TOKEN_MANUAL, tokenId: '3', type: 'ERC-721' },
      ],
    }
    const meta = { name: 'Rock #7', image: 'ipfs://rock-seven', attributes: [{ trait_type: 'Hard', value: 'Yes' }] }
    const dataUri = `data:application/json;base64,${Buffer.from(JSON.stringify(meta)).toString('base64')}`
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/v2/')) return json({ items: [] })
      if (url === RPC) {
        const p = (JSON.parse(String(init?.body)) as { params: [{ to: string; data: string }] }).params[0]
        const sel = p.data.slice(0, 10)
        // Only NFT_CONTRACT #7 is still owned by this wallet.
        if (sel === '0x6352211e') {
          return json({ result: p.to === NFT_CONTRACT ? word(BigInt(EVM)) : word(BigInt('0x9999999999999999999999999999999999999999')) })
        }
        if (sel === '0xc87b56dd') return json({ result: abiString(dataUri) })
        if (sel === '0x06fdde03') return json({ result: abiString('Rocks') })
        return json({ result: '0x' })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAllCollectibles(EVM, undefined, cfg)
    const mine = result.items.filter(n => n.chain === 'custom-9999')

    expect(mine).toEqual([
      expect.objectContaining({
        id: `custom-9999:${NFT_CONTRACT}:7`,
        name: 'Rock #7',
        image: 'https://ipfs.io/ipfs/rock-seven',
        collectionName: 'Rocks',
        tokenId: '7',
        contractType: 'ERC-721',
        chainColor: '#FFFFFF',
        traits: [{ trait_type: 'Hard', value: 'Yes' }],
      }),
    ])
    expect(result.chainResults['custom-9999']).toEqual({ count: 1, error: null })
  })

  it('does not render an imported NFT twice when Blockscout already lists it', async () => {
    const cfg: WalletConfig = {
      ...config,
      customNfts: [{ chain: 'custom-9999', contractAddress: NFT_CONTRACT, tokenId: '7', type: 'ERC-721' }],
    }
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/v2/') && url.includes('/nft')) {
        return json({ items: [{ id: '7', token_type: 'ERC-721', metadata: { name: 'Rock #7' }, token: { address: NFT_CONTRACT, name: 'Rocks' } }] })
      }
      if (url.includes('/api/v2/')) return json([])
      if (url === RPC) {
        const data = (JSON.parse(String(init?.body)) as { params: [{ data: string }] }).params[0].data
        if (data.startsWith('0x6352211e')) return json({ result: word(BigInt(EVM)) })
        return json({ result: '0x' })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAllCollectibles(EVM, undefined, cfg)
    expect(result.items.filter(n => n.id === `custom-9999:${NFT_CONTRACT}:7`)).toHaveLength(1)
  })
})
