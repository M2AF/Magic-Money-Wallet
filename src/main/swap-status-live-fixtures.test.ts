import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
// The Worker is plain JS with no type declarations; imported untyped, as in
// swap-fee-policy.test.ts, because running its real handler is the point.
// @ts-expect-error -- untyped Worker entry, exercised end to end
import worker from '../../cloudflare-worker/swap-proxy.js'
import { getCrossSwapStatus, setSwapFetch } from './swap-proxy'
import type { WalletConfig } from './secure-store'

/**
 * RECORDED LIVE responses, through the REAL Worker and the REAL client mapper.
 *
 * The fixtures in src/shared/__fixtures__/lifi-status were fetched on
 * 2026-09-20 from GET https://li.quest/v1/status for historical transfers that
 * actually ended DONE/PARTIAL and DONE/REFUNDED (found via LI.FI's public
 * transfer analytics). They are provider output, not hand-written examples, so
 * this is the first evidence that the whole chain —
 *
 *     li.quest/v1/status  ->  Worker lifiStatus  ->  client getCrossSwapStatus
 *                                                ->  mapProviderStatus
 *
 * — reports a real partial delivery or refund as one. Before these existed the
 * PARTIAL/REFUNDED mapping was fixture-tested only against documented
 * vocabulary.
 *
 * Only the network edge is stubbed: the Worker's upstream `fetch` returns the
 * recorded body, and the client's `swapFetch` is pointed at the Worker's own
 * `fetch` handler instead of the internet. Everything between runs unmodified.
 *
 * Third-party wallet addresses were stripped from the recordings; nothing the
 * Worker reads was changed.
 */

const DIR = join(__dirname, '..', 'shared', '__fixtures__', 'lifi-status')

interface Recorded {
  status: string
  substatus: string
  sending: { txHash: string; chainId: number; token: { address: string; symbol: string } }
  receiving: { txHash: string; chainId: number; amount: string; token: { address: string; symbol: string; decimals: number } }
  quote: { action: { toChainId: number; toToken: { address: string; symbol: string } } }
}

const fixtures = readdirSync(DIR)
  .filter(f => f.endsWith('.json'))
  .map(f => ({ name: f, body: JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Recorded }))

const ENV = { ALLOW_INSECURE_DEV: 'true' }
const CONFIG = { swapProxyUrl: 'https://worker.test', clientToken: '' } as unknown as WalletConfig

let upstream: Recorded | null = null
const realFetch = globalThis.fetch

beforeAll(() => {
  // The Worker's upstream call to li.quest returns the recording.
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (!url.startsWith('https://li.quest/v1/status')) throw new Error(`unexpected upstream ${url}`)
    return new Response(JSON.stringify(upstream), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  // The client's call to the Worker is served by the Worker's own handler.
  setSwapFetch((input, init) =>
    worker.fetch(new Request(input, init), ENV, { waitUntil: () => {} }))
})

afterAll(() => {
  globalThis.fetch = realFetch
  setSwapFetch((input, init) => realFetch(input, init))
})

async function run(body: Recorded) {
  upstream = body
  return getCrossSwapStatus({
    provider: 'lifi',
    txHash: body.sending.txHash,
    fromChain: 'ethereum',
    toChain: 'base',
    // What the user ASKED for, straight from the provider's own record.
    expectedToTokenAddress: body.quote.action.toToken.address,
  }, CONFIG)
}

describe('recorded live LI.FI outcomes, end to end', () => {
  it('has recordings of both outcomes to test against', () => {
    expect(fixtures.some(f => f.body.substatus === 'PARTIAL')).toBe(true)
    expect(fixtures.some(f => f.body.substatus === 'REFUNDED')).toBe(true)
  })

  for (const { name, body } of fixtures) {
    it(`${name}: ${body.status}/${body.substatus} is reported as itself, never as success`, async () => {
      const r = await run(body)
      expect(r.state).toBe(body.substatus === 'PARTIAL' ? 'partial' : 'refunded')
      expect(r.state).not.toBe('completed')
      // The legacy coarse field still says "done" — which is exactly why the UI
      // must read `state`, not `status`.
      expect(r.status).toBe('done')
    })

    it(`${name}: names the asset that ACTUALLY arrived, on the chain it arrived on`, async () => {
      const r = await run(body)
      expect(r.delivered?.symbol).toBe(body.receiving.token.symbol)
      expect(r.delivered?.address).toBe(body.receiving.token.address)
      expect(r.delivered?.amountRaw).toBe(body.receiving.amount)
      expect(r.delivered?.chain).toBe(String(body.receiving.chainId))
    })
  }

  it('PARTIAL delivers the intermediate asset on the DESTINATION chain', () => {
    // Measured, not assumed: every recorded PARTIAL landed on the chain the user
    // was swapping TO, as a token they did not ask for. Recovering the intended
    // token therefore needs another swap on the destination chain.
    for (const { body } of fixtures.filter(f => f.body.substatus === 'PARTIAL')) {
      expect(body.receiving.chainId).toBe(body.quote.action.toChainId)
      expect(body.receiving.token.address.toLowerCase())
        .not.toBe(body.quote.action.toToken.address.toLowerCase())
    }
  })

  it('REFUNDED returns the SOURCE token on the SOURCE chain', () => {
    for (const { body } of fixtures.filter(f => f.body.substatus === 'REFUNDED')) {
      expect(body.receiving.chainId).toBe(body.sending.chainId)
      expect(body.receiving.token.address.toLowerCase()).toBe(body.sending.token.address.toLowerCase())
    }
  })
})
