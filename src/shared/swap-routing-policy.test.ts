/**
 * swap-routing-policy.test.ts — route selection, and parity with the Worker's
 * copy (cloudflare-worker/swap-routing.js).
 *
 * The policy this replaces was two-tier: any verified fee-paying route beat
 * every fee-free route regardless of how much less the user would receive.
 * These tests pin the replacement rule — best real net result wins, a fee
 * route is preferred only within a documented, versioned tolerance — and the
 * parity block is the guarantee the Worker's mirror has not drifted (same
 * arrangement as swap-fee-policy.test.ts).
 */
import { describe, it, expect } from 'vitest'
import {
  selectRoute, referenceUnitPriceUsd, riskClassOf, SWAP_ROUTING_POLICY,
  type RouteMetrics,
} from './swap-routing-policy'
// @ts-expect-error -- untyped Worker mirror, imported only to prove parity
import * as worker from '../../cloudflare-worker/swap-routing.js'

function route(over: Partial<RouteMetrics> & { key: string }): RouteMetrics {
  return {
    provider: 'x',
    netOutRaw: 1_000_000n,
    minOutRaw: 950_000n,
    sourceCostUsd: null,
    outputUsd: null,
    feeVerified: false,
    risk: 0,
    ...over,
  }
}

describe('riskClassOf', () => {
  it('orders atomic < provider-guaranteed < destination-conditional < estimate/unknown', () => {
    expect(riskClassOf('atomic')).toBe(0)
    expect(riskClassOf('provider-guaranteed')).toBe(1)
    expect(riskClassOf('destination-conditional')).toBe(2)
    expect(riskClassOf('estimate')).toBe(3)
    expect(riskClassOf(null)).toBe(3)
    expect(riskClassOf(undefined)).toBe(3)
    expect(riskClassOf('something-unknown')).toBe(3)
  })
})

describe('selectRoute — no routes', () => {
  it('returns null for an empty list', () => {
    expect(selectRoute([])).toBeNull()
  })

  it('returns null when every route has zero output', () => {
    expect(selectRoute([route({ key: 'a', netOutRaw: 0n })])).toBeNull()
  })
})

describe('selectRoute — best net result wins by default', () => {
  it('picks the higher net output when neither route pays a fee', () => {
    const a = route({ key: 'a', netOutRaw: 1_000_000n })
    const b = route({ key: 'b', netOutRaw: 1_100_000n })
    const r = selectRoute([a, b])!
    expect(r.selectedKey).toBe('b')
    expect(r.bestKey).toBe('b')
    expect(r.reason).toBe('best-net-result')
    expect(r.shortfallBps).toBe(0)
  })

  it('a fee-paying route with a materially worse result does NOT win', () => {
    // The bug this replaces: tier-1 (fee-paying) beat tier-2 outright. Here the
    // fee route returns 5% less — far outside the tolerance — so the better
    // fee-free route must be selected.
    const feeRoute = route({ key: 'fee', netOutRaw: 950_000n, minOutRaw: 900_000n, feeVerified: true })
    const free = route({ key: 'free', netOutRaw: 1_000_000n, minOutRaw: 950_000n })
    const r = selectRoute([feeRoute, free])!
    expect(r.selectedKey).toBe('free')
    expect(r.bestKey).toBe('free')
    expect(r.reason).toBe('best-net-result')
  })

  it('still offers the best safe route when it pays no fee at all', () => {
    const free = route({ key: 'only', netOutRaw: 1_000_000n })
    const r = selectRoute([free])!
    expect(r.selectedKey).toBe('only')
  })
})

