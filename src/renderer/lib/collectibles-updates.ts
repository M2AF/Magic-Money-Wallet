import type { CollectiblesResult } from '../types/wallet'
import { canonicalNftKey } from '../../shared/asset-filter-key'

/** Keep existing cards during a refresh; remove sold assets only on its complete result. */
export function mergeCollectiblesUpdate(previous: CollectiblesResult | null, incoming: CollectiblesResult): CollectiblesResult {
  if (previous && incoming.fetchedAt < previous.fetchedAt) return previous
  if (!incoming.partial || !previous || (incoming.ownerAddress && previous.ownerAddress && incoming.ownerAddress.toLowerCase() !== previous.ownerAddress.toLowerCase())) return incoming
  const key = (n: CollectiblesResult['items'][number]) => canonicalNftKey(n.chain, n.contractAddress, n.tokenId)
  const items = new Map(previous.items.map(n => [key(n), n]))
  for (const n of incoming.items) {
    const old = items.get(key(n))
    items.set(key(n), old ? { ...n, usdValue: n.usdValue ?? old.usdValue, floorPrice: n.floorPrice ?? old.floorPrice } : n)
  }
  return { ...incoming, items: [...items.values()], chainResults: { ...previous.chainResults, ...incoming.chainResults } }
}
