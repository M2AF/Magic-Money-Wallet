import { describe, it, expect } from 'vitest'
import { buildCandles, candleBucketMs } from './candles'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('buildCandles', () => {
  it('groups samples into OHLC buckets', () => {
    // 1D range → 30-minute candles. Two buckets of three 10-minute samples.
    const t0 = 1_700_000_000_000 - (1_700_000_000_000 % (30 * MIN))
    const data: Array<[number, number]> = [
      [t0, 10], [t0 + 10 * MIN, 14], [t0 + 20 * MIN, 9],
      [t0 + 30 * MIN, 11], [t0 + 40 * MIN, 8], [t0 + 50 * MIN, 12],
    ]
    expect(buildCandles(data, '1')).toEqual([
      { t: t0, o: 10, h: 14, l: 9, c: 9 },
      // Opens at the previous close (9), not at its own first sample (11).
      { t: t0 + 30 * MIN, o: 9, h: 12, l: 8, c: 12 },
    ])
  })

  it('returns nothing for fewer than two usable points', () => {
    expect(buildCandles([], '7')).toEqual([])
    expect(buildCandles([[0, 1]], '7')).toEqual([])
    expect(buildCandles([[0, 1], [HOUR, Number.NaN]], '7')).toEqual([])
  })

  it('keeps a single-sample bucket as a flat-or-gapped candle', () => {
    const data: Array<[number, number]> = [[0, 5], [DAY, 7]]
    const c = buildCandles(data, '30')
    expect(c).toHaveLength(2)
    expect(c[1]).toEqual({ t: DAY, o: 5, h: 7, l: 5, c: 7 })
  })
})

describe('candleBucketMs', () => {
  it('uses fixed widths per range', () => {
    expect(candleBucketMs('1', DAY)).toBe(30 * MIN)
    expect(candleBucketMs('7', 7 * DAY)).toBe(4 * HOUR)
    expect(candleBucketMs('30', 30 * DAY)).toBe(DAY)
    expect(candleBucketMs('365', 365 * DAY)).toBe(7 * DAY)
  })

  it('sizes ALL from the span in whole days, at least one', () => {
    expect(candleBucketMs('max', 10 * DAY)).toBe(DAY)
    // ~12 years → ~73 days per candle for ~60 candles.
    expect(candleBucketMs('max', 4380 * DAY)).toBe(73 * DAY)
  })
})
