/**
 * swap-destination.ts — what a cross-chain route actually guarantees, and what
 * the user is holding if it does not deliver.
 *
 * THE DISTINCTION THIS MODULE EXISTS TO KEEP
 *
 * "Minimum received" means three different things depending on the route, and
 * collapsing them is how an estimate gets presented as a guarantee:
 *
 *   atomic                 The payload itself reverts below the floor. The swap
 *                          either delivers at least the minimum or does not
 *                          happen, and the user keeps their input. This is the
 *                          only scope in which an amount is GUARANTEED.
 *
 *   destination-conditional The floor governs the DESTINATION leg only. If the
 *                          route cannot meet it, the source transaction has
 *                          already settled: the user ends up holding the
 *                          intermediate asset on the destination chain and must
 *                          send another transaction to do anything with it. The
 *                          floor decides which asset they hold, never whether
 *                          they keep their original one.
 *
 *   provider-guaranteed    The provider commits to a floor through its own
 *                          mechanism (a solver refunds, an intent expires). The
 *                          failure mode is the provider's to define and ours to
 *                          report, and it is only as good as that provider.
 *
 *   estimate               Nobody enforces anything. We computed it from the
 *                          quoted output and the slippage the user accepted.
 *
 * Post-settlement shortfall detection (`applyDestinationShortfall`) is NOT on
 * this list. It runs after the money has moved and can only change what the user
 * is told. It must never be used to satisfy an execution-safety requirement.
 *
 * Platform-neutral — no Electron, Chrome, Capacitor, node: or fetch.
 */

/** How strongly the displayed minimum is actually held. */
export type MinReceivedScope =
  /** The transaction reverts below the floor; the user keeps their input. */
  | 'atomic'
  /** Governs the destination leg only; the source has already settled. */
  | 'destination-conditional'
  /** The provider commits by its own mechanism, with its own failure mode. */
  | 'provider-guaranteed'
  /** Computed by us from output x (1 - slippage). Enforced by nothing. */
  | 'estimate'

/** True only where an amount may honestly be called guaranteed. */
export function isGuaranteedMinimum(scope: MinReceivedScope | undefined): boolean {
  return scope === 'atomic'
}

/**
 * What the user is left holding when a cross-chain route's destination leg does
 * not complete.
 *
 * Derived from the route the provider described, not guessed. When the provider
 * does not tell us the intermediate asset, every field stays null and the UI
 * says so rather than inventing a reassuring answer.
 */
export interface DestinationFallback {
  /** Chain the user ends up holding value on. Usually the DESTINATION chain. */
  chain: string | null
  /** The asset actually delivered when the final swap leg fails. */
  tokenAddress: string | null
  tokenSymbol: string | null
  tokenDecimals: number | null
  /**
   * Does getting the intended token then require another transaction from the
   * user? For a bridge-then-swap route the answer is yes, and saying so up
   * front is the difference between a surprise and a known risk.
   */
  requiresFurtherTransaction: boolean
  /** One sentence for the UI. Never promises a refund we cannot deliver. */
  summary: string
}

/** Route metadata a quote carries so the wallet can explain the failure mode. */
export interface DestinationTerms {
  minReceivedScope: MinReceivedScope
  /** Present only for cross-chain routes whose final leg can fail separately. */
  fallback: DestinationFallback | null
  /** Provider-stated destination slippage bound, in bps, when it gives one. */
  destinationSlippageBps: number | null
}

/**
 * Read the intermediate asset out of a LI.FI route.
 *
 * LI.FI describes a route as ordered steps, e.g.
 *   protocol:feeCollection > swap:nordstern > cross:across > swap:lifidexaggregator
 * The asset that crosses the bridge is the `toToken` of the LAST `cross` step.
 * If a subsequent destination swap fails, that is what the user holds, on the
 * destination chain.
 *
 * When the route's final step IS the bridge, there is no destination swap to
 * fail and the bridged asset is the asset asked for — no fallback applies.
 */
