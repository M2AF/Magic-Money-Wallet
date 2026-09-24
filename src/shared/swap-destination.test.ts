import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  destinationTermsFor, compactRouteSteps, lifiDestinationTerms, isGuaranteedMinimum,
  describeMinReceivedScope,
} from './swap-destination'

/**
 * What a displayed minimum actually guarantees, using ROUTE SHAPES RECORDED LIVE
 * from li.quest/v1/quote on 2026-09-20 (Base ETH -> Arbitrum ARB, read-only):
 *
 *   single-cross      protocol > cross            (bridge delivers ARB directly)
 *   bridge-then-swap  protocol > cross > swap     (ETH -> WETH@Arbitrum, then
 *                                                  WETH -> ARB on Arbitrum)
 *
 * The second is the shape whose failure is a PARTIAL delivery: recorded live
 * PARTIAL transfers (src/shared/__fixtures__/lifi-status) all left the user
 * holding the bridged intermediate on the destination chain.
 */

const load = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'lifi-quote', name), 'utf8')) as { includedSteps: unknown[] }

const ARB = '0x912CE59144191C1204E64559FE8253a0e49E6548'
const WETH_ARB = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'

const base = {
  provider: 'lifi', fromChain: 'base', toChain: 'arbitrum',
  toTokenAddress: ARB, slippageBps: 50, minReceivedSource: 'provider' as const,
}

describe('recorded live LI.FI route shapes', () => {
  it('bridge-then-swap is destination-conditional and names WETH on Arbitrum as the fallback', () => {
    const t = destinationTermsFor({ ...base, routeSteps: compactRouteSteps(load('bridge-then-swap.json').includedSteps) })
    expect(t.minReceivedScope).toBe('destination-conditional')
    expect(t.fallback).toMatchObject({
      chain: 'arbitrum', tokenAddress: WETH_ARB, tokenSymbol: 'WETH', tokenDecimals: 18,
      requiresFurtherTransaction: true,
    })
    expect(t.fallback!.summary).toMatch(/WETH on arbitrum/)
    expect(t.fallback!.summary).toMatch(/another transaction/)
  })

  it('single-cross (bridge is the final leg) is provider-guaranteed, with no intermediate asset', () => {
    const t = destinationTermsFor({ ...base, routeSteps: compactRouteSteps(load('single-cross.json').includedSteps) })
    expect(t.minReceivedScope).toBe('provider-guaranteed')
    expect(t.fallback).toBeNull()
  })
})

describe('an amount is only ever "guaranteed" when a transaction enforces it', () => {
  it('only atomic counts as guaranteed', () => {
    expect(isGuaranteedMinimum('atomic')).toBe(true)
    for (const s of ['destination-conditional', 'provider-guaranteed', 'estimate', undefined] as const) {
      expect(isGuaranteedMinimum(s)).toBe(false)
    }
  })

  it('same-chain with a PROVIDER floor is atomic; with a DERIVED floor it is an estimate', () => {
    expect(destinationTermsFor({ ...base, toChain: 'base', routeSteps: null }).minReceivedScope).toBe('atomic')
    expect(destinationTermsFor({ ...base, toChain: 'base', minReceivedSource: 'derived' }).minReceivedScope)
      .toBe('estimate')
  })

  it('cross-chain on a derived floor is an estimate, whatever the route', () => {
    const t = destinationTermsFor({
      ...base, minReceivedSource: 'derived',
      routeSteps: compactRouteSteps(load('bridge-then-swap.json').includedSteps),
    })
    expect(t.minReceivedScope).toBe('estimate')
  })

  it('cross-chain through a provider whose route we cannot read is an estimate', () => {
    expect(destinationTermsFor({ ...base, provider: 'rango', routeSteps: null }).minReceivedScope).toBe('estimate')
    expect(destinationTermsFor({ ...base, routeSteps: null }).minReceivedScope).toBe('estimate')
  })

  it('a cross-chain quote whose steps contain no bridge is not called atomic', () => {
    const noBridge = compactRouteSteps([{ type: 'swap', tool: 'x', action: { toChainId: 42161, toToken: { address: ARB } } }])
    expect(destinationTermsFor({ ...base, routeSteps: noBridge }).minReceivedScope).toBe('estimate')
  })

  it('labels never say "guaranteed" for a non-atomic scope', () => {
    for (const s of ['destination-conditional', 'provider-guaranteed', 'estimate'] as const) {
      expect(describeMinReceivedScope(s)).not.toMatch(/guaranteed|enforced by the transaction/i)
    }
    expect(describeMinReceivedScope('atomic')).toMatch(/enforced by the transaction/)
  })
})

describe('compactRouteSteps treats provider steps as untrusted', () => {
  it('drops junk entries and returns null for non-arrays', () => {
    expect(compactRouteSteps(null)).toBeNull()
    expect(compactRouteSteps('steps')).toBeNull()
    expect(compactRouteSteps([null, 5, { noType: true }])).toBeNull()
  })

  it('clamps oversized fields and caps the step count', () => {
    const many = Array.from({ length: 40 }, () => ({ type: 'swap', tool: 'x'.repeat(500), action: {} }))
    const out = compactRouteSteps(many)!
    expect(out).toHaveLength(16)
    expect(out[0].tool!.length).toBeLessThanOrEqual(64)
  })

  it('an unidentified bridged asset yields a fallback with no address — which the gate refuses', () => {
    const t = lifiDestinationTerms(
      [{ type: 'cross', action: { toToken: {} } }, { type: 'swap', action: {} }], 'arbitrum', ARB, 50)
    expect(t.minReceivedScope).toBe('destination-conditional')
    expect(t.fallback!.tokenAddress).toBeNull()
  })
})
