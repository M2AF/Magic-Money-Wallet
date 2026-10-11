import { describe, it, expect, vi } from 'vitest'
import { createWorkerReadCache, READ_TTL_MS } from './worker-read-cache'

const W = 'https://magicmoney-swap-proxy.guildfordking.workers.dev'
const rpc = (method: string, params: unknown[] = [], id = 1) =>
  ({ method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) })

function setup() {
  let t = 1_000_000
  const calls: string[] = []
  const inner = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push(url)
    let id: unknown = 1
    try { id = JSON.parse(String(init?.body)).id } catch { /* GET */ }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: `r${calls.length}` }), { status: 200 })
  })
  const cache = createWorkerReadCache(inner as unknown as typeof fetch, () => t)
  return { cache, inner, calls, advance: (ms: number) => { t += ms } }
}

describe('worker-read-cache', () => {
  it('reuses a whitelisted read within the TTL and refetches after it', async () => {
    const { cache, inner, advance } = setup()
    const a = await (await cache.fetch(`${W}/rpc/alchemy/eth-mainnet`, rpc('eth_getBalance', ['0xabc', 'latest']))).json()
    const b = await (await cache.fetch(`${W}/rpc/alchemy/eth-mainnet`, rpc('eth_getBalance', ['0xabc', 'latest']))).json()
    expect(inner).toHaveBeenCalledTimes(1)
    expect(b.result).toBe(a.result)
    advance(READ_TTL_MS + 1)
    await cache.fetch(`${W}/rpc/alchemy/eth-mainnet`, rpc('eth_getBalance', ['0xabc', 'latest']))
    expect(inner).toHaveBeenCalledTimes(2)
  })

  it('answers a cached JSON-RPC read with the new caller\'s id', async () => {
    const { cache } = setup()
    await cache.fetch(`${W}/rpc/alchemy/eth-mainnet`, rpc('eth_getBalance', ['0xabc'], 7))
    const second = await (await cache.fetch(`${W}/rpc/alchemy/eth-mainnet`, rpc('eth_getBalance', ['0xabc'], 42))).json()
    expect(second.id).toBe(42)
  })

  it('shares one network call between identical concurrent requests', async () => {
    const { cache, inner } = setup()
    await Promise.all(Array.from({ length: 16 }, () => cache.fetch(`${W}/alchemy-data/assets/tokens`, { method: 'POST', body: '{"a":1}' })))
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it.each(['eth_getTransactionCount', 'eth_call', 'eth_estimateGas', 'eth_getTransactionReceipt', 'eth_blockNumber'])(
    'never caches %s (swap read-after-write needs it fresh)', async (m) => {
      const { cache, inner } = setup()
      await cache.fetch(`${W}/rpc/alchemy/base-mainnet`, rpc(m, ['0xabc']))
      await cache.fetch(`${W}/rpc/alchemy/base-mainnet`, rpc(m, ['0xabc']))
      expect(inner).toHaveBeenCalledTimes(2)
    })

  it('does not cache a batch that mixes a cacheable and a non-cacheable method', async () => {
    const { cache, inner } = setup()
    const body = JSON.stringify([{ id: 1, method: 'eth_getBalance', params: [] }, { id: 2, method: 'eth_getTransactionCount', params: [] }])
    await cache.fetch(`${W}/rpc/alchemy/eth-mainnet`, { method: 'POST', body })
    await cache.fetch(`${W}/rpc/alchemy/eth-mainnet`, { method: 'POST', body })
    expect(inner).toHaveBeenCalledTimes(2)
  })

  it('a send clears every cached read', async () => {
    const { cache, inner } = setup()
    await cache.fetch(`${W}/rpc/alchemy/eth-mainnet`, rpc('eth_getBalance', ['0xabc']))
    await cache.fetch(`${W}/rpc/alchemy/eth-mainnet`, rpc('eth_sendRawTransaction', ['0xsigned']))
    await cache.fetch(`${W}/rpc/alchemy/eth-mainnet`, rpc('eth_getBalance', ['0xabc']))
    expect(inner).toHaveBeenCalledTimes(3)
  })

  it.each(['/quote?fromChain=base', '/swap/status?id=1', '/ss/estimate', '/cn/exchange', '/profile/themes', '/sync'])(
    'passes %s straight through', async (path) => {
      const { cache, inner } = setup()
      await cache.fetch(`${W}${path}`)
      await cache.fetch(`${W}${path}`)
      expect(inner).toHaveBeenCalledTimes(2)
    })

  it('caches TRON account reads, passes tx building through, and clears on broadcast', async () => {
    const { cache, inner } = setup()
    const tron = (path: string) => cache.fetch(`${W}/rpc/alchemy-tron/wallet/${path}`, { method: 'POST', body: '{"address":"T1"}' })
    await tron('getaccount'); await tron('getaccount')
    expect(inner).toHaveBeenCalledTimes(1)
    await tron('createtransaction'); await tron('createtransaction')
    expect(inner).toHaveBeenCalledTimes(3)
    await tron('broadcasttransaction')
    await tron('getaccount')
    expect(inner).toHaveBeenCalledTimes(5)
  })

  it('fronts the custom domain as well as the legacy host', async () => {
    const { cache, inner } = setup()
    await cache.fetch('https://api.magicmoney.dev/rpc/alchemy/eth-mainnet', rpc('eth_getBalance', ['0xabc']))
    await cache.fetch('https://api.magicmoney.dev/rpc/alchemy/eth-mainnet', rpc('eth_getBalance', ['0xabc']))
    expect(inner).toHaveBeenCalledTimes(1)
  })

  it('ignores hosts other than the Worker', async () => {
    const { cache, inner } = setup()
    await cache.fetch('https://api.coingecko.com/api/v3/ping')
    await cache.fetch('https://api.coingecko.com/api/v3/ping')
    expect(inner).toHaveBeenCalledTimes(2)
  })

  it('does not keep failures or JSON-RPC error bodies', async () => {
    let n = 0
    const inner = vi.fn(async () => {
      n++
      return n === 1 ? new Response('busy', { status: 503 })
        : n === 2 ? new Response(JSON.stringify({ id: 1, error: { code: -32000, message: 'x' } }), { status: 200 })
        : new Response(JSON.stringify({ id: 1, result: '0x1' }), { status: 200 })
    })
    const cache = createWorkerReadCache(inner as unknown as typeof fetch)
    for (let i = 0; i < 3; i++) await cache.fetch(`${W}/rpc/alchemy/eth-mainnet`, rpc('eth_getBalance', ['0xabc']))
    expect(inner).toHaveBeenCalledTimes(3)
    await cache.fetch(`${W}/rpc/alchemy/eth-mainnet`, rpc('eth_getBalance', ['0xabc']))
    expect(inner).toHaveBeenCalledTimes(3)
  })

  it('a caller\'s abort rejects that caller without cancelling the shared call', async () => {
    let release!: () => void
    const inner = vi.fn(() => new Promise<Response>(r => { release = () => r(new Response('{"data":[]}', { status: 200 })) }))
    const cache = createWorkerReadCache(inner as unknown as typeof fetch)
    const ac = new AbortController()
    const aborted = cache.fetch(`${W}/moralis/0xabc/nft`, { signal: ac.signal })
    const other = cache.fetch(`${W}/moralis/0xabc/nft`)
    ac.abort()
    await expect(aborted).rejects.toBeTruthy()
    release()
    expect((await other).status).toBe(200)
    expect(inner).toHaveBeenCalledTimes(1)
  })
})
