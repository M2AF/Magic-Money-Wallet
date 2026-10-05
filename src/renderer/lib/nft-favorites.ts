import type { WalletCollectible } from '../types/wallet'
import { canonicalNftKey } from '../../shared/asset-filter-key'

export const nftFavoritesStorageKey = (owner: string, testnet: boolean) =>
  `mmw_nft_favorites_v1_${testnet ? 'testnet' : 'mainnet'}_${owner.toLowerCase()}`

export function parseNftFavorites(raw: string | null): Set<string> {
  try {
    const entries: unknown = JSON.parse(raw ?? '[]')
    return new Set(Array.isArray(entries) ? entries.filter((s): s is string => typeof s === 'string') : [])
  } catch { return new Set() }
}

export function sortNftFavorites(items: WalletCollectible[], favorites: ReadonlySet<string>): WalletCollectible[] {
  const favorite = (n: WalletCollectible) => Number(favorites.has(canonicalNftKey(n.chain, n.contractAddress, n.tokenId)))
  const value = (n: WalletCollectible) => typeof n.usdValue === 'number' && Number.isFinite(n.usdValue) ? n.usdValue : -Infinity
  return [...items].sort((a, b) => {
    const group = favorite(b) - favorite(a)
    if (group) return group
    const av = value(a), bv = value(b)
    return av === bv ? 0 : av > bv ? -1 : 1
  })
}
