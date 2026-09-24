/**
 * swap-policy-checks.ts — what a host is willing to SIGN.
 *
 * Moved unchanged from src/main/swap-policy.ts (which re-exports it) so that
 * Magic Money's privileged layer and ChainLens's connected-wallet page apply
 * one policy. In Magic Money it runs where the keys are; in ChainLens it runs in
 * the page immediately before the connected wallet is asked to sign.
 *
 * Dynamic discovery made every token on a supported chain selectable. Selecting
 * is not trading: the picker can only ever be a hint, because the renderer is
 * the untrusted side of this boundary. This module is the gate, and it runs
 * where the keys are.
 *
 * What this decides, in order: is the quote INTERNALLY HONEST (a fee pointed at
 * a stranger, or terms from a policy the user never saw, stop here), is the pair
 * one we execute at all, and is its minimum received enforceable.
 *
 * What it deliberately does NOT decide: whether Magic Money gets paid. Under the
 * two-tier fee policy a route that cannot carry the app fee is a tier-2 route,
 * not an unsafe one. Losing a working swap to protect revenue is the wrong
 * trade, and conflating the two questions is how that happens by accident.
 *
 * Two tiers:
 *
 *   CURATED  both sides of the trade are addresses we ship
 *            (`src/shared/swap-curated-tokens.ts`). These are the pairs that
 *            worked before discovery existed, so they keep exactly their old
 *            execution behaviour — a simulation we could not RUN (dead RPC,
 *            node without eth_call) must not break a swap that has always
 *            worked. A simulation that definitively REVERTS still blocks.
 *
 *   BROAD    anything else — the long-tail and meme tokens discovery unlocked.
 *            These have never been executed by this wallet, so they must clear
 *            the stricter bar: an explicit minimum received, and a simulation
 *            that actually ran and passed. Unable-to-verify fails CLOSED.
 *
 * BROAD CROSS-CHAIN — what changed, and what did not
 *
 * This used to be refused outright, with a message blaming lifecycle tracking:
 * `lifiStatus` flattened DONE, the tracker died with its React component, and a
 * refund read as a completed swap. All three are now fixed (Stage 3), so that
 * explanation is stale and has been removed rather than left to mislead.
 *
 * It is NOT simply unlocked. A bridge cannot give the atomic guarantee a
 * same-chain swap gives: if the destination leg fails you receive the bridged
 * intermediate asset (PARTIAL) rather than the transaction reverting. So the
 * minimum received is DESTINATION-scope, not atomic, and a broad cross-chain
 * swap is admitted only where every one of these holds:
 *
 *   1. the provider states its own destination floor (`minReceivedSource`)
 *   2. that provider's floor semantics are verified (MIN_ENFORCEABLE_PROVIDERS)
 *   3. that provider's LIFECYCLE semantics are verified too, so a partial or a
 *      refund will actually be reported as one (LIFECYCLE_VERIFIED_PROVIDERS)
 *   4. settlement tracking is active, so the outcome survives a restart and the
 *      shortfall check below has somewhere to record itself
 *
 * SwapKit fails (3): its status endpoint is THORChain's and carries no
 * partial/refund vocabulary we have mapped, so a SwapKit refund would still read
 * as success. Rango fails (2): its minimum field spelling is unconfirmed. That
 * leaves LI.FI, which is measured on both counts — a narrow unlock, and an
 * honest one.
 *
 * Nothing here reads the renderer's copy of anything. Chains and addresses come
 * off the quote the privileged layer itself issued (see `swap-intent.ts`).
 */

import { isCuratedSwapToken } from './swap-curated-tokens'
import { swapCapability } from './swap-networks'
import { checkQuoteFeeIntegrity } from './swap-fee-checks'
import type { NormalizedSwapQuote } from './swap-quote'

export type SwapTier = 'curated' | 'broad'

export interface SwapPolicyDecision {
  tier: SwapTier
  isCrossChain: boolean
  /** false → refuse to sign at all; `reason` says why. */
  allowed: boolean
  reason: string | null
  /** Simulation must RUN and PASS. When false, only a definite revert blocks. */
  requireSimulation: boolean
  /** `minBuyAmountRaw` must be present and consistent with the quoted slippage. */
  requireMinReceived: boolean
}

