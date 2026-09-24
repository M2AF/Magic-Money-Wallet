/**
 * swap-safe-route-selection.test.ts — the app offers the best route it can
 * actually SIGN, and says plainly when it cannot offer one.
 *
 * Three failures a user reported (2026-09-21), each reproduced here:
 *
 *   1. Monad EMO -> MON and Solana -> SOL, same-chain: "Quote does not match the
 *      request (app fee terms)". Cause: the deployed Worker predates the fee
 *      policy and sends quotes with no fee record. The app correctly refused to
 *      bind them, but the message blamed the request. It now says the swap
 *      service is out of date.
 *
 *   2. EMO -> PIXL cross-chain: a LI.FI quote was SHOWN, then refused at "Swap"
 *      because its provider floor is 4.93% below output while the approved
 *      slippage is 2.50%. Cause: the app returned the first fee-verified LI.FI
 *      quote without checking it could be signed, or comparing it with other
 *      routes. It now excludes unsignable routes before ranking, so a SAFE
 *      route (Relay, whose floor matches the slippage) is offered instead.
 *
 * Upstreams are mocked with recorded shapes; nothing reaches a real provider.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error -- untyped Worker entry, exercised end to end
import worker from '../../cloudflare-worker/swap-proxy.js'
import { getSwapQuote, setSwapFetch } from './swap-proxy'
import { setSettlementTrackingActive } from './swap-policy'
import type { WalletConfig } from './secure-store'

const ENV = {
  ALLOW_INSECURE_DEV: 'true', FEE_BPS: '100',
  FEE_EVM: '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13', LIFI_INTEGRATOR: 'ChainLens',
}
const CONFIG = { swapProxyUrl: 'https://worker.test', clientToken: '' } as unknown as WalletConfig
const TAKER = '0x5555555555555555555555555555555555555555'
const EMO = '0x81a224f8a62f52bde942dbf23a56df77a10b7777'
const PIXL = '0x427a03fb96d9a94a6727fbcfbba143444090dd64'
const realFetch = globalThis.fetch
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  globalThis.fetch = realFetch
  setSwapFetch((input, init) => realFetch(input, init))
  setSettlementTrackingActive(false)
})

describe('an OUTDATED Worker (no fee terms) is named as the cause', () => {
  // Recorded 2026-09-21 from the deployed Worker: a 1inch Monad quote with the
  // legacy `feeBps` and no `appFee` / `minBuyAmountRaw`.
  const legacyQuote = {
    provider: '1inch', fromChain: 'monad', toChain: 'monad',
    fromTokenAddress: EMO, toTokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    fromTokenSymbol: 'EMO', toTokenSymbol: 'MON',
    sellAmountRaw: '10000000000000000000000', buyAmountRaw: '322000000000000000000',
    estimatedGasRaw: '0', slippageBps: 250, priceImpactPct: 0, rate: 0.0322,
    expiresAt: Date.now() + 30_000, isCrossChain: false, feeBps: 0,
    txData: { to: '0x3333333333333333333333333333333333333333', data: '0x1234', value: '0' },
    approvalTx: null,
  }

  beforeEach(() => {
    // Stand in for the deployed service itself, not the local Worker code.
    setSwapFetch(async () => json({ quote: legacyQuote, error: null }))
  })

  it('refuses it with a reason that names the swap service, not the request', async () => {
    const res = await getSwapQuote({
      fromChain: 'monad', toChain: 'monad', fromToken: EMO,
      toToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', fromSymbol: 'EMO', toSymbol: 'MON',
      sellAmountRaw: '10000000000000000000000', slippageBps: 250, taker: TAKER, toAddress: TAKER,
    } as Parameters<typeof getSwapQuote>[0], CONFIG)
    expect(res.quote).toBeNull()
    expect(res.error).toMatch(/older version than this app/i)
    expect(res.error).toMatch(/Worker needs redeploying/i)
    expect(res.error).not.toMatch(/does not match the request/i)
  })
})

describe('EMO -> PIXL: an unsignable LI.FI route no longer hides a safe Relay route', () => {
  const relayFixture = JSON.parse(readFileSync(
    join(__dirname, '..', 'shared', '__fixtures__', 'relay', 'quote-emo-pixl.json'), 'utf8'))
  const lifiSteps = [
    { type: 'protocol', tool: 'feeCollection', action: { fromChainId: 143, toChainId: 143, toToken: { address: EMO, symbol: 'EMO', decimals: 18 } } },
    { type: 'cross', tool: 'relaydepository', action: { fromChainId: 143, toChainId: 1, toToken: { address: PIXL, symbol: 'PIXL', decimals: 18 } } },
  ]
  // The screenshot's shape: LI.FI's own floor 4.93% below its output.
  const lifiOut = 25_300_000_000_000_000_000_000n
  const lifiMin = (lifiOut * 9507n) / 10000n
  const lifiResponse = {
    tool: 'relaydepository',
    estimate: {
      toAmount: lifiOut.toString(), toAmountMin: lifiMin.toString(),
      approvalAddress: '0x4444444444444444444444444444444444444444',
      feeCosts: [], gasCosts: [], executionDuration: 6,
    },
    transactionRequest: { to: '0x4444444444444444444444444444444444444444', data: '0x5678', value: '0' },
    includedSteps: lifiSteps,
  }

  beforeEach(() => {
    setSettlementTrackingActive(true)
    // Worker upstreams: Relay answers with the recorded route; others fail.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('api.relay.link/quote')) return json(relayFixture)
      return json({ error: 'no route' }, 404)
    }) as typeof fetch
    // Device-side calls: LI.FI direct answers; the Worker runs in-process.
    setSwapFetch(async (input, init) => {
      if (String(input).includes('li.quest')) return json(lifiResponse)
      return worker.fetch(new Request(input, init), ENV, { waitUntil: () => {} })
    })
  })

  const request = {
    fromChain: 'monad', toChain: 'ethereum', fromToken: EMO, toToken: PIXL,
    fromSymbol: 'EMO', toSymbol: 'PIXL', sellAmountRaw: '100000000000000000000000',
    slippageBps: 250, taker: TAKER, toAddress: TAKER, fromDecimals: 18, toDecimals: 18,
  } as Parameters<typeof getSwapQuote>[0]

  it('offers Relay, whose floor matches the approved slippage', async () => {
    const res = await getSwapQuote(request, CONFIG)
    expect(res.error).toBeNull()
    expect(res.quote?.provider).toBe('relay')
  })

  it('excludes LI.FI for exactly the reason the user hit at "Swap"', async () => {
    const res = await getSwapQuote(request, CONFIG)
    const lifi = (res.routing?.excluded ?? []).filter(r => r.startsWith('lifi'))
    expect(lifi.length).toBeGreaterThan(0)
    expect(lifi.join(' ')).toMatch(/4\.93% below its expected output/i)
  })

  it('reports the choice under the versioned routing policy', async () => {
    const res = await getSwapQuote(request, CONFIG)
    expect(res.routing?.policyVersion).toBe('2026-09-21.routing-v1')
    expect(res.routing?.safeCandidates).toBe(1)
  })
})
