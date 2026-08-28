import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { formatFiat, formatFiatPrice, formatFiatCompact, __setDisplayLocale } from './currency'
import { CURRENCIES, currencyOf, isSupportedCurrency, intlCode } from '../../shared/currencies'

// Symbols and separators are the LOCALE's business, so the locale is pinned
// here — otherwise these expectations pass or fail depending on whose machine
// runs them. On an en-CA box (this repo's) USD renders as "US$1,234.50" and
// CAD as plain "$", which is correct for that reader and useless as a fixture.
beforeAll(() => __setDisplayLocale('en-US'))
afterAll(() => __setDisplayLocale(null))

describe('formatFiat', () => {
  it('formats USD at rate 1', () => {
    expect(formatFiat(1234.5, 'usd', 1)).toBe('$1,234.50')
    expect(formatFiat(0, 'usd', 1)).toBe('$0.00')
  })

  it('converts before formatting', () => {
    // 1000 USD at 1.4 CAD/USD. The symbol must stay distinguishable from USD's.
    expect(formatFiat(1000, 'cad', 1.4)).toBe('CA$1,400.00')
    expect(formatFiat(1000, 'eur', 0.9)).toBe('€900.00')
  })

  it('falls back to USD when the rate is unknown', () => {
    // The number is a USD figure; rendering it under a euro sign would misstate
    // what the user holds, so an absent rate means "show dollars".
    expect(formatFiat(1000, 'eur', null)).toBe('$1,000.00')
  })

  it('respects the currency own decimal count', () => {
    // Yen has no subunit — "¥150.00" would be wrong, not just unidiomatic.
    expect(formatFiat(1, 'jpy', 150)).toBe('¥150')
  })

  it('returns null for a missing value so callers can render nothing', () => {
    expect(formatFiat(null, 'usd', 1)).toBeNull()
    expect(formatFiat(undefined, 'usd', 1)).toBeNull()
    expect(formatFiat(Number.NaN, 'usd', 1)).toBeNull()
  })

  it('collapses sub-cent amounts by default but not under `precise`', () => {
    // A network fee rendered as "$0.00" reads as free, which is why fees pass
    // `precise` and portfolio rows do not.
    expect(formatFiat(0.000021, 'usd', 1)).toBe('$0.00')
    expect(formatFiat(0.000021, 'usd', 1, { precise: true })).toBe('$0.000021')
    expect(formatFiat(0.004, 'usd', 1, { precise: true })).toBe('$0.004')
    // Above a cent, `precise` changes nothing.
    expect(formatFiat(12.34, 'usd', 1, { precise: true })).toBe('$12.34')
  })

  it('never asks Intl for fewer decimals than the currency defines', () => {
    // Kuwaiti dinars carry three. Forcing two used to be a RangeError, which the
    // catch turned into a silent fall back to dollars.
    const out = formatFiat(1, 'kwd', 0.31)
    expect(out).not.toBeNull()
    expect(out).not.toContain('$')
  })

  it('formats every supported currency without falling back to USD', () => {
    // A code in the catalogue that Intl rejects would silently render dollars
    // for anyone who picked it.
    for (const c of CURRENCIES) {
      if (c.code === 'usd') continue
      const out = formatFiat(1234.5, c.code, 1)
      expect(out, `${c.code} formatted as ${out}`).not.toBeNull()
      // Rendered under its OWN code, not the USD fallback.
      const usdOut = formatFiat(1234.5, 'usd', 1)
      if (c.code !== 'usd') expect(out === usdOut && c.code !== 'usd').toBe(false)
    }
  })
})

describe('formatFiatPrice', () => {
  it('widens precision as the price shrinks', () => {
    expect(formatFiatPrice(65_000, 'usd', 1)).toBe('$65,000.00')
    expect(formatFiatPrice(12.3456789, 'usd', 1)).toBe('$12.3457')
    expect(formatFiatPrice(0.0123456, 'usd', 1)).toBe('$0.01235')
    expect(formatFiatPrice(0.00000123, 'usd', 1)).toBe('$0.000001')
  })

  it('applies the ladder to the CONVERTED value', () => {
    // 0.004 USD is 0.6 JPY — a yen figure, which has no subunit at all.
    expect(formatFiatPrice(0.004, 'jpy', 150)).toBe('¥0.6')
  })

  it('returns null for a missing price', () => {
    expect(formatFiatPrice(null, 'usd', 1)).toBeNull()
  })
})

describe('formatFiatCompact', () => {
  it('abbreviates large figures in the display currency', () => {
    expect(formatFiatCompact(1.23e12, 'usd', 1)).toBe('$1.23T')
    expect(formatFiatCompact(1e9, 'eur', 0.9)).toBe('€900M')
  })

  it('falls back to USD without a rate', () => {
    expect(formatFiatCompact(1e9, 'eur', null)).toBe('$1B')
  })

  it('returns null for a missing figure', () => {
    expect(formatFiatCompact(null, 'usd', 1)).toBeNull()
  })
})

describe('currency catalogue', () => {
  it('has no duplicate codes', () => {
    const codes = CURRENCIES.map(c => c.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('keys everything in lowercase and matches on any case', () => {
    for (const c of CURRENCIES) expect(c.code).toBe(c.code.toLowerCase())
    expect(currencyOf('CAD')?.code).toBe('cad')
    expect(currencyOf(' eur ')?.code).toBe('eur')
    expect(currencyOf('not-a-currency')).toBeNull()
    expect(isSupportedCurrency(null)).toBe(false)
  })

  it('emits uppercase ISO codes for Intl', () => {
    expect(intlCode('cad')).toBe('CAD')
  })
})