/**
 * Classify by ADDRESS, never by symbol or by any flag the renderer attached.
 * Minting a token called "USDC" costs a few cents; minting one at a curated
 * address is impossible.
 */
export function classifySwapTier(quote: NormalizedSwapQuote): SwapTier {
  const sellCurated = isCuratedSwapToken(quote.fromChain, quote.fromTokenAddress)
  const buyCurated = isCuratedSwapToken(quote.toChain, quote.toTokenAddress)
  return sellCurated && buyCurated ? 'curated' : 'broad'
}

/**
 * Providers whose minimum-received semantics are established well enough to
 * carry a swap of a token this wallet has never traded.
 *
 * "Established" means the adapter reads the provider's OWN floor field — the
 * number encoded in the payload the router enforces — not a figure we computed.
 *
 *   jupiter  `otherAmountThreshold`   VERIFIED live: exactly out x (1 - slippage)
 *   lifi     `estimate.toAmountMin`   VERIFIED live: exactly out x (1 - slippage)
 *   0x       `minBuyAmount`           per 0x Swap API v2 docs; not exercised here
 *                                     (needs a key). Present-and-integer only.
 *   relay    `details.currencyOut.minimumAmount`
 *                                     VERIFIED live 2026-09-20: exactly the
 *                                     quoted `slippageTolerance` below
 *                                     `currencyOut.amount`.
 *
 * Deliberately absent: 1inch v6 /swap returns no floor at all, so its minimum
 * can only ever be derived. Uniswap, Rango and SwapKit have documented fields
 * whose spelling we have not confirmed against a live response, so they stay out
 * until one is. All of them remain fully available for CURATED pairs — this
 * list restricts which providers may carry a BROAD token, not which providers
 * work.
 */
const MIN_ENFORCEABLE_PROVIDERS = new Set(['jupiter', 'lifi', '0x', 'relay'])

/**
 * Providers whose CROSS-CHAIN lifecycle is VERIFIED against real provider
 * output, so a partial delivery or a refund is reported as one, not as success.
 *
 *   lifi   Verified 2026-09-20 against RECORDED LIVE responses for historical
 *          transfers that really ended DONE/PARTIAL (3) and DONE/REFUNDED (2),
 *          run through the real Worker and the real client mapper
 *          (src/main/swap-status-live-fixtures.test.ts). NOT_FOUND was observed
 *          live as a 404 / code 1003. FAILED + REFUND_IN_PROGRESS is mapped from
 *          LI.FI's docs and has NOT been observed live.
 *
 *   relay  Verified 2026-09-20 against RECORDED LIVE records from
 *          api.relay.link/requests/v2: `success`, `refund` and `failure` were
 *          all observed, plus `pending`, and `/intents/status` answered
 *          `unknown` for an unsubmitted request
 *          (src/shared/__fixtures__/relay, asserted by swap-relay.test.ts).
 *          The refund case is the one that matters: a refund is paid on the
 *          SOURCE chain while `metadata.currencyOut` still names the token that
 *          was REQUESTED, so reading the requested output as the delivered asset
 *          would report a refund as a perfect delivery.
 *
 * Deliberately absent: rango. Its REVERTED_TO_INPUT / MIDDLE_ASSET output types
 * are mapped from its docs but have never been seen in a live response, and a
 * set named "verified" must not contain a provider verified only on paper. (It
 * previously did; the only thing stopping it carrying a broad route was that
 * its minimum field is also unconfirmed.)
 *
 * Deliberately absent: swapkit. Its status comes from THORNode and carries no
 * partial/refund concept we have mapped, so a SwapKit refund would currently
 * read as a completed swap. That is precisely the failure this set exists to
 * prevent, and it is why "the lifecycle is fixed" is not the same statement as
 * "every provider's lifecycle is fixed".
 */
