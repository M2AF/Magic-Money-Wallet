import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WalletConfig } from './secure-store'

const blockfrost = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('./api-proxy', () => ({ blockfrostFetch: blockfrost.fetch }))

import { fetchCardanoNFTs, fetchCardanoTokens } from './token-fetcher'

const config = {} as WalletConfig
const address = 'addr1test'
const policy = 'a'.repeat(56)
const asset = (n: number) => `${policy}${n.toString(16).padStart(2, '0')}`
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

afterEach(() => blockfrost.fetch.mockReset())

describe('Cardano asset discovery', () => {
  it('uses asset metadata to partition singleton fungibles and NFTs without overlap', async () => {
    const holdings = [
      { unit: asset(1), quantity: '1' },
      { unit: asset(2), quantity: '1' },
      { unit: asset(3), quantity: '5' },
      { unit: asset(4), quantity: '2' },
      { unit: asset(5), quantity: '3' },
    ]
    blockfrost.fetch.mockImplementation(async (path: string) => {
      if (path === `addresses/${address}`) return json({ amount: holdings })
      if (path === `assets/${asset(1)}`) return json({ quantity: '1000', metadata: { name: 'Unit Coin', decimals: 0 } })
      if (path === `assets/${asset(2)}`) return json({ quantity: '1', onchain_metadata: { name: 'One NFT' } })
      if (path === `assets/${asset(3)}`) return json({ quantity: '100', onchain_metadata: { name: 'Edition', image: 'ipfs://art' } })
      if (path === `assets/${asset(4)}`) return json({ quantity: '100', metadata: { name: 'Unknown Precision' } })
      if (path === `assets/${asset(5)}`) return json({ quantity: '100', onchain_metadata: { name: 'Named Token' } })
      throw new Error(`Unexpected ${path}`)
    })

    const [tokens, nfts] = await Promise.all([
      fetchCardanoTokens(address, config), fetchCardanoNFTs(address, config),
    ])
    expect(tokens.map(t => t.contractAddress)).toEqual([asset(1), asset(4), asset(5)])
    expect(tokens.map(t => [t.decimals, t.decimalsKnown])).toEqual([[0, true], [0, false], [0, false]])
    expect(nfts.map(n => `${n.contractAddress}${n.tokenId}`)).toEqual([asset(2), asset(3)])
  })

  it('loads holdings beyond the old caps with at most six metadata requests in flight', async () => {
    const holdings = Array.from({ length: 55 }, (_, n) => ({ unit: asset(n), quantity: '1' }))
    let inFlight = 0
    let peak = 0
    blockfrost.fetch.mockImplementation(async (path: string) => {
      if (path === `addresses/${address}`) return json({ amount: holdings })
      if (path.startsWith('assets/')) {
        peak = Math.max(peak, ++inFlight)
        await new Promise(resolve => setTimeout(resolve, 1))
        inFlight--
        return json({ quantity: '1000', metadata: { decimals: 6 } })
      }
      throw new Error(`Unexpected ${path}`)
    })

    const tokens = await fetchCardanoTokens(address, config)
    expect(tokens).toHaveLength(55)
    expect(tokens.at(-1)?.contractAddress).toBe(asset(54))
    expect(peak).toBeLessThanOrEqual(6)
    expect(peak).toBeGreaterThan(1)
  })

  it('keeps a holding visible with unknown decimals when asset metadata is unavailable', async () => {
    blockfrost.fetch.mockImplementation(async (path: string) => {
      if (path === `addresses/${address}`) return json({ amount: [{ unit: asset(1), quantity: '1' }] })
      throw new Error('Blockfrost asset lookup unavailable')
    })

    const [tokens, nfts] = await Promise.all([
      fetchCardanoTokens(address, config), fetchCardanoNFTs(address, config),
    ])
    expect(tokens).toEqual([expect.objectContaining({
      contractAddress: asset(1), rawBalance: '1', decimals: 0, decimalsKnown: false,
    })])
    expect(nfts).toEqual([])
  })

  it('paginates stake account assets and includes NFTs beyond the old fifty-item cap', async () => {
    const holdings = Array.from({ length: 105 }, (_, n) => ({ unit: asset(n), quantity: '1' }))
    blockfrost.fetch.mockImplementation(async (path: string) => {
      if (path === `addresses/${address}`) return json({ stake_address: 'stake1test', amount: [] })
      if (path.endsWith('page=1')) return json(holdings.slice(0, 100))
      if (path.endsWith('page=2')) return json(holdings.slice(100))
      if (path.startsWith('assets/')) return json({ quantity: '1', onchain_metadata: { name: 'NFT' } })
      throw new Error(`Unexpected ${path}`)
    })

    const nfts = await fetchCardanoNFTs(address, config)
    expect(nfts).toHaveLength(105)
    expect(nfts.at(-1)?.tokenId).toBe(asset(104).slice(56))
  })
})
