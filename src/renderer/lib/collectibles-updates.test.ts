import { expect, it } from 'vitest'
import { mergeCollectiblesUpdate } from './collectibles-updates'
import type { CollectiblesResult, WalletCollectible } from '../types/wallet'

const item = (id: string, extra = {}): WalletCollectible => ({
  id, name: id, description: null, image: null, animationUrl: null, collectionName: null,
  chain: 'base', chainLabel: 'Base', chainColor: '#000', tokenId: id, contractAddress: '0xabc', contractType: 'ERC721', traits: [], ...extra,
})
const result = (at: number, items: WalletCollectible[], partial = false): CollectiblesResult => ({ fetchedAt: at, items, partial, chainResults: {}, error: null })

it('keeps existing cards and prices until the full ownership refresh arrives', () => {
  const previous = result(100, [item('sold'), item('kept', { usdValue: 12 })])
  const partial = mergeCollectiblesUpdate(previous, result(200, [item('kept'), item('new')], true))
  expect(partial.items.map(n => n.id)).toEqual(['sold', 'kept', 'new'])
  expect(partial.items.find(n => n.id === 'kept')?.usdValue).toBe(12)
  const full = result(200, [item('kept'), item('new')])
  expect(mergeCollectiblesUpdate(partial, full)).toBe(full)
  expect(mergeCollectiblesUpdate(full, previous)).toBe(full)
})
it('never merges the holdings of different accounts', () => {
  const previous = { ...result(100, [item('old')]), ownerAddress: '0x111' }
  const incoming = { ...result(200, [item('new')], true), ownerAddress: '0x222' }
  expect(mergeCollectiblesUpdate(previous, incoming).items.map(n => n.id)).toEqual(['new'])
})