describe('selectRoute — fee preference within tolerance', () => {
  it('prefers a verified fee route within the default bps tolerance', () => {
    // 25 bps is the default cap; 20 bps shortfall must still prefer the fee route.
    const feeRoute = route({ key: 'fee', netOutRaw: 998_000n, minOutRaw: 948_000n, feeVerified: true })
    const free = route({ key: 'free', netOutRaw: 1_000_000n, minOutRaw: 950_000n })
    const r = selectRoute([feeRoute, free])!
    expect(r.selectedKey).toBe('fee')
    expect(r.reason).toBe('fee-route-within-tolerance')
    expect(r.bestKey).toBe('free')
    expect(r.shortfallBps).toBeCloseTo(20, 0)
  })

  it('refuses to prefer a fee route just OUTSIDE the bps tolerance', () => {
    const feeRoute = route({ key: 'fee', netOutRaw: 997_000n, minOutRaw: 947_000n, feeVerified: true }) // 30 bps
    const free = route({ key: 'free', netOutRaw: 1_000_000n, minOutRaw: 950_000n })
    const r = selectRoute([feeRoute, free])!
    expect(r.selectedKey).toBe('free')
    expect(r.reason).toBe('best-net-result')
  })

  it('never prefers a fee route with strictly higher execution risk than the best', () => {
    const feeRoute = route({
      key: 'fee', netOutRaw: 999_500n, minOutRaw: 949_500n, feeVerified: true, risk: 2,
    })
    const free = route({ key: 'free', netOutRaw: 1_000_000n, minOutRaw: 950_000n, risk: 0 })
    const r = selectRoute([feeRoute, free])!
    expect(r.selectedKey).toBe('free')
  })

  it('refuses a fee route whose guaranteed floor is materially weaker, even if net output is close', () => {
    const feeRoute = route({ key: 'fee', netOutRaw: 999_500n, minOutRaw: 800_000n, feeVerified: true })
    const free = route({ key: 'free', netOutRaw: 1_000_000n, minOutRaw: 950_000n })
    const r = selectRoute([feeRoute, free])!
    expect(r.selectedKey).toBe('free')
  })

  it('respects the USD cap even when the bps shortfall is within tolerance', () => {
    // 20 bps of a $1,000,000-equivalent output is $2,000 — far past the $10 cap.
    const unitUsd = 1 // $1 per raw unit, so netOutRaw doubles as USD
    const feeRoute = route({
      key: 'fee', netOutRaw: 998_000n, minOutRaw: 948_000n, feeVerified: true, outputUsd: 998_000 * unitUsd,
    })
    const free = route({ key: 'free', netOutRaw: 1_000_000n, minOutRaw: 950_000n, outputUsd: 1_000_000 * unitUsd })
    const r = selectRoute([feeRoute, free])!
    expect(r.selectedKey).toBe('free')
  })
})

describe('selectRoute — cost normalization', () => {
  it('folds priced gas/source costs into the comparison when every route has them', () => {
    const unitUsd = 0.001 // $0.001 per raw output unit
    const cheap = route({
      key: 'cheap', netOutRaw: 1_000_000n, minOutRaw: 950_000n,
      outputUsd: 1_000, sourceCostUsd: 5,
    })
    const expensive = route({
      key: 'expensive', netOutRaw: 1_010_000n, minOutRaw: 960_000n,
      outputUsd: 1_010 * (1010 / 1000), sourceCostUsd: 50, // far pricier gas
    })
    const r = selectRoute([cheap, expensive])!
    expect(r.costsNormalized).toBe(true)
    expect(r.selectedKey).toBe('cheap')
    void unitUsd
  })

  it('falls back to net-output-only when any route is missing a priced cost, and says so', () => {
    const withCost = route({ key: 'a', netOutRaw: 1_000_000n, outputUsd: 1000, sourceCostUsd: 5 })
    const withoutCost = route({ key: 'b', netOutRaw: 1_010_000n, outputUsd: 1010, sourceCostUsd: null })
    const r = selectRoute([withCost, withoutCost])!
    expect(r.costsNormalized).toBe(false)
    expect(r.selectedKey).toBe('b') // higher raw net output, no cost guessed
    expect(r.comparedOn).toMatch(/net output only/i)
  })
})

