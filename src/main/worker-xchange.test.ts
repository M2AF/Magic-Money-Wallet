/**
 * Worker deposit-address exchange routes (/ss/*, /cn/*): validation, per-route
 * rate limits, provider failures, and both real clients end to end — the wallet's
 * simpleswap/changenow clients and the ChainLens backend's exchange-service.
 *
 * Everything upstream is mocked. No live quote, no exchange, no funds.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
// @ts-expect-error -- untyped Worker entry, exercised end to end
import worker from '../../cloudflare-worker/swap-proxy.js'
// @ts-expect-error -- untyped Worker module
import { CREATE_PER_HOUR } from '../../cloudflare-worker/xchange.js'
import { ssEstimate, ssCreateExchange, ssGetStatus } from './simpleswap-client'
import { cnEstimate, cnCreateExchange, cnGetStatus } from './changenow-client'
import type { WalletConfig } from './secure-store'

const WORKER = 'https://worker.test'
const PUBLIC_TAG = 'public-client-tag'
const CONFIG = { swapProxyUrl: WORKER, clientToken: PUBLIC_TAG } as unknown as WalletConfig

const SOL = '3noTuHnQdHkat2w5rBx18vAACMzFUvB5LodEe5vMN98d'
const BTC = 'bc1qt6cx7977r8xttn5rg42d2ulnlc7agspycd600w'
const EVM = '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13'
const DOT = '1dhUhWA8DZEbT5GmjXTJBuafJGWtS5YH13Wqz46KtFdDyoS'

/** Workers Rate Limiting binding stand-in: a fixed count per key. */
class FakeLimiter {
  counts = new Map<string, number>()
  constructor(public max: number) {}
  async limit({ key }: { key: string }) {
    const n = (this.counts.get(key) ?? 0) + 1
    this.counts.set(key, n)
    return { success: n <= this.max }
  }
}
/** KV stand-in for lib.rateLimit (the hourly create cap). */
class FakeKv {
  data = new Map<string, string>()
  async get(key: string, type?: string) {
    const v = this.data.get(key)
    return v == null ? null : type === 'json' ? JSON.parse(v) : v
  }
  async put(key: string, value: string) { this.data.set(key, value) }
}

type Upstream = { url: URL; method: string; headers: Headers; body: unknown }
let upstream: Upstream[]
let providers: Record<string, (u: Upstream) => Response | Promise<Response>>
let env: Record<string, unknown>
let callerIp: string

const ssExchange = { id: 'ss-abc123', status: 'waiting', tickerFrom: 'sol', tickerTo: 'btc', networkFrom: 'sol', networkTo: 'btc',
  amountFrom: '2', amountTo: '0.0026', addressFrom: SOL, addressTo: BTC, extraIdFrom: null, type: 'floating', validUntil: null }

function defaultProviders(): typeof providers {
  return {
    'GET api.simpleswap.io/v3/estimates': () => Response.json({ result: { estimatedAmount: '0.0026', rateId: null, validUntil: null } }),
    'GET api.simpleswap.io/v3/ranges': () => Response.json({ result: { min: '0.04', max: null } }),
    'POST api.simpleswap.io/v3/exchanges': () => Response.json({ result: ssExchange }),
    'GET api.simpleswap.io/v3/exchanges/ss-abc123': () => Response.json({ result: { ...ssExchange, status: 'confirming' } }),
    'GET api.changenow.io/v2/exchange/estimated-amount': () => Response.json({ toAmount: 0.0082, rateId: null, validUntil: null }),
    'GET api.changenow.io/v2/exchange/range': () => Response.json({ minAmount: 0.29, maxAmount: null }),
    'POST api.changenow.io/v2/exchange': () => Response.json({ id: 'cn0123456789ab', status: 'new', payinAddress: DOT, payoutAddress: EVM, fromAmount: 20, toAmount: 0.0082, payinExtraId: null }),
    'GET api.changenow.io/v2/exchange/by-id': () => Response.json({ id: 'cn0123456789ab', status: 'exchanging', payinAddress: DOT, payoutAddress: EVM, amountFrom: 20, amountTo: 0.0082 }),
  }
}

