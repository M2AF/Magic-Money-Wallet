/**
 * currency.ts — display currency: the ONE place a USD number becomes text.
 *
 * The wallet stores and reasons in USD everywhere (see shared/currencies.ts for
 * why), so this module does exactly two things at the last moment before paint:
 * multiply by a USD→X rate, and hand the result to `Intl.NumberFormat`. Sorting,
 * portfolio totals and the spam filter all keep working on the raw USD numbers
 * and never see a formatted string — the old code round-tripped values through
 * "$1,234.56" and back out with parseFloat(s.replace(/[$,]/g,'')), which no
 * non-US format survives ("1.234,56 €" parses as 1).
 *
 * Two storage layers, in this order of authority:
 *
 *   mm.currency   the chosen code. Written synchronously, ALWAYS what the UI
 *                 renders from, and synced to other windows via `storage`.
 *   mm.fx.v1      the last rate table we saw. Read before the first paint so a
 *                 cold or offline start shows the user's currency immediately
 *                 instead of flashing USD and then correcting itself.
 *
 * ⚠ A MISSING RATE MUST NEVER PRODUCE A WRONG NUMBER. If the table has nothing
 * for the selected currency — offline first run, a currency CoinGecko dropped,
 * an older host build with no `getFxRates` — `rate` is null and everything
 * renders in USD, labelled USD. Showing "€1,234.56" against a USD figure would
 * misstate what someone holds, which is worse than showing the wrong currency.
 *
 * Nothing here fetches while the user is on USD (the default), so the ordinary
 * install pays nothing for this feature — see the guard in refresh().
 */

import { useEffect, useSyncExternalStore } from 'react'
import {
  BASE_CURRENCY, currencyOf, intlCode, isSupportedCurrency,
  type CurrencyDef, type FxRates,
} from '../../shared/currencies'

export type { CurrencyDef }
export { CURRENCIES, CURRENCY_GROUPS, BASE_CURRENCY, currencyOf } from '../../shared/currencies'

const CODE_KEY = 'mm.currency'
const FX_KEY = 'mm.fx.v1'
/** Refresh the table at most this often per window. main/fx-rates.ts caches too. */
const REFRESH_MS = 60 * 60_000
/** How long to wait before trying again after a fetch that did not help. */
const RETRY_MS = 60_000

// ─── Selected currency ───────────────────────────────────────────────────────

export function getCurrency(): string {
  try {
    const saved = localStorage.getItem(CODE_KEY)
    return isSupportedCurrency(saved) ? saved!.toLowerCase() : BASE_CURRENCY
  } catch {
    return BASE_CURRENCY   // private mode / storage disabled
  }
}

export function setCurrency(code: string): void {
  const def = currencyOf(code)
  if (!def) return
  try { localStorage.setItem(CODE_KEY, def.code) } catch { /* quota / private mode */ }
  notify()
  // Picking a currency is exactly when its rate becomes worth having — and a
  // deliberate switch outranks a retry window a previous failure opened.
  lastAttempt = 0
  void refresh()
}

// ─── Rate table ──────────────────────────────────────────────────────────────

let rates: Record<string, number> = readCachedRates()
/** When a fetch last SUCCEEDED — what the hourly TTL is measured from. */
let lastSuccess = 0
/**
 * When one was last ATTEMPTED, successful or not. Without this the failure
 * cases retry on every single call: offline, and — more quietly — whenever the
 * table simply has no row for the chosen currency, which is a state no amount
 * of refetching fixes.
 */
let lastAttempt = 0
let inflight: Promise<void> | null = null

function readCachedRates(): Record<string, number> {
  try {
    const raw = localStorage.getItem(FX_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as { rates?: unknown }
    return sanitize(parsed?.rates)
  } catch {
    return {}
  }
}

/** Keep only finite positive rates for currencies this build knows about. */
function sanitize(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [code, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSupportedCurrency(code)) continue
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[code.toLowerCase()] = value
  }
  return out
}

/**
 * Pull a fresh table if the selection needs one. Safe to call from anywhere,
 * as often as you like: it no-ops on USD (rate 1, always known), while a fetch
 * is in flight, inside the hourly TTL, and inside a one-minute retry window
 * after a fetch that did not help. Every consumer mounting at once costs one
 * request; the default USD install costs none.
 */
export function refresh(): Promise<void> {
  if (getCurrency() === BASE_CURRENCY) return Promise.resolve()
  if (inflight) return inflight
  const now = Date.now()
  if (now - lastSuccess < REFRESH_MS) return Promise.resolve()
  if (now - lastAttempt < RETRY_MS) return Promise.resolve()

  const get = window.wallet?.getFxRates
  // Older host build (an extension/mobile shell that predates this method):
  // degrade to USD rather than reaching for a function that is not there.
  if (typeof get !== 'function') return Promise.resolve()

  lastAttempt = now
  const p = get.call(window.wallet)
    .then((table: FxRates) => {
      const clean = sanitize(table?.rates)
      // An empty answer means "no idea", never "everything is worth nothing" —
      // keep whatever we were already using.
      if (Object.keys(clean).length === 0) return
      rates = clean
      lastSuccess = Date.now()
      try { localStorage.setItem(FX_KEY, JSON.stringify({ rates: clean, at: lastSuccess })) }
      catch { /* quota */ }
      notify()
    })
    .catch(() => { /* offline — the cached table, or USD, still renders */ })
    .finally(() => { if (inflight === p) inflight = null })

  inflight = p
  return p
}

