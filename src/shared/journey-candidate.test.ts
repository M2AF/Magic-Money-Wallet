import { describe, it, expect } from 'vitest'
import { summarizeCosts, rankJourneys, costsFromSwapQuote, type JourneyCandidate, type JourneyCost } from './journey-candidate'

const asset = (chain: string, symbol: string) => ({ chain: chain as 'base', address: `${symbol}-addr`, symbol, decimals: 6 })
const cost = (over: Partial<JourneyCost>): JourneyCost => ({
  label: 'fee', leg: 0, chain: 'base', symbol: 'ETH', decimals: 18, amountRaw: '1', usd: 1, kind: 'fee', includedInOutput: false, ...over,
})
function candidate(over: Partial<JourneyCandidate>): JourneyCandidate {
  return {
    family: 'cbada-ccip', label: 'x', source: asset('base', 'USDC'), destination: asset('solana', 'BONK'),
    legs: [{ kind: 'bridge', label: 'b', status: 'prepared', from: asset('base', 'cbADA'), to: asset('solana', 'cbADA'), inputBasis: 'floor',
      inRaw: '1', expectedOutRaw: '1', minOutRaw: '1', via: null, expiresAt: null, reason: null }],
    costs: [], executable: true, validated: true, finalExpectedRaw: '1000000', finalMinRaw: '990000', finalOutputUsd: 100, blockers: [], ...over,
  }
}

describe('summarizeCosts — each cost once, unknown never zero', () => {
  it('counts priced costs, skips fees already deducted from the output, and keeps deposits apart', () => {
    const s = summarizeCosts(candidate({ costs: [
      cost({ label: 'gas', kind: 'gas', usd: 0.5 }),
      cost({ label: 'bridge fee', usd: 2 }),
      cost({ label: 'pool fee', usd: 9, includedInOutput: true }),
      cost({ label: 'deposit', kind: 'deposit', usd: 3 }),
    ] }))
    expect(s.countedUsd).toBeCloseTo(2.5)
    expect(s.deposits.map(d => d.label)).toEqual(['deposit'])
    expect(s.unknown).toEqual([])
  })

  it('an unknown or unpriced cost makes the total unknown, and is named', () => {
    const s = summarizeCosts(candidate({ costs: [cost({ usd: 1 }), cost({ label: 'CCIP fee', amountRaw: null, usd: null }), cost({ label: 'gas', usd: null })] }))
    expect(s.countedUsd).toBeNull()
    expect(s.unknown).toEqual(['CCIP fee', 'gas (no USD price)'])
  })

  it('gas stated only in USD is known', () => {
    expect(summarizeCosts(candidate({ costs: [cost({ amountRaw: null, usd: 0.01, kind: 'gas' })] })).countedUsd).toBeCloseTo(0.01)
  })
})

describe('rankJourneys — only executable, validated, comparable routes compete', () => {
  it('previews are never recommended, whatever their output', () => {
    const r = rankJourneys([
      candidate({ executable: false, finalExpectedRaw: '9000000', finalMinRaw: '8000000' }),
      candidate({ validated: false, finalMinRaw: '7000000' }),
    ])
    expect(r.recommended).toBeNull()
    expect(r.noRecommendation).toMatch(/No route can be executed/)
    expect(r.previews.map(p => p.finalMinRaw)).toEqual(['8000000', '7000000'])
  })

  it('an executable route with an unknown cost blocks a recommendation instead of ranking on output alone', () => {
    const r = rankJourneys([candidate({}), candidate({ finalExpectedRaw: '2000000', costs: [cost({ amountRaw: null, usd: null })] })])
    expect(r.recommended).toBeNull()
    expect(r.noRecommendation).toMatch(/could not be priced/)
  })

  it('costs count: a higher output with a larger cost loses on net value', () => {
    // A: 100 USD out (1.000000 units), 1 USD of costs. B: 101 USD out, 3 USD of costs.
    const a = candidate({ label: 'A', costs: [cost({ usd: 1 })] })
    const b = candidate({ label: 'B', finalExpectedRaw: '1010000', finalMinRaw: '1000000', finalOutputUsd: 101, costs: [cost({ usd: 3 })] })
    const r = rankJourneys([b, a])
    expect(r.recommended?.candidate.label).toBe('A')
    expect(r.recommended?.best.label).toBe('A')
    expect(r.executable.map(c => c.label)).toEqual(['A', 'B'])
  })

  it('previews stay separate from the competing set', () => {
    const r = rankJourneys([candidate({ label: 'A' }), candidate({ label: 'P', executable: false, finalExpectedRaw: '5000000' })])
    expect(r.recommended?.candidate.label).toBe('A')
    expect(r.previews.map(p => p.label)).toEqual(['P'])
  })
})

describe('costsFromSwapQuote', () => {
  it('keeps provider fee flags, prices gas only when the provider did, and separates Cardano deposits', () => {
    const evm = costsFromSwapQuote({ externalFees: [{ name: 'LI.FI', tokenSymbol: 'USDC', tokenDecimals: 6, amountRaw: '250', includedInQuotedOutput: true }],
      valuation: { sourceCostUsd: 0.009 }, estimatedGasRaw: '0' }, 0, 'base', 'ETH', 18)
    expect(evm).toEqual([
      expect.objectContaining({ label: 'LI.FI', includedInOutput: true, amountRaw: '250' }),
      expect.objectContaining({ kind: 'gas', amountRaw: null, usd: 0.009 }),
    ])
    const unpriced = costsFromSwapQuote({ estimatedGasRaw: '21000' }, 2, 'solana', 'SOL', 9)
    expect(unpriced[0]).toMatchObject({ kind: 'gas', amountRaw: '21000', usd: null })
    const ada = costsFromSwapQuote({ cardanoCost: { txFeeLovelace: '200000', depositLovelace: '2000000' } }, 0, 'cardano', 'ADA', 6)
    expect(ada.map(c => c.kind)).toEqual(['gas', 'deposit'])
  })
})