const LIFECYCLE_VERIFIED_PROVIDERS = new Set(['lifi', 'relay'])

/**
 * Is settlement tracking live?
 *
 * This is a REPORTING precondition, not a safety argument. Tracking runs after
 * the money has moved; it decides what the user is told, never what they
 * receive. It is required so a partial delivery or refund is not lost, but it
 * does not satisfy any execution-safety requirement on its own -- that is the
 * job of the destination terms checked in `checkBroadCrossChain`.
 */
let settlementTrackingActive = false
export function setSettlementTrackingActive(active: boolean): void {
  settlementTrackingActive = active
}
export function isSettlementTrackingActive(): boolean {
  return settlementTrackingActive
}

/**
 * Can this broad pair cross a bridge safely?
 *
 * A bridge cannot give the atomic guarantee a same-chain swap gives. If the
 * destination leg fails the user receives the bridged intermediate asset rather
 * than the transaction reverting, so the minimum received here is
 * DESTINATION-scope: the route targets it, and a shortfall surfaces as a partial
 * delivery instead of a revert. Admitting a broad token to that is only honest
 * when the shortfall will actually be detected and reported.
 */
export function checkBroadCrossChain(quote: NormalizedSwapQuote): BroadMinCheck {
  const enforceable = checkEnforceableMinimum(quote)
  if (!enforceable.ok) return enforceable

  if (!LIFECYCLE_VERIFIED_PROVIDERS.has(quote.provider)) {
    return {
      ok: false,
      reason:
        `Cross-chain delivery through ${quote.provider} cannot yet be told apart from a partial delivery or a ` +
        'refund, so this token is not enabled on that route. A different provider may still carry it.',
    }
  }

  // ---- What the minimum actually guarantees, bound into the approved plan ----
  // `destination` is computed by the wallet from the route (never accepted from a
  // backend) and is part of the stored intent, so what is checked here is what
  // the user saw and approved.
  const terms = quote.destination
  if (!terms) {
    return {
      ok: false,
      reason: 'This route did not describe what happens if its destination leg fails, so it is not enabled.',
    }
  }
  if (terms.minReceivedScope === 'destination-conditional') {
    // The source settles before the destination swap runs. If that swap misses
    // its floor the user holds the BRIDGED asset on the destination chain -- so
    // that asset must be known and shown before signing, not discovered after.
    if (!terms.fallback?.tokenAddress) {
      return {
        ok: false,
        reason:
          'If the final swap on this route failed you would receive a bridged asset the route does not identify. ' +
          'It is not enabled until that asset can be shown to you before signing.',
      }
    }
  } else if (terms.minReceivedScope !== 'provider-guaranteed') {
    // 'estimate' (nothing enforces it) or 'atomic' (impossible across chains --
    // a self-contradictory route description).
    return {
      ok: false,
      reason:
        'The minimum shown for this cross-chain route is an estimate that nothing enforces, so this token is ' +
        'not enabled on it.',
    }
  }

  if (!settlementTrackingActive) {
    return {
      ok: false,
      reason:
        'Cross-chain tracking is not active on this device, so a partial delivery or a refund could go unreported. ' +
        'This token is not enabled cross-chain here.',
    }
  }
  return { ok: true, reason: null }
}

export interface BroadMinCheck {
  ok: boolean
  reason: string | null
}

/**
 * Is this quote's minimum an ENFORCEABLE floor, or just an estimate?
 *
 * A derived minimum restates terms the user accepted; it is not encoded
 * anywhere and no contract will honour it. A successful `eth_call` does not
 * close that gap either: `eth_call` executes the calldata it was given against
 * current state — it tells you the route works at this instant, not that the
 * payload contains the bound the UI displayed. So for a broad token both must
 * hold: the floor came from the provider, and it came from an adapter whose
 * floor semantics we have established.
 */
