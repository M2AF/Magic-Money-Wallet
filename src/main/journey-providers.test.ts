/**
 * The journey-provider registry: cbADA via Chainlink CCIP beside USDCx via
 * xReserve and the conditional Coinbase conversion. Dependencies are fakes; the
 * pinned identities and the live fee/liquidity values they mirror were read on
 * Base mainnet on 2026-10-05 (see cbada-ccip.ts). No network.
 */
import { describe, it, expect, vi } from 'vitest'
import { planJourneys, cbAdaProvider, type JourneyDeps, type JourneyRequest, type JourneyProvider } from './journey-providers'
import { CBADA, svmTokenTransferExtraArgs, isCbAda, cbAdaLane } from './cbada-ccip'
import type { SwapQuoteRequest } from './swap-proxy'

const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
const SOL_WALLET = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV'
const EVM_WALLET = '0x720f28c62b844e7dd8705ab0a7651f3f575384f4'
const CARDANO = 'addr1q950qv0ks9t29mavulaa5jr3sk2s50r5jfsddydjs0pazrfh32tdpt7zttt4mhl6t9purm4c9rv555z7r5mulq78aleqcg9c9h'

/** 1 USDC -> 3.73 cbADA; 1 cbADA -> 1000 BONK (shapes of the live 2026-10-05 quotes). */
function fakeQuote(req: SwapQuoteRequest, over: Record<string, unknown> = {}) {
  const sell = BigInt(req.sellAmountRaw)
  const out = isCbAda(req.toChain, req.toToken) ? sell * 373n / 100n : sell * 1000n
  return {
    quote: {
      provider: req.fromChain === 'solana' ? 'jupiter' : 'lifi', fromChain: req.fromChain, toChain: req.toChain,
      fromTokenAddress: req.fromToken, toTokenAddress: req.toToken, sellAmountRaw: req.sellAmountRaw,
      buyAmountRaw: out.toString(), minBuyAmountRaw: (out * 995n / 1000n).toString(), expiresAt: 1, bridgeTool: 'DEX',
      estimatedGasRaw: '0', valuation: { sourceCostUsd: 0.01, outputUsd: 50 }, externalFees: [],
      ...over,
    } as never,
    error: null,
  }
}

function deps(over: Partial<JourneyDeps> = {}) {
  const quotes: SwapQuoteRequest[] = []
  const d: JourneyDeps = {
    quote: vi.fn(async (req: SwapQuoteRequest) => { quotes.push(req); return fakeQuote(req) }),
    prepareEthereum: vi.fn(), prepareSolana: vi.fn(),
    ccip: {
      // Live 2026-10-05: 0.00138465 ETH for 10 cbADA Base -> Solana; Base pool held 0 cbADA.
      feeBaseToSolana: vi.fn(async () => 1_384_650_232_086_707n),
      baseReleaseLiquidity: vi.fn(async () => 0n),
    },
    nativeUsd: vi.fn(async () => 2500),
    ...over,
  }
  return { d, quotes }
}

const baseToSolana = (over: Partial<JourneyRequest> = {}): JourneyRequest => ({
  source: { chain: 'base', address: BASE_USDC, symbol: 'USDC', decimals: 6 }, sellAmountRaw: '100000000',
  destination: { chain: 'solana', address: BONK, symbol: 'BONK', decimals: 5 },
  sourceAddress: EVM_WALLET, recipient: SOL_WALLET, slippageBps: 50, ...over,
})