export function lifiDestinationTerms(
  includedSteps: Array<Record<string, unknown>> | undefined,
  toChain: string,
  toTokenAddress: string,
  slippageBps: number,
): DestinationTerms {
  const steps = Array.isArray(includedSteps) ? includedSteps : []
  const lastCrossIdx = steps.map(s => String(s.type ?? '')).lastIndexOf('cross')

  // No bridge step at all: a same-chain route described by the same schema.
  if (lastCrossIdx < 0) {
    return { minReceivedScope: 'atomic', fallback: null, destinationSlippageBps: slippageBps }
  }
  const hasDestinationSwap = steps
    .slice(lastCrossIdx + 1)
    .some(s => String(s.type ?? '') === 'swap')

  if (!hasDestinationSwap) {
    // Bridge is the final leg. Nothing after it can fail separately, but the
    // delivery is still the bridge's to guarantee, not a transaction's.
    return { minReceivedScope: 'provider-guaranteed', fallback: null, destinationSlippageBps: slippageBps }
  }

  const bridgeStep = steps[lastCrossIdx]
  const action = (bridgeStep.action ?? {}) as Record<string, unknown>
  const bridged = (action.toToken ?? {}) as Record<string, unknown>
  const symbol = typeof bridged.symbol === 'string' ? bridged.symbol : null
  const address = typeof bridged.address === 'string' ? bridged.address : null
  const decimals = typeof bridged.decimals === 'number' ? bridged.decimals : null

  return {
    minReceivedScope: 'destination-conditional',
    destinationSlippageBps: slippageBps,
    fallback: {
      chain: toChain,
      tokenAddress: address,
      tokenSymbol: symbol,
      tokenDecimals: decimals,
      requiresFurtherTransaction: true,
      summary: symbol
        ? `If the final swap on ${toChain} cannot fill, you receive ${symbol} on ${toChain} instead. `
          + 'Your original funds are not returned, and converting it would need another transaction.'
        : `If the final swap on ${toChain} cannot fill, you receive the bridged asset on ${toChain} instead of the `
          + 'token you asked for. Your original funds are not returned, and converting it would need another transaction.',
    },
  }
}

/**
 * Terms for a solver/intent route (Relay-style).
 *
 * A solver either fills the whole intent or it does not fill it, and an unfilled
 * intent is refunded by the provider rather than leaving the user holding an
 * intermediate asset. That is a genuinely different — and better — failure mode
 * than bridge-then-swap, but it is still the PROVIDER's promise, not the
 * transaction's, so it is `provider-guaranteed` and not `atomic`.
 */
export function solverDestinationTerms(
  provider: string, fromChain: string, slippageBps: number,
): DestinationTerms {
  return {
    minReceivedScope: 'provider-guaranteed',
    destinationSlippageBps: slippageBps,
    fallback: {
      chain: fromChain,
      tokenAddress: null,
      tokenSymbol: null,
      tokenDecimals: null,
      requiresFurtherTransaction: false,
      summary:
        `If no ${provider} solver fills this order at the quoted minimum, ${provider} refunds the deposit on `
        + `${fromChain}. That refund is the provider's commitment, not something this transaction enforces.`,
    },
  }
}

/** Same-chain routes: the router's own floor is enforced by the transaction. */
export function sameChainDestinationTerms(
  minReceivedSource: 'provider' | 'derived' | undefined, slippageBps: number,
): DestinationTerms {
  return {
    // A DERIVED floor is not in the payload, so it is not atomic however
    // same-chain the route is. This is the check that stops "same-chain" being
    // treated as a synonym for "guaranteed".
    minReceivedScope: minReceivedSource === 'provider' ? 'atomic' : 'estimate',
    fallback: null,
    destinationSlippageBps: slippageBps,
  }
}

/**
 * One route step, reduced to what destination terms need.
 *
 * Kept in LI.FI's own nesting (`action.toToken`) so `lifiDestinationTerms` reads
 * a compact step and a raw provider step identically.
 */