export function checkEnforceableMinimum(quote: NormalizedSwapQuote): BroadMinCheck {
  if (quote.minReceivedSource !== 'provider') {
    return {
      ok: false,
      reason:
        `The ${quote.provider} route did not return its own minimum received, so the figure shown is ` +
        'an estimate rather than a limit the transaction enforces. This token is outside the ' +
        'wallet\'s verified list, so it is not signed on an estimate.',
    }
  }
  if (!MIN_ENFORCEABLE_PROVIDERS.has(quote.provider)) {
    return {
      ok: false,
      reason:
        `Minimum-received handling for the ${quote.provider} route has not been verified for tokens ` +
        'outside the wallet\'s verified list, so this pair is not enabled through it yet.',
    }
  }
  return { ok: true, reason: null }
}

/**
 * Can these chains carry a swap at all?
 *
 * Chain capability is declared in `src/shared/swap-networks.ts` and measured, not
 * asserted by whoever built the quote. Enforced HERE as well as in the picker
 * because the picker is the untrusted side: a renderer that offers a chain we
 * never enabled must not be able to get it signed.
 */
export function checkChainCapability(quote: NormalizedSwapQuote): BroadMinCheck {
  const from = swapCapability(quote.fromChain)
  const to = swapCapability(quote.toChain)
  if (!from) {
    return { ok: false, reason: `Swaps are not enabled on ${quote.fromChain}.` }
  }
  if (!to) {
    return { ok: false, reason: `Swaps cannot deliver to ${quote.toChain}.` }
  }
  const sameChain = quote.fromChain === quote.toChain
  const canSource = sameChain ? from.sameChain.length > 0 : from.crossChainSource.length > 0
  if (!canSource) {
    return {
      ok: false,
      reason: from.reason
        ?? `No configured provider can swap ${sameChain ? 'on' : 'out of'} ${quote.fromChain}.`,
    }
  }
  if (!sameChain && to.crossChainDestination.length === 0) {
    return { ok: false, reason: to.reason ?? `No configured provider can deliver to ${quote.toChain}.` }
  }
  return { ok: true, reason: null }
}

export function decideSwapPolicy(quote: NormalizedSwapQuote): SwapPolicyDecision {
  const tier = classifySwapTier(quote)
  const isCrossChain = quote.fromChain !== quote.toChain

  // Chain capability first: a chain we never enabled cannot be rescued by any
  // amount of per-route checking below.
  const capable = checkChainCapability(quote)
  if (!capable.ok) {
    return {
      tier, isCrossChain, allowed: false, reason: capable.reason,
      requireSimulation: true, requireMinReceived: true,
    }
  }

  // ---- Fee INTEGRITY, not fee collection -----------------------------------
  // Checked first, and checked here rather than only at quote time, because this
  // runs on the stored intent at the moment of signing.
  //
  // This refuses only two things: a "Magic Money fee" that would be paid to an
  // address that is not ours, and terms carried over from a policy version the
  // user never agreed to. A route that simply cannot pay us passes straight
  // through -- it is a tier-2 route, and refusing it would cost the user their
  // swap to protect our revenue.
  const feeIntegrity = checkQuoteFeeIntegrity(quote)
  if (!feeIntegrity.ok) {
    return {
      tier, isCrossChain, allowed: false, reason: feeIntegrity.reason,
      requireSimulation: true, requireMinReceived: true,
    }
  }

  if (tier === 'broad' && isCrossChain) {
    const gate = checkBroadCrossChain(quote)
    if (!gate.ok) {
      return {
        tier, isCrossChain, allowed: false, reason: gate.reason,
        requireSimulation: true, requireMinReceived: true,
      }
    }
  }

  if (tier === 'broad') {
    const enforceable = checkEnforceableMinimum(quote)
    if (!enforceable.ok) {
      return {
        tier, isCrossChain, allowed: false, reason: enforceable.reason,
        requireSimulation: true, requireMinReceived: true,
      }
    }
  }

  return {
    tier, isCrossChain, allowed: true, reason: null,
    requireSimulation: tier === 'broad',
    requireMinReceived: tier === 'broad',
  }
}

