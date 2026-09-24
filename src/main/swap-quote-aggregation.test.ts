/**
 * swap-quote-aggregation.test.ts — provider-aggregated route selection.
 *
 * Two things are pinned here:
 *
 *   1. `pickBestRoute` (cloudflare-worker/swap-proxy.js), directly: it must
 *      apply the routing policy (best real net result; a fee route wins only
 *      within its documented tolerance) rather than the old two-tier rule
 *      where ANY verified fee stood ahead of ANY fee-free route, however much
 *      less it returned.
 *
 *   2. `handleQuote`, end to end with mocked upstreams: a same-chain request
 *      now queries 0x, 1inch, Uniswap, LI.FI AND Rango CONCURRENTLY and picks
 *      across all five. Before this pass, LI.FI and Rango were only tried when
 *      the native trio returned NOTHING AT ALL — so a materially better LI.FI
 *      route was invisible whenever 0x/1inch/Uniswap returned anything, however
 *      weak. This is the "use every applicable provider" requirement.
 */
import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest'
// @ts-expect-error -- untyped Worker module, exercised directly (as in swap-relay.test.ts)
import { pickBestRoute } from '../../cloudflare-worker/swap-proxy.js'
// @ts-expect-error -- untyped Worker entry, exercised end to end (as in swap-quote-errors.test.ts)
import worker from '../../cloudflare-worker/swap-proxy.js'
import { getSwapQuote, setSwapFetch } from './swap-proxy'
import type { WalletConfig } from './secure-store'

const BPS = 100

function feeFreeQuote(provider: string, buyAmountRaw: string) {
  return {
    provider, fromChain: 'ethereum', toChain: 'ethereum',
    buyAmountRaw, minBuyAmountRaw: String(BigInt(buyAmountRaw) - 1n), sellAmountRaw: '1000000',
    appFee: { verification: 'none-requested', requestedBps: 0, appliedBps: 0, amountRaw: null, recipient: null, provider },
  }
}
function feePayingQuote(provider: string, buyAmountRaw: string) {
  return {
    provider, fromChain: 'ethereum', toChain: 'ethereum',
    buyAmountRaw, minBuyAmountRaw: String(BigInt(buyAmountRaw) - 1n), sellAmountRaw: '1000000',
    appFee: {
      verification: 'applied-verified', requestedBps: BPS, appliedBps: BPS, amountRaw: '10000',
      recipient: '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13', provider,
    },
  }
}

describe('pickBestRoute — replaces the old two-tier rule', () => {
  it('picks the best fee-free result over a materially worse fee-paying one', () => {
    const candidates = [
      { name: 'zeroex', quote: feePayingQuote('0x', '950000') },
      { name: 'lifi', quote: feeFreeQuote('lifi', '1000000') },
    ]
    const { winner, routing } = pickBestRoute(candidates, BPS)
    expect(winner.name).toBe('lifi')
    expect(routing.reason).toBe('best-net-result')
  })

  it('prefers a fee-paying route within the documented tolerance', () => {
    const candidates = [
      { name: 'zeroex', quote: feePayingQuote('0x', '998000') },
      { name: 'lifi', quote: feeFreeQuote('lifi', '1000000') },
    ]
    const { winner, routing } = pickBestRoute(candidates, BPS)
    expect(winner.name).toBe('zeroex')
    expect(routing.reason).toBe('fee-route-within-tolerance')
  })

  it('returns null and reasons when nothing produced an output', () => {
    const { winner, notes } = pickBestRoute([{ name: 'zeroex', error: 'no liquidity' }], BPS)
    expect(winner).toBeNull()
    expect(notes).toEqual([])
  })

  it('lists the non-selected routes as alternatives', () => {
    const candidates = [
      { name: 'a', quote: feeFreeQuote('a', '1000000') },
      { name: 'b', quote: feeFreeQuote('b', '900000') },
      { name: 'c', quote: feeFreeQuote('c', '800000') },
    ]
    const { winner, alternatives } = pickBestRoute(candidates, BPS)
    expect(winner.name).toBe('a')
    expect(alternatives.map((a: { provider: string }) => a.provider)).toEqual(['b', 'c'])
  })
})

// ── End to end: same-chain queries every applicable provider concurrently ───

const ENV = { ALLOW_INSECURE_DEV: 'true', ZEROX_API_KEY: 'k', ONEINCH_API_KEY: 'k', UNISWAP_API_KEY: 'k' }
const CONFIG = { swapProxyUrl: 'https://worker.test', clientToken: '' } as unknown as WalletConfig
const SELL = '0x1111111111111111111111111111111111111111'
const BUY = '0x2222222222222222222222222222222222222222'
const request = {
  fromChain: 'ethereum', toChain: 'ethereum',
  fromToken: SELL, toToken: BUY, fromSymbol: 'SELL', toSymbol: 'BUY',
  sellAmountRaw: '1000000000000000000', slippageBps: 50,
  taker: '0x5555555555555555555555555555555555555555',
  toAddress: '0x5555555555555555555555555555555555555555',
} as Parameters<typeof getSwapQuote>[0]

