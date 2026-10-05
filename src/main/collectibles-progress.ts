import type { CollectiblesResult, WalletCollectible } from './token-fetcher'

export function collectibleIdentity(n: WalletCollectible): string {
  return `${n.chain}:${n.contractAddress.toLowerCase()}:${n.tokenId}`
}

/** Snapshots are detached from provider arrays; imports never override indexed assets. */
export class CollectiblesProgress {
  private sources = new Map<string, WalletCollectible[]>()
  private errors: Record<string, string | null> = {}
  constructor(private fetchedAt: number) {}

  add(source: string, items: WalletCollectible[], reports: Record<string, string | null> = {}): CollectiblesResult {
    this.sources.set(source, items)
    Object.assign(this.errors, reports)
    const unique = new Map<string, WalletCollectible>()
    const ordered = [...this.sources.entries()].sort(([a], [b]) => Number(a === 'imports') - Number(b === 'imports'))
    for (const [, entries] of ordered) {
      for (const n of entries) {
        const key = collectibleIdentity(n)
        if (!unique.has(key)) unique.set(key, { ...n, traits: [...n.traits] })
      }
    }
    const all = [...unique.values()]
    const chainResults: CollectiblesResult['chainResults'] = {}
    for (const [chain, error] of Object.entries(this.errors)) chainResults[chain] = { count: 0, error }
    for (const n of all) {
      chainResults[n.chain] ??= { count: 0, error: null }
      chainResults[n.chain].count++
    }
    return { items: all, chainResults, fetchedAt: this.fetchedAt, error: null, partial: true }
  }
}