beforeEach(() => {
  upstream = []
  callerIp = '203.0.113.7'
  providers = defaultProviders()
  env = {
    ALLOW_INSECURE_DEV: 'true',
    SIMPLESWAP_API_KEY: 'ss-secret',
    CHANGENOW_API_KEY: 'cn-secret',
    XCHANGE_QUOTE_LIMITER: new FakeLimiter(300),
    XCHANGE_STATUS_LIMITER: new FakeLimiter(300),
    XCHANGE_CREATE_LIMITER: new FakeLimiter(20),
    XCHANGE_CREATE_GLOBAL_LIMITER: new FakeLimiter(120),
    XCHANGE_LIST_LIMITER: new FakeLimiter(30),
    SWAP_QUOTE_LIMITER: new FakeLimiter(300),
    SWAP_STATUS_LIMITER: new FakeLimiter(600),
  }
  // One fetch for everything: Worker-bound requests run the real Worker in
  // process (as the given caller IP); provider-bound requests hit the mocks.
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    if (url.origin === WORKER) {
      const headers = new Headers(req.headers)
      headers.set('CF-Connecting-IP', callerIp)
      return worker.fetch(new Request(req, { headers }), env, { waitUntil: () => {} })
    }
    const text = req.method === 'POST' ? await req.text() : ''
    const call = { url, method: req.method, headers: req.headers, body: text ? JSON.parse(text) : null }
    upstream.push(call)
    const handler = providers[`${req.method} ${url.host}${url.pathname}`]
    return handler ? handler(call) : new Response('{"error":"unmocked"}', { status: 404 })
  }))
})
afterEach(() => vi.unstubAllGlobals())

/** A direct call to the Worker, as any internet client could make it. */
const direct = (path: string, init?: RequestInit) => fetch(`${WORKER}${path}`, init)
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  direct(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })

const ssPair = 'from=sol&fromNet=sol&to=btc&toNet=btc'
const cnPair = 'fromCurrency=dot&toCurrency=eth&fromNetwork=assethub&toNetwork=eth'
const ssCreate = { fixed: false, tickerFrom: 'sol', networkFrom: 'sol', tickerTo: 'btc', networkTo: 'btc', amount: '2', reverse: false,
  addressTo: BTC, extraIdTo: '', userRefundAddress: SOL, userRefundExtraId: '', rateId: null }

describe('wallet client flow through the Worker', () => {
  it('SimpleSwap: estimate → create → status, key added server-side and only known fields forwarded', async () => {
    const est = await ssEstimate({ tickerFrom: 'sol', networkFrom: 'sol', tickerTo: 'btc', networkTo: 'btc', amount: '2', fixed: false }, CONFIG)
    expect(est).toMatchObject({ estimatedAmount: '0.0026', min: '0.04', error: null })

    const ex = await ssCreateExchange({ tickerFrom: 'sol', networkFrom: 'sol', tickerTo: 'btc', networkTo: 'btc', amount: '2', fixed: false,
      addressTo: BTC, userRefundAddress: SOL }, CONFIG)
    expect(ex).toMatchObject({ id: 'ss-abc123', addressFrom: SOL, error: null })

    const st = await ssGetStatus('ss-abc123', CONFIG)
    expect(st.status).toBe('confirming')

    for (const call of upstream) {
      expect(call.headers.get('x-api-key')).toBe('ss-secret')
      expect(call.headers.get('x-mm-client')).toBeNull()          // the public tag never leaves the Worker
      expect(call.url.searchParams.has('mm_client')).toBe(false)
    }
    const estimate = upstream.find(c => c.url.pathname === '/v3/estimates')!
    expect(Object.fromEntries(estimate.url.searchParams)).toEqual({
      tickerFrom: 'sol', networkFrom: 'sol', tickerTo: 'btc', networkTo: 'btc', amount: '2', fixed: 'false', reverse: 'false',
    })
    expect(upstream.find(c => c.method === 'POST')!.body).toEqual({ ...ssCreate })
  })

  it('ChangeNOW fallback (DOT on Asset Hub): estimate → create → status', async () => {
    const params = { tickerFrom: 'dot', networkFrom: 'dot', tickerTo: 'eth', networkTo: 'eth', amount: '20', fixed: false }
    const est = await cnEstimate(params, CONFIG)
    expect(est).toMatchObject({ estimatedAmount: '0.0082', min: '0.29', error: null })
    const ex = await cnCreateExchange({ ...params, addressTo: EVM, userRefundAddress: DOT }, CONFIG)
    expect(ex).toMatchObject({ id: 'cn0123456789ab', status: 'waiting', addressFrom: DOT, error: null })
    expect((await cnGetStatus('cn0123456789ab', CONFIG)).status).toBe('exchanging')

    const estimate = upstream.find(c => c.url.pathname === '/v2/exchange/estimated-amount')!
    expect(estimate.headers.get('x-changenow-api-key')).toBe('cn-secret')
    expect(estimate.url.searchParams.get('fromNetwork')).toBe('assethub')
    expect(upstream.find(c => c.method === 'POST')!.body).toMatchObject({ fromNetwork: 'assethub', address: EVM, refundAddress: DOT, flow: 'standard', type: 'direct' })
  })
})

