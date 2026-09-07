/**
 * An indexer's `tokenURI` is a claim; the chain is the truth.
 *
 * Alchemy pinned a real collection to a four-day-old pointer: for Robinhood Chain
 * 0x0351...1b31 it kept serving `ar://uOMqV3Xpgl.../1` after the contract's
 * baseURI had moved to `ar://6H-mWZG.../1`, surviving both `refreshCache=true`
 * and the contract's own ERC-4906 events. Every token rendered the wrong art. Its
 * `raw.metadata` was the same stale copy, so no reordering of the image fallbacks
 * could have helped.
 *
 * These tests pin the repair: one Multicall3 read per chain, a gateway fetch ONLY
 * where the chain disagrees, and - the part that matters most - the indexer's
 * data left untouched whenever the verification itself cannot be completed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeFunctionResult, parseAbi } from 'viem'
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

const CONTRACT = '0x0351566c7e98780a591c08000576a01801241b31'
const STALE_URI = 'ar://uOMqV3XpglWY5Z9rW3GCMlJhnGaozxOXPvX95uI0jTQ/1'
const REAL_URI = 'ar://6H-mWZG-HS09ePHPGsrvKLv6FGznHc40FwDNUKK__dE/1'
/**
 * The repair cache is module-scoped and keyed by URI, so tests must not share a
 * pointer or one test's cached document answers another's fetch. A distinct URI
 * per case keeps them independent - and mirrors reality, where a changed pointer
 * is always a cache miss.
 */
const uniqueRealUri = (tag: string) => `ar://6H-mWZG-${tag}/1`
const ALCHEMY_IMG = 'https://nft-cdn.alchemy.com/stale-cached-copy.png'

const MULTICALL_ABI = parseAbi([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[] returnData)',
])
const URI_ABI = parseAbi(['function tokenURI(uint256) view returns (string)'])

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** One owned NFT whose metadata pointer Alchemy reports as `claimed`. */
const ownedNfts = (claimed: string) => ({
  ownedNfts: [{
    tokenId: '1',
    tokenUri: claimed,
    contract: { address: CONTRACT, name: 'REDACTED', tokenType: 'ERC721' },
    name: 'REDACTED #10',
    description: 'stale',
    image: { cachedUrl: ALCHEMY_IMG, thumbnailUrl: null, originalUrl: null, pngUrl: null },
    raw: { metadata: { name: 'REDACTED #10', image: 'ar://old/10.png', attributes: [] } },
  }],
  pageKey: null,
})

/** An aggregate3 response carrying one successful tokenURI return. */
const multicallReturning = (uri: string) => json({
  jsonrpc: '2.0',
  id: 1,
  result: encodeFunctionResult({
    abi: MULTICALL_ABI,
    functionName: 'aggregate3',
    result: [{
      success: true,
      returnData: encodeFunctionResult({ abi: URI_ABI, functionName: 'tokenURI', result: uri }),
    }],
  }),
})

let addr = 0
/** A fresh address per call defeats the 10s coalescing cache in alchemy-cache.ts. */
const nextAddress = () => `0x${String(++addr).padStart(40, '0')}`

interface Counts { rpc: number; gateway: number }

/**
 * @param claimed what the indexer says the pointer is
 * @param onchain what the chain returns, or 'rpc-down'
 * @param gateway the metadata document, or 404
 */
function stub(claimed: string, onchain: string | 'rpc-down', gateway: unknown | 404): Counts {
  const counts: Counts = { rpc: 0, gateway: 0 }
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.pathname.includes('/alchemy-nft/') && url.pathname.includes('getNFTsForOwner')) {
      return url.pathname.includes('robinhood-mainnet')
        ? json(ownedNfts(claimed))
        : json({ ownedNfts: [], pageKey: null })
    }
    if (url.hostname === 'rpc.mainnet.chain.robinhood.com') {
      counts.rpc++
      if (onchain === 'rpc-down') return new Response('boom', { status: 500 })
      return multicallReturning(onchain)
    }
    if (url.hostname === 'arweave.net') {
      counts.gateway++
      return gateway === 404 ? new Response('nope', { status: 404 }) : json(gateway)
    }
    return json({})
  }))
  return counts
}

