/**
 * swap-candidates.ts — which quoted routes may be OFFERED, and which one wins.
 *
 * Moved from src/main/swap-proxy.ts so the wallet, the ChainLens backend and the
 * ChainLens page filter and rank candidates identically. A backend's own ranking
 * and any `destination` it sent are claims; everything here is recomputed from
 * the quote and the policy this code ships with.
 */

import {
  destinationTermsFor, compactRouteSteps, solverDestinationTerms,
} from './swap-destination'
import { selectRoute, riskClassOf, type RouteMetrics } from './swap-routing-policy'
import { deriveMinBuyAmountRaw, decideSwapPolicy, checkMinReceived } from './swap-policy-checks'
import { classifyQuoteFee, checkQuoteFeeIntegrity } from './swap-fee-checks'
import type { NormalizedSwapQuote } from './swap-quote'

export interface SwapRoutingSummary {
  policyVersion: string
  reason: 'best-net-result' | 'fee-route-within-tolerance'
  /** How much less the offered route returns than the best safe one, in bps. */
  shortfallBps: number
  costsNormalized: boolean
  /** Safe routes compared, and routes excluded (with why). */
  safeCandidates: number
  excluded: string[]
  /** The other safe routes, best first. Summaries only; each needs its own quote to execute. */
  alternatives: { provider: string; buyAmountRaw: string; minBuyAmountRaw: string | null; feeVerified: boolean }[]
}

/**
 * Guarantee every quote carries a minimum received.
 *
 * Providers that state their own floor keep it; the rest get one derived from
 * the output and the slippage the user already accepted. A derived floor is NOT
 * proof the router enforces it, which is why a BROAD swap also has to simulate
 * (see swap-policy.ts) rather than trusting this number on its own.
 */
export function withMinReceived(quote: NormalizedSwapQuote | null): NormalizedSwapQuote | null {
  return withDestinationTerms(withMinReceivedOnly(quote))
}

/**
 * Attach what the minimum ACTUALLY guarantees.
 *
 * Recomputed here unconditionally. Any `destination` a backend sent is
 * discarded: it is the claim being checked, so it cannot also be the evidence.
 * Route steps are re-sanitized for the same reason.
 */
export function withDestinationTerms(quote: NormalizedSwapQuote | null): NormalizedSwapQuote | null {
  if (!quote) return null
  const routeSteps = compactRouteSteps(quote.routeSteps)
  return {
    ...quote,
    routeSteps,
    destination: quote.provider === 'relay' && quote.fromChain !== quote.toChain
      // Relay is a SOLVER: it fills the whole intent or refunds the deposit, so
      // there is no bridged intermediate to be left holding. That is a better
      // failure mode than bridge-then-swap, but it is still the PROVIDER's
      // promise rather than the transaction's — `provider-guaranteed`, never
      // `atomic`. Measured refunds arrive on the SOURCE chain.
      ? solverDestinationTerms('Relay', quote.fromChain, quote.slippageBps)
      : destinationTermsFor({
      provider: quote.provider,
      fromChain: quote.fromChain,
      toChain: quote.toChain,
      toTokenAddress: quote.toTokenAddress,
      slippageBps: quote.slippageBps,
      minReceivedSource: quote.minReceivedSource,
      routeSteps,
    }),
  }
}

export function withMinReceivedOnly(quote: NormalizedSwapQuote | null): NormalizedSwapQuote | null {
  if (!quote) return null
  if (quote.minBuyAmountRaw && /^[0-9]+$/.test(quote.minBuyAmountRaw)) {
    // A Worker that predates provenance sent a figure but no source. Treat the
    // unknown case as 'derived': assuming 'provider' would let an old backend
    // silently unlock broad execution.
    return quote.minReceivedSource ? quote : { ...quote, minReceivedSource: 'derived' }
  }
  const derived = deriveMinBuyAmountRaw(quote.buyAmountRaw, quote.slippageBps)
  return derived ? { ...quote, minBuyAmountRaw: derived, minReceivedSource: 'derived' } : quote
}


/** One error string that names every route that was not served, and why. */
export function joinReasons(primary: string, rejected: string[]): string {
  return rejected.length ? `${primary} | ${rejected.join(' | ')}` : primary
}

