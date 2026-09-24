import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error -- untyped Worker adapter, exercised directly
import { relayQuote } from '../../cloudflare-worker/swap-relay.js'
import { decideSwapPolicy, checkMinReceived, setSettlementTrackingActive } from './swap-policy'
import { destinationTermsFor, solverDestinationTerms } from '../shared/swap-destination'
import type { NormalizedSwapQuote } from './swap-proxy'

/**
 * EMO (Monad) -> PIXL (Ethereum) as a standing regression.
 *
 * This is the pair that was refused with a stale message about lifecycle
 * tracking, then re-investigated by EXACT ADDRESS rather than by token-list
 * membership. All three responses below are RECORDED LIVE from
 * api.relay.link/quote on 2026-09-20 with our 1% app fee, from a burn address.
 * Nothing was signed and no funds moved.
 *
 * The amounts matter as much as the pair: the original "no route" conclusion
 * came from probing at a size below the solver's economic floor.
 */

const fxPath = (n: string) => join(__dirname, '..', 'shared', '__fixtures__', 'relay', n)
const fx = (n: string) => JSON.parse(readFileSync(fxPath(n), 'utf8'))

const EMO = '0x81a224f8a62f52bde942dbf23a56df77a10b7777'
const PIXL = '0x427a03fb96d9a94a6727fbcfbba143444090dd64'
const FEE_EVM = '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13'

const ENV = { FEE_EVM, FEE_BPS: '100', ALLOW_INSECURE_DEV: 'true' }
const query = (amount: string) => ({
  fromChain: 'monad', toChain: 'ethereum',
  sell: EMO, buy: PIXL, sellSymbol: 'EMO', buySymbol: 'PIXL',
  amount, slippageBps: '200',
  taker: '0x5555555555555555555555555555555555555555',
  toAddress: '0x5555555555555555555555555555555555555555',
})

const realFetch = globalThis.fetch
/** Serve one recorded Relay body for the next quote call. */
function serve(body: unknown, status = 200) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    if (!String(input).startsWith('https://api.relay.link/quote')) throw new Error('unexpected upstream')
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

beforeEach(() => setSettlementTrackingActive(true))
afterAll(() => { globalThis.fetch = realFetch; setSettlementTrackingActive(false) })

describe('amount too small', () => {
  it('surfaces Relay\'s own reason instead of a generic "no route"', async () => {
    // 100 EMO. "No route" here would be wrong AND unhelpful: the pair routes,
    // the size does not.
    const rec = fx('quote-too-low.json')
    serve({ message: rec.message, errorCode: rec.errorCode }, 400)
    await expect(relayQuote(query(rec._amount), ENV, false))
      .rejects.toThrow(/too small to cover fees/i)
  })
})

describe('excessive price impact', () => {
  it('surfaces the impact rather than quoting it anyway', async () => {
    const rec = fx('quote-impact-too-high.json')
    serve({ message: rec.message, errorCode: rec.errorCode }, 400)
    await expect(relayQuote(query(rec._amount), ENV, false))
      .rejects.toThrow(/impact is too high/i)
  })
})