describe('cbADA via CCIP — Base USDC -> cbADA -> Solana cbADA -> BONK', () => {
  it('quotes both swaps against the PINNED cbADA identities and prices the CCIP fee', async () => {
    const { d, quotes } = deps()
    const c = await cbAdaProvider.plan(baseToSolana(), d)
    expect(quotes[0]).toMatchObject({ fromChain: 'base', toToken: CBADA.base.token, taker: EVM_WALLET })
    expect(quotes[1]).toMatchObject({ fromChain: 'solana', fromToken: CBADA.solana.token, toToken: BONK, taker: SOL_WALLET })
    const [src, bridge, dst] = c.legs
    expect(src).toMatchObject({ status: 'quoted', minOutRaw: '371135000' })
    // CCIP moves cbADA 1:1; the destination swap is quoted on the bridged floor and is indicative.
    expect(bridge).toMatchObject({ status: 'prepared', inRaw: '371135000', expectedOutRaw: '371135000' })
    expect(dst).toMatchObject({ status: 'quoted', inRaw: '371135000', inputBasis: 'indicative' })
    expect(d.ccip.feeBaseToSolana).toHaveBeenCalledWith(371_135_000n, SOL_WALLET)
    const fee = c.costs.find(k => k.label === 'Chainlink CCIP fee')!
    expect(fee).toMatchObject({ amountRaw: '1384650232086707', symbol: 'ETH', includedInOutput: false })
    expect(fee.usd).toBeCloseTo(1.384650232086707e-3 * 2500)
    // The CCIP send's own network fee is not estimated: unknown, not zero.
    expect(c.costs.find(k => k.label.includes('network fee for the CCIP send'))).toMatchObject({ amountRaw: null, usd: null })
    expect(c.executable).toBe(false)
    expect(c.blockers[0]).toMatch(/not implemented or validated/)
    expect(c.finalExpectedRaw).not.toBeNull()
  })

  it('cbADA already held and cbADA wanted: both swaps are skipped', async () => {
    const { d, quotes } = deps()
    const c = await cbAdaProvider.plan(baseToSolana({
      source: { chain: 'base', address: CBADA.base.token.toLowerCase(), symbol: 'cbADA', decimals: 6 },
      destination: { chain: 'solana', address: CBADA.solana.token, symbol: 'cbADA', decimals: 6 },
      sellAmountRaw: '5000000',
    }), d)
    expect(c.legs.map(l => l.status)).toEqual(['skipped', 'prepared', 'skipped'])
    expect(quotes).toHaveLength(0)
    expect(c.finalExpectedRaw).toBe('5000000')
  })

  it('a token merely NAMED cbADA is not cbADA: it is swapped, not skipped', async () => {
    const { d, quotes } = deps()
    const c = await cbAdaProvider.plan(baseToSolana({ source: { chain: 'base', address: '0x' + '11'.repeat(20), symbol: 'cbADA', decimals: 6 } }), d)
    expect(c.legs[0].status).toBe('quoted')
    expect(quotes[0].toToken).toBe(CBADA.base.token)
  })

  it('a quote for a different asset than requested is refused', async () => {
    const { d } = deps({ quote: vi.fn(async (req: SwapQuoteRequest) => fakeQuote(req, { toTokenAddress: '0x' + '22'.repeat(20) })) })
    const c = await cbAdaProvider.plan(baseToSolana(), d)
    expect(c.legs[0]).toMatchObject({ status: 'unavailable', reason: expect.stringMatching(/different token/) })
    expect(c.legs[1].status).toBe('unavailable')
    expect(c.finalExpectedRaw).toBeNull()
  })

  it('an unreadable CCIP fee stays unknown, never zero', async () => {
    const { d } = deps({ ccip: { feeBaseToSolana: vi.fn(async () => null), baseReleaseLiquidity: vi.fn(async () => 0n) } })
    const c = await cbAdaProvider.plan(baseToSolana(), d)
    expect(c.costs.find(k => k.label === 'Chainlink CCIP fee')).toMatchObject({ amountRaw: null, usd: null })
  })

  it('without an ETH price the fee is stated but unpriced', async () => {
    const { d } = deps({ nativeUsd: undefined })
    const c = await cbAdaProvider.plan(baseToSolana(), d)
    expect(c.costs.find(k => k.label === 'Chainlink CCIP fee')).toMatchObject({ amountRaw: '1384650232086707', usd: null })
  })

  it('more than the lane capacity is refused', async () => {
    const { d } = deps({ quote: vi.fn(async (req: SwapQuoteRequest) => fakeQuote(req, { minBuyAmountRaw: (CBADA.laneCapacityRaw + 1n).toString() })) })
    const c = await cbAdaProvider.plan(baseToSolana(), d)
    expect(c.legs[1]).toMatchObject({ status: 'unavailable', reason: expect.stringMatching(/capacity/) })
  })
})

