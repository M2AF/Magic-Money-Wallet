/**
 * currencies.ts — the display-currency catalogue, shared by main and renderer.
 *
 * The wallet prices EVERYTHING in USD: CoinGecko, Binance, Ordiscan and Anvil
 * all quote USD, and several of them quote nothing else. So display currency is
 * deliberately NOT a second price feed — it is one multiplication applied at the
 * very last moment, against a USD→X rate fetched once (see main/fx-rates.ts).
 * That keeps a single price cache instead of one per currency, and means a
 * currency the price sources have never heard of still works.
 *
 * Codes are lowercase here because that is how CoinGecko's /exchange_rates
 * endpoint keys them; `Intl.NumberFormat` wants them uppercased, which
 * `currencyOf().code` does not do for you — use `intlCode()`.
 *
 * Everything in this list must be a currency CoinGecko's /exchange_rates
 * reports, or its rate is permanently missing and the UI falls back to USD.
 */

export interface CurrencyDef {
  /** Lowercase ISO-4217 code — the key used on the wire and in localStorage. */
  code: string
  /** English name, shown in the Settings picker. */
  name: string
  /** Region grouping for the picker. Purely cosmetic. */
  group: 'Americas' | 'Europe' | 'Asia-Pacific' | 'Middle East & Africa'
}

/**
 * Ordered for the picker: USD first (the default and the base of every rate),
 * then alphabetical by code inside each group.
 */
export const CURRENCIES: readonly CurrencyDef[] = [
  { code: 'usd', name: 'US Dollar',            group: 'Americas' },
  { code: 'ars', name: 'Argentine Peso',       group: 'Americas' },
  { code: 'brl', name: 'Brazilian Real',       group: 'Americas' },
  { code: 'cad', name: 'Canadian Dollar',      group: 'Americas' },
  { code: 'clp', name: 'Chilean Peso',         group: 'Americas' },
  { code: 'mxn', name: 'Mexican Peso',         group: 'Americas' },

  { code: 'eur', name: 'Euro',                 group: 'Europe' },
  { code: 'chf', name: 'Swiss Franc',          group: 'Europe' },
  { code: 'czk', name: 'Czech Koruna',         group: 'Europe' },
  { code: 'dkk', name: 'Danish Krone',         group: 'Europe' },
  { code: 'gbp', name: 'British Pound',        group: 'Europe' },
  { code: 'huf', name: 'Hungarian Forint',     group: 'Europe' },
  { code: 'nok', name: 'Norwegian Krone',      group: 'Europe' },
  { code: 'pln', name: 'Polish Zloty',         group: 'Europe' },
  { code: 'rub', name: 'Russian Ruble',        group: 'Europe' },
  { code: 'sek', name: 'Swedish Krona',        group: 'Europe' },
  { code: 'try', name: 'Turkish Lira',         group: 'Europe' },
  { code: 'uah', name: 'Ukrainian Hryvnia',    group: 'Europe' },

  { code: 'aud', name: 'Australian Dollar',    group: 'Asia-Pacific' },
  { code: 'bdt', name: 'Bangladeshi Taka',     group: 'Asia-Pacific' },
  { code: 'cny', name: 'Chinese Yuan',         group: 'Asia-Pacific' },
  { code: 'hkd', name: 'Hong Kong Dollar',     group: 'Asia-Pacific' },
  { code: 'idr', name: 'Indonesian Rupiah',    group: 'Asia-Pacific' },
  { code: 'inr', name: 'Indian Rupee',         group: 'Asia-Pacific' },
  { code: 'jpy', name: 'Japanese Yen',         group: 'Asia-Pacific' },
  { code: 'krw', name: 'South Korean Won',     group: 'Asia-Pacific' },
  { code: 'lkr', name: 'Sri Lankan Rupee',     group: 'Asia-Pacific' },
  { code: 'myr', name: 'Malaysian Ringgit',    group: 'Asia-Pacific' },
  { code: 'nzd', name: 'New Zealand Dollar',   group: 'Asia-Pacific' },
  { code: 'php', name: 'Philippine Peso',      group: 'Asia-Pacific' },
  { code: 'pkr', name: 'Pakistani Rupee',      group: 'Asia-Pacific' },
  { code: 'sgd', name: 'Singapore Dollar',     group: 'Asia-Pacific' },
  { code: 'thb', name: 'Thai Baht',            group: 'Asia-Pacific' },
  { code: 'twd', name: 'New Taiwan Dollar',    group: 'Asia-Pacific' },
  { code: 'vnd', name: 'Vietnamese Dong',      group: 'Asia-Pacific' },

  { code: 'aed', name: 'UAE Dirham',           group: 'Middle East & Africa' },
  { code: 'bhd', name: 'Bahraini Dinar',       group: 'Middle East & Africa' },
  { code: 'ils', name: 'Israeli New Shekel',   group: 'Middle East & Africa' },
  { code: 'kwd', name: 'Kuwaiti Dinar',        group: 'Middle East & Africa' },
  { code: 'ngn', name: 'Nigerian Naira',       group: 'Middle East & Africa' },
  { code: 'sar', name: 'Saudi Riyal',          group: 'Middle East & Africa' },
  { code: 'zar', name: 'South African Rand',   group: 'Middle East & Africa' },
]

/**
 * A USD-based rate table. Produced by main/fx-rates.ts, consumed by
 * renderer/lib/currency.ts; declared here because src/main is deliberately not
 * reachable from the renderer, and this is the wire shape between them.
 */
export interface FxRates {
  /** Always 'usd' — the denomination of every stored value. */
  base: string
  /** code → units of that currency per 1 USD. Always contains `usd: 1`. */
  rates: Record<string, number>
  /** When the served table was fetched. 0 = never (hard failure, USD only). */
  fetchedAt: number
  /** True when the table is past its TTL, i.e. a refresh failed. */
  stale: boolean
}

/** The base every stored value is denominated in, and the fallback everywhere. */
export const BASE_CURRENCY = 'usd'

const BY_CODE = new Map(CURRENCIES.map(c => [c.code, c]))

/** The picker's groups, in display order, without hardcoding the list twice. */
export const CURRENCY_GROUPS: readonly CurrencyDef['group'][] =
  ['Americas', 'Europe', 'Asia-Pacific', 'Middle East & Africa']

/** Look a code up, case-insensitively. Unknown codes are not currencies here. */
export function currencyOf(code: string | null | undefined): CurrencyDef | null {
  if (!code) return null
  return BY_CODE.get(code.trim().toLowerCase()) ?? null
}

/** True for a code this build can actually display. */
export function isSupportedCurrency(code: string | null | undefined): boolean {
  return currencyOf(code) != null
}

/** ISO-4217 as `Intl.NumberFormat` wants it — uppercase. */
export function intlCode(code: string): string {
  return code.toUpperCase()
}
