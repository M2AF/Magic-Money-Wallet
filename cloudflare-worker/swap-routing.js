/**
 * swap-routing.js — mirror of src/shared/swap-routing-policy.ts.
 *
 * The wallet makes the real choice, in its privileged layer, AFTER its own
 * execution-safety checks; this copy only decides which candidate the Worker
 * names as `quote` for clients older than the multi-route response. Keep it
 * rule-for-rule identical: swap-routing-parity.test.ts runs both on the same
 * fixtures and fails on any difference.
 */

export const SWAP_ROUTING_POLICY = {
  version: '2026-09-21.routing-v1',
  feePreferenceMaxShortfallBps: 25,
  feePreferenceMaxShortfallUsd: 10,
  maxAlternatives: 3,
}

export function riskClassOf(scope) {
  switch (scope) {
    case 'atomic': return 0
    case 'provider-guaranteed': return 1
    case 'destination-conditional': return 2
    default: return 3
  }
}

function median(xs) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function bpsOf(part, whole) {
  if (whole <= 0n) return 0
  return Number((part * 1000000n) / whole) / 100
}

export function referenceUnitPriceUsd(routes) {
  const ratios = routes
    .filter(r => r.outputUsd != null && r.outputUsd > 0 && r.netOutRaw > 0n)
    .map(r => r.outputUsd / Number(r.netOutRaw))
    .filter(x => Number.isFinite(x) && x > 0)
  return median(ratios)
}

/** Same contract as the TS `selectRoute`. `routes` carry bigint netOutRaw/minOutRaw. */
export function selectRoute(routes, settings = SWAP_ROUTING_POLICY) {
  const live = routes.filter(r => r.netOutRaw > 0n)
  if (!live.length) return null

  const unitUsd = referenceUnitPriceUsd(live)
  const costsNormalized = unitUsd != null && live.every(r => r.sourceCostUsd != null)
  const valueOf = (r) => costsNormalized
    ? r.netOutRaw - BigInt(Math.round(r.sourceCostUsd / unitUsd))
    : r.netOutRaw

  const order = (a, b) => {
    const va = valueOf(a), vb = valueOf(b)
    if (va !== vb) return va > vb ? -1 : 1
    if (a.minOutRaw !== b.minOutRaw) return a.minOutRaw > b.minOutRaw ? -1 : 1
    if (a.risk !== b.risk) return a.risk - b.risk
    if (a.feeVerified !== b.feeVerified) return a.feeVerified ? -1 : 1
    return 0
  }
  const sorted = [...live].sort(order)
  const best = sorted[0]
  const bestValue = valueOf(best)

  const competitive = (r) => {
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
  let reason = 'best-net-result'
  if (!best.feeVerified) {
    const feeRoute = sorted.find(competitive)
    if (feeRoute) { selected = feeRoute; reason = 'fee-route-within-tolerance' }
  }
  const selectedValue = valueOf(selected)
  const shortfall = bestValue - selectedValue
  const ranked = sorted.map(r => ({
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

/**
 * Metrics from a Worker-normalized quote. The Worker cannot compute the
 * wallet's destination terms, so its risk class is coarser: same-chain is
 * atomic, cross-chain is treated as unknown (3) unless the provider floor is a
 * solver guarantee. That only affects the legacy `quote` pick.
 */
export function workerRouteMetrics(key, quote, feeVerified) {
  const big = (v) => { try { return BigInt(String(v)) } catch { return 0n } }
  const cross = quote.fromChain !== quote.toChain
  const v = quote.valuation || {}
  return {
    key,
    provider: quote.provider,
    netOutRaw: big(quote.buyAmountRaw),
    minOutRaw: big(quote.minBuyAmountRaw || quote.buyAmountRaw),
    sourceCostUsd: typeof v.sourceCostUsd === 'number' ? v.sourceCostUsd : null,
    outputUsd: typeof v.outputUsd === 'number' ? v.outputUsd : null,
    feeVerified: !!feeVerified,
    risk: !cross ? 0 : quote.provider === 'relay' ? 1 : 3,
  }
}
