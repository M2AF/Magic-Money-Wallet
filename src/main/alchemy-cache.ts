/**
 * alchemy-cache.ts — coalesced, throttle-resilient alchemy_getTokenBalances
 *
 * Both the balance fetcher (token COUNT) and the token fetcher (token LIST) call
 * `alchemy_getTokenBalances` for the same (network, address) on dashboard mount —
 * the two IPC handlers fire concurrently. It's the most expensive Alchemy method
 * we use, so this module:
 *
 *   1. Collapses concurrent identical calls into one in-flight request and
 *      briefly caches the result (mirrors native-prices.ts).
 *   2. Caps concurrency at 4 — the mount burst used to fire ~14 of these at
 *      once, spiking the shared key's CU/s budget and inviting 429s.
 *   3. Distinguishes FAILURE from "zero tokens": a 429/outage returns the
 *      last-known-good balances from disk (token-balance-cache.json /
 *      chrome.storage mirror) instead of an empty list. Same doctrine as the
 *      NFT floor cache — a throttled provider must never blank the wallet.
 */

import type { WalletConfig } from './secure-store'
import { loadTokenBalanceCache, saveTokenBalanceCache } from './secure-store'
import { alchemyDataFetch } from './api-proxy'

export interface RawTokenBalance {
  contractAddress: string
  tokenBalance: string
}

// 32-byte zero word Alchemy returns for an empty balance.
const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000'

interface Entry { balances: RawTokenBalance[]; exp: number }

const cache = new Map<string, Entry>()                          // network:address → balances
const inflight = new Map<string, Promise<RawTokenBalance[]>>()  // network:address → in-flight fetch
// 10s: long enough to collapse the concurrent mount burst, short enough that a
// manual refresh a few seconds later still does a fresh fetch.
const TTL = 10_000
// Stale entries older than this are not served (holdings drift; a week-old list
// during a provider outage still beats an empty wallet).
const DISK_MAX_AGE = 7 * 24 * 60 * 60_000

function nonZero(hex: string): boolean {
  if (hex === ZERO) return false
  try { return BigInt(hex) > 0n } catch { return false }
}

// ── Concurrency gate (max 4 in-flight getTokenBalances) ──────────────────────
let running = 0
const waiters: Array<() => void> = []
async function acquire(): Promise<void> {
  if (running < 4) { running++; return }
  await new Promise<void>(r => waiters.push(r))
  running++
}
function release(): void {
  running--
  waiters.shift()?.()
}

// ── Last-known-good persistence (debounced) ───────────────────────────────────
let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(map: Record<string, { balances: RawTokenBalance[]; at: number }>): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { saveTimer = null; saveTokenBalanceCache(map) }, 2_000)
}

/**
 * Non-zero ERC-20 token balances for (network, address) — coalesced + briefly
 * cached. Returns the FULL filtered list (callers cap/count as needed). On
 * provider failure, serves the last-known-good list from disk (≤7 days old);
 * only returns [] when the account genuinely has no tokens (or never had a
 * successful fetch).
 */
export async function getTokenBalances(network: string, address: string, config: WalletConfig): Promise<RawTokenBalance[]> {
  const k = `${network}:${address.toLowerCase()}`
  const now = Date.now()

  const hit = cache.get(k)
  if (hit && hit.exp > now) return hit.balances

  const existing = inflight.get(k)
  if (existing) return existing

  const p = (async () => {
    await acquire()
    let live: RawTokenBalance[] | undefined
    try {
      live = await fetchTokenBalances(network, address, config)
    } finally {
      release()
    }

    const lastGood = await loadTokenBalanceCache()
    let balances: RawTokenBalance[]
    if (live !== undefined) {
      balances = live
      lastGood[k] = { balances: live, at: Date.now() }
      scheduleSave(lastGood)
    } else {
      // Throttled/unreachable — serve stale rather than pretending "no tokens".
      const stale = lastGood[k]
      balances = (stale && Date.now() - stale.at < DISK_MAX_AGE) ? stale.balances : []
      if (balances.length) console.warn(`[TOKEN] ${network} getTokenBalances failed — serving ${balances.length} cached balances`)
    }
    // Cache whatever we're serving (stale included) so the mount burst and any
    // immediate retries don't re-hit a provider that just refused us.
    cache.set(k, { balances, exp: Date.now() + TTL })
    return balances
  })().finally(() => { if (inflight.get(k) === p) inflight.delete(k) })

  inflight.set(k, p)
  return p
}

// Alchemy Portfolio Data API token row (assets/tokens/by-address).
interface PortfolioToken {
  tokenAddress: string | null   // null = native coin (skipped — handled separately)
  tokenBalance: string          // hex
}

const PORTFOLIO_MAX_PAGES = 10

/**
 * Each page gets one live attempt (+1 retry on 429/5xx). `undefined` = failure
 * before any page was recovered — NOT "no tokens".
 *
 * Uses the Portfolio Data API instead of the JSON-RPC `alchemy_getTokenBalances`
 * method: the RPC method is aggressively shed on the shared tier ("unusually high
 * global traffic") even while cheap RPC and the NFT API keep working, and it
 * doesn't cover Abstract. The Data API is a separate rate bucket and covers every
 * chain we serve, so it survives the throttle that was blanking the token list.
 */
async function fetchTokenBalances(network: string, address: string, config: WalletConfig): Promise<RawTokenBalance[] | undefined> {
  const balances: RawTokenBalance[] = []
  let pageKey: string | undefined

  for (let page = 0; page < PORTFOLIO_MAX_PAGES; page++) {
    const body = {
      addresses: [{ address, networks: [network] }],
      withMetadata: false,
      withPrices: false,
      ...(pageKey ? { pageKey } : {}),
    }
    let pageLoaded = false

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await alchemyDataFetch('assets/tokens/by-address', body, config, 12_000)
        if (res.ok) {
          const json = await res.json() as {
            data?: { tokens?: PortfolioToken[]; pageKey?: string }
            error?: { message?: string }
          }
          if (json.error) {
            console.warn(`[TOKEN] ${network} portfolio API error: ${json.error.message ?? ''}`)
          } else {
            balances.push(...(json.data?.tokens ?? [])
              .filter(t => t.tokenAddress != null && nonZero(t.tokenBalance))
              .map(t => ({ contractAddress: t.tokenAddress as string, tokenBalance: t.tokenBalance })))
            pageKey = json.data?.pageKey || undefined
            pageLoaded = true
            break
          }
        } else if (res.status !== 429 && res.status < 500) {
          console.warn(`[TOKEN] ${network} portfolio API HTTP ${res.status}`)
          return balances.length ? balances : undefined
        }
      } catch { /* timeout/network — retryable */ }
      if (attempt === 0) await new Promise(r => setTimeout(r, 1_500))
    }

    if (!pageLoaded) return balances.length ? balances : undefined
    if (!pageKey) break
  }

  // A defensive de-duplication protects against a provider page boundary
  // repeating the last item while balances are changing during pagination.
  return [...new Map(balances.map(t => [t.contractAddress.toLowerCase(), t])).values()]
}
