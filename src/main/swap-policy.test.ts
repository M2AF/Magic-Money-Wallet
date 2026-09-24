import { afterEach, describe, expect, it } from 'vitest'
import {
  classifySwapTier, decideSwapPolicy, checkMinReceived, deriveMinBuyAmountRaw,
  checkEnforceableMinimum, isValidSlippageBps,
} from './swap-policy'
import type { NormalizedSwapQuote } from './swap-proxy'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compactRouteSteps, destinationTermsFor } from '../shared/swap-destination'
import { validAppFee, calldataWithFeeRecipient } from './swap-fixtures'
import { feeFreeRecord } from '../shared/swap-fee-policy'
import { setSettlementTrackingActive } from './swap-policy'

/**
 * The gate that decides what the wallet will SIGN, now that discovery made every
 * token on a supported chain selectable.
 *
 * Curated addresses below are the real mainnet entries from
 * src/shared/swap-curated-tokens.ts. The "broad" ones are real long-tail tokens
 * from live discovery responses — the whole point is that these are findable and
 * therefore reachable by the execute path.
 */

const ETH_NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const DEGEN_BASE = '0x4ed4e862860bed51a9570b96d89af5e1b0efefed'   // discovered, not curated
const SOL_MINT = 'So11111111111111111111111111111111111111112'
const BONK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'

/**
 * A quote that is fee-valid by default.
 *
 * The app-fee gate runs first in `decideSwapPolicy`, so without a valid record
 * every case below would fail for a reason that has nothing to do with the tier
 * rules they exist to test. The fee itself is exercised in its own describe
 * block at the end of this file and in swap-fee.test.ts.
 */
function quote(over: Partial<NormalizedSwapQuote> = {}): NormalizedSwapQuote {
  const provider = over.provider ?? '0x'
  const fromChain = over.fromChain ?? 'ethereum'
  const sellAmountRaw = over.sellAmountRaw ?? '1000000000000000000'
  return {
    provider,
    fromChain, toChain: over.toChain ?? 'ethereum',
    fromTokenAddress: ETH_NATIVE, toTokenAddress: USDC_ETH,
    fromTokenSymbol: 'ETH', toTokenSymbol: 'USDC',
    sellAmountRaw,
    buyAmountRaw: '1000000',
    minBuyAmountRaw: '995000', minReceivedSource: 'provider',
    estimatedGasRaw: '210000',
    slippageBps: 50,
    priceImpactPct: 0, rate: 1, expiresAt: Date.now() + 30_000,
    isCrossChain: false,
    appFee: validAppFee(provider, fromChain, sellAmountRaw),
    txData: {
      to: '0x3333333333333333333333333333333333333333',
      data: calldataWithFeeRecipient(),
      value: '0',
    },
    ...over,
  }
}

describe('classifySwapTier', () => {
  it('calls a pair curated only when BOTH sides are addresses we ship', () => {
    expect(classifySwapTier(quote())).toBe('curated')
    expect(classifySwapTier(quote({ toTokenAddress: DEGEN_BASE }))).toBe('broad')
    expect(classifySwapTier(quote({ fromTokenAddress: DEGEN_BASE }))).toBe('broad')
  })

  it('classifies by ADDRESS, not by the symbol the renderer attached', () => {
    // A token minted as "USDC" at an arbitrary address must not buy its way in.
    const impostor = quote({ toTokenAddress: DEGEN_BASE, toTokenSymbol: 'USDC' })
    expect(classifySwapTier(impostor)).toBe('broad')
  })

  it('is chain-qualified — a curated address on the WRONG chain is not curated', () => {
    // USDC on Base is curated for base, not for ethereum.
    expect(classifySwapTier(quote({ toTokenAddress: USDC_BASE }))).toBe('broad')
  })

  it('accepts either EVM address spelling for a curated token', () => {
    expect(classifySwapTier(quote({ toTokenAddress: USDC_ETH.toLowerCase() }))).toBe('curated')
  })

  it('treats curated Solana mints case-sensitively', () => {
    const sol = quote({ fromChain: 'solana', toChain: 'solana', fromTokenAddress: SOL_MINT, toTokenAddress: SOL_MINT })
    expect(classifySwapTier(sol)).toBe('curated')
    // A lowercased mint is a different (and invalid) string, so it is not curated.
    expect(classifySwapTier(quote({
      fromChain: 'solana', toChain: 'solana',
      fromTokenAddress: SOL_MINT, toTokenAddress: SOL_MINT.toLowerCase(),
    }))).toBe('broad')
  })
})