// The ChainLens backend lives in the sibling repository. When that checkout is
// present, run its real exchange-service against this Worker.
const chainlensService = resolve(__dirname, '../../../chainlens/exchange-service.js')
describe.skipIf(!existsSync(chainlensService))('ChainLens backend flow through the Worker', () => {
  it('quote → create → status, from one shared server IP', async () => {
    const { createExchangeService } = createRequire(__filename)(chainlensService)
    const service = createExchangeService({ workerUrl: WORKER, clientToken: '' })
    const quote = await service.quote({ from: 'sol:sol', to: 'btc:btc', amount: '2', fixed: false })
    expect(quote).toMatchObject({ provider: 'simpleswap', estimatedAmount: '0.0026', min: '0.04' })
    const order = await service.create({ quoteId: quote.quoteId, addressTo: BTC, userRefundAddress: SOL })
    expect(order).toMatchObject({ id: 'ss-abc123', addressFrom: SOL })
    expect((await service.status('simpleswap', 'ss-abc123')).status).toBe('confirming')
    // ChainLens's create body carries only the fields the Worker forwards.
    expect(upstream.find(c => c.method === 'POST')!.body).toEqual({ ...ssCreate })
  })

  it('ChangeNOW fallback from ChainLens when SimpleSwap cannot price a pair', async () => {
    providers['GET api.simpleswap.io/v3/estimates'] = () => Response.json({ description: 'Pair is not available' }, { status: 422 })
    const { createExchangeService } = createRequire(__filename)(chainlensService)
    const service = createExchangeService({ workerUrl: WORKER })
    const quote = await service.quote({ from: 'dot:dot', to: 'eth:eth', amount: '20', fixed: false })
    expect(quote.provider).toBe('changenow')
    const order = await service.create({ quoteId: quote.quoteId, addressTo: EVM })
    expect(order).toMatchObject({ id: 'cn0123456789ab', status: 'waiting' })
    expect((await service.status('changenow', 'cn0123456789ab')).status).toBe('exchanging')
  })
})