const realFetch = globalThis.fetch

describe('handleQuote — same-chain tries every applicable provider, not just the trio', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      // The trio all answer with a WEAK route.
      if (url.includes('api.0x.org')) {
        return new Response(JSON.stringify({
          liquidityAvailable: true, buyAmount: '900000000000000000', sellAmount: request.sellAmountRaw,
          transaction: { to: '0x3333333333333333333333333333333333333333', data: '0x1234', gas: '200000' },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('api.1inch.dev')) return new Response('{}', { status: 404 })
      if (url.includes('trade-api.gateway.uniswap.org')) return new Response('{}', { status: 404 })
      // LI.FI answers with a materially BETTER route, fee-free (no integrator fee split).
      if (url.includes('li.quest/v1/quote')) {
        return new Response(JSON.stringify({
          tool: 'test-dex',
          estimate: { toAmount: '1000000000000000000', toAmountMin: '995000000000000000', approvalAddress: '0x4444444444444444444444444444444444444444', feeCosts: [], gasCosts: [] },
          transactionRequest: { to: '0x3333333333333333333333333333333333333333', data: '0x5678', value: '0' },
          includedSteps: [],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('rango.exchange')) return new Response(JSON.stringify({ error: 'no route' }), { status: 200 })
      return new Response('{}', { status: 200 })
    }) as typeof fetch

    setSwapFetch(async (input, init) => worker.fetch(new Request(input, init), ENV, { waitUntil: () => {} }))
  })

  afterAll(() => {
    globalThis.fetch = realFetch
    setSwapFetch((input, init) => realFetch(input, init))
  })

  it('selects the LI.FI route even though the trio (0x) already returned something', async () => {
    // Under the old staged logic, 0x's weaker route would have won outright
    // (or lost only to another trio member) because LI.FI was never consulted
    // once the trio produced ANY usable, fee-free result.
    const res = await getSwapQuote(request, CONFIG)
    expect(res.quote?.provider).toBe('lifi')
    expect(res.quote?.buyAmountRaw).toBe('1000000000000000000')
  })
})

// ── Imported networks: quoting by numeric id, not the wallet's string name ──

describe('handleQuote — an IMPORTED network quotes via its RPC-verified numeric id', () => {
  // Linea (59144): documented for 0x (see DOCUMENTED_CHAINS in swap-chains.js)
  // but NOT one of the wallet's built-in EVM_CHAIN_IDS entries — exactly the
  // shape of a real import: a chain 0x actually routes, reached only by the
  // numeric id, never by a wallet chain-id STRING no per-provider map knows.
  const IMPORTED_CHAIN_ID = 59144
  const importedRequest = {
    ...request,
    fromChain: 'custom-1' as unknown as Parameters<typeof getSwapQuote>[0]['fromChain'],
    toChain: 'custom-1' as unknown as Parameters<typeof getSwapQuote>[0]['toChain'],
    fromChainId: IMPORTED_CHAIN_ID,
    toChainId: IMPORTED_CHAIN_ID,
  }

  beforeEach(() => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('api.0x.org')) {
        // Proves the numeric id actually reached 0x: chainId=59144 in the URL.
        if (!url.includes('chainId=59144')) return new Response('{}', { status: 400 })
        return new Response(JSON.stringify({
          liquidityAvailable: true, buyAmount: '1000000000000000000', sellAmount: request.sellAmountRaw,
          transaction: { to: '0x3333333333333333333333333333333333333333', data: '0x1234', gas: '200000' },
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch
    setSwapFetch(async (input, init) => worker.fetch(new Request(input, init), ENV, { waitUntil: () => {} }))
  })

  afterAll(() => {
    globalThis.fetch = realFetch
    setSwapFetch((input, init) => realFetch(input, init))
  })

  it('reaches the provider by numeric id, then declines to OFFER it because it cannot be signed', async () => {
    // Without fromChainId the string 'custom-1' matches nothing in any
    // per-provider map and 0x would never be asked. With it, 0x IS asked for
    // chain 59144 and answers. The wallet then runs its signing gate at quote
    // time: an import has no matrix entry, so it cannot be signed yet, and the
    // quote is withheld with that reason — rather than shown and then refused
    // at "Swap", which is what a user used to hit.
    const res = await getSwapQuote(importedRequest, CONFIG)
    const asked = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map(c => String(c[0])).filter(u => u.includes('api.0x.org'))
    expect(asked.some(u => u.includes('chainId=59144'))).toBe(true)
    expect(res.quote).toBeNull()
    expect(res.error).toMatch(/0x: Swaps are not enabled on custom-1/i)
  })

  it('still refuses cleanly (no route) for an unrecognized chain with NO numeric id given', async () => {
    const { fromChainId, toChainId, ...withoutIds } = importedRequest
    void fromChainId; void toChainId
    const res = await getSwapQuote(withoutIds, CONFIG)
    expect(res.quote).toBeNull()
  })
})