describe('a routable amount', () => {
  const routable = fx('quote-emo-pixl.json')
  const run = async () => {
    serve(routable)
    return await relayQuote(query('100000000000000000000000'), ENV, false) as NormalizedSwapQuote
  }

  it('returns a signable source-chain plan: approval + deposit', async () => {
    const q = await run()
    expect(q.provider).toBe('relay')
    expect(q.isCrossChain).toBe(true)
    expect(q.approvalTx?.to).toBeTruthy()
    expect(q.txData.to).toBeTruthy()
    expect(q.txData.data).toBeTruthy()
    // Relay polls by requestId, not by source hash.
    expect(q.requestId).toMatch(/^0x/)
  })

  it('carries Relay\'s OWN minimum, not one we derived', async () => {
    const q = await run()
    expect(q.minReceivedSource).toBe('provider')
    expect(q.minBuyAmountRaw).toBe(routable.details.currencyOut.minimumAmount)
    // And that minimum is consistent with the slippage the user approved.
    expect(checkMinReceived({ ...q, slippageBps: 200 }).ok).toBe(true)
  })

  it('records the 1% app fee with its limits stated', async () => {
    const q = await run()
    expect(q.appFee?.requestedBps).toBe(100)
    expect(q.appFee?.appliedBps).toBeGreaterThan(90)
    expect(q.appFee?.appliedBps).toBeLessThan(110)
    expect(q.appFee?.verification).toBe('applied-verified')
    // The honesty requirement: the quote proves the AMOUNT, not the recipient.
    expect(q.appFee?.evidence.join(' ')).toMatch(/does NOT echo the fee recipient/i)
  })

  it('reports Relay\'s costs separately from ours', async () => {
    const q = await run()
    const names = (q.externalFees ?? []).map(f => f.name)
    expect(names.every(n => !/magic ?money/i.test(n))).toBe(true)
  })

  it('is a PROVIDER-GUARANTEED route, never described as atomic', async () => {
    const q = await run()
    const terms = q.fromChain !== q.toChain
      ? solverDestinationTerms('Relay', q.fromChain, q.slippageBps)
      : destinationTermsFor({ ...q, toTokenAddress: q.toTokenAddress, routeSteps: null })
    expect(terms.minReceivedScope).toBe('provider-guaranteed')
    // A solver refunds rather than leaving an intermediate asset behind, and the
    // refund is the PROVIDER's promise — not something the signed transaction
    // enforces.
    expect(terms.fallback?.summary).toMatch(/refunds the deposit/i)
    expect(terms.fallback?.requiresFurtherTransaction).toBe(false)
  })

  it('passes the broad cross-chain gate — the EMO/PIXL case end to end', async () => {
    const q = await run()
    const decision = decideSwapPolicy({
      ...q,
      destination: solverDestinationTerms('Relay', q.fromChain, q.slippageBps),
    })
    expect(decision.tier).toBe('broad')
    expect(decision.isCrossChain).toBe(true)
    expect(decision.allowed).toBe(true)
    // Broad still means simulation and a confirmed minimum are required.
    expect(decision.requireSimulation).toBe(true)
    expect(decision.requireMinReceived).toBe(true)
  })

  it('is REFUSED when settlement tracking is not running', async () => {
    const q = await run()
    setSettlementTrackingActive(false)
    const decision = decideSwapPolicy({
      ...q, destination: solverDestinationTerms('Relay', q.fromChain, q.slippageBps),
    })
    expect(decision.allowed).toBe(false)
  })
})

describe('the applied rate survives USD rounding', () => {
  // Relay's rate can only be measured as a ratio of two USD figures. Measured
  // live on this pair it read 98 bps for a 100 bps request; the exact tier check
  // then demoted a genuinely fee-paying route to the fee-free fallback.
  const withFeeUsd = (feeUsd: string) => {
    const q = JSON.parse(JSON.stringify(fx('quote-emo-pixl.json')))
    q.details.currencyIn.amountUsd = '100.000000'
    q.fees.app.amountUsd = feeUsd
    return q
  }

  it('records the requested rate when the measured ratio is within rounding (98 bps)', async () => {
    serve(withFeeUsd('0.980000'))
    const q = await relayQuote(query('100000000000000000000000'), ENV, false) as NormalizedSwapQuote
    expect(q.appFee?.appliedBps).toBe(100)
    expect(q.appFee?.verification).toBe('applied-verified')
    expect(q.appFee?.evidence.join(' ')).toMatch(/measured ~98 bps/)
  })

  it('does NOT verify a rate genuinely off target (120 bps)', async () => {
    serve(withFeeUsd('1.200000'))
    const q = await relayQuote(query('100000000000000000000000'), ENV, false) as NormalizedSwapQuote
    expect(q.appFee?.verification).toBe('requested-unverified')
    expect(q.appFee?.appliedBps).toBe(120)
  })
})

describe('fee integrity for an off-chain recipient', () => {
  it('REFUSES a fee-bearing Relay quote with no request id to reconcile against', async () => {
    // Relay keeps the recipient in its own intent, so the only later proof is
    // data.paidAppFees[] keyed by requestId. Without one the fee could never be
    // checked, and an uncheckable fee must not pass as a verified one.
    serve(fx('quote-emo-pixl.json'))
    const q = await relayQuote(query('100000000000000000000000'), ENV, false) as NormalizedSwapQuote
    const decision = decideSwapPolicy({
      ...q, requestId: null,
      destination: solverDestinationTerms('Relay', q.fromChain, q.slippageBps),
    })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toMatch(/never be checked/i)
  })

  it('does NOT look for our address in calldata, because Relay never puts it there', async () => {
    // Measured: the 8330-char deposit calldata contains the fee address nowhere.
    const dep = fx('quote-emo-pixl.json').steps.find((st: { id: string }) => st.id === 'deposit')
    expect(String(dep.items[0].data.data).toLowerCase()).not.toContain(FEE_EVM.toLowerCase().slice(2))
  })
})

describe('the fee-free fallback is a real fallback', () => {
  it('asks Relay for no fee and records that explicitly', async () => {
    serve(fx('quote-emo-pixl.json'))
    const q = await relayQuote(query('100000000000000000000000'), ENV, true) as NormalizedSwapQuote
    expect(q.appFee?.requestedBps).toBe(0)
    expect(q.appFee?.verification).toBe('none-requested')
    expect(q.feeBps).toBe(0)
  })
})