describe('selectRoute — ranking and alternatives', () => {
  it('ranks every route, best first, and caps alternatives at maxAlternatives', () => {
    const routes = ['a', 'b', 'c', 'd', 'e'].map((k, i) =>
      route({ key: k, netOutRaw: BigInt(1_000_000 - i * 1000) }))
    const r = selectRoute(routes)!
    expect(r.ranked.map(x => x.key)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(r.alternatives).toHaveLength(SWAP_ROUTING_POLICY.maxAlternatives)
    expect(r.alternatives.map(x => x.key)).toEqual(['b', 'c', 'd'])
  })

  it('reports deltaBpsVsSelected as 0 for the selected route itself', () => {
    const r = selectRoute([route({ key: 'only', netOutRaw: 1_000_000n })])!
    expect(r.ranked[0].deltaBpsVsSelected).toBe(0)
  })
})

describe('referenceUnitPriceUsd', () => {
  it('is the median of routes that priced their own output', () => {
    const routes = [
      route({ key: 'a', netOutRaw: 1_000_000n, outputUsd: 1000 }),  // 0.001/unit
      route({ key: 'b', netOutRaw: 1_000_000n, outputUsd: 2000 }),  // 0.002/unit
      route({ key: 'c', netOutRaw: 1_000_000n, outputUsd: 3000 }),  // 0.003/unit
    ]
    expect(referenceUnitPriceUsd(routes)).toBeCloseTo(0.002, 6)
  })

  it('is null when no route priced its output', () => {
    expect(referenceUnitPriceUsd([route({ key: 'a' })])).toBeNull()
  })
})

// ── Worker parity ────────────────────────────────────────────────────────────

describe('parity with cloudflare-worker/swap-routing.js', () => {
  it('shares the same policy version and tolerances', () => {
    expect(worker.SWAP_ROUTING_POLICY.version).toBe(SWAP_ROUTING_POLICY.version)
    expect(worker.SWAP_ROUTING_POLICY.feePreferenceMaxShortfallBps)
      .toBe(SWAP_ROUTING_POLICY.feePreferenceMaxShortfallBps)
    expect(worker.SWAP_ROUTING_POLICY.feePreferenceMaxShortfallUsd)
      .toBe(SWAP_ROUTING_POLICY.feePreferenceMaxShortfallUsd)
    expect(worker.SWAP_ROUTING_POLICY.maxAlternatives).toBe(SWAP_ROUTING_POLICY.maxAlternatives)
  })

  it('riskClassOf agrees on every scope value', () => {
    for (const scope of ['atomic', 'provider-guaranteed', 'destination-conditional', 'estimate', null, 'x']) {
      expect(worker.riskClassOf(scope)).toBe(riskClassOf(scope as never))
    }
  })

  // Randomized-ish fixed fixtures run through BOTH implementations; any future
  // drift between the TS and JS copies fails here rather than shipping quietly.
  const scenarios: RouteMetrics[][] = [
    [route({ key: 'a', netOutRaw: 1_000_000n }), route({ key: 'b', netOutRaw: 1_100_000n })],
    [
      route({ key: 'fee', netOutRaw: 998_000n, minOutRaw: 948_000n, feeVerified: true }),
      route({ key: 'free', netOutRaw: 1_000_000n, minOutRaw: 950_000n }),
    ],
    [
      route({ key: 'fee', netOutRaw: 950_000n, minOutRaw: 900_000n, feeVerified: true }),
      route({ key: 'free', netOutRaw: 1_000_000n, minOutRaw: 950_000n }),
    ],
    [
      route({ key: 'a', netOutRaw: 1_000_000n, outputUsd: 1000, sourceCostUsd: 5 }),
      route({ key: 'b', netOutRaw: 1_010_000n, outputUsd: 1010, sourceCostUsd: 50 }),
    ],
  ]

  it.each(scenarios.map((s, i) => [i, s] as const))('agrees with the Worker on scenario %i', (_i, routes) => {
    const tsResult = selectRoute(routes)!
    const jsResult = worker.selectRoute(routes)
    expect(jsResult.selectedKey).toBe(tsResult.selectedKey)
    expect(jsResult.bestKey).toBe(tsResult.bestKey)
    expect(jsResult.reason).toBe(tsResult.reason)
    expect(jsResult.costsNormalized).toBe(tsResult.costsNormalized)
    expect(jsResult.shortfallBps).toBeCloseTo(tsResult.shortfallBps, 6)
    expect(jsResult.ranked.map((r: { key: string }) => r.key)).toEqual(tsResult.ranked.map(r => r.key))
    expect(jsResult.alternatives.map((r: { key: string }) => r.key))
      .toEqual(tsResult.alternatives.map(r => r.key))
  })
})
