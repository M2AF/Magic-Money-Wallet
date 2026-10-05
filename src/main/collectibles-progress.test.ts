import { expect, it } from 'vitest'
import { CollectiblesProgress } from './collectibles-progress'
import type { WalletCollectible } from './token-fetcher'

const item = (name: string): WalletCollectible => ({
  id: name, name, description: null, image: null, animationUrl: null, collectionName: null,
  chain: 'base', chainLabel: 'Base', chainColor: '#000', tokenId: '2', contractAddress: '0xABC', contractType: 'ERC721', traits: [],
})
it('replaces an early manual import with its indexed copy without duplicates and counts correctly', () => {
  const progress = new CollectiblesProgress(100)
  const first = progress.add('imports', [item('import')])
  const second = progress.add('base', [item('indexed')], { base: null, ethereum: 'capacity exceeded' })
  expect(second.items.map(n => n.name)).toEqual(['indexed'])
  expect(second.chainResults).toEqual({ base: { count: 1, error: null }, ethereum: { count: 0, error: 'capacity exceeded' } })
  expect(first.items[0].name).toBe('import')
  second.items[0].name = 'mutated receiver'
  expect(progress.add('solana', []).items[0].name).toBe('indexed')
})