/**
 * Why a quote must NOT be offered, or null when it may be.
 *
 * Runs the SAME checks the executor runs at signing time (fee integrity, the
 * policy gate, and — for broad tokens — the exact minimum-received bound), so a
 * route that would be refused at signing is excluded HERE, before it is ranked
 * and shown. Previously the first fee-verified route was returned without these
 * checks, so a user could be shown a quote and only learn at "Swap" that it
 * could never be signed — while a safe route from another provider went unseen.
 *
 * This moves no gate and weakens none: the executor still runs every one of
 * these again on the stored intent, plus simulation.
 */
export function unsignableReason(quote: NormalizedSwapQuote): string | null {
  if (!/^[0-9]+$/.test(quote.buyAmountRaw) || quote.buyAmountRaw === '0') return 'no output amount'
  const integrity = checkQuoteFeeIntegrity(quote)
  if (!integrity.ok) return integrity.reason ?? 'fee terms could not be verified'
  const policy = decideSwapPolicy(quote)
  if (!policy.allowed) return policy.reason ?? 'not enabled'
  if (policy.requireMinReceived) {
    const min = checkMinReceived(quote)
    if (!min.ok) return min.reason ?? 'minimum received could not be confirmed'
  }
  return null
}

/** A Worker quote is only usable when it carries fee terms at all. */
export function outdatedWorkerReason(quote: NormalizedSwapQuote): string | null {
  if (quote.appFee) return null
  return 'the swap service returned a quote with no fee terms, which means it is running an older '
    + 'version than this app — it cannot be verified, so it is not offered (the Worker needs redeploying)'
}

/**
 * Rank the SAFE candidates under the routing policy and describe the choice.
 * Every candidate must already have passed `unsignableReason`.
 */
export function selectSafeRoute(
  candidates: NormalizedSwapQuote[], excluded: string[],
): { quote: NormalizedSwapQuote | null; error: string | null; routing?: SwapRoutingSummary | null } {
  if (!candidates.length) {
    return { quote: null, error: joinReasons('No route could be offered safely for this swap.', excluded) }
  }
  const metrics: RouteMetrics[] = candidates.map((q, i) => ({
    key: String(i),
    provider: q.provider,
    netOutRaw: BigInt(q.buyAmountRaw),
    minOutRaw: BigInt(q.minBuyAmountRaw && /^[0-9]+$/.test(q.minBuyAmountRaw) ? q.minBuyAmountRaw : q.buyAmountRaw),
    sourceCostUsd: typeof q.valuation?.sourceCostUsd === 'number' ? q.valuation.sourceCostUsd : null,
    outputUsd: typeof q.valuation?.outputUsd === 'number' ? q.valuation.outputUsd : null,
    feeVerified: classifyQuoteFee(q).tier === 'fee-paying',
    risk: riskClassOf(q.destination?.minReceivedScope),
  }))
  const selection = selectRoute(metrics)
  if (!selection) {
    return { quote: null, error: joinReasons('No route returned a usable output.', excluded) }
  }
  const byKey = (k: string) => candidates[Number(k)]
  return {
    quote: byKey(selection.selectedKey),
    error: null,
    routing: {
      policyVersion: selection.policyVersion,
      reason: selection.reason,
      shortfallBps: selection.shortfallBps,
      costsNormalized: selection.costsNormalized,
      safeCandidates: candidates.length,
      excluded,
      alternatives: selection.alternatives.map(a => {
        const q = byKey(a.key)
        return {
          provider: q.provider,
          buyAmountRaw: q.buyAmountRaw,
          minBuyAmountRaw: q.minBuyAmountRaw ?? null,
          feeVerified: classifyQuoteFee(q).tier === 'fee-paying',
        }
      }),
    },
  }
}

/**
 * Filter a backend's candidate list the way the wallet does: minimum and
 * destination terms recomputed, stale-backend quotes and unsignable routes
 * excluded with their reason, then ranked.
 */
export function selectFromCandidates(
  list: unknown[], excluded: string[] = [],
): { quote: NormalizedSwapQuote | null; error: string | null; routing?: SwapRoutingSummary | null } {
  const safe: NormalizedSwapQuote[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const q = raw as NormalizedSwapQuote
    const outdated = outdatedWorkerReason(q)
    if (outdated) { excluded.push(`${q.provider}: ${outdated}`); continue }
    const ready = withMinReceived(q)
    if (!ready) continue
    const why = unsignableReason(ready)
    if (why) { excluded.push(`${q.provider}: ${why}`); continue }
    safe.push(ready)
  }
  return selectSafeRoute(safe, excluded)
}
