import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WalletConfig } from './secure-store'
import type { CollectiblesResult } from './token-fetcher'

vi.mock('./secure-store', () => ({
  loadFloorCache: vi.fn(async () => ({})), saveFloorCache: vi.fn(),
  loadTokenBalanceCache: vi.fn(async () => ({})), saveTokenBalanceCache: vi.fn(),
  loadTokenMetaCache: vi.fn(async () => ({})), saveTokenMetaCache: vi.fn(),
}))
vi.mock('./native-prices', () => ({ getNativeUsd: vi.fn(async () => ({})) }))
import { fetchAllCollectibles } from './token-fetcher'

const config = {
  swapProxyUrl: 'https://proxy.example', clientToken: 'test', testnetMode: true,
  privacyMode: false, customChains: [], customNfts: [], customTokens: [],
} as unknown as WalletConfig
const owner = '0x1111111111111111111111111111111111111111'
const nft = {
  tokenId: '1', name: 'Preview Test', contract: { address: owner, tokenType: 'ERC721' },
  image: { cachedUrl: 'https://cdn.example/full.png', thumbnailUrl: 'https://cdn.example/small.webp' },
}
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
afterEach(() => vi.unstubAllGlobals())

function sources() {
  let finish!: () => void
  const gate = new Promise<void>(resolve => { finish = resolve })
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.includes('/alchemy-nft/base-sepolia/')) await gate
    if (url.includes('/alchemy-nft/')) return json({ ownedNfts: url.includes('/eth-sepolia/') ? [nft] : [] })
    return new Response('unavailable', { status: 404 })
  }))
  return finish
}

describe('NFT gallery delivery', () => {
  it('publishes the ready chain before a slow chain, with a separate preview and original', async () => {
    const finish = sources()
    const snapshots: CollectiblesResult[] = []
    let completed = false
    const pending = fetchAllCollectibles(owner, undefined, config, undefined, undefined, undefined, undefined, undefined, r => snapshots.push(r))
      .then(r => { completed = true; return r })
    try {
      await vi.waitFor(() => expect(snapshots.some(r => r.items.length === 1)).toBe(true))
      expect(completed).toBe(false)
      expect(snapshots.find(r => r.items.length)?.items[0]).toMatchObject({ image: nft.image.cachedUrl, thumbnailUrl: nft.image.thumbnailUrl })
      expect(snapshots.every(r => r.partial && r.ownerAddress === owner)).toBe(true)
    } finally { finish() }
    const result = await pending
    expect(result.partial).toBe(false)
    expect(result.items).toHaveLength(1)
    expect(result.fetchedAt).toBe(snapshots[0].fetchedAt)
  })

  it('suppresses an older request after a newer privacy-mode load', async () => {
    const finish = sources()
    const snapshots: CollectiblesResult[] = []
    const pending = fetchAllCollectibles(owner, undefined, config, undefined, undefined, undefined, undefined, undefined, r => snapshots.push(r))
    await vi.waitFor(() => expect(snapshots.length).toBeGreaterThan(0))
    const newer = await fetchAllCollectibles(owner, undefined, { ...config, testnetMode: false, privacyMode: true })
    const delivered = snapshots.length
    finish()
    await pending
    expect(snapshots).toHaveLength(delivered)
    expect(newer.items).toEqual([])
  })

  it('does not lose ownership results if the update receiver throws', async () => {
    const finish = sources()
    finish()
    const result = await fetchAllCollectibles(owner, undefined, config, undefined, undefined, undefined, undefined, undefined, () => { throw new Error('closed window') })
    expect(result.error).toBeNull()
    expect(result.items).toHaveLength(1)
  })
})