describe('direct Worker calls: validation', () => {
  it('works without the public tag or an Origin — neither is authentication — but is still validated', async () => {
    const r = await direct(`/ss/estimate?${ssPair}&amount=2&fixed=false`)
    expect(r.status).toBe(200)
    const bad = await direct(`/ss/estimate?${ssPair}&amount=abc`)
    expect(bad.status).toBe(400)
  })

  it.each([
    ['empty status id (would have reached the list endpoint)', '/ss/status/'],
    ['nested status path', '/ss/status/abc/def'],
    ['encoded traversal in a status id', '/cn/status/..%2F..%2Fexchange'],
    ['bad ticker', `/ss/estimate?from=sol!&fromNet=sol&to=btc&toNet=btc&amount=1`],
    ['zero amount', `/ss/estimate?${ssPair}&amount=0`],
    ['negative amount', `/ss/estimate?${ssPair}&amount=-1`],
    ['missing network', `/ss/ranges?from=sol&to=btc&toNet=btc`],
    ['non-boolean fixed', `/ss/ranges?${ssPair}&fixed=maybe`],
    ['unknown ChangeNOW flow', `/cn/range?${cnPair}&flow=everything`],
    ['reverse ChangeNOW type', `/cn/estimate?${cnPair}&fromAmount=1&type=reverse`],
  ])('rejects %s with 400 and no provider call', async (_name, path) => {
    const r = await direct(path)
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBeTruthy()
    expect(upstream).toHaveLength(0)
  })

  it('drops parameters and body fields the clients do not use', async () => {
    await direct(`/cn/estimate?${cnPair}&fromAmount=1&userId=someone-else&api_key=x`)
    const q = upstream[0].url.searchParams
    expect(q.has('userId')).toBe(false)
    expect(q.has('api_key')).toBe(false)
    await post('/ss/exchange', { ...ssCreate, partnerId: 'x', extraFee: '5' })
    expect(Object.keys(upstream[1].body as object).sort()).toEqual(Object.keys(ssCreate).sort())
  })

  it.each([
    ['non-JSON body', 'not json'],
    ['array body', '[]'],
    ['missing destination', JSON.stringify({ ...ssCreate, addressTo: '' })],
    ['whitespace in destination', JSON.stringify({ ...ssCreate, addressTo: 'bc1 q' })],
    ['reverse exchange', JSON.stringify({ ...ssCreate, reverse: true })],
    ['non-string memo', JSON.stringify({ ...ssCreate, extraIdTo: { $ne: '' } })],
  ])('rejects a create with %s', async (_name, body) => {
    const r = await post('/ss/exchange', body)
    expect(r.status).toBe(400)
    expect(upstream).toHaveLength(0)
  })

  it('rejects oversized requests with 413 or 400', async () => {
    const big = JSON.stringify({ ...ssCreate, userRefundExtraId: 'x'.repeat(5000) })
    expect((await post('/ss/exchange', big)).status).toBe(413)
    const declared = await post('/cn/exchange', '{}', { 'content-length': '999999' })
    expect(declared.status).toBe(413)
    const longAddress = await post('/ss/exchange', { ...ssCreate, addressTo: 'b'.repeat(151) })
    expect(longAddress.status).toBe(400)
    const longMemo = await post('/ss/exchange', { ...ssCreate, extraIdTo: 'm'.repeat(101) })
    expect(longMemo.status).toBe(400)
    expect(upstream).toHaveLength(0)
  })

  it('wrong method is 405 and unknown routes are 404', async () => {
    const r = await direct('/ss/exchange')
    expect(r.status).toBe(405)
    expect(r.headers.get('Allow')).toBe('POST')
    expect((await post('/ss/estimate', {})).status).toBe(405)
    expect((await direct('/ss/anything')).status).toBe(404)
  })
})