describe('decideSwapPolicy', () => {
  it('allows a curated same-chain swap with simulation advisory', () => {
    const d = decideSwapPolicy(quote())
    expect(d).toMatchObject({ tier: 'curated', allowed: true, requireSimulation: false, requireMinReceived: false })
  })

  it('allows a broad same-chain swap but demands simulation AND a minimum received', () => {
    const d = decideSwapPolicy(quote({ toTokenAddress: DEGEN_BASE }))
    expect(d).toMatchObject({ tier: 'broad', allowed: true, requireSimulation: true, requireMinReceived: true })
  })

  it('REFUSES a broad cross-chain swap on a provider whose lifecycle is not verified (0x)', () => {
    const d = decideSwapPolicy(quote({
      fromChain: 'ethereum', toChain: 'base',
      toTokenAddress: DEGEN_BASE, isCrossChain: true,
    }))
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/cross-chain/i)
  })

  it('still allows a curated cross-chain swap — that is existing behaviour', () => {
    const d = decideSwapPolicy(quote({
      fromChain: 'ethereum', toChain: 'base',
      toTokenAddress: USDC_BASE, isCrossChain: true,
    }))
    expect(d).toMatchObject({ tier: 'curated', isCrossChain: true, allowed: true })
  })

  it('refuses a broad Solana→EVM route too', () => {
    const d = decideSwapPolicy(quote({
      fromChain: 'solana', toChain: 'ethereum',
      fromTokenAddress: BONK_MINT, toTokenAddress: USDC_ETH, isCrossChain: true,
    }))
    expect(d.allowed).toBe(false)
  })
})

describe('checkMinReceived — the EXACT bound the user approved', () => {
  it('accepts a minimum equal to the approved floor', () => {
    expect(checkMinReceived(quote()).ok).toBe(true)          // 995000 = 1000000 x 0.995
  })

  /**
   * REGRESSION — the tolerance used to be 500 bps, i.e. five PERCENTAGE POINTS.
   * This exact input was reported as `{ ok: true, shortfallBps: 550 }`: a quote
   * displaying 0.5% slippage accepted a floor 5.5% below expected output, so the
   * user approved one bound and the transaction enforced a far weaker one.
   */
  it('REJECTS a 5.5% shortfall on a 0.5% slippage setting', () => {
    const r = checkMinReceived(quote({
      buyAmountRaw: '10000', minBuyAmountRaw: '9450', slippageBps: 50,
    }))
    expect(r.ok).toBe(false)
    expect(r.shortfallBps).toBe(550)
  })

  it('rejects anything past the approved floor, however slightly', () => {
    // floor = 1000000 x 0.995 = 995000; one unit of rounding is allowed, two is not.
    expect(checkMinReceived(quote({ minBuyAmountRaw: '994999' })).ok).toBe(true)   // rounding
    expect(checkMinReceived(quote({ minBuyAmountRaw: '994998' })).ok).toBe(false)
  })

  it('scales the bound with the slippage the user actually chose', () => {
    expect(checkMinReceived(quote({ minBuyAmountRaw: '975000', slippageBps: 250 })).ok).toBe(true)
    expect(checkMinReceived(quote({ minBuyAmountRaw: '975000', slippageBps: 50 })).ok).toBe(false)
  })

  it('rejects an absent, malformed or zero minimum rather than assuming one', () => {
    expect(checkMinReceived(quote({ minBuyAmountRaw: undefined })).ok).toBe(false)
    expect(checkMinReceived(quote({ minBuyAmountRaw: 'lots' })).ok).toBe(false)
    expect(checkMinReceived(quote({ minBuyAmountRaw: '-5' })).ok).toBe(false)
    expect(checkMinReceived(quote({ minBuyAmountRaw: '0' })).reason).toMatch(/no minimum received/i)
  })

  it('rejects a minimum ABOVE the expected output (it would always revert)', () => {
    expect(checkMinReceived(quote({ minBuyAmountRaw: '2000000' })).ok).toBe(false)
  })

  it('rejects invalid, non-finite or out-of-range slippage', () => {
    for (const bad of [NaN, Infinity, -1, 10001, 12.5, '50' as unknown as number]) {
      expect(checkMinReceived(quote({ slippageBps: bad })).ok).toBe(false)
    }
  })

  it('is exact on 6-decimal amounts and on amounts past Number.MAX_SAFE_INTEGER', () => {
    // 6-decimal USDC-style
    expect(checkMinReceived(quote({ buyAmountRaw: '1000001', minBuyAmountRaw: '995000', slippageBps: 50 })).ok).toBe(true)
    // 18-decimal, large supply — this is why the check is integer maths
    expect(checkMinReceived(quote({
      buyAmountRaw: '123456789012345678901234567890',
      minBuyAmountRaw: '122839505067283950506728395050',   // x 0.995
      slippageBps: 50,
    })).ok).toBe(true)
    expect(checkMinReceived(quote({
      buyAmountRaw: '123456789012345678901234567890',
      minBuyAmountRaw: '100000000000000000000000000000',
      slippageBps: 50,
    })).ok).toBe(false)
  })
})

