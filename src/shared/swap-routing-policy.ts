/**
 * swap-routing-policy.ts — which SAFE route the user is offered, and why.
 *
 * WHAT CHANGED
 *
 * Route selection used to be two-tier: every route that paid a verified Magic
 * Money fee beat every route that did not, whatever either returned. A route
 * that paid us but gave the user materially less could win outright. This
 * module replaces that with one rule:
 *
 *   Offer the route with the best normalized net result for the user. Prefer a
 *   verified fee-paying route only when it is COMPETITIVE with that best route,
 *   as defined by the versioned tolerances below.
 *
 * Fee support is a tie-breaker among competitive routes, never a barrier to a
 * better outcome.
 *
 * WHAT IT RANKS, AND WHAT IT DOES NOT
 *
 * Only routes that already passed every execution-safety check reach this
 * module. It never makes an unsafe route eligible, and it never demotes a safe
 * route for failing to pay us.
 *
 * It ranks on real, provider-reported numbers:
 *   - net output: `buyAmountRaw`, which every adapter reports AFTER provider,
 *     bridge and app fees. All candidates for one request share the output
 *     token, so these are the same units.
 *   - source-side costs (gas, plus fees paid on top of the input), when every
 *     compared route prices them in USD. They are converted to output units at
 *     one common reference price. If any route lacks them, costs are NOT
 *     guessed: the ranking uses net output alone and says so
 *     (`costsNormalized: false`).
 *   - the minimum received, which must also be competitive, so a fee route
 *     with a much weaker guaranteed floor cannot be preferred.
 *   - execution risk, from what the minimum actually guarantees. A fee route is
 *     never preferred over a lower-risk best route.
 *
 * It never applies a hypothetical penalty. The best route is compared with the
 * other routes that actually exist, not with an imagined fee-free copy of
 * itself.
 *
 * Platform-neutral — no Electron, Chrome, Capacitor, node: or fetch.
 */

/**
 * Versioned routing settings. Changing a value means changing `version`, so
 * every selection record says which rules produced it.
 *
 * DEFAULTS, AND WHY
 *
 * `feePreferenceMaxShortfallBps: 25` (0.25%). A fee-paying route may be
 * preferred when it returns at most 0.25% less than the best safe route. That
 * is a quarter of the 1% fee, and a fifth of the smallest non-stablecoin slippage
 * the wallet sets automatically (50 bps for blue chips, 250 bps otherwise).
 * Price movement between quote and fill routinely exceeds it, so differences
 * inside it are within quote noise. Differences outside it are real money the
 * user would lose so that we get paid.
 *
 * `feePreferenceMaxShortfallUsd: 10`. The same preference is also capped in
 * absolute terms when a USD reference price is known: 0.25% of a $100,000 swap
 * is $250, which is material however small the ratio. With no price, only the
 * relative bound applies, and the record says so.
 *
 * `maxAlternatives: 3`. Enough to show the output/speed/provider tradeoff
 * without burying the recommended route.
 */
export const SWAP_ROUTING_POLICY = {
  version: '2026-09-21.routing-v1',
  feePreferenceMaxShortfallBps: 25,
  feePreferenceMaxShortfallUsd: 10,
  maxAlternatives: 3,
} as const

export type SwapRoutingSettings = {
  version: string
  feePreferenceMaxShortfallBps: number
  feePreferenceMaxShortfallUsd: number
  maxAlternatives: number
}

/**
 * Execution risk from what the minimum received actually guarantees.
 * 0 atomic (same-chain: the floor is enforced in the transaction)
 * 1 provider-guaranteed (e.g. a solver that refunds on failure)
 * 2 destination-conditional (the floor holds only if the destination leg does)
 * 3 estimate (nothing enforces it)
 */
export type RouteRiskClass = 0 | 1 | 2 | 3

export function riskClassOf(scope: string | null | undefined): RouteRiskClass {
  switch (scope) {
    case 'atomic': return 0
    case 'provider-guaranteed': return 1
    case 'destination-conditional': return 2
    default: return 3
  }
}

/** What the policy needs from a route. Built by the privileged layer. */
export interface RouteMetrics {
  /** Stable key for the candidate (the caller maps it back to its quote). */
  key: string
  provider: string
  netOutRaw: bigint
  minOutRaw: bigint
  /** Gas + costs paid on top of the input, in USD; null when not priced. */
  sourceCostUsd: number | null
  /** USD value of `netOutRaw`, as the provider priced it; null when unknown. */
  outputUsd: number | null
  /** True only for a route whose Magic Money fee is VERIFIED. */
  feeVerified: boolean
  risk: RouteRiskClass
}

export type RouteSelectionReason =
  /** The best normalized net result, which may or may not pay a fee. */
  | 'best-net-result'
  /** A verified fee route within the competitive tolerance of the best. */
  | 'fee-route-within-tolerance'

export interface RankedRoute {
  key: string
  provider: string
  /** Net output after normalized source costs, in output raw units. */
  valueRaw: bigint
  /** How much less than the SELECTED route this returns, in bps (negative = more). */
  deltaBpsVsSelected: number
}

