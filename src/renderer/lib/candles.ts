/**
 * candles.ts — OHLC candles from a sampled price series.
 *
 * Every chart source (the worker cache, CoinGecko market_chart, Binance close
 * prices) hands back [time, price] points, not OHLC. Grouping those samples
 * into fixed time buckets gives candles on every build without another
 * endpoint. High/low are the extremes of the SAMPLES, so a wick can be a little
 * shorter than an exchange's tick-level one — the shape is right, the extremes
 * are a floor.
 */

export type ChartTimeframe = '1' | '7' | '30' | '365' | 'max'

export interface Candle {
  /** Bucket start, ms since epoch. */
  t: number
  o: number
  h: number
  l: number
  c: number
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/**
 * Candle width per range, picked so each range lands around 30–60 candles
 * (1D: 48 × 30m, 7D: 42 × 4h, 1M: 30 × 1d, 1Y: 52 × 1w). ALL has no fixed
 * span, so it is sized from the data instead.
 */
const BUCKET_MS: Record<ChartTimeframe, number | null> = {
  '1': 30 * MIN,
  '7': 4 * HOUR,
  '30': DAY,
  '365': 7 * DAY,
  'max': null,
}

const TARGET_CANDLES = 60

export function candleBucketMs(tf: ChartTimeframe, spanMs: number): number {
  const fixed = BUCKET_MS[tf]
  if (fixed) return fixed
  // Whole days, never under one: a daily-sampled series has nothing finer.
  return Math.max(DAY, Math.ceil(spanMs / TARGET_CANDLES / DAY) * DAY)
}

/**
 * Each candle opens at the previous candle's close (as exchange candles do),
 * so consecutive bodies join up rather than floating on sampling gaps.
 * Input must be time-ascending, as every chart source returns it.
 */
export function buildCandles(data: ReadonlyArray<readonly [number, number]>, tf: ChartTimeframe): Candle[] {
  const pts = data.filter(([t, p]) => Number.isFinite(t) && Number.isFinite(p))
  if (pts.length < 2) return []
  const size = candleBucketMs(tf, pts[pts.length - 1][0] - pts[0][0])

  const out: Candle[] = []
  let cur: Candle | null = null
  for (const [t, p] of pts) {
    const bucket = Math.floor(t / size) * size
    if (cur && bucket === cur.t) {
      if (p > cur.h) cur.h = p
      if (p < cur.l) cur.l = p
      cur.c = p
      continue
    }
    const o: number = cur ? cur.c : p
    if (cur) out.push(cur)
    cur = { t: bucket, o, h: Math.max(o, p), l: Math.min(o, p), c: p }
  }
  if (cur) out.push(cur)
  return out
}