export interface RouteStep {
  type: string
  tool: string | null
  action: {
    toChainId: string | number | null
    toToken: { address: string | null; symbol: string | null; decimals: number | null }
  }
}

/**
 * Sanitize a provider's step list into `RouteStep`s.
 *
 * The steps arrive through the same untrusted transport as the rest of the
 * quote. They only ever DESCRIBE the route — they are never executed — but the
 * fallback asset they name is shown to the user and bound into the approved
 * plan, so malformed entries are dropped rather than guessed at.
 */
export function compactRouteSteps(raw: unknown): RouteStep[] | null {
  if (!Array.isArray(raw)) return null
  const out: RouteStep[] = []
  for (const s of raw.slice(0, 16)) {
    if (!s || typeof s !== 'object') continue
    const step = s as Record<string, unknown>
    const action = (step.action ?? {}) as Record<string, unknown>
    const tok = (action.toToken ?? {}) as Record<string, unknown>
    if (typeof step.type !== 'string') continue
    out.push({
      type: step.type.slice(0, 32),
      tool: typeof step.tool === 'string' ? step.tool.slice(0, 64) : null,
      action: {
        toChainId: typeof action.toChainId === 'number' || typeof action.toChainId === 'string'
          ? action.toChainId : null,
        toToken: {
          address: typeof tok.address === 'string' ? tok.address.slice(0, 128) : null,
          symbol: typeof tok.symbol === 'string' ? tok.symbol.slice(0, 32) : null,
          decimals: Number.isInteger(tok.decimals) ? tok.decimals as number : null,
        },
      },
    })
  }
  return out.length ? out : null
}

/** The fields of a quote that destination terms are derived from. */
export interface DestinationTermsInput {
  provider: string
  fromChain: string
  toChain: string
  toTokenAddress: string
  slippageBps: number
  minReceivedSource?: 'provider' | 'derived'
  routeSteps?: RouteStep[] | null
}

/**
 * Work out what a quote's minimum received ACTUALLY guarantees.
 *
 * Always computed by the wallet from the route it was given — never taken from
 * a `destination` field a backend or renderer supplied, because that field is
 * precisely the claim being checked. Where the route shape is unknown the answer
 * is `estimate`: an unknown guarantee is no guarantee.
 */
export function destinationTermsFor(q: DestinationTermsInput): DestinationTerms {
  if (q.fromChain === q.toChain) return sameChainDestinationTerms(q.minReceivedSource, q.slippageBps)

  // Cross-chain. Without the provider's own floor there is nothing to scope.
  if (q.minReceivedSource !== 'provider') {
    return { minReceivedScope: 'estimate', fallback: null, destinationSlippageBps: q.slippageBps }
  }
  if (q.provider === 'lifi' && q.routeSteps?.length) {
    const terms = lifiDestinationTerms(
      q.routeSteps as unknown as Array<Record<string, unknown>>, q.toChain, q.toTokenAddress, q.slippageBps)
    // A cross-chain quote whose steps contain no bridge is self-contradictory;
    // `atomic` would be the wrong conclusion to draw from it.
    if (terms.minReceivedScope === 'atomic') {
      return { minReceivedScope: 'estimate', fallback: null, destinationSlippageBps: q.slippageBps }
    }
    return terms
  }
  // A provider we cannot read the route of: its floor exists, but what happens
  // when it is missed is unknown to us.
  return { minReceivedScope: 'estimate', fallback: null, destinationSlippageBps: q.slippageBps }
}

/** Short label for the quote card. Never says "guaranteed" unless it is. */
export function describeMinReceivedScope(scope: MinReceivedScope | undefined): string {
  switch (scope) {
    case 'atomic': return 'enforced by the transaction'
    case 'destination-conditional': return 'applies to the destination leg only'
    case 'provider-guaranteed': return 'committed by the provider, not by the transaction'
    default: return 'estimate'
  }
}