describe('rate limits', () => {
  it('429 with Retry-After once a caller exhausts the quote class; no provider call', async () => {
    env.XCHANGE_QUOTE_LIMITER = new FakeLimiter(2)
    for (let i = 0; i < 2; i++) expect((await direct(`/ss/ranges?${ssPair}`)).status).toBe(200)
    const r = await direct(`/cn/range?${cnPair}`)                  // same class, other provider
    expect(r.status).toBe(429)
    expect(r.headers.get('Retry-After')).toBe('60')
    expect((await r.json()).error).toMatch(/Too many/)
    expect(upstream).toHaveLength(2)
  })

  it('classes are independent and limits are per caller IP', async () => {
    env.XCHANGE_QUOTE_LIMITER = new FakeLimiter(1)
    await direct(`/ss/ranges?${ssPair}`)
    expect((await direct(`/ss/ranges?${ssPair}`)).status).toBe(429)
    expect((await direct('/ss/status/ss-abc123')).status).toBe(200)  // status has its own budget
    callerIp = '198.51.100.9'
    expect((await direct(`/ss/ranges?${ssPair}`)).status).toBe(200)  // another caller is unaffected
  })

  it('malformed requests count against the limit too', async () => {
    env.XCHANGE_QUOTE_LIMITER = new FakeLimiter(2)
    await direct('/ss/estimate?amount=junk')
    await direct('/ss/estimate?amount=junk')
    expect((await direct(`/ss/estimate?${ssPair}&amount=1`)).status).toBe(429)
  })

  it('creation: per-IP per-minute, then a location-wide cap across callers', async () => {
    env.XCHANGE_CREATE_LIMITER = new FakeLimiter(2)
    env.XCHANGE_CREATE_GLOBAL_LIMITER = new FakeLimiter(3)
    expect((await post('/ss/exchange', ssCreate)).status).toBe(200)
    expect((await post('/ss/exchange', ssCreate)).status).toBe(200)
    expect((await post('/ss/exchange', ssCreate)).status).toBe(429)   // this IP's minute
    callerIp = '198.51.100.9'
    expect((await post('/ss/exchange', ssCreate)).status).toBe(200)
    callerIp = '192.0.2.44'
    const r = await post('/ss/exchange', ssCreate)                    // the location's minute
    expect(r.status).toBe(429)
    expect((await r.json()).error).toMatch(/busy/)
    expect(upstream.filter(c => c.method === 'POST')).toHaveLength(3)
  })

  it(`creation: at most ${CREATE_PER_HOUR} per IP per hour`, async () => {
    env.CACHE = new FakeKv()
    env.XCHANGE_CREATE_LIMITER = new FakeLimiter(Infinity)
    env.XCHANGE_CREATE_GLOBAL_LIMITER = new FakeLimiter(Infinity)
    providers['POST api.simpleswap.io/v3/exchanges'] = () => Response.json({ result: ssExchange })
    let last = 0
    for (let i = 0; i < CREATE_PER_HOUR; i++) last = (await post('/ss/exchange', ssCreate)).status
    expect(last).toBe(429)
    expect(upstream.filter(c => c.method === 'POST').length).toBe(CREATE_PER_HOUR - 1)
  })

  it('DEX /quote and /swap/status are metered per IP as well', async () => {
    env.SWAP_QUOTE_LIMITER = new FakeLimiter(1)
    env.SWAP_STATUS_LIMITER = new FakeLimiter(1)
    expect((await direct('/quote?chain=base')).status).toBe(400)       // allowed: fails on its own validation
    expect((await direct('/quote?chain=base')).status).toBe(429)
    expect((await direct('/swap/status')).status).toBe(400)
    expect((await direct('/swap/status')).status).toBe(429)
  })

  it('a missing limiter binding fails open rather than taking the exchange down', async () => {
    for (const k of Object.keys(env)) if (k.endsWith('_LIMITER')) delete env[k]
    expect((await direct(`/ss/ranges?${ssPair}`)).status).toBe(200)
  })
})

describe('provider failures', () => {
  it('an unreachable provider is a 502 JSON error; a create says the order may exist', async () => {
    providers['GET api.simpleswap.io/v3/estimates'] = () => { throw new TypeError('fetch failed') }
    const est = await direct(`/ss/estimate?${ssPair}&amount=2`)
    expect(est.status).toBe(502)
    expect((await est.json()).error).toMatch(/SimpleSwap is unavailable/)

    providers['POST api.changenow.io/v2/exchange'] = () => { throw new DOMException('timed out', 'TimeoutError') }
    const cr = await post('/cn/exchange', { fromCurrency: 'dot', toCurrency: 'eth', fromNetwork: 'assethub', toNetwork: 'eth', fromAmount: '20', address: EVM })
    expect(cr.status).toBe(502)
    expect((await cr.json()).error).toMatch(/may or may not have been created/)
  })

  it('a provider refusal keeps its status and message, and the wallet shows that message', async () => {
    providers['POST api.simpleswap.io/v3/exchanges'] = () => Response.json({ description: 'Amount is less than minimal' }, { status: 422 })
    const r = await post('/ss/exchange', ssCreate)
    expect(r.status).toBe(422)
    const ex = await ssCreateExchange({ tickerFrom: 'sol', networkFrom: 'sol', tickerTo: 'btc', networkTo: 'btc', amount: '0.001', fixed: false, addressTo: BTC }, CONFIG)
    expect(ex.error).toBe('Amount is less than minimal')
  })

  it('a missing provider key is a 503, not a crash', async () => {
    delete env.CHANGENOW_API_KEY
    const r = await direct(`/cn/range?${cnPair}`)
    expect(r.status).toBe(503)
    expect(upstream).toHaveLength(0)
  })
})
