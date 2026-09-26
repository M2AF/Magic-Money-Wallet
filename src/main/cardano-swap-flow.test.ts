/**
 * The Cardano swap flow around the validator: the Minswap client's route checks
 * and per-hop slippage, the policy gate, order status vocabulary, and the
 * session lifecycle of an order that is placed now and traded later.
 *
 * Provider responses are the ones recorded live on 2026-09-26
 * (src/main/__fixtures__/minswap); no test here reaches a network.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  termsFromEstimate, minswapQuoteDirect, approvedFloor, MinswapQuoteError,
  type MinswapEstimate, type MinswapEstimateRequest,
} from './minswap-client'
import { decideSwapPolicy, checkMinReceived } from '../shared/swap-policy-checks'
import { unsignableReason, withMinReceived } from '../shared/swap-candidates'
import { validateSwapQuoteForExecution } from '../shared/swap-execution-checks'
import { mapStatusForProvider } from '../shared/swap-lifecycle'
import {
  openSwapSession, recordSwapBroadcast, recordSourceReceipt, applyStatusReport, sessionsNeedingReconcile,
  type SettledSwapSessionMap, type OpenSessionInput,
} from '../shared/swap-settlement'
import { swapCapability } from '../shared/swap-networks'
import { CARDANO_USDCX_UNIT } from '../shared/swap-token-identity'
import type { NormalizedSwapQuote } from '../shared/swap-quote'
import { feeFreeRecord } from '../shared/swap-fee-policy'

const FIX = join(__dirname, '__fixtures__', 'minswap')
const load = (name: string) => JSON.parse(readFileSync(join(FIX, `${name}.json`), 'utf8'))
const USDCX = CARDANO_USDCX_UNIT.mainnet
const SNEK = '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b'
const SENDER = 'addr1q8008tnk6x22qh7xl38znc5p6c52hp8wtfrxaq0yrer9az8fahsvrvjs2nte6d95crak93gphy32u868qqtx3s4r5dxqxpj8mk'

describe('termsFromEstimate — only a single Minswap V2 route between exactly the requested tokens', () => {
  const fx = load('usdcx-snek-2hop') as { estimateRequest: MinswapEstimateRequest; estimate: MinswapEstimate }

  it('reads the recorded 2-hop route (via NIGHT) into its path and fees', () => {
    const t = termsFromEstimate(fx.estimateRequest, fx.estimate)
    expect(t.hops).toBe(2)
    expect(t.terms.path[0]).toBe(USDCX)
    expect(t.terms.path[2]).toBe(SNEK)
    expect(t.terms.path[1]).toMatch(/4e49474854$/)   // "NIGHT"
    expect(t.terms.batcherFeeLovelace).toBe('2000000')
    expect(t.terms.aggregatorFeeLovelace).toBe('1000000')
  })

  it('refuses a route split across several orders', () => {
    const paths = fx.estimate.paths as NonNullable<MinswapEstimate['paths']>
    expect(() => termsFromEstimate(fx.estimateRequest, { ...fx.estimate, paths: [paths[0], paths[0]] }))
      .toThrow(/split across several orders/)
  })

  it('refuses a hop through another protocol, even when V2 was requested (measured: SNEK<->ADA came back via V1)', () => {
    const paths = fx.estimate.paths as NonNullable<MinswapEstimate['paths']>
    const v1 = [[{ ...paths[0][0], protocol: 'Minswap' }, paths[0][1]]]
    expect(() => termsFromEstimate(fx.estimateRequest, { ...fx.estimate, paths: v1 })).toThrow(/not Minswap V2/)
  })

  it('refuses a different sell amount or token than requested', () => {
    expect(() => termsFromEstimate(fx.estimateRequest, { ...fx.estimate, amount_in: '1' })).toThrow(/sell amount/)
    expect(() => termsFromEstimate(fx.estimateRequest, { ...fx.estimate, token_out: USDCX })).toThrow(/different tokens/)
  })

  it('refuses a discontinuous route', () => {
    const paths = fx.estimate.paths as NonNullable<MinswapEstimate['paths']>
    const broken = [[paths[0][0], { ...paths[0][1], token_in: 'lovelace' }]]
    expect(() => termsFromEstimate(fx.estimateRequest, { ...fx.estimate, paths: broken })).toThrow(/does not continue/)
  })
})

describe('minswapQuoteDirect — the floor shown is the floor enforced', () => {
  const one = load('ada-usdcx-1hop')
  const two = load('usdcx-snek-2hop')
  const fetchReturning = (...bodies: Array<{ status?: number; body: unknown }>) => {
    const calls: Array<{ url: string; body: unknown }> = []
    const fn = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) })
      const next = bodies.shift() ?? { status: 500, body: {} }
      return new Response(JSON.stringify(next.body), { status: next.status ?? 200 })
    })
    return { fn, calls }
  }

  it('builds with Minswap\'s own minimum and returns a fee-free, provider-floored quote', async () => {
    const { fn, calls } = fetchReturning({ body: one.estimate }, { body: one.buildTx })
    const q = await minswapQuoteDirect({
      sellUnit: 'lovelace', buyUnit: USDCX, sellAmountRaw: '20000000', slippageBps: 50,
      sender: SENDER, fromSymbol: 'ADA', toSymbol: 'USDCx',
    }, fn)
    expect(calls.map(c => c.url.split('/').pop())).toEqual(['estimate', 'build-tx'])
    expect((calls[1].body as { min_amount_out: string }).min_amount_out).toBe(one.estimate.min_amount_out)
    expect(q.provider).toBe('minswap')
    expect(q.minReceivedSource).toBe('provider')
    expect(q.appFee?.requestedBps).toBe(0)
    expect(q.txData.cbor).toBe(one.buildTx.cbor)
    expect(checkMinReceived(q).ok).toBe(true)
  })

  it('re-asks with the slippage divided across hops when per-hop compounding would loosen the floor', async () => {
    // Recorded: 1% on a 2-hop route gave a floor 1.97% under the output.
    expect(BigInt(two.estimate.min_amount_out)).toBeLessThan(approvedFloor(two.estimate.amount_out, 100))
    const tighter = { ...two.estimate, min_amount_out: String(approvedFloor(two.estimate.amount_out, 100) + 1n) }
    const { fn, calls } = fetchReturning({ body: two.estimate }, { body: tighter }, { body: two.buildTx })
    await minswapQuoteDirect({
      sellUnit: USDCX, buyUnit: SNEK, sellAmountRaw: '10000000', slippageBps: 100,
      sender: SENDER, fromSymbol: 'USDCx', toSymbol: 'SNEK',
    }, fn)
    expect(calls.map(c => (c.body as { slippage?: number }).slippage)).toEqual([1, 0.5, undefined])
  })

  it('refuses rather than offers a floor looser than the slippage on screen', async () => {
    const { fn } = fetchReturning({ body: two.estimate }, { body: two.estimate })
    await expect(minswapQuoteDirect({
      sellUnit: USDCX, buyUnit: SNEK, sellAmountRaw: '10000000', slippageBps: 100,
      sender: SENDER, fromSymbol: 'USDCx', toSymbol: 'SNEK',
    }, fn)).rejects.toThrow(/looser than your slippage/)
  })

  it('turns the per-IP rate limit into an instruction, not a raw error', async () => {
    const { fn } = fetchReturning({ status: 429, body: { statusCode: 429, message: 'Rate limit exceeded, retry in 1 minute' } })
    await expect(minswapQuoteDirect({
      sellUnit: 'lovelace', buyUnit: USDCX, sellAmountRaw: '20000000', slippageBps: 50,
      sender: SENDER, fromSymbol: 'ADA', toSymbol: 'USDCx',
    }, fn)).rejects.toThrow(MinswapQuoteError)
  })
})

function cardanoQuote(over: Partial<NormalizedSwapQuote> = {}): NormalizedSwapQuote {
  const one = load('ada-usdcx-1hop')
  const t = termsFromEstimate(one.estimateRequest, one.estimate)
  return {
    provider: 'minswap', fromChain: 'cardano', toChain: 'cardano',
    fromTokenAddress: 'lovelace', toTokenAddress: USDCX, fromTokenSymbol: 'ADA', toTokenSymbol: 'USDCx',
    sellAmountRaw: '20000000', buyAmountRaw: t.buyAmountRaw, minBuyAmountRaw: t.minBuyAmountRaw,
    minReceivedSource: 'provider', estimatedGasRaw: '0', slippageBps: 50, priceImpactPct: 0, rate: 0,
    expiresAt: Date.now() + 30_000, isCrossChain: false, toAddress: SENDER,
    appFee: feeFreeRecord('minswap', 'cardano', 'Minswap aggregator has no integrator fee mechanism'),
    txData: { cbor: one.buildTx.cbor }, approvalTx: null, cardanoOrder: t.terms,
    ...over,
  }
}

describe('the policy gate for Cardano', () => {
  it('Cardano is enabled same-chain only, and not claimed as verified before a real-funds swap', () => {
    const cap = swapCapability('cardano')!
    expect(cap.sameChain).toEqual(['minswap'])
    expect(cap.crossChainSource).toEqual([])
    expect(cap.crossChainDestination).toEqual([])
    expect(cap.status).toBe('implemented-unverified')
  })

  it('offers a broad-token Minswap route (the floor is provider-stated and datum-checked)', () => {
    const q = withMinReceived(cardanoQuote({ toTokenAddress: SNEK, toTokenSymbol: 'SNEK' }))!
    expect(decideSwapPolicy(q).tier).toBe('broad')
    expect(decideSwapPolicy(q).allowed).toBe(true)
  })

  it('refuses a cross-chain quote out of Cardano, whatever the route claims', () => {
    const d = decideSwapPolicy(cardanoQuote({ toChain: 'ethereum' }))
    expect(d.allowed).toBe(false)
  })

  it('structural execution checks: CBOR only, from Minswap, with its order terms', () => {
    const ok = cardanoQuote()
    expect(() => validateSwapQuoteForExecution(ok, Date.now(), () => false)).not.toThrow()
    expect(() => validateSwapQuoteForExecution({ ...ok, provider: 'rango' }, Date.now(), () => false)).toThrow(/Minswap/)
    expect(() => validateSwapQuoteForExecution({ ...ok, txData: { ...ok.txData, to: '0x1' } }, Date.now(), () => false))
      .toThrow(/EVM or Solana/)
    expect(() => validateSwapQuoteForExecution({ ...ok, cardanoOrder: null }, Date.now(), () => false)).toThrow(/order/)
    expect(() => validateSwapQuoteForExecution({ ...ok, txData: {} }, Date.now(), () => false)).toThrow(/Cardano transaction/)
  })

  it('unsignableReason agrees with the gate', () => {
    const q = withMinReceived(cardanoQuote())!
    expect(unsignableReason({ ...q, toChain: 'solana' })).not.toBeNull()
  })
})

describe('Minswap order status — Cardano wording, never a bridge', () => {
  it('maps each measured state', () => {
    expect(mapStatusForProvider('minswap', { status: 'NOT_FOUND' }, USDCX).state).toBe('source-submitted')
    const open = mapStatusForProvider('minswap', { status: 'PENDING', substatus: 'ORDER_OPEN' }, USDCX)
    expect(open.state).toBe('source-confirmed')
    expect(open.message).toMatch(/stay open until you cancel/)
    expect(open.message).not.toMatch(/bridge/i)
    expect(mapStatusForProvider('minswap', {
      status: 'DONE', substatus: 'COMPLETED', receivedAmountRaw: '5100000', receivedTokenAddress: USDCX, receivedTokenChain: 'cardano',
    }, USDCX).state).toBe('completed')
    expect(mapStatusForProvider('minswap', { status: 'DONE', substatus: 'REFUNDED' }, USDCX).state).toBe('refunded')
    expect(mapStatusForProvider('minswap', {
      status: 'DONE', substatus: 'COMPLETED', receivedAmountRaw: '1', receivedTokenAddress: SNEK, receivedTokenChain: 'cardano',
    }, USDCX).state).toBe('partial')
  })
})

describe('an order session stays open until the order is traded', () => {
  const input: OpenSessionInput = {
    id: 'i1', walletId: 'w', accountIndex: 0, environment: 'mainnet', provider: 'minswap',
    fromChain: 'cardano', toChain: 'cardano', fromTokenAddress: 'lovelace', fromTokenSymbol: 'ADA', fromTokenDecimals: 6,
    toTokenAddress: USDCX, toTokenSymbol: 'USDCx', toTokenDecimals: 6, sellAmountRaw: '20000000',
    expectedBuyAmountRaw: '5078463', minBuyAmountRaw: '5053197', recipient: SENDER, isCrossChain: false,
    settlesAfterSource: true, bridgeTool: 'Minswap V2', providerRequestId: null, appFee: null,
  }

  it('a confirmed order transaction is "placed", not "completed", and is still polled', () => {
    let map: SettledSwapSessionMap = openSwapSession({}, input)
    map = recordSwapBroadcast(map, 'i1', { txHash: 'ab'.repeat(32), explorerUrl: null, nonce: null })
    map = recordSourceReceipt(map, 'i1', { txHash: 'ab'.repeat(32), success: true })
    expect(map.i1.state).toBe('source-confirmed')
    expect(sessionsNeedingReconcile(map).map(s => s.id)).toEqual(['i1'])

    map = applyStatusReport(map, 'i1', mapStatusForProvider('minswap', {
      status: 'DONE', substatus: 'COMPLETED', receivedAmountRaw: '5070000', receivedTokenAddress: USDCX, receivedTokenChain: 'cardano',
    }, USDCX))
    expect(map.i1.state).toBe('completed')
    expect(sessionsNeedingReconcile(map)).toEqual([])
  })

  it('a delivery measured below the approved floor is reported as a shortfall, not success', () => {
    let map: SettledSwapSessionMap = openSwapSession({}, input)
    map = recordSwapBroadcast(map, 'i1', { txHash: 'ab'.repeat(32), explorerUrl: null, nonce: null })
    map = applyStatusReport(map, 'i1', mapStatusForProvider('minswap', {
      status: 'DONE', substatus: 'COMPLETED', receivedAmountRaw: '5000000', receivedTokenAddress: USDCX, receivedTokenChain: 'cardano',
    }, USDCX))
    expect(map.i1.state).toBe('partial')
  })

  it('an ordinary same-chain session is unchanged: confirmed means completed', () => {
    let map: SettledSwapSessionMap = openSwapSession({}, { ...input, provider: 'jupiter', settlesAfterSource: false })
    map = recordSourceReceipt(map, 'i1', { txHash: 'ab'.repeat(32), success: true })
    expect(map.i1.state).toBe('completed')
  })
})
