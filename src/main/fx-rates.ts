/**
 * fx-rates.ts — USD → fiat exchange rates (main process / extension worker).
 *
 * Every price the wallet has is a USD price: CoinGecko, Binance, Ordiscan and
 * Anvil all quote USD, and some of them quote nothing else. Display currency is
 * therefore ONE multiplication at the display layer, not a second price feed —
 * see shared/currencies.ts for why.
 *
 * Source is CoinGecko's keyless `/exchange_rates`, which returns every rate
 * relative to BTC in a single request; USD → X is `rates[x] / rates.usd`. That
 * one call covers the whole catalogue, so switching currency never costs a fetch
 * and a currency the price feeds have never heard of still works.
 *
 * Doctrine, mirroring native-prices.ts (same endpoint family, same 429 behaviour):
 *  - concurrent callers are coalesced onto one in-flight request
 *  - the last good table is kept FOREVER and served stale rather than dropped;
 *    a wrong-by-an-hour rate is a rounding error, an empty table silently
 *    reprices someone's whole portfolio to USD
 *  - it never throws and never returns an empty table — the worst case is
 *    `{ usd: 1 }`, which the renderer reads as "fall back to USD"
 *
 * Nothing calls this unless the user has actually picked a non-USD currency
 * (see renderer/lib/currency.ts), so the default install makes no request.
 */

import { CURRENCIES, BASE_CURRENCY, type FxRates } from '../shared/currencies'

export type { FxRates }

const TTL = 60 * 60_000   // 1 h — fiat moves far slower than the crypto prices it scales

const SUPPORTED = new Set(CURRENCIES.map(c => c.code))

let cache: { rates: Record<string, number>; fetchedAt: number } | null = null
let inflight: Promise<void> | null = null

/**
 * USD → fiat rates for the whole catalogue. Serves the cache when fresh,
 * refreshes (once, coalesced) when stale, and falls back to the last good table
 * — or to USD-only — when the refresh fails.
 */
export async function getFxRates(): Promise<FxRates> {
  const now = Date.now()
  if (!cache || now - cache.fetchedAt >= TTL) await refresh()

  if (!cache) return { base: BASE_CURRENCY, rates: { [BASE_CURRENCY]: 1 }, fetchedAt: 0, stale: true }
  return {
    base: BASE_CURRENCY,
    rates: { ...cache.rates },
    fetchedAt: cache.fetchedAt,
    stale: Date.now() - cache.fetchedAt >= TTL,
  }
}

/** Reset the module cache. Tests only. */
export function __resetFxCache(): void {
  cache = null
  inflight = null
}

function refresh(): Promise<void> {
  if (inflight) return inflight
  const p = fetchRates().finally(() => { if (inflight === p) inflight = null })
  inflight = p
  return p
}

interface CgRate { value?: unknown; type?: unknown }

async function fetchRates(): Promise<void> {
  const url = 'https://api.coingecko.com/api/v3/exchange_rates'
  // One retry, as in native-prices.ts: a 429 here is transient burst contention
  // with the price fetchers rather than a real quota wall.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000) })
      if (res.status === 429 && attempt === 0) {
        await new Promise(r => setTimeout(r, 1200))
        continue
      }
      if (!res.ok) return
      const json = await res.json() as { rates?: Record<string, CgRate> }
      const rates = normalizeRates(json?.rates)
      if (rates) cache = { rates, fetchedAt: Date.now() }
      return
    } catch {
      return
    }
  }
}

/**
 * CoinGecko's table is BTC-relative (`rates.usd.value` = USD per BTC), so a USD
 * base is `rates[x] / rates.usd`. Returns null — leaving the previous table in
 * place — if USD itself is missing or nonsensical, because every other rate in
 * the response would then be scaled by garbage.
 *
 * Exported for the unit test; the shape is CoinGecko's, not ours.
 */
export function normalizeRates(raw: Record<string, CgRate> | undefined): Record<string, number> | null {
  if (!raw) return null
  const usdPerBtc = num(raw[BASE_CURRENCY]?.value)
  if (usdPerBtc == null || usdPerBtc <= 0) return null

  const out: Record<string, number> = { [BASE_CURRENCY]: 1 }
  for (const [code, entry] of Object.entries(raw)) {
    if (code === BASE_CURRENCY || !SUPPORTED.has(code)) continue
    const perBtc = num(entry?.value)
    if (perBtc == null || perBtc <= 0) continue
    out[code] = perBtc / usdPerBtc
  }
  return out
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
