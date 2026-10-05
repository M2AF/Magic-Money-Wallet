import { expect, it } from 'vitest'
import type { WalletCollectible } from '../types/wallet'
import { canonicalNftKey } from '../../shared/asset-filter-key'
import { nftFavoritesStorageKey, parseNftFavorites, sortNftFavorites } from './nft-favorites'

const item = (tokenId: string, usdValue?: number | null) => ({ chain: 'base', contractAddress: '0xABC', tokenId, usdValue }) as WalletCollectible
it('pins favorites first, retaining descending USD order within both groups', () => {
  const items = [item('a', 100), item('b', 2), item('c', 30), item('d', 50)]
  const favorites = new Set(['b', 'c'].map(id => canonicalNftKey('base', '0xabc', id)))
  expect(sortNftFavorites(items, favorites).map(n => n.tokenId)).toEqual(['c', 'b', 'a', 'd'])
  expect(items.map(n => n.tokenId)).toEqual(['a', 'b', 'c', 'd'])
})
it('keeps equal-value order stable and unpriced NFTs after priced NFTs', () => {
  expect(sortNftFavorites([item('x'), item('a', 0), item('b', 0), item('n', NaN)], new Set()).map(n => n.tokenId)).toEqual(['a', 'b', 'x', 'n'])
})
it('isolates wallet accounts and network modes, normalizing EVM owner casing', () => {
  expect(nftFavoritesStorageKey('0xABC', false)).toBe(nftFavoritesStorageKey('0xabc', false))
  expect(nftFavoritesStorageKey('0xabc', false)).not.toBe(nftFavoritesStorageKey('0xabc', true))
  expect(nftFavoritesStorageKey('0xabc', false)).not.toBe(nftFavoritesStorageKey('0xdef', false))
})
it('recovers safely from malformed local data', () => {
  expect([...parseNftFavorites('["a",null,42,"a"]')]).toEqual(['a'])
  expect(parseNftFavorites('broken').size).toBe(0)
  expect(parseNftFavorites('{}').size).toBe(0)
})
