/**
 * History coverage (measured 2026-09-23 against the real wallet addresses):
 * - alchemy_getAssetTransfers returns OLDEST first unless `order: 'desc'`, and
 *   the old 'external'-only query hid every token transfer (Avalanche, Blast and
 *   Gnosis showed "no transactions" while holding only token activity).
 * - 'internal' is accepted only on eth/polygon/base/arc; Abstract and Monad refuse it.
 * - The Abstract Global Wallet has its own activity under its own address.
 * - Monad: Alchemy 'monad-mainnet' indexes it; Moralis's free plan is paused.
 * - Polkadot: Subscan refuses keyless calls; Statescan (Asset Hub + relay) answers.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const api = vi.hoisted(() => ({
  moralisFetch: vi.fn(),
  canMoralis: vi.fn(() => true),
  alchemyRpcUrl: vi.fn((network: string) => `https://alchemy.test/${network}`),
  heliusApiFetch: vi.fn(),
  blockfrostFetch: vi.fn(),
}))
const chains = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>>, testnet: false }))
vi.mock('./api-proxy', () => api)
vi.mock('./chain-config', () => ({
  DOGE_API_BASE: 'https://doge.invalid',
  activeEvmChains: () => chains.list,
  isTestnet: () => chains.testnet,
}))

import { fetchAllHistory, AGW_HISTORY_KEY, NO_INTERNAL_COVERAGE, POLKADOT_COVERAGE } from './tx-history'
import { historyLabel } from '../shared/history-state'

const EOA = '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13'
const AGW = '0x8a42A0502B862e8CE41FF001e6f32aBCEc460102'
const DOT = '1dhUhWA8DZEbT5GmjXTJBuafJGWtS5YH13Wqz46KtFdDyoS'
const ABSTRACT = { id: 'abstract', nativeSymbol: 'ETH', alchemyNetwork: 'abstract-mainnet', explorerTx: 'https://abscan.org/tx' }
const ETH = { id: 'ethereum', nativeSymbol: 'ETH', alchemyNetwork: 'eth-mainnet', explorerTx: 'https://etherscan.io/tx' }

type Body = { method?: string; params?: Array<Record<string, unknown>> }
const transfer = (over: Record<string, unknown>) => ({
  hash: '0xh', from: EOA.toLowerCase(), to: '0x2222222222222222222222222222222222222222', value: 1, asset: 'ETH',
  category: 'external', metadata: { blockTimestamp: '2026-09-20T00:00:00.000Z' }, ...over,
})

let alchemyCalls: Array<{ url: string; params: Record<string, unknown> }>
let batches: Array<Array<{ id: number; method: string; params: unknown[] }>>
let blockTimestamps: Record<string, string>
let alchemyReply: (url: string, params: Record<string, unknown>) => Response
let otherReply: (url: string) => Response

beforeEach(() => {
  alchemyCalls = []
  batches = []
  blockTimestamps = {}
  chains.list = []
  chains.testnet = false
  api.moralisFetch.mockReset()
  alchemyReply = () => Response.json({ jsonrpc: '2.0', id: 1, result: { transfers: [] } })
  otherReply = () => Response.json({})
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: { body?: string }) => {
    const url = String(input)
    if (url.startsWith('https://alchemy.test/')) {
      const body = JSON.parse(init?.body ?? '{}')
      if (Array.isArray(body)) {
        batches.push(body)
        return Response.json(body.map((r: { id: number; params: [string] }) => ({
          jsonrpc: '2.0', id: r.id, result: blockTimestamps[r.params[0]] ? { timestamp: blockTimestamps[r.params[0]] } : null,
        })))
      }
      const params = (JSON.parse(init?.body ?? '{}') as Body).params?.[0] ?? {}
      alchemyCalls.push({ url, params })
      return alchemyReply(url, params)
    }
    return otherReply(url)
  }))
})
afterEach(() => vi.unstubAllGlobals())

const run = (extra: Record<string, string> = {}) =>
  fetchAllHistory({ evm: EOA, solana: '', cardano: null, ...extra }, {} as never)

describe('Alchemy history', () => {
  it('asks for the NEWEST transfers, including token and NFT transfers', async () => {
    chains.list = [ABSTRACT]
    await run()
    expect(alchemyCalls).toHaveLength(2)
    for (const c of alchemyCalls) {
      expect(c.params.order).toBe('desc')
      expect(c.params.category).toEqual(['external', 'erc20', 'erc721', 'erc1155'])
    }
  })

  it("adds 'internal' only where Alchemy supports it, and names the gap elsewhere", async () => {
    chains.list = [ETH, ABSTRACT]
    const h = await run()
    const eth = alchemyCalls.filter(c => c.url.endsWith('eth-mainnet'))
    const abs = alchemyCalls.filter(c => c.url.endsWith('abstract-mainnet'))
    expect(eth.every(c => (c.params.category as string[]).includes('internal'))).toBe(true)
    expect(abs.some(c => (c.params.category as string[]).includes('internal'))).toBe(false)
    expect(h.ethereum.coverage).toBeNull()
    expect(h.abstract.coverage).toBe(NO_INTERNAL_COVERAGE)
  })

  it('keeps both legs of a swap (same hash, different assets) and a token-only history', async () => {
    chains.list = [ABSTRACT]
    alchemyReply = (_u, p) => Response.json({ result: { transfers: p.fromAddress
      ? [transfer({ asset: 'PENGU', category: 'erc20', value: 3000 })]
      : [transfer({ from: '0x3333333333333333333333333333333333333333', to: EOA.toLowerCase(), asset: 'ETH', value: 0.01, category: 'internal' })],
    } })
    const h = await run()
    expect(h.abstract.error).toBeNull()
    expect(h.abstract.records.map(r => `${r.direction}:${r.symbol}:${r.amount}`)).toEqual(['out:PENGU:3000.000000', 'in:ETH:0.010000'])
  })

  it('a proxy refusal or JSON-RPC error is "unavailable", never an empty history', async () => {
    chains.list = [ABSTRACT]
    alchemyReply = () => Response.json({ error: 'Unknown network: abstract-mainnet' }, { status: 400 })
    expect((await run()).abstract).toMatchObject({ records: [], error: 'Alchemy 400: Unknown network: abstract-mainnet' })
    alchemyReply = () => Response.json({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'capacity' } })
    expect((await run()).abstract.error).toBe('Alchemy 200: capacity')
  })
})

describe('Alchemy history: scam airdrops and missing timestamps', () => {
  it('hides phishing-named token transfers and says how many', async () => {
    chains.list = [ABSTRACT]
    alchemyReply = (_u, p) => Response.json({ result: { transfers: p.toAddress ? [
      transfer({ hash: '0xs1', to: EOA.toLowerCase(), asset: '$ CLAIM ON: [ airstake.lol ]', category: 'erc20' }),
      transfer({ hash: '0xs2', to: EOA.toLowerCase(), asset: 'ecAVAX - https://newinvest.live/', category: 'erc20' }),
      transfer({ hash: '0xok', to: EOA.toLowerCase(), asset: 'USDC', category: 'erc20', value: 5 }),
    ] : [] } })
    const h = await run()
    expect(h.abstract.records.map(r => r.hash)).toEqual(['0xok'])
    expect(h.abstract.coverage).toBe(`${NO_INTERNAL_COVERAGE} 2 suspected scam-token transfers hidden.`)
  })

  it('never filters the native coin, whatever the asset label', async () => {
    chains.list = [ETH]
    alchemyReply = (_u, p) => Response.json({ result: { transfers: p.fromAddress ? [transfer({ asset: 'ETH', category: 'external' })] : [] } })
    expect((await run()).ethereum.records).toHaveLength(1)
  })

  it('orders by block and fills block times Alchemy left out, in one batch', async () => {
    chains.list = [ABSTRACT]
    blockTimestamps = { '0x10': '0x68d0c000' }
    alchemyReply = (_u, p) => Response.json({ result: { transfers: p.fromAddress
      ? [transfer({ hash: '0xold', blockNum: '0x5', metadata: { blockTimestamp: '2025-01-01T00:00:00.000Z' } })]
      : [transfer({ hash: '0xnew', blockNum: '0x10', to: EOA.toLowerCase(), from: '0x4444444444444444444444444444444444444444', metadata: null })] } })
    const h = await run()
    expect(h.abstract.records.map(r => r.hash)).toEqual(['0xnew', '0xold'])
    expect(h.abstract.records[0].timestamp).toBe(0x68d0c000 * 1000)
    expect(batches).toHaveLength(1)
    expect(batches[0].map(b => b.params[0])).toEqual(['0x10'])
  })

  it('a block time that cannot be read leaves the row undated, not the list unavailable', async () => {
    chains.list = [ABSTRACT]
    alchemyReply = (_u, p) => Response.json({ result: { transfers: p.fromAddress ? [transfer({ blockNum: '0x9', metadata: null })] : [] } })
    const h = await run()
    expect(h.abstract.error).toBeNull()
    expect(h.abstract.records[0].timestamp).toBe(0)
  })
})

describe('Abstract Global Wallet history', () => {
  it('is read under the AGW address and kept apart from the regular Abstract account', async () => {
    chains.list = [ABSTRACT]
    alchemyReply = (_u, p) => Response.json({ result: { transfers:
      (p.fromAddress === AGW) ? [transfer({ hash: '0xagw', from: AGW.toLowerCase() })] : [],
    } })
    const h = await run({ agw: AGW })
    const addrs = alchemyCalls.map(c => (c.params.fromAddress ?? c.params.toAddress) as string)
    expect(addrs.filter(a => a === AGW)).toHaveLength(2)
    expect(addrs.filter(a => a === EOA)).toHaveLength(2)
    expect(h[AGW_HISTORY_KEY].records.map(r => r.hash)).toEqual(['0xagw'])
    expect(h.abstract.records).toEqual([])
    expect(h[AGW_HISTORY_KEY].coverage).toBe(NO_INTERNAL_COVERAGE)
  })

  it('no AGW entry when there is no AGW, or it is the EOA itself', async () => {
    chains.list = [ABSTRACT]
    expect(AGW_HISTORY_KEY in (await run())).toBe(false)
    expect(AGW_HISTORY_KEY in (await run({ agw: EOA.toLowerCase() }))).toBe(false)
  })
})

describe('Monad history', () => {
  const MONAD = { id: 'monad', nativeSymbol: 'MON', explorerTx: 'https://monadexplorer.com/tx' }

  it('reads Alchemy monad-mainnet first', async () => {
    chains.list = [MONAD]
    alchemyReply = () => Response.json({ result: { transfers: [transfer({ asset: 'MON', value: 55 })] } })
    const h = await run()
    expect(alchemyCalls[0].url).toBe('https://alchemy.test/monad-mainnet')
    expect(h.monad.records[0]).toMatchObject({ symbol: 'MON', amount: '55.000000', explorerUrl: 'https://monadexplorer.com/tx/0xh' })
    expect(api.moralisFetch).not.toHaveBeenCalled()
  })

  it('reports both providers when neither answers', async () => {
    chains.list = [MONAD]
    alchemyReply = () => Response.json({ error: 'Unknown network: monad-mainnet' }, { status: 400 })
    api.moralisFetch.mockResolvedValue(new Response('{"message":"paused"}', { status: 401 }))
    expect((await run()).monad).toMatchObject({ records: [], error: 'Alchemy 400: Unknown network: monad-mainnet; Moralis 401' })
  })
})

describe('HyperEVM history', () => {
  const HYPER = { id: 'hyperevm', nativeSymbol: 'HYPE', explorerTx: 'https://purrsec.com/tx', blockscoutUrl: 'https://purrsec.com' }

  it('reads Alchemy hyperliquid-mainnet', async () => {
    chains.list = [HYPER]
    const h = await run()
    expect(alchemyCalls.map(c => c.url)).toEqual(['https://alchemy.test/hyperliquid-mainnet', 'https://alchemy.test/hyperliquid-mainnet'])
    expect(h.hyperevm).toMatchObject({ records: [], error: null })
  })

  it("when Alchemy is refused, the explorer's HTML 404 is NOT read as no activity", async () => {
    chains.list = [HYPER]
    alchemyReply = () => Response.json({ error: 'Unknown network: hyperliquid-mainnet' }, { status: 400 })
    otherReply = () => new Response('<!DOCTYPE html><title>Page not found</title>', { status: 404, headers: { 'content-type': 'text/html' } })
    expect((await run()).hyperevm).toMatchObject({
      records: [], error: 'Alchemy 400: Unknown network: hyperliquid-mainnet; Explorer has no transaction-history API (404)',
    })
  })

  it("a Blockscout JSON 404 (address never seen) is no activity", async () => {
    chains.list = [HYPER]
    alchemyReply = () => Response.json({ error: 'Unknown network: hyperliquid-mainnet' }, { status: 400 })
    otherReply = () => Response.json({ message: 'Not found' }, { status: 404 })
    expect((await run()).hyperevm).toMatchObject({ records: [], error: null })
  })
})

describe('Polkadot history (Statescan)', () => {
  const item = (over: Record<string, unknown>) => ({
    indexer: { blockHeight: 100, blockTime: 1_790_000_000_000, eventIndex: 3, extrinsicIndex: 2 },
    from: DOT, to: '13BU2y7W5iKxKkVzLGjQGtZxuo6K3zh5pD156Q6SojyBdEp7', balance: '25000000000', isNativeAsset: true, ...over,
  })

  it('reads Asset Hub and the relay chain, keyless, and lists DOT only', async () => {
    const urls: string[] = []
    otherReply = (url) => {
      urls.push(url)
      if (url.startsWith('https://ahp-api.statescan.io/')) return Response.json({ items: [item({}), item({ isNativeAsset: false })] })
      if (url.startsWith('https://polkadot-api.statescan.io/')) {
        return Response.json({ items: [item({ from: '14Pw5rBuMf81fPxKABqo2jrfZGMdvytd527fHM2R2vwNx4d8', to: DOT, indexer: { blockHeight: 9, blockTime: 1_700_000_000_000, eventIndex: 1 } })] })
      }
      return Response.json({})
    }
    const h = await run({ polkadot: DOT })
    expect(urls.filter(u => u.includes(`/accounts/${DOT}/transfers`))).toHaveLength(2)
    expect(h.polkadot.error).toBeNull()
    expect(h.polkadot.coverage).toBe(POLKADOT_COVERAGE)
    expect(h.polkadot.records).toEqual([
      expect.objectContaining({ direction: 'out', amount: '2.5000', symbol: 'DOT', explorerUrl: 'https://assethub-polkadot.statescan.io/#/extrinsics/100-2' }),
      expect.objectContaining({ direction: 'in', explorerUrl: 'https://polkadot.statescan.io/#/blocks/9' }),
    ])
  })

  it('an account with no transfers is "no activity"; one source down is "unavailable"', async () => {
    otherReply = () => Response.json({ items: [], page: 0, pageSize: 10, total: 0 })
    expect((await run({ polkadot: DOT })).polkadot).toMatchObject({ records: [], error: null })
    otherReply = (url) => url.startsWith('https://ahp-api') ? new Response('bad gateway', { status: 502 }) : Response.json({ items: [] })
    expect((await run({ polkadot: DOT })).polkadot).toMatchObject({ records: [], error: 'Statescan 502' })
  })
})

describe('unsupported networks', () => {
  it('a network without an indexer is unsupported, not empty', async () => {
    chains.list = [{ id: 'hyperevm-like', nativeSymbol: 'X', explorerTx: '' }]
    expect((await run())['hyperevm-like']).toMatchObject({ records: [], unsupported: true })
  })

  it("a custom network whose explorer serves a web page is unsupported", async () => {
    chains.list = [{ id: 'custom-56', nativeSymbol: 'BNB', explorerTx: 'https://bscscan.com/tx', blockscoutUrl: 'https://bscscan.com' }]
    otherReply = () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'content-type': 'text/html' } })
    expect((await run())['custom-56']).toMatchObject({ records: [], unsupported: true })
  })
})

describe('historyLabel keeps the three outcomes apart', () => {
  it('no activity / provider unavailable / unsupported', () => {
    expect(historyLabel({ records: [], error: null })).toBe('No recent activity')
    expect(historyLabel({ records: [], error: 'Statescan 502' })).toBe('History provider unavailable')
    expect(historyLabel({ records: [], error: 'x', unsupported: true })).toBe('History not available for this network')
  })
})
