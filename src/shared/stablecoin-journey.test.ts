import { describe, it, expect } from 'vitest'
import {
  createJourney, approveLeg, recordLegSubmitted, recordLegOutcome, journeyHolding, journeyKeepsAlive, parseJourney, JourneyError,
  type StablecoinJourney,
} from './stablecoin-journey'
import { STABLECOIN_INTERMEDIATES, type ExactAsset } from './stablecoin-route'

const SNEK = { chain: 'cardano' as const, address: '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b', symbol: 'SNEK', decimals: 0 }
const PEPE = { chain: 'ethereum' as const, address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', symbol: 'PEPE', decimals: 18 }
const H1 = 'aa'.repeat(32), H2 = 'bb'.repeat(32), H3 = '0x' + 'cc'.repeat(32)

const fresh = (source: ExactAsset = SNEK, destination: ExactAsset = PEPE) => createJourney({
  id: 'j1', walletId: 'w1', now: 1, bridge: 'xreserve-cardano-ethereum', recipient: '0xabc',
  source, usdcx: STABLECOIN_INTERMEDIATES.cardano, usdc: STABLECOIN_INTERMEDIATES.ethereum, destination,
})

/** Source swap confirmed with 25 USDCx measured. */
function afterSource(): StablecoinJourney {
  let j = approveLeg(fresh(), 'source-swap', '10000', 2, '10000')
  j = recordLegSubmitted(j, 'source-swap', H1, 3)
  return recordLegOutcome(j, 'source-swap', { state: 'confirmed', measuredOutputRaw: '25000000' }, 4)
}

describe('stablecoin journey — order, approval and hashes', () => {
  it('starts active, skips legs whose input is already the intermediate', () => {
    expect(fresh().legs.map(l => l.state)).toEqual(['planned', 'planned', 'planned'])
    expect(fresh(STABLECOIN_INTERMEDIATES.cardano, STABLECOIN_INTERMEDIATES.ethereum).legs.map(l => l.state)).toEqual(['skipped', 'planned', 'skipped'])
    expect(journeyKeepsAlive(fresh())).toBe(true)
  })

  it('a later leg cannot be approved before the earlier one is confirmed', () => {
    expect(() => approveLeg(fresh(), 'bridge', '1', 2)).toThrow(/earlier step/)
    let j = approveLeg(fresh(), 'source-swap', '10000', 2, '10000')
    j = recordLegSubmitted(j, 'source-swap', H1, 3)
    expect(() => approveLeg(j, 'bridge', '1', 4)).toThrow(/earlier step/)
  })

  it('approval spends at most the MEASURED output of the previous leg', () => {
    const j = afterSource()
    expect(() => approveLeg(j, 'bridge', '25000001', 5)).toThrow(/actually delivered/)
    expect(approveLeg(j, 'bridge', '25000000', 5).legs[1]).toMatchObject({ state: 'approved', approvedInputRaw: '25000000' })
  })

  it('a hash is recorded once, before broadcast, and never replaced', () => {
    let j = approveLeg(afterSource(), 'bridge', '25000000', 5)
    j = recordLegSubmitted(j, 'bridge', H2, 6)
    expect(() => recordLegSubmitted(j, 'bridge', 'dd'.repeat(32), 7)).toThrow(/never replaced/)
    // Uncertain stays tied to the same hash; evidence later resolves it.
    j = recordLegOutcome(j, 'bridge', { state: 'uncertain' }, 7)
    expect(j.legs[1]).toMatchObject({ state: 'uncertain', txHash: H2 })
    j = recordLegOutcome(j, 'bridge', { state: 'confirmed', measuredOutputRaw: '23000000' }, 8)
    expect(j.legs[1].state).toBe('confirmed')
  })

  it('an unapproved step cannot record a transaction', () => {
    expect(() => recordLegSubmitted(fresh(), 'source-swap', H1, 2)).toThrow(/not approved/)
  })

  it('completing the last leg completes the journey', () => {
    let j = approveLeg(afterSource(), 'bridge', '25000000', 5)
    j = recordLegSubmitted(j, 'bridge', H2, 6)
    j = recordLegOutcome(j, 'bridge', { state: 'confirmed', measuredOutputRaw: '23000000' }, 7)
    j = approveLeg(j, 'destination-swap', '23000000', 8)
    j = recordLegSubmitted(j, 'destination-swap', H3, 9)
    j = recordLegOutcome(j, 'destination-swap', { state: 'confirmed', measuredOutputRaw: '5' }, 10)
    expect(j.status).toBe('completed')
    expect(journeyKeepsAlive(j)).toBe(false)
  })
})

describe('stablecoin journey — partial completion and restart', () => {
  it('a failed destination swap stops the journey and leaves the USDC where it landed', () => {
    let j = approveLeg(afterSource(), 'bridge', '25000000', 5)
    j = recordLegSubmitted(j, 'bridge', H2, 6)
    j = recordLegOutcome(j, 'bridge', { state: 'confirmed', measuredOutputRaw: '23000000' }, 7)
    j = approveLeg(j, 'destination-swap', '23000000', 8)
    j = recordLegSubmitted(j, 'destination-swap', H3, 9)
    j = recordLegOutcome(j, 'destination-swap', { state: 'failed' }, 10)
    expect(j.status).toBe('stopped')
    // The failed step produced nothing; the measured bridge credit is what is held.
    const h = journeyHolding({ ...j, legs: [j.legs[0], j.legs[1], { ...j.legs[2], txHash: null }] })
    expect(h).toMatchObject({ asset: { address: STABLECOIN_INTERMEDIATES.ethereum.address }, amountRaw: '23000000', settled: true })
  })

  it('a bridge in flight is reported as unsettled, held in transit', () => {
    let j = approveLeg(afterSource(), 'bridge', '25000000', 5)
    j = recordLegSubmitted(j, 'bridge', H2, 6)
    expect(journeyHolding(j)).toMatchObject({ settled: false, amountRaw: null })
  })

  it('round-trips through storage and refuses anything outside the schema', () => {
    const j = approveLeg(afterSource(), 'bridge', '25000000', 5)
    expect(parseJourney(JSON.stringify(j))).toEqual(j)
    const withCbor = { ...j, legs: [j.legs[0], { ...j.legs[1], cbor: '84a0' }, j.legs[2]] }
    expect(() => parseJourney(JSON.stringify(withCbor))).toThrow(JourneyError)
    expect(() => parseJourney(JSON.stringify({ ...j, signature: 'x' }))).toThrow(/unexpected fields/)
    expect(() => parseJourney('{')).toThrow(/unreadable/)
    const lostHash = { ...j, legs: [{ ...j.legs[0], txHash: null }, j.legs[1], j.legs[2]] }
    expect(() => parseJourney(JSON.stringify(lostHash))).toThrow(/lost its transaction hash/)
    const reordered = { ...j, legs: [j.legs[1], j.legs[0], j.legs[2]] }
    expect(() => parseJourney(JSON.stringify(reordered))).toThrow(JourneyError)
  })
})

describe('cbADA journey — interrupted CCIP transfer survives restart', () => {
  const BASE_CB = { chain: 'base' as const, address: '0xcbADA732173e39521CDBE8bf59a6Dc85A9fc7b8c', symbol: 'cbADA', decimals: 6 }
  const SOL_CB = { chain: 'solana' as const, address: 'cbADAmv9issuPfhFwyQG3xac4DGPd1LDSt1oz7vwJsg', symbol: 'cbADA', decimals: 6 }
  const USDC = { chain: 'base' as const, address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 }
  const BONK = { chain: 'solana' as const, address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', decimals: 5 }
  const MSG = '0x' + 'ee'.repeat(32)

  it('records the send hash and CCIP message id once; a restart restores the uncertain bridge, never a resend', async () => {
    const { recordLegProviderRef } = await import('./stablecoin-journey')
    let j = createJourney({ id: 'c1', walletId: 'w', now: 1, bridge: 'ccip-cbada', recipient: 'sol', source: USDC, usdcx: BASE_CB, usdc: SOL_CB, destination: BONK })
    expect(j.legs.map(l => [l.chain, l.state])).toEqual([['base', 'planned'], ['base', 'planned'], ['solana', 'planned']])
    j = approveLeg(j, 'source-swap', '100000000', 2, '100000000')
    j = recordLegSubmitted(j, 'source-swap', H3, 3)
    j = recordLegOutcome(j, 'source-swap', { state: 'confirmed', measuredOutputRaw: '371135000' }, 4)
    j = approveLeg(j, 'bridge', '371135000', 5)
    j = recordLegSubmitted(j, 'bridge', '0x' + 'dd'.repeat(32), 6)
    j = recordLegProviderRef(j, 'bridge', MSG, 7)
    expect(recordLegProviderRef(j, 'bridge', MSG, 8)).toBe(j)
    expect(() => recordLegProviderRef(j, 'bridge', '0x' + 'ff'.repeat(32), 8)).toThrow(/never replaced/)
    j = recordLegOutcome(j, 'bridge', { state: 'uncertain' }, 9)
    const restored = parseJourney(JSON.stringify(j))
    expect(restored.legs[1]).toMatchObject({ state: 'uncertain', providerRef: MSG })
    expect(journeyKeepsAlive(restored)).toBe(true)
    // Funds are in transit, not settled; nothing may approve the next step.
    expect(journeyHolding(restored)).toMatchObject({ settled: false })
    expect(() => approveLeg(restored, 'destination-swap', '1', 10)).toThrow(/earlier step/)
  })

  it('cbADA already held on Base is skipped; a malformed message id is refused by the parser', () => {
    const j = createJourney({ id: 'c2', walletId: 'w', now: 1, bridge: 'ccip-cbada', recipient: 'sol', source: BASE_CB, usdcx: BASE_CB, usdc: SOL_CB, destination: SOL_CB })
    expect(j.legs.map(l => l.state)).toEqual(['skipped', 'planned', 'skipped'])
    const bad = { ...j, legs: [j.legs[0], { ...j.legs[1], providerRef: 'msg-1' }, j.legs[2]] }
    expect(() => parseJourney(JSON.stringify(bad))).toThrow(JourneyError)
  })
})