const robinhoodItems = (r: { items: Array<{ chain: string }> }) =>
  r.items.filter(c => c.chain === 'robinhood')

beforeEach(() => { addr = 0 })
afterEach(() => { vi.unstubAllGlobals() })

describe('on-chain NFT metadata verification', () => {
  it('repairs an NFT whose indexer pointer is stale', async () => {
    const counts = stub(STALE_URI, uniqueRealUri('repair'), {
      name: 'REDACTED #1',
      image: 'ar://images/1.png',
      attributes: [{ trait_type: 'Race', value: 'Pink' }],
    })

    const items = robinhoodItems(await fetchAllCollectibles(nextAddress(), undefined, config))

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      name: 'REDACTED #1',
      image: 'https://arweave.net/images/1.png',
      traits: [{ trait_type: 'Race', value: 'Pink' }],
    })
    expect(counts.gateway).toBe(1)
  }, 30_000)

  it('costs one RPC read and ZERO gateway fetches when the indexer is right', async () => {
    // Same pointer on both sides - the overwhelmingly common case.
    const counts = stub(REAL_URI, REAL_URI, { name: 'unused', image: 'ar://never/fetched.png' })

    const items = robinhoodItems(await fetchAllCollectibles(nextAddress(), undefined, config))

    expect(items[0]).toMatchObject({ name: 'REDACTED #10', image: ALCHEMY_IMG })
    expect(counts.gateway).toBe(0)
    expect(counts.rpc).toBe(1)
  }, 30_000)

  it('treats ar:// and its gateway form as the same pointer', async () => {
    // A resolved-form claim must not look like a mismatch, or every NFT in the
    // wallet would trigger a needless fetch.
    const counts = stub('https://arweave.net/6H-mWZG-HS09ePHPGsrvKLv6FGznHc40FwDNUKK__dE/1', REAL_URI, {})
    await fetchAllCollectibles(nextAddress(), undefined, config)
    expect(counts.gateway).toBe(0)
  }, 30_000)

  it('keeps the indexer data when the chain cannot be read', async () => {
    const counts = stub(STALE_URI, 'rpc-down', { name: 'never', image: 'ar://never.png' })

    const items = robinhoodItems(await fetchAllCollectibles(nextAddress(), undefined, config))

    // Wrong art beats no art: a verification we cannot perform must never blank
    // the wallet.
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ name: 'REDACTED #10', image: ALCHEMY_IMG })
    expect(counts.gateway).toBe(0)
  }, 30_000)

  it('fetches a repaired document once, not on every refresh', async () => {
    // Collectibles refetch every 5 minutes and the indexer stays stale, so the
    // same mismatch recurs forever. Without the memo that would be a gateway
    // fetch per NFT per refresh, indefinitely.
    const counts = stub(STALE_URI, uniqueRealUri('memo'), { name: 'REDACTED #1', image: 'ar://images/1.png' })

    await fetchAllCollectibles(nextAddress(), undefined, config)
    await fetchAllCollectibles(nextAddress(), undefined, config)

    expect(counts.rpc).toBe(2)      // the chain is re-read every pass (free)
    expect(counts.gateway).toBe(1)  // the document is not
  }, 30_000)

  it('keeps the indexer image when the repair gateway 404s', async () => {
    const counts = stub(STALE_URI, uniqueRealUri('gone'), 404)

    const items = robinhoodItems(await fetchAllCollectibles(nextAddress(), undefined, config))

    expect(items[0]).toMatchObject({ name: 'REDACTED #10', image: ALCHEMY_IMG })
    expect(counts.gateway).toBe(1)
  }, 30_000)
})