// ─── Change notification ─────────────────────────────────────────────────────

const listeners = new Set<() => void>()

function rateFor(code: string): number | null {
  if (code === BASE_CURRENCY) return 1
  const r = rates[code]
  return typeof r === 'number' && Number.isFinite(r) && r > 0 ? r : null
}

let snapshot = { code: getCurrency(), rate: rateFor(getCurrency()) }

function notify(): void {
  const code = getCurrency()
  const rate = rateFor(code)
  if (snapshot.code === code && snapshot.rate === rate) return
  // useSyncExternalStore compares snapshots by identity, so this must be a new
  // object whenever anything changed — and the SAME object when nothing did.
  snapshot = { code, rate }
  for (const cb of [...listeners]) { try { cb() } catch { /* a bad listener is not fatal */ } }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** Follow the choice made in other windows, and prime the table. Call once. */
export function initCurrency(): void {
  window.addEventListener('storage', e => {
    if (e.key === CODE_KEY) notify()
    else if (e.key === FX_KEY) { rates = readCachedRates(); notify() }
  })
  void refresh()
}

// ─── Formatting ──────────────────────────────────────────────────────────────

const fmtCache = new Map<string, Intl.NumberFormat | null>()
const digitCache = new Map<string, { min: number; max: number }>()

/**
 * The number formatting follows the USER's locale; only the currency follows
 * their pick. An American choosing euros wants "€1,234.56", not "1.234,56 €",
 * and a Canadian gets "$" for CAD and "US$" for USD — which is the whole point
 * of leaving the grouping, the separator and the symbol to `Intl`.
 *
 * Resolved once: the app cannot observe a locale change mid-session, and the
 * formatter caches below are keyed on currency alone.
 */
let localeOverride: string | null = null
let cachedLocale: string | null = null

function displayLocale(): string {
  if (localeOverride) return localeOverride
  if (cachedLocale) return cachedLocale
  try { cachedLocale = navigator.language || 'en-US' } catch { cachedLocale = 'en-US' }
  return cachedLocale
}

/**
 * Pin the formatting locale and drop the caches. TESTS ONLY — expectations
 * about separators and symbols would otherwise depend on whose machine ran them.
 */
export function __setDisplayLocale(locale: string | null): void {
  localeOverride = locale
  fmtCache.clear()
  digitCache.clear()
}

/**
 * Symbols stay ambiguity-free on purpose: the default `currencyDisplay` renders
 * CAD as "CA$1,234.56" rather than narrowSymbol's "$1,234.56", and in a wallet
 * the difference between US and Canadian dollars is not decoration.
 */

/**
 * How many decimals the currency itself uses — 2 for dollars and euros, 0 for
 * yen and won, 3 for Kuwaiti dinars. Hardcoding 2 would print "¥1,234.00", and
 * asking Intl for 2 on a 3-decimal currency is a RangeError, not a rounding.
 */
function currencyDigits(code: string): { min: number; max: number } {
  const hit = digitCache.get(code)
  if (hit) return hit
  let d = { min: 2, max: 2 }
  try {
    const o = new Intl.NumberFormat(displayLocale(), { style: 'currency', currency: intlCode(code) })
      .resolvedOptions()
    d = { min: o.minimumFractionDigits ?? 2, max: o.maximumFractionDigits ?? 2 }
  } catch { /* unknown currency — the 2/2 default is only ever a fallback */ }
  digitCache.set(code, d)
  return d
}

/**
 * `wantMax` only ever WIDENS the currency's own precision: a fee worth a
 * hundredth of a yen may need extra digits, but nothing may ask for fewer than
 * the currency defines, which is what would throw.
 */
function formatter(code: string, wantMax?: number): Intl.NumberFormat | null {
  const d = currencyDigits(code)
  const max = wantMax == null ? d.max : Math.max(wantMax, d.max)
  const min = Math.min(d.min, max)

  const key = `${code}:${min}:${max}`
  if (fmtCache.has(key)) return fmtCache.get(key) ?? null
  let f: Intl.NumberFormat | null = null
  try {
    f = new Intl.NumberFormat(displayLocale(), {
      style: 'currency',
      currency: intlCode(code),
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    })
  } catch {
    f = null   // an Intl without this currency — caller falls back
  }
  fmtCache.set(key, f)
  return f
}

export interface FormatOptions {
  /**
   * Let small amounts keep significant digits instead of collapsing to zero.
   * Network fees are routinely worth a fraction of a cent, and a rendered zero
   * reads as free. Off by default: portfolio figures should line up at two
   * decimals.
   */
  precise?: boolean
}

/**
 * A USD amount as text in `code`, converted at `rate`. Returns null for null
 * input so callers can render nothing (an unpriced asset) rather than a zero.
 */
export function formatFiat(
  usd: number | null | undefined,
  code: string,
  rate: number | null,
  opts: FormatOptions = {},
): string | null {
  if (usd == null || !Number.isFinite(usd)) return null

  // No rate for the pick → show the honest USD figure rather than a converted
  // number wearing the wrong symbol.
  const useCode = rate == null ? BASE_CURRENCY : code
  const value = usd * (rate ?? 1)

  let wantMax: number | undefined
  if (opts.precise) {
    const abs = Math.abs(value)
    // Enough digits to say something, capped well inside Intl's limit of 20.
    if (abs > 0 && abs < 0.01) wantMax = Math.min(8, 2 + Math.ceil(-Math.log10(abs)))
  }

  const f = formatter(useCode, wantMax) ?? formatter(BASE_CURRENCY, wantMax)
  if (!f) return `$${value.toFixed(2)}`   // no Intl at all — vanishingly unlikely
  return f.format(value)
}

/**
 * A unit PRICE rather than a holding. A coin worth a thousandth of a cent needs
 * more decimals than a portfolio line ever does, so the digit ladder widens as
 * the number shrinks — applied to the CONVERTED value, since the same coin is
 * ¥0.6 where it is $0.004 and wants a different number of digits in each.
 */
export function formatFiatPrice(
  usd: number | null | undefined,
  code: string,
  rate: number | null,
): string | null {
  if (usd == null || !Number.isFinite(usd)) return null
  const useCode = rate == null ? BASE_CURRENCY : code
  const value = usd * (rate ?? 1)
  const abs = Math.abs(value)
  // Above ten million the figure is a wall of digits in a fixed-width column,
  // and only the high-magnitude currencies ever get there: ₫2,100,000,000 for a
  // coin that is CA$112,730.80. Those, and only those, go compact.
  if (abs >= 1e7) return formatFiatCompact(usd, code, rate)
  const wantMax = abs >= 1000 ? undefined : abs >= 1 ? 4 : abs >= 0.01 ? 5 : 6
  const f = formatter(useCode, wantMax) ?? formatter(BASE_CURRENCY, wantMax)
  return f ? f.format(value) : `$${value.toFixed(wantMax ?? 2)}`
}

/** Compact form for large figures — "$1.2M", "€3.4B". Used by Market Watch. */
export function formatFiatCompact(
  usd: number | null | undefined,
  code: string,
  rate: number | null,
): string | null {
  if (usd == null || !Number.isFinite(usd)) return null
  const useCode = rate == null ? BASE_CURRENCY : code
  const value = usd * (rate ?? 1)
  try {
    return new Intl.NumberFormat(displayLocale(), {
      style: 'currency',
      currency: intlCode(useCode),
      notation: 'compact',
      // Both bounds are explicit because the currency's own digit count would
      // otherwise supply the minimum, and ICU versions disagree about whether
      // compact notation honours it: Node 20 renders 1e9 USD as '$1.00B', Node
      // 24 as '$1B'. Pinning min to 0 gives the trimmed form everywhere, which
      // is what this function is for — and Electron ships its own ICU, so the
      // packaged app is a third opinion we would rather not have to poll.
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return formatFiat(usd, code, rate)
  }
}

// ─── React binding ───────────────────────────────────────────────────────────

export interface DisplayCurrency {
  /** The selected code, lowercase — 'usd' unless the user changed it. */
  code: string
  /** Units per USD, or null when we have no rate and are showing USD instead. */
  rate: number | null
  /** What the numbers on screen are actually denominated in right now. */
  shownCode: string
  /** True when the pick is live; false while it silently falls back to USD. */
  ready: boolean
  /** USD number → text in the display currency. Null in, null out. */
  fmt(usd: number | null | undefined, opts?: FormatOptions): string | null
  /** As `fmt`, but with a unit price's digit ladder — see formatFiatPrice. */
  fmtPrice(usd: number | null | undefined): string | null
  /** As `fmt`, but "$1.2M" style. */
  fmtCompact(usd: number | null | undefined): string | null
}

function getSnapshot() { return snapshot }

/**
 * The display currency, re-rendering the component when the user changes it (in
 * this window or another) or when rates first arrive.
 */
export function useDisplayCurrency(): DisplayCurrency {
  const { code, rate } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  // In an effect, not the render body: this can start a request, and every
  // guard in refresh() is about how OFTEN that happens, not whether a render is
  // allowed to have side effects. Idempotent, so a dozen mounted consumers and
  // StrictMode's double-invoke all still amount to one request.
  useEffect(() => { void refresh() }, [code])
  return {
    code,
    rate,
    shownCode: rate == null ? BASE_CURRENCY : code,
    ready: rate != null,
    fmt: (usd, opts) => formatFiat(usd, code, rate, opts),
    fmtPrice: usd => formatFiatPrice(usd, code, rate),
    fmtCompact: usd => formatFiatCompact(usd, code, rate),
  }
}