describe('checkEnforceableMinimum — estimate vs enforced floor', () => {
  it('accepts a provider floor from an established adapter', () => {
    for (const provider of ['jupiter', 'lifi', '0x'] as const) {
      expect(checkEnforceableMinimum(quote({ provider, minReceivedSource: 'provider' })).ok).toBe(true)
    }
  })

  it('REFUSES a derived minimum — nothing enforces a number we computed', () => {
    const r = checkEnforceableMinimum(quote({ provider: 'lifi', minReceivedSource: 'derived' }))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/estimate/i)
  })

  it('treats a missing provenance as derived, so an older backend cannot unlock broad execution', () => {
    expect(checkEnforceableMinimum(quote({ minReceivedSource: undefined })).ok).toBe(false)
  })

  it('REFUSES an adapter whose floor semantics are unverified, even with a provider floor', () => {
    // 1inch returns no floor at all; uniswap/rango/swapkit field names are
    // documented but unexercised here.
    for (const provider of ['1inch', 'uniswap', 'rango', 'swapkit'] as const) {
      expect(checkEnforceableMinimum(quote({ provider, minReceivedSource: 'provider' })).ok).toBe(false)
    }
  })
})

describe('decideSwapPolicy — broad execution needs an ENFORCEABLE floor', () => {
  it('refuses a broad same-chain swap priced on a derived minimum', () => {
    const d = decideSwapPolicy(quote({
      toTokenAddress: DEGEN_BASE, provider: 'lifi', minReceivedSource: 'derived',
    }))
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/estimate/i)
  })

  it('refuses a broad swap routed through an unverified adapter', () => {
    const d = decideSwapPolicy(quote({
      toTokenAddress: DEGEN_BASE, provider: '1inch', minReceivedSource: 'provider',
    }))
    expect(d.allowed).toBe(false)
  })

  it('allows a broad swap on a provider floor from an established adapter', () => {
    const d = decideSwapPolicy(quote({
      toTokenAddress: DEGEN_BASE, provider: '0x', minReceivedSource: 'provider',
    }))
    expect(d).toMatchObject({ tier: 'broad', allowed: true, requireSimulation: true })
  })

  it('does not impose minimum PROVENANCE on curated pairs, on any fee-capable provider', () => {
    // A derived floor is still fine for a curated pair -- that rule is unchanged.
    for (const provider of ['uniswap', '0x', 'lifi'] as const) {
      expect(decideSwapPolicy(quote({ provider, minReceivedSource: 'derived' })).allowed, provider).toBe(true)
    }
  })

  /**
   * A real coverage change, recorded rather than smoothed over.
   *
   * These providers used to carry curated pairs. Under the fee policy they
   * cannot, because none of them states an applied fee that can be reconciled:
   * 1inch v6 returns no fee field, and Rango/SwapKit attribute fees through
   * account state this code cannot read. The decision is deliberate -- the
   * alternative is a swap where the user pays a disclosed 1% that reaches
   * nobody -- and it is one constant away from being revisited if a measured
   * response upgrades their evidence level.
   */
  it('RESTORES providers that cannot prove a fee - they serve curated pairs again', () => {
    // This reverses the previous policy. 1inch, Rango and SwapKit were excluded
    // purely because their fee could not be verified; under the two-tier policy
    // that makes them tier-2 routes, not unavailable ones. Nothing else about
    // their execution requirements was relaxed - see the broad-token cases above,
    // which still refuse them for their minimum-received semantics.
    for (const provider of ['1inch', 'rango', 'swapkit'] as const) {
      const d = decideSwapPolicy(quote({
        provider,
        appFee: feeFreeRecord(provider, 'ethereum', 'no applied-fee amount to reconcile'),
      }))
      expect(d.allowed, provider).toBe(true)
    }
  })
})