export interface RouteSelection {
  policyVersion: string
  selectedKey: string
  reason: RouteSelectionReason
  /** The best route by normalized net result (equal to selected unless a fee route was preferred). */
  bestKey: string
  /** How much less the selected route returns than the best, in bps and (if priced) USD. */
  shortfallBps: number
  shortfallUsd: number | null
  /** True when source costs were priced for every route and included. */
  costsNormalized: boolean
  /** Why costs were or were not compared, in words for the record. */
  comparedOn: string
  /** Every eligible route, best value first. */
  ranked: RankedRoute[]
  /** Up to `maxAlternatives` routes other than the selected one. */
  alternatives: RankedRoute[]
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** bps of `part` relative to `whole`, for bigints; 0 when whole is 0. */
function bpsOf(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0
  return Number((part * 1_000_000n) / whole) / 100
}

/**
 * USD per raw output unit, as the median of what the routes themselves imply.
 * A median, so one provider's odd pricing cannot move the reference.
 */
export function referenceUnitPriceUsd(routes: RouteMetrics[]): number | null {
  const ratios = routes
    .filter(r => r.outputUsd != null && r.outputUsd > 0 && r.netOutRaw > 0n)
    .map(r => (r.outputUsd as number) / Number(r.netOutRaw))
    .filter(x => Number.isFinite(x) && x > 0)
  return median(ratios)
}

/**
 * Choose among SAFE routes. Returns null for an empty list; the caller then
 * reports that no safe executable route exists, with the reasons it collected.
 */
export function selectRoute(
  routes: RouteMetrics[],
  settings: SwapRoutingSettings = SWAP_ROUTING_POLICY,
): RouteSelection | null {
  const live = routes.filter(r => r.netOutRaw > 0n)
  if (!live.length) return null

  const unitUsd = referenceUnitPriceUsd(live)
  const costsNormalized = unitUsd != null && live.every(r => r.sourceCostUsd != null)
  const valueOf = (r: RouteMetrics): bigint => {
    if (!costsNormalized) return r.netOutRaw
    const costUnits = BigInt(Math.round((r.sourceCostUsd as number) / (unitUsd as number)))
    return r.netOutRaw - costUnits
  }

  const order = (a: RouteMetrics, b: RouteMetrics): number => {
    const va = valueOf(a), vb = valueOf(b)
    if (va !== vb) return va > vb ? -1 : 1
    if (a.minOutRaw !== b.minOutRaw) return a.minOutRaw > b.minOutRaw ? -1 : 1
    if (a.risk !== b.risk) return a.risk - b.risk
    // Exact tie on everything the user gets: now, and only now, fee support
    // decides.
    if (a.feeVerified !== b.feeVerified) return a.feeVerified ? -1 : 1
    return 0
  }
  const sorted = [...live].sort(order)
  const best = sorted[0]
  const bestValue = valueOf(best)

  // A verified fee route is preferred only if it is competitive on EVERY axis
  // the user cares about: net result, guaranteed floor, and execution risk.
  const competitive = (r: RouteMetrics): boolean => {
    if (!r.feeVerified) return false
    if (r.risk > best.risk) return false
    const shortfall = bestValue - valueOf(r)
    if (bpsOf(shortfall, bestValue) > settings.feePreferenceMaxShortfallBps) return false
    if (unitUsd != null && Number(shortfall) * unitUsd > settings.feePreferenceMaxShortfallUsd) return false
    const floorShortfall = best.minOutRaw - r.minOutRaw
    if (floorShortfall > 0n && bpsOf(floorShortfall, best.minOutRaw) > settings.feePreferenceMaxShortfallBps) return false
    return true
  }

  let selected = best
  let reason: RouteSelectionReason = 'best-net-result'
  if (!best.feeVerified) {
    const feeRoute = sorted.find(competitive)
    if (feeRoute) { selected = feeRoute; reason = 'fee-route-within-tolerance' }
  }

  const selectedValue = valueOf(selected)
  const shortfall = bestValue - selectedValue
  const ranked: RankedRoute[] = sorted.map(r => ({
    key: r.key,
    provider: r.provider,
    valueRaw: valueOf(r),
    deltaBpsVsSelected: bpsOf(selectedValue - valueOf(r), selectedValue),
  }))

  return {
    policyVersion: settings.version,
    selectedKey: selected.key,
    reason,
    bestKey: best.key,
    shortfallBps: bpsOf(shortfall, bestValue),
    shortfallUsd: unitUsd != null ? Number(shortfall) * unitUsd : null,
    costsNormalized,
    comparedOn: costsNormalized
      ? 'net output minus gas and source-side costs, all priced by the providers in USD'
      : unitUsd == null
        ? 'net output only: no route priced its output in USD, so gas could not be converted'
        : 'net output only: at least one route did not price its gas, so gas was not compared',
    ranked,
    alternatives: ranked.filter(r => r.key !== selected.key).slice(0, settings.maxAlternatives),
  }
}