/**
 * Rounding headroom, in raw output units — NOT a slippage allowance.
 *
 * The exact floor is an integer division, and a provider computing the same
 * bound its own way can land a unit or two either side. One raw unit of the
 * output token absorbs that. It was previously 500 bps, which is five
 * PERCENTAGE POINTS: a quote displaying "0.5%" was accepted with a minimum 5.5%
 * below the expected output, so the user approved one bound and the transaction
 * enforced a far weaker one. That is not rounding.
 */
const MIN_RECEIVED_ROUNDING_UNITS = 1n

export interface MinReceivedCheck {
  ok: boolean
  reason: string | null
  /** Actual shortfall from the quoted buy amount, in bps. */
  shortfallBps: number | null
}

/** Slippage must be a finite, in-range integer before any bound is derived from it. */
export function isValidSlippageBps(slippageBps: unknown): slippageBps is number {
  return typeof slippageBps === 'number'
    && Number.isFinite(slippageBps)
    && Number.isInteger(slippageBps)
    && slippageBps >= 0
    && slippageBps <= 10000
}

/**
 * Validate `minBuyAmountRaw` against the EXACT bound the user approved.
 *
 * The rule is the one the user was shown: the minimum may not sit further below
 * the expected output than the slippage on screen, give or take a unit of
 * integer rounding. Anything wider is a different trade and needs a fresh
 * approval, not a tolerance.
 *
 * Fees are deliberately not folded in here. A fee that reduces the user's
 * receipt belongs in the quoted output (`buyAmountRaw`) so it is visible and
 * priced; silently widening the acceptable floor to make room for one would
 * hide exactly what this check exists to surface.
 */
export function checkMinReceived(quote: NormalizedSwapQuote): MinReceivedCheck {
  if (!isValidSlippageBps(quote.slippageBps)) {
    return { ok: false, reason: 'Quote has an invalid slippage setting.', shortfallBps: null }
  }
  const min = quote.minBuyAmountRaw
  if (min == null || !/^[0-9]+$/.test(min)) {
    return { ok: false, reason: 'Quote is missing a minimum received amount.', shortfallBps: null }
  }
  if (!/^[0-9]+$/.test(quote.buyAmountRaw)) {
    return { ok: false, reason: 'Quote amounts are not valid integers.', shortfallBps: null }
  }
  const minV = BigInt(min)
  const buyV = BigInt(quote.buyAmountRaw)

  if (buyV <= 0n) return { ok: false, reason: 'Quote has no output amount.', shortfallBps: null }
  if (minV <= 0n) {
    return { ok: false, reason: 'Quote sets no minimum received — the swap would have no slippage protection.', shortfallBps: null }
  }
  if (minV > buyV) {
    return { ok: false, reason: 'Quote minimum received exceeds its expected output.', shortfallBps: null }
  }

  // The floor the user approved, in raw units, computed exactly.
  const approvedFloor = (buyV * BigInt(10000 - quote.slippageBps)) / 10000n
  const shortfallBps = Number(((buyV - minV) * 10000n) / buyV)

  if (minV + MIN_RECEIVED_ROUNDING_UNITS < approvedFloor) {
    return {
      ok: false,
      reason:
        `Quote minimum received is ${(shortfallBps / 100).toFixed(2)}% below its expected output, ` +
        `but the approved slippage is ${(quote.slippageBps / 100).toFixed(2)}%. ` +
        'Executing it would enforce a weaker bound than the one shown.',
      shortfallBps,
    }
  }
  return { ok: true, reason: null, shortfallBps }
}

/**
 * Derive a minimum received from the quoted output and slippage.
 *
 * Only for providers that do not return one. It is a floor computed from terms
 * the user already accepted, not a promise the router will enforce it — which is
 * why a BROAD swap additionally requires simulation rather than trusting this.
 */
export function deriveMinBuyAmountRaw(buyAmountRaw: string, slippageBps: number): string | null {
  if (!/^[0-9]+$/.test(buyAmountRaw)) return null
  const bps = Math.max(0, Math.min(10000, Math.round(slippageBps)))
  try {
    return ((BigInt(buyAmountRaw) * BigInt(10000 - bps)) / 10000n).toString()
  } catch {
    return null
  }
}
