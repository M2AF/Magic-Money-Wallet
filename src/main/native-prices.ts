/**
 * native-prices.ts — shared native-coin USD price cache (main process)
 *
 * CoinGecko's keyless `simple/price` endpoint effectively allows only ONE request
 * at a time — concurrent calls return HTTP 429. The wallet hits CoinGecko from
 * several places at once on dashboard mount (portfolio balances, token enrichment,
 * NFT floor → USD valuation), so all-but-one used to 429. When the NFT-floor path
 * lost that race its price map came back empty and every NFT's USD value silently
 * went null — even though the collection floor had been fetched correctly.
 *
 * This module collapses those concurrent calls into a single, de-duplicated,
 * cached request and NEVER returns an empty map on failure: it serves the last
 * known price instead. `seedNativeUsd` lets other CoinGecko consumers (the
 * balance fetcher's `coins/markets` call) populate the same cache so the token /
 * NFT paths reuse those prices without making a second request.
 */

interface Entry { usd: number; exp: number }

const cache = new Map<string, Entry>()                 // cgId → { usd, exp }
const inflight = new Map<string, Promise<unknown>>()   // cgId → in-flight fetch
const TTL = 120_000                                    // 2 min — native prices move slowly

/** Populate the cache from an already-fetched id→usd map (e.g. coins/markets). */
export function seedNativeUsd(prices: Record<string, number>): void {
  const exp = Date.now() + TTL
  for (const [id, usd] of Object.entries(prices)) {
    if (typeof usd === 'number' && usd > 0) cache.set(id, { usd, exp })
  }
}

/**
 * Resolve USD prices for the given CoinGecko ids. Returns a map keyed by id.
 * Fresh cache hits are served immediately; missing/expired ids trigger at most one
 * coalesced CoinGecko request. On 429/failure the last cached value is still
 * returned (stale-OK) rather than dropping the id — callers never get an empty map
 * just because another request was racing them.
 */
export async function getNativeUsd(cgIds: string[]): Promise<Record<string, number>> {
  const ids = [...new Set(cgIds.filter(Boolean))]
  if (ids.length === 0) return {}

  const now = Date.now()
  const stale = ids.filter(id => { const e = cache.get(id); return !e || e.exp <= now })
  if (stale.length) await refresh(stale)

  const out: Record<string, number> = {}
  for (const id of ids) {
    const e = cache.get(id)
    if (e) out[id] = e.usd   // serve cached even if stale — better than 0
  }
  return out
}

/** Fetch the missing ids, reusing any in-flight request that already covers them. */
async function refresh(ids: string[]): Promise<void> {
  const waits: Promise<unknown>[] = []
  const need: string[] = []
  for (const id of ids) {
    const f = inflight.get(id)
    if (f) waits.push(f)
    else need.push(id)
  }
  if (need.length) {
    const p = fetchPrices(need)
    for (const id of need) inflight.set(id, p)
    p.finally(() => { for (const id of need) if (inflight.get(id) === p) inflight.delete(id) })
    waits.push(p)
  }
  await Promise.allSettled(waits)
}

async function fetchPrices(ids: string[]): Promise<void> {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`
  // One retry: a 429 here is almost always transient burst contention that clears
  // once the other concurrent callers (now coalesced) finish.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000) })
      if (res.status === 429 && attempt === 0) {
        await new Promise(r => setTimeout(r, 1200))
        continue
      }
      if (!res.ok) return
      const json = await res.json() as Record<string, { usd?: number }>
      const exp = Date.now() + TTL
      for (const [id, v] of Object.entries(json)) {
        if (v && typeof v.usd === 'number' && v.usd > 0) cache.set(id, { usd: v.usd, exp })
      }
      return
    } catch {
      return
    }
  }
}