describe('decideSwapPolicy - the fee is preferred, not mandatory', () => {
  it('ALLOWS a quote with no fee record - losing the swap would be the worse trade', () => {
    expect(decideSwapPolicy(quote({ appFee: null })).allowed).toBe(true)
  })

  it('ALLOWS a route quoted deliberately fee-free', () => {
    const d = decideSwapPolicy(quote({
      provider: '1inch',
      appFee: feeFreeRecord('1inch', 'ethereum', 'no applied-fee amount to reconcile'),
    }))
    expect(d.allowed).toBe(true)
  })

  it('ALLOWS a fee we could not confirm - not being paid is not a safety problem', () => {
    const d = decideSwapPolicy(quote({
      appFee: validAppFee('0x', 'ethereum', '1000000000000000000', { verification: 'requested-unverified' }),
    }))
    expect(d.allowed).toBe(true)
  })

  it('REFUSES a fee that would be paid to someone else', () => {
    const d = decideSwapPolicy(quote({
      appFee: validAppFee('0x', 'ethereum', '1000000000000000000', {
        recipient: '0xdead00000000000000000000000000000000beef',
      }),
    }))
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/not the configured Magic Money recipient/)
  })

  it('REFUSES terms from a superseded policy version', () => {
    const d = decideSwapPolicy(quote({
      appFee: validAppFee('0x', 'ethereum', '1000000000000000000', { policyVersion: '2020-01-01.old' }),
    }))
    expect(d.allowed).toBe(false)
  })

  it('REFUSES a charged fee the transaction does not pay', () => {
    const d = decideSwapPolicy(quote({
      txData: { to: '0x3333333333333333333333333333333333333333', data: '0xdeadbeef', value: '0' },
    }))
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/does not reference the Magic Money fee recipient/)
  })

  it('does not let a fee-free route skip ANY other requirement', () => {
    // The whole point of the clarification: tier 2 keeps every safety rule.
    const feeFree = feeFreeRecord('1inch', 'ethereum', 'tier-2')
    // Broad token on a provider with unverified floor semantics is still refused.
    expect(decideSwapPolicy(quote({
      toTokenAddress: DEGEN_BASE, provider: '1inch', appFee: feeFree, minReceivedSource: 'provider',
    })).allowed).toBe(false)
    // Broad token with a derived-only minimum is still refused.
    expect(decideSwapPolicy(quote({
      toTokenAddress: DEGEN_BASE, provider: 'lifi', minReceivedSource: 'derived',
      appFee: feeFreeRecord('lifi', 'ethereum', 'tier-2'),
    })).allowed).toBe(false)
  })
})

