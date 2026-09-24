import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest'
// The Worker is plain JS with no type declarations; imported untyped so its real
// handler runs, as in swap-fee-policy.test.ts.
// @ts-expect-error -- untyped Worker entry, exercised end to end
import worker from '../../cloudflare-worker/swap-proxy.js'
import { getSwapQuote, setSwapFetch } from './swap-proxy'
import type { WalletConfig } from './secure-store'

/**
 * WHAT THE USER ACTUALLY SAW, swapping EMO (Monad) -> PIXL (Ethereum):
 *
 *   rango: Unexpected token '<', "<!DOCTYPE ... is not valid JSON |
 *   swapkit: SwapKit: unsupported chain
 *
 * Two failures in one screen. Rango answered with an HTML error page and the
 * adapter called `res.json()` on it, so the JSON PARSER's complaint became the
 * reason the swap had failed — it named the symptom and hid the cause. And LI.FI,
 * the provider most likely to carry a cross-chain pair, was missing from the list
 * entirely because its failure was only ever written to the console.
 */

const ENV = {
  ALLOW_INSECURE_DEV: 'true',
  RANGO_API_KEY: 'test-key',
  SWAPKIT_API_KEY: 'test-key',
}
const CONFIG = { swapProxyUrl: 'https://worker.test', clientToken: '' } as unknown as WalletConfig

const EMO = '0x81a224f8a62f52bde942dbf23a56df77a10b7777'
const PIXL = '0x427a03fb96d9a94a6727fbcfbba143444090dd64'

const request = {
  fromChain: 'monad', toChain: 'ethereum',
  fromToken: EMO, toToken: PIXL,
  fromSymbol: 'EMO', toSymbol: 'PIXL',
  sellAmountRaw: '1000000000000000000000',
  slippageBps: 250,
  taker: '0x5555555555555555555555555555555555555555',
  toAddress: '0x5555555555555555555555555555555555555555',
} as Parameters<typeof getSwapQuote>[0]

const realFetch = globalThis.fetch
/** An HTML error page, exactly the class of response that produced the bug. */
const HTML_ERROR = '<!DOCTYPE html><html><head><title>503</title></head><body>Service Unavailable</body></html>'

beforeEach(() => {
  // The Worker's UPSTREAM calls. Rango answers HTML; li.quest is unreachable.
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('rango.exchange')) {
      return new Response(HTML_ERROR, { status: 503, headers: { 'content-type': 'text/html' } })
    }
    if (url.includes('li.quest')) throw new Error('Rate limit exceeded, retry in 2 hours')
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

  // The CLIENT's calls: li.quest direct fails, the Worker is served in-process.
  setSwapFetch(async (input, init) => {
    if (String(input).includes('li.quest')) throw new Error('Rate limit exceeded, retry in 2 hours')
    return worker.fetch(new Request(input, init), ENV, { waitUntil: () => {} })
  })
})

afterAll(() => {
  globalThis.fetch = realFetch
  setSwapFetch((input, init) => realFetch(input, init))
})

describe('a failing provider explains itself', () => {
  it('does NOT surface a JSON parser error when a provider answers with HTML', async () => {
    const res = await getSwapQuote(request, CONFIG)
    expect(res.quote).toBeNull()
    expect(res.error).toBeTruthy()
    // The exact string the user was shown.
    expect(res.error).not.toMatch(/Unexpected token/i)
    expect(res.error).not.toMatch(/DOCTYPE/i)
  })

  it('names the provider, the kind of response and the HTTP status', async () => {
    const res = await getSwapQuote(request, CONFIG)
    expect(res.error).toMatch(/Rango returned an HTML error page \(HTTP 503\)/i)
  })

  it('includes LI.FI in the reasons instead of hiding it in the console', async () => {
    // LI.FI is the provider most likely to carry a cross-chain pair; a failure
    // list that omits it tells the user nothing about why the swap is refused.
    const res = await getSwapQuote(request, CONFIG)
    expect(res.error).toMatch(/lifi/i)
    expect(res.error).toMatch(/rate limit/i)
  })

  it('still reports the other providers alongside it', async () => {
    const res = await getSwapQuote(request, CONFIG)
    expect(res.error).toMatch(/swapkit/i)
  })
})
