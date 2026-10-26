import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WalletConfig } from './secure-store'
const seams = vi.hoisted(() => ({ blockfrost: vi.fn(), discovery: vi.fn() }))
vi.mock('./api-proxy', async original => ({ ...await original<typeof import('./api-proxy')>(), blockfrostFetch: seams.blockfrost }))
vi.mock('./cardano-programmable', async original => ({ ...await original<typeof import('./cardano-programmable')>(), cachedCip113Holdings: seams.discovery }))
vi.mock('./secure-store', () => ({ loadFloorCache: vi.fn(async () => ({})), saveFloorCache: vi.fn(),
  loadTokenMetaCache: vi.fn(async () => ({})), saveTokenMetaCache: vi.fn() }))
import { fetchCardanoNFTs, fetchCardanoProgrammableTokens } from './token-fetcher'
const regular = 'aa'.repeat(28) + '01', programmable = 'bb'.repeat(28) + '02'
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })
const config = {} as WalletConfig
beforeEach(() => {
  vi.clearAllMocks()
  seams.blockfrost.mockImplementation(async (path: string) => {
    if (path === 'addresses/wallet-fixture') return json({ stake_address: 'stake-fixture', amount: [{ unit: regular, quantity: '1' }] })
    if (path.startsWith('accounts/stake-fixture/addresses/assets')) return json([{ unit: regular, quantity: '1' }, { unit: programmable, quantity: '1' }])
    if (path.startsWith('assets/')) return json({ quantity: '1', onchain_metadata: { name: 'NFT-like token', image: 'ipfs://fixture/art.png' } })
    throw new Error(`Unexpected path: ${path}`)
  })
})
describe('programmable holdings and legacy stake NFT discovery', () => {
  it('keeps a programmable singleton in Tokens exactly once and out of the generic NFT path', async () => {
    seams.discovery.mockResolvedValue({ error: null, checkedAt: 1, holdings: [{ unit: programmable, rawBalance: '1', details: { deploymentId: 'fixture' } }] })
    const [tokens, nfts] = await Promise.all([fetchCardanoProgrammableTokens('wallet-fixture', config), fetchCardanoNFTs('wallet-fixture', config)])
    expect(tokens.tokens).toMatchObject([{ source: 'cip113', contractAddress: programmable, rawBalance: '1' }])
    expect(nfts.map(n => n.contractAddress + n.tokenId)).toEqual([regular])
    expect(nfts[0].readOnlyReason).toBeUndefined()
  })
  it('preserves display but blocks unclassified stake-only NFT sends after a discovery failure', async () => {
    seams.discovery.mockResolvedValue({ error: 'offline', checkedAt: 1, holdings: [] })
    const nfts = await fetchCardanoNFTs('wallet-fixture', config)
    expect(nfts).toHaveLength(2)
    expect(nfts.find(n => n.contractAddress + n.tokenId === regular)?.readOnlyReason).toBeUndefined()
    expect(nfts.find(n => n.contractAddress + n.tokenId === programmable)?.readOnlyReason).toContain('Ownership could not be checked')
  })
  it('blocks registered-policy stake fallbacks even when their current programmable balance is zero', async () => {
    seams.discovery.mockResolvedValue({ error: null, checkedAt: 1, registryPolicies: [programmable.slice(0, 56)], holdings: [] })
    const nfts = await fetchCardanoNFTs('wallet-fixture', config)
    expect(nfts.find(n => n.contractAddress + n.tokenId === programmable)?.readOnlyReason).toContain('programmable-policy')
  })
})