describe('cbADA via CCIP — Solana -> Base releases from the Base lock/release pool', () => {
  const solToBase = (): JourneyRequest => ({
    source: { chain: 'solana', address: CBADA.solana.token, symbol: 'cbADA', decimals: 6 }, sellAmountRaw: '10000000',
    destination: { chain: 'base', address: BASE_USDC, symbol: 'USDC', decimals: 6 }, sourceAddress: SOL_WALLET, recipient: EVM_WALLET, slippageBps: 50,
  })

  it('an empty pool (as measured) makes the bridge unavailable; the final swap is still discovered', async () => {
    const { d } = deps()
    const c = await cbAdaProvider.plan(solToBase(), d)
    expect(c.legs[1]).toMatchObject({ status: 'unavailable', reason: expect.stringMatching(/holds 0 base units/) })
    expect(c.legs[2].status).toBe('quoted')
    expect(c.finalExpectedRaw).toBeNull()
    expect(c.costs.find(k => k.label.startsWith('Chainlink CCIP fee'))).toMatchObject({ amountRaw: null })
  })

  it('with enough release liquidity the bridge is priced as prepared (fee still unknown)', async () => {
    const { d } = deps({ ccip: { feeBaseToSolana: vi.fn(), baseReleaseLiquidity: vi.fn(async () => 50_000_000n) } })
    const c = await cbAdaProvider.plan(solToBase(), d)
    expect(c.legs[1].status).toBe('prepared')
    expect(d.ccip.feeBaseToSolana).not.toHaveBeenCalled()
  })

  it('unreadable liquidity is not assumed to be enough', async () => {
    const { d } = deps({ ccip: { feeBaseToSolana: vi.fn(), baseReleaseLiquidity: vi.fn(async () => null) } })
    expect((await cbAdaProvider.plan(solToBase(), d)).legs[1].status).toBe('unavailable')
  })
})

describe('planJourneys — the registry', () => {
  it('only providers that serve the pair are asked; an unsupported lane yields nothing', async () => {
    const { d } = deps()
    expect((await planJourneys(baseToSolana({ destination: { chain: 'ethereum', address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', symbol: 'PEPE', decimals: 18 } }), d)).candidates).toEqual([])
    expect(cbAdaLane('solana', 'robinhood')).toBe(false)
  })

  it('Base -> Solana: cbADA is a candidate, listed as a preview; nothing is recommended', async () => {
    const { d } = deps()
    const r = await planJourneys(baseToSolana(), d)
    expect(r.candidates.map(c => c.family)).toEqual(['cbada-ccip'])
    expect(r.ranking.recommended).toBeNull()
    expect(r.ranking.previews.map(c => c.family)).toEqual(['cbada-ccip'])
  })

  it('Cardano -> Solana: USDCx and the conditional Coinbase conversion, both previews', async () => {
    const { d } = deps()
    const r = await planJourneys({
      source: { chain: 'cardano', address: 'lovelace', symbol: 'ADA', decimals: 6 }, sellAmountRaw: '20000000',
      destination: { chain: 'solana', address: BONK, symbol: 'BONK', decimals: 5 }, sourceAddress: CARDANO, recipient: SOL_WALLET, slippageBps: 50,
    }, d)
    expect(r.candidates.map(c => c.family)).toEqual(['usdcx-xreserve', 'coinbase-conversion'])
    const usdcx = r.candidates[0]
    expect(usdcx.costs.find(k => k.label === 'Circle withdrawal fee')).toMatchObject({ amountRaw: null })
    expect(usdcx.costs.find(k => k.label === 'Cardano burn network fee')).toMatchObject({ amountRaw: null })
    expect(r.candidates[1]).toMatchObject({ executable: false, blockers: expect.arrayContaining([expect.stringMatching(/Coinbase account/)]) })
    expect(r.ranking.recommended).toBeNull()
  })

  it('a provider that throws becomes an unavailable candidate and does not hide the others', async () => {
    const { d } = deps()
    const broken: JourneyProvider = { family: 'coinbase-conversion', supports: () => true, plan: async () => { throw new Error('boom') } }
    const r = await planJourneys(baseToSolana(), d, [broken, cbAdaProvider])
    expect(r.candidates.map(c => [c.family, c.blockers[0]])).toEqual([['coinbase-conversion', 'boom'], ['cbada-ccip', expect.any(String)]])
  })
})

describe('cbADA identities', () => {
  it('pins exact addresses and the SVM extra-args encoding for a wallet receiver', () => {
    expect(isCbAda('base', '0xCBADA732173E39521CDBE8BF59A6DC85A9FC7B8C')).toBe(true)
    expect(isCbAda('solana', CBADA.solana.token.toLowerCase())).toBe(false)
    expect(isCbAda('ethereum', CBADA.base.token)).toBe(false)
    const extra = svmTokenTransferExtraArgs(SOL_WALLET)
    expect(extra.startsWith('0x1f3b3aba')).toBe(true)
    expect(() => svmTokenTransferExtraArgs('bad')).toThrow()
  })
})