describe('deriveMinBuyAmountRaw', () => {
  it('applies slippage as an exact integer floor', () => {
    expect(deriveMinBuyAmountRaw('1000000', 50)).toBe('995000')       // 0.5%
    expect(deriveMinBuyAmountRaw('1000000', 250)).toBe('975000')      // 2.5%
    expect(deriveMinBuyAmountRaw('1000000', 0)).toBe('1000000')
  })

  it('does not lose precision on huge raw amounts', () => {
    expect(deriveMinBuyAmountRaw('100000000000000000000000000', 100))
      .toBe('99000000000000000000000000')
  })

  it('returns null for a non-integer amount instead of guessing', () => {
    expect(deriveMinBuyAmountRaw('1.5', 50)).toBeNull()
    expect(deriveMinBuyAmountRaw('', 50)).toBeNull()
  })

  it('clamps nonsensical slippage rather than producing a negative floor', () => {
    expect(deriveMinBuyAmountRaw('1000000', 99999)).toBe('0')
    expect(deriveMinBuyAmountRaw('1000000', -5)).toBe('1000000')
  })
})

/**
 * BROAD CROSS-CHAIN — the gate the UI hit on EMO(Monad) -> PIXL(Ethereum).
 *
 * The old refusal blamed lifecycle tracking: "Bridge tracking cannot yet tell a
 * partial delivery or a refund apart from a completed swap." That is no longer
 * true (Stage 3), so the message is gone. What replaced it is narrower and
 * actually checkable, because a bridge still cannot give the atomic guarantee a
 * same-chain swap gives.
 */
