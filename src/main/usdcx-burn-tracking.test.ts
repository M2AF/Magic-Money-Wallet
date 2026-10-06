/**
 * One USDCx withdrawal journey followed from its saved burn hash to the
 * destination credit. Positive data is PUBLIC and real (2026-10-05, read-only):
 * Cardano burn 887333810e… (2,802 USDCx = 2,800 + 2 fee cap), the IOG history
 * row that links it to Ethereum release 0x37dce9fa…, and that release's
 * Ethereum evidence (2,800 USDC to 0x720f28…). Every negative case is derived.
 * Nothing reaches a network; nothing is built, signed or sent.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { checkUsdcxBurnLeg, USDCX_BURN_DEPTH, type UsdcxBurnReads } from './usdcx-burn-tracking'
import { parseIogWithdrawalHistory } from './iog-withdrawal-history'
import { recheckJourney, type RecheckReads } from './journey-recheck'
import { journeyMapStore, createJourneyWriteQueue } from './journey-store'
import {
  createJourney, approveLeg, authorizeXReserveBurn, recordLegSubmitted, recordLegOutcome, journeyHolding, parseJourney,
  type StablecoinJourney,
} from '../shared/stablecoin-journey'
import type { EthereumDepositEvidence } from './xreserve-ethereum-deposit-proof'

const FIX = join(__dirname, '__fixtures__', 'iog')
const load = <T>(name: string): T => JSON.parse(readFileSync(join(FIX, name), 'utf8')) as T
const burnFixture = load<{ txHash: string; cbor: string; terms: { network: string; encoded: string; burnAmountRaw: string; remoteDepositor: string }; releaseAmountRaw: string; recipient: string }>('cardano-burn-887333810e.json')
const historyFixture = load<{ address: string; response: Array<Record<string, unknown>> }>('withdrawal-history-public.json')
const releaseFixture = load<{ evidence: unknown }>('ethereum-release-37dce9fa.json')

const USDCX = { chain: 'cardano' as const, address: '1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378', symbol: 'USDCx', decimals: 6 }
const USDC = { chain: 'ethereum' as const, address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', decimals: 6 }
const ADDRESS = historyFixture.address
const ROWS = parseIogWithdrawalHistory(historyFixture.response)
const EVIDENCE = releaseFixture.evidence as unknown as EthereumDepositEvidence
const BURN = burnFixture.txHash

function journey(over: { recipient?: string; bridge?: 'xreserve-cardano-ethereum' | 'xreserve-cardano-solana-forwarded' } = {}): StablecoinJourney {
  let j = createJourney({
    id: 'u1', walletId: 'w', now: 1, bridge: over.bridge ?? 'xreserve-cardano-ethereum', recipient: burnFixture.recipient,
    source: USDCX, usdcx: USDCX, usdc: USDC, destination: USDC,
  })
  j = approveLeg(j, 'bridge', burnFixture.terms.burnAmountRaw, 2, burnFixture.terms.burnAmountRaw)
  j = authorizeXReserveBurn(j, {
    ...burnFixture.terms, network: 'mainnet', releaseAmountRaw: burnFixture.releaseAmountRaw, releaseRecipient: over.recipient ?? burnFixture.recipient,
  }, 3)
  return recordLegOutcome(recordLegSubmitted(j, 'bridge', BURN, 4), 'bridge', { state: 'uncertain' }, 5)
}

function reads(over: Partial<{ cbor: string; depth: number | null; tx: 'not-found' | 'unreadable'; rows: unknown; evidence: EthereumDepositEvidence | 'unreadable' }> = {}): UsdcxBurnReads & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    cardanoBurn: vi.fn(async (h: string) => { calls.push(`cardano ${h}`); return over.tx ?? { cbor: over.cbor ?? burnFixture.cbor, depth: over.depth === undefined ? 1623 : over.depth } }),
    iogHistory: vi.fn(async (a: string) => { calls.push(`iog ${a}`); return (over.rows ?? ROWS) as never }),
    ethereumEvidence: vi.fn(async (h: string) => { calls.push(`eth ${h}`); return over.evidence ?? EVIDENCE }),
  }
}

const rowsWith = (patch: Record<string, unknown>) =>
  parseIogWithdrawalHistory((historyFixture.response as Array<Record<string, unknown>>).map(r => r.cardanoBurnTxHash === BURN ? { ...r, ...patch } : r))

describe('checkUsdcxBurnLeg — burn, operator row, destination credit', () => {
  it('the real public linkage: burn verified, IOG finalized, exact 2,800 USDC credit -> confirmed with the MEASURED amount', async () => {
    const r = reads()
    const { evidence, outcome } = await checkUsdcxBurnLeg(journey(), ADDRESS, r)
    expect(evidence).toMatchObject({ burn: 'verified', burnDepth: 1623, burnFinal: true, provider: 'finalized', providerStatus: 'finalized',
      releaseTxHash: '0x37dce9fab6f48033691f841be3c783bd9154998054490d535795cac2876b5630', credit: 'verified', creditedRaw: '2800000000' })
    expect(outcome).toEqual({ state: 'confirmed', measuredOutputRaw: '2800000000' })
    // Only reads, and only for the saved burn and the release its row names.
    expect(r.calls).toEqual([`cardano ${BURN}`, `iog ${ADDRESS}`, 'eth 0x37dce9fab6f48033691f841be3c783bd9154998054490d535795cac2876b5630'])
  })

  it('a burn not on chain (yet) changes nothing and is never sent again', async () => {
    const { evidence, outcome } = await checkUsdcxBurnLeg(journey(), ADDRESS, reads({ tx: 'not-found' }))
    expect(outcome).toBeNull()
    expect(evidence.burn).toBe('not-found')
    expect(evidence.reason).toMatch(/never sent again/)
  })

  it('unreadable sources change nothing', async () => {
    expect((await checkUsdcxBurnLeg(journey(), ADDRESS, reads({ tx: 'unreadable' }))).outcome).toBeNull()
    expect((await checkUsdcxBurnLeg(journey(), ADDRESS, reads({ rows: 'unreadable' }))).outcome).toBeNull()
    const eth = await checkUsdcxBurnLeg(journey(), ADDRESS, reads({ evidence: 'unreadable' }))
    expect(eth.outcome).toBeNull()
    expect(eth.evidence.reason).toMatch(/could not be read/)
  })

  it('a shallow burn the operator has not finished is pending, not a failure', async () => {
    const r = await checkUsdcxBurnLeg(journey(), ADDRESS, reads({ depth: 12, rows: rowsWith({ status: 'awaiting_finality', ethereumTxHash: null, confirmations: 12 }) }))
    expect(r.outcome).toBeNull()
    expect(r.evidence).toMatchObject({ burn: 'verified', burnFinal: false, provider: 'pending' })
    expect(r.evidence.reason).toMatch(new RegExp(`${USDCX_BURN_DEPTH.cardanoBlocks}`))
  })

  it('a verified Ethereum credit does not complete a journey before the Cardano burn is final', async () => {
    const r = await checkUsdcxBurnLeg(journey(), ADDRESS, reads({ depth: USDCX_BURN_DEPTH.cardanoBlocks - 1 }))
    expect(r.evidence).toMatchObject({ burn: 'verified', burnFinal: false, provider: 'finalized', credit: 'verified' })
    expect(r.outcome).toBeNull()
    expect(r.evidence.reason).toMatch(/waiting for 400/)
  })

  it('a failed burn is not recorded as final before the Cardano depth requirement', async () => {
    const cbor = burnFixture.cbor
    const flipped = cbor.slice(0, cbor.lastIndexOf('f5')) + 'f4' + cbor.slice(cbor.lastIndexOf('f5') + 2)
    const r = await checkUsdcxBurnLeg(journey(), ADDRESS, reads({ cbor: flipped, depth: 1 }))
    expect(r.evidence.burn).toBe('failed-attempt')
    expect(r.outcome).toBeNull()
  })

  it('refuses stored release terms that disagree with the byte-exact BurnIntent value', async () => {
    const j = journey()
    const changed = { ...j, burnTerms: { ...j.burnTerms!, releaseAmountRaw: '2799000000' } }
    const r = await checkUsdcxBurnLeg(changed, ADDRESS, reads())
    expect(r.outcome).toEqual({ state: 'needs-review' })
    expect(r.evidence.reason).toMatch(/BurnIntent release value differs/)
    expect(r.evidence.provider).toBe('not-checked')
  })

  it('a burn the operator does not list is pending, not a failure', async () => {
    const r = await checkUsdcxBurnLeg(journey(), ADDRESS, reads({ rows: [] }))
    expect(r.outcome).toBeNull()
    expect(r.evidence.provider).toBe('not-listed')
  })

  it('operator failure/expiry after a verified burn needs review and is never called a refund', async () => {
    for (const status of ['failed', 'expired']) {
      const r = await checkUsdcxBurnLeg(journey(), ADDRESS, reads({ rows: rowsWith({ status }) }))
      expect(r.outcome).toEqual({ state: 'needs-review' })
      expect(r.evidence.reason).toMatch(/not a refund/)
    }
  })

  it('a duplicate operator row, or one with another amount, needs review', async () => {
    const row = (historyFixture.response as Array<Record<string, unknown>>).find(r => r.cardanoBurnTxHash === BURN)!
    expect((await checkUsdcxBurnLeg(journey(), ADDRESS, reads({ rows: parseIogWithdrawalHistory([row, row]) }))).outcome).toEqual({ state: 'needs-review' })
    expect((await checkUsdcxBurnLeg(journey(), ADDRESS, reads({ rows: rowsWith({ amount: '2801000000' }) }))).outcome).toEqual({ state: 'needs-review' })
  })

  it('a release that does not credit the APPROVED recipient exactly needs review', async () => {
    const r = await checkUsdcxBurnLeg(journey({ recipient: '0x' + '11'.repeat(20) }), ADDRESS, reads())
    expect(r.outcome).toEqual({ state: 'needs-review' })
    expect(r.evidence.credit).toBe('needs-review')
  })

  it('a burn transaction that failed script validation burned nothing -> failed', async () => {
    // Same body (same hash), is_valid flipped to false.
    const cbor = burnFixture.cbor
    const flipped = cbor.slice(0, cbor.lastIndexOf('f5')) + 'f4' + cbor.slice(cbor.lastIndexOf('f5') + 2)
    const r = await checkUsdcxBurnLeg(journey(), ADDRESS, reads({ cbor: flipped }))
    expect(r.evidence.burn).toBe('failed-attempt')
    expect(r.outcome).toEqual({ state: 'failed' })
  })

  it('a saved hash whose transaction does not match the approved burn needs review', async () => {
    // The approved burn amount differs from what the transaction burned.
    let j = createJourney({ id: 'u2', walletId: 'w', now: 1, bridge: 'xreserve-cardano-ethereum', recipient: burnFixture.recipient, source: USDCX, usdcx: USDCX, usdc: USDC, destination: USDC })
    const intent = burnFixture.terms.encoded
    const maxFeeAt = 2 + 36 * 2, value = 2 + (72 + 16 + 8 * 32) * 2
    // value + maxFee consistent, but 1 USDC less value than burned on chain.
    const less = intent.slice(0, value) + (2799000000).toString(16).padStart(64, '0') + intent.slice(value + 64)
    void maxFeeAt
    j = approveLeg(j, 'bridge', '2801000000', 2, '2802000000')
    j = authorizeXReserveBurn(j, { ...burnFixture.terms, encoded: less, burnAmountRaw: '2801000000', network: 'mainnet', releaseAmountRaw: '2799000000', releaseRecipient: burnFixture.recipient }, 3)
    j = recordLegSubmitted(j, 'bridge', BURN, 4)
    const r = await checkUsdcxBurnLeg(j, ADDRESS, reads())
    expect(['conflict', 'unrelated']).toContain(r.evidence.burn)
    expect(r.outcome).toEqual({ state: 'needs-review' })
  })


  it('a Solana-forwarded withdrawal is never confirmed here (no Solana credit check yet)', async () => {
    const r = await checkUsdcxBurnLeg(journey({ bridge: 'xreserve-cardano-solana-forwarded' }), ADDRESS, reads())
    expect(r.outcome).toBeNull()
    expect(r.evidence.reason).toMatch(/Solana credit is not supported yet/)
  })
})

describe('the recoverable journey', () => {
  function store(initial: Record<string, string> = {}) {
    let map = { ...initial }
    return { store: journeyMapStore(async () => ({ ...map }), async (m) => { map = { ...m } }, createJourneyWriteQueue()), map: () => map }
  }
  const baseReads = (usdcxBurn: UsdcxBurnReads): RecheckReads => ({
    evmAllowance: async () => null, evmReceipt: async () => 'unreadable', evmBlockTime: async () => null,
    solanaStatus: async () => null, cardanoTx: async () => null,
    solanaDelivery: {} as RecheckReads['solanaDelivery'], usdcxBurn,
  })

  it('does not display an unreadable burn transaction as on-chain success', async () => {
    const s = store()
    const j = journey()
    await s.store.put(j)
    const r = await recheckJourney(j, s.store, baseReads(reads({ cbor: '80' })), { cardano: ADDRESS }, 10)
    expect(r.legs[0].onChain).toBe('unknown')
    expect(r.legs[0].burn?.burn).not.toBe('verified')
  })

  it('survives a restart, then records the measured credit; funds are shown where they are after each step', async () => {
    const s = store()
    const j = journey()
    await s.store.put(j)
    // Before: burned on Cardano, not yet proven arrived.
    expect(journeyHolding(j)).toMatchObject({ asset: { chain: 'ethereum', symbol: 'USDC' }, amountRaw: null, settled: false })

    // "Restart": a fresh store over the same persisted map; the burn is still pending.
    const restarted = store(s.map())
    const pending = await recheckJourney((await restarted.store.get('u1'))!, restarted.store, baseReads(reads({ rows: [] })), { cardano: ADDRESS }, 10)
    expect(pending.journey.legs[1]).toMatchObject({ state: 'uncertain', txHash: BURN })
    expect(pending.legs[0].burn?.provider).toBe('not-listed')

    // Later: the full linkage is visible -> confirmed with the measured credit, persisted.
    const done = await recheckJourney((await restarted.store.get('u1'))!, restarted.store, baseReads(reads()), { cardano: ADDRESS }, 11)
    const saved = parseJourney(restarted.map()['u1'])
    expect(saved.legs[1]).toMatchObject({ state: 'confirmed', measuredOutputRaw: '2800000000', txHash: BURN })
    expect(saved.status).toBe('completed')
    expect(journeyHolding(saved)).toEqual({ asset: USDC, amountRaw: '2800000000', settled: true })
    expect(done.legs[0].onChain).toBe('confirmed')

    // Checking again changes nothing.
    await recheckJourney(saved, restarted.store, baseReads(reads()), { cardano: ADDRESS }, 12)
    expect(parseJourney(restarted.map()['u1'])).toEqual(saved)
  })

  it('a failed burn stops the journey with the USDCx still on Cardano', async () => {
    const s = store()
    await s.store.put(journey())
    const cbor = burnFixture.cbor
    const flipped = cbor.slice(0, cbor.lastIndexOf('f5')) + 'f4' + cbor.slice(cbor.lastIndexOf('f5') + 2)
    await recheckJourney((await s.store.get('u1'))!, s.store, baseReads(reads({ cbor: flipped })), { cardano: ADDRESS }, 10)
    const saved = parseJourney(s.map()['u1'])
    expect(saved).toMatchObject({ status: 'stopped' })
    expect(saved.legs[1].state).toBe('failed')
    expect(journeyHolding(saved)).toMatchObject({ asset: { chain: 'cardano', symbol: 'USDCx' }, settled: true })
  })

  it('the saved burn hash and approved terms can never be replaced, and terms are set once', async () => {
    const s = store()
    const j = journey()
    await s.store.put(j)
    await expect(s.store.put({ ...j, legs: [j.legs[0], { ...j.legs[1], txHash: 'ab'.repeat(32) }, j.legs[2]] as StablecoinJourney['legs'] })).rejects.toThrow(/never replaced/)
    await expect(s.store.put({ ...j, burnTerms: { ...j.burnTerms!, releaseAmountRaw: '1' } })).rejects.toThrow(/never change/)
    await expect(s.store.put({ ...j, burnTerms: null })).rejects.toThrow(/never change/)
    expect(() => recordLegSubmitted(j, 'bridge', 'cd'.repeat(32), 9)).toThrow(/never replaced/)
  })

  it('burn terms: only for an approved, unsent xReserve step, matching the approved amount, once', () => {
    const fresh = () => approveLeg(createJourney({ id: 'u3', walletId: 'w', now: 1, bridge: 'xreserve-cardano-ethereum', recipient: burnFixture.recipient,
      source: USDCX, usdcx: USDCX, usdc: USDC, destination: USDC }), 'bridge', burnFixture.terms.burnAmountRaw, 2, burnFixture.terms.burnAmountRaw)
    const terms = { ...burnFixture.terms, network: 'mainnet' as const, releaseAmountRaw: burnFixture.releaseAmountRaw, releaseRecipient: burnFixture.recipient }
    const once = authorizeXReserveBurn(fresh(), terms, 3)
    expect(() => authorizeXReserveBurn(once, terms, 4)).toThrow(/already has terms/)
    expect(() => authorizeXReserveBurn(fresh(), { ...terms, burnAmountRaw: '2801000000' }, 3)).toThrow(/differs/)
    expect(() => authorizeXReserveBurn(fresh(), { ...terms, releaseAmountRaw: '2803000000' }, 3)).toThrow(/exceeds/)
    expect(() => authorizeXReserveBurn(recordLegSubmitted(fresh(), 'bridge', BURN, 3), terms, 4)).toThrow(/nothing sent/)
  })

  it('records saved before burn terms existed still read (as none); terms on another bridge are refused', () => {
    const j = journey()
    const { burnTerms: _omit, ...legacy } = j
    void _omit
    expect(parseJourney(JSON.stringify(legacy)).burnTerms).toBeNull()
    expect(() => parseJourney(JSON.stringify({ ...j, bridge: 'ccip-cbada' }))).toThrow()
  })
})
