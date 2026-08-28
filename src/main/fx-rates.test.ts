import { describe, it, expect } from 'vitest'
import { normalizeRates } from './fx-rates'

// CoinGecko's /exchange_rates is BTC-relative: every `value` is "units of this
// currency per 1 BTC". The wallet needs a USD base, so the whole table is
// rescaled by the USD row.
const raw = {
  btc: { name: 'Bitcoin',         unit: 'BTC',  value: 1,       type: 'crypto' },
  usd: { name: 'US Dollar',       unit: '$',    value: 50_000,  type: 'fiat'   },
  cad: { name: 'Canadian Dollar', unit: 'CA$',  value: 70_000,  type: 'fiat'   },
  eur: { name: 'Euro',            unit: '€',    value: 45_000,  type: 'fiat'   },
  jpy: { name: 'Japanese Yen',    unit: '¥',    value: 7_500_000, type: 'fiat' },
}

describe('fx-rates normalizeRates', () => {
  it('rebases the BTC-relative table onto USD', () => {
    const out = normalizeRates(raw)!
    expect(out.usd).toBe(1)
    expect(out.cad).toBeCloseTo(1.4, 10)     // 70000 / 50000
    expect(out.eur).toBeCloseTo(0.9, 10)     // 45000 / 50000
    expect(out.jpy).toBeCloseTo(150, 10)     // 7500000 / 50000
  })

  it('drops codes the wallet cannot display', () => {
    // btc is in the response and is a real rate, but it is not a fiat currency
    // in shared/currencies.ts, so it must not reach the picker as one.
    const out = normalizeRates(raw)!
    expect(out).not.toHaveProperty('btc')
    expect(normalizeRates({ ...raw, zzz: { value: 1, type: 'fiat' } })!).not.toHaveProperty('zzz')
  })

  it('drops nonsense values rather than propagating them', () => {
    const out = normalizeRates({
      ...raw,
      cad: { value: 0, type: 'fiat' },
      eur: { value: Number.NaN, type: 'fiat' },
      gbp: { value: -3, type: 'fiat' },
      chf: { value: 'lots' as unknown as number, type: 'fiat' },
    })!
    expect(out).not.toHaveProperty('cad')
    expect(out).not.toHaveProperty('eur')
    expect(out).not.toHaveProperty('gbp')
    expect(out).not.toHaveProperty('chf')
    expect(out.jpy).toBeCloseTo(150, 10)   // the good rows survive
  })

  it('refuses the whole table when USD is missing or broken', () => {
    // Every other rate is scaled by the USD row, so a bad USD row would make the
    // entire table wrong — better to keep serving the previous one.
    const { usd: _usd, ...noUsd } = raw
    expect(normalizeRates(noUsd)).toBeNull()
    expect(normalizeRates({ ...raw, usd: { value: 0, type: 'fiat' } })).toBeNull()
    expect(normalizeRates(undefined)).toBeNull()
  })
})