describe('broad cross-chain', () => {
  // Destination terms exactly as getSwapQuote computes them for a real LI.FI
  // bridge-then-swap route (shape recorded live 2026-09-20): the fallback is the
  // bridged asset on the destination chain.
  const liveSteps = compactRouteSteps(JSON.parse(readFileSync(
    join(__dirname, '..', 'shared', '__fixtures__', 'lifi-quote', 'bridge-then-swap.json'), 'utf8')).includedSteps)
  const bridged = (over: Partial<NormalizedSwapQuote> = {}) => {
    const q = quote({
      toChain: 'base', toTokenAddress: DEGEN_BASE, isCrossChain: true,
      provider: 'lifi', minReceivedSource: 'provider',
      appFee: validAppFee('lifi', 'ethereum', '1000000000000000000'),
      routeSteps: liveSteps,
      ...over,
    })
    return { ...q, destination: over.destination ?? destinationTermsFor(q) }
  }

  afterEach(() => setSettlementTrackingActive(false))

  it('is ALLOWED on LI.FI once settlement tracking is active', () => {
    setSettlementTrackingActive(true)
    const d = decideSwapPolicy(bridged())
    expect(d.allowed).toBe(true)
    expect(d.tier).toBe('broad')
    // Every other broad requirement is still in force.
    expect(d.requireSimulation).toBe(true)
    expect(d.requireMinReceived).toBe(true)
  })

  it('is REFUSED while settlement tracking is inactive', () => {
    setSettlementTrackingActive(false)
    const d = decideSwapPolicy(bridged())
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/tracking is not active/i)
  })

  it('is REFUSED on a provider whose partial/refund vocabulary is unmapped', () => {
    setSettlementTrackingActive(true)
    // 0x isolates the LIFECYCLE check: its minimum-received semantics ARE
    // verified, so it clears the first hurdle and is stopped by the second.
    const d = decideSwapPolicy(bridged({
      provider: '0x', appFee: validAppFee('0x', 'ethereum', '1000000000000000000'),
    }))
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/cannot yet be told apart from a partial delivery or a refund/i)
  })

  it('is REFUSED when the route does not describe its destination failure mode', () => {
    setSettlementTrackingActive(true)
    const q = bridged()
    delete (q as Partial<NormalizedSwapQuote>).destination
    const d = decideSwapPolicy(q)
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/destination leg fails/i)
  })

  it('is REFUSED when the fallback asset is not identified before signing', () => {
    setSettlementTrackingActive(true)
    const d = decideSwapPolicy(bridged({
      destination: {
        minReceivedScope: 'destination-conditional', destinationSlippageBps: 50,
        fallback: { chain: 'base', tokenAddress: null, tokenSymbol: null, tokenDecimals: null,
          requiresFurtherTransaction: true, summary: 'unknown' },
      },
    }))
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/does not identify/i)
  })

  it('is REFUSED when the cross-chain minimum is only an estimate', () => {
    setSettlementTrackingActive(true)
    const d = decideSwapPolicy(bridged({
      destination: { minReceivedScope: 'estimate', fallback: null, destinationSlippageBps: 50 },
    }))
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/estimate that nothing enforces/i)
  })

  it('does NOT let settlement tracking stand in for destination terms', () => {
    // Monitoring runs after the money has moved; it cannot satisfy an
    // execution-safety requirement. Tracking on + no terms = still refused.
    setSettlementTrackingActive(true)
    const q = bridged({ destination: { minReceivedScope: 'estimate', fallback: null, destinationSlippageBps: 50 } })
    expect(decideSwapPolicy(q).allowed).toBe(false)
  })

  it('REFUSES SwapKit on its minimum semantics BEFORE its lifecycle gap matters', () => {
    setSettlementTrackingActive(true)
    // SwapKit fails both checks. The order matters for the message the user
    // reads: the first missing guarantee is the one worth naming.
    const d = decideSwapPolicy(bridged({
      provider: 'swapkit', appFee: feeFreeRecord('swapkit', 'ethereum', 'tier-2'),
    }))
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/has not been verified/i)
  })

  it('is REFUSED on a provider whose own minimum field is unconfirmed', () => {
    setSettlementTrackingActive(true)
    // Rango's minimum-received spelling is not measured, and its lifecycle is
    // mapped from docs only -- so it is refused on the first missing guarantee.
    const d = decideSwapPolicy(bridged({
      provider: 'rango', appFee: feeFreeRecord('rango', 'ethereum', 'tier-2'),
    }))
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/has not been verified/i)
  })

  it('is REFUSED on a DERIVED minimum, however good the provider is', () => {
    setSettlementTrackingActive(true)
    const d = decideSwapPolicy(bridged({ minReceivedSource: 'derived' }))
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/estimate/i)
  })

  it('no longer blames lifecycle tracking, which is fixed', () => {
    setSettlementTrackingActive(false)
    const d = decideSwapPolicy(bridged())
    expect(d.reason).not.toMatch(/limited to the wallet/i)
    expect(d.reason).not.toMatch(/cannot yet tell a partial delivery/i)
  })

  it('does not disturb CURATED cross-chain, which never needed this gate', () => {
    setSettlementTrackingActive(false)
    const d = decideSwapPolicy(quote({
      toChain: 'base', toTokenAddress: USDC_BASE, isCrossChain: true, provider: 'lifi',
      appFee: validAppFee('lifi', 'ethereum', '1000000000000000000'),
    }))
    expect(d.tier).toBe('curated')
    expect(d.allowed).toBe(true)
  })

  it('a fee-free route gets no easier ride across a bridge', () => {
    setSettlementTrackingActive(true)
    const d = decideSwapPolicy(bridged({
      provider: '1inch', appFee: feeFreeRecord('1inch', 'ethereum', 'tier-2'),
    }))
    expect(d.allowed).toBe(false)
  })
})

describe('checkChainCapability — an imported network can be QUOTED before it can be SIGNED', () => {
  // 2026-09-21: the Worker now accepts a numeric chain id fallback
  // (fromChainId/toChainId), so an imported network CAN get a real, well-formed
  // NormalizedSwapQuote back — quoting no longer requires a matrix entry.
  // Signing still does: checkChainCapability resolves ONLY against the static
  // SWAP_NETWORKS matrix, which no import has an entry in (every entry there IS
  // a built-in). This is intentional, not an oversight — extending the
  // execution gate to imports needs its own dynamic, re-verified-at-signing-time
  // evidence, which this pass deliberately does NOT add, per "never weaken
  // execution protections for revenue or coverage." This test pins that a
  // successfully quoted import is still refused at the signing gate, so a
  // future change cannot silently loosen it without failing here first.
  it('REFUSES to sign a well-formed quote on a chain id with no matrix entry', () => {
    const d = decideSwapPolicy(quote({
      fromChain: 'custom-1', toChain: 'custom-1',
      provider: '0x', appFee: validAppFee('0x', 'custom-1', '1000000000000000000'),
    }))
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/swaps are not enabled on custom-1/i)
  })
})
