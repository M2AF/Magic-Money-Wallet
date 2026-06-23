/**
 * alchemy-cache.ts — coalesced alchemy_getTokenBalances (main process)
 *
 * Both the balance fetcher (token COUNT) and the token fetcher (token LIST) call
 * `alchemy_getTokenBalances` for the same (network, address) on dashboard mount —
 * the two IPC handlers fire concurrently. It's the most expensive Alchemy method
 * we use, so calling it twice per chain per load needlessly doubles CU burn
 * against the shared key.
 *
 * This collapses concurrent identical calls into a single in-flight request and
 * briefly caches the result (short TTL) so the mount burst reuses one network
 * call — without staling the manual-refresh path. Mirrors the coalescing pattern
 * in native-prices.ts.
 */

import type { WalletConfig } from './secure-store'
import { alchemyRpcUrl } from './api-proxy'

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

function nonZero(hex: string): boolean {
  if (hex === ZERO) return false
  try { return BigInt(hex) > 0n } catch { return false }
}

/**
 * Non-zero ERC-20 token balances for (network, address) — coalesced + briefly
 * cached. Returns the FULL filtered list (callers cap/count as needed). Returns
 * [] on any failure, so a count caller reads 0 and a list caller reads empty.
 */
export async function getTokenBalances(network: string, address: string, config: WalletConfig): Promise<RawTokenBalance[]> {
  const k = `${network}:${address.toLowerCase()}`
  const now = Date.now()

  const hit = cache.get(k)
  if (hit && hit.exp > now) return hit.balances

  const existing = inflight.get(k)
  if (existing) return existing

  const p = fetchTokenBalances(network, address, config)
    .then(balances => {
      cache.set(k, { balances, exp: Date.now() + TTL })
      return balances
    })
    .finally(() => { if (inflight.get(k) === p) inflight.delete(k) })

  inflight.set(k, p)
  return p
}

async function fetchTokenBalances(network: string, address: string, config: WalletConfig): Promise<RawTokenBalance[]> {
  try {
    const res = await fetch(alchemyRpcUrl(network, config), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'alchemy_getTokenBalances', params: [address, 'erc20'] }),
      signal: AbortSignal.timeout(12_000)
    })
    if (!res.ok) return []
    const json = await res.json() as { result?: { tokenBalances?: RawTokenBalance[] } }
    return (json.result?.tokenBalances ?? []).filter(t => nonZero(t.tokenBalance))
  } catch {
    return []
  }
}
