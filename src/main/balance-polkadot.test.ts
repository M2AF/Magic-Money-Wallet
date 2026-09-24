/**
 * DOT moved from the relay chain to Polkadot Asset Hub (November 2025). The
 * wallet's balance reads both and sums them; reading only the relay chain showed
 * a migrated balance as 0. One side unreadable = unavailable, never understated.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const api = vi.hoisted(() => ({ tatumFetch: vi.fn(), canTatum: vi.fn(() => true) }))
vi.mock('./api-proxy', async (orig) => ({ ...(await orig<typeof import('./api-proxy')>()), ...api }))

import { fetchPolkadotNative, dotFreePlanck, POLKADOT_ASSET_HUB_RPC } from './balance-fetcher'

const DOT = '1dhUhWA8DZEbT5GmjXTJBuafJGWtS5YH13Wqz46KtFdDyoS'

/** A SCALE AccountInfo (80 bytes) holding `planck` free. */
function accountInfo(planck: bigint): string {
  const b = Buffer.alloc(80)
  b.writeUInt32LE(3, 0)
  b.writeBigUInt64LE(planck & 0xffffffffffffffffn, 16)
  b.writeBigUInt64LE(planck >> 64n, 24)
  return '0x' + b.toString('hex')
}
const rpc = (result: string | null, status = 200) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status })

let hub: () => Response
beforeEach(() => {
  api.tatumFetch.mockReset()
  hub = () => rpc(null)
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === POLKADOT_ASSET_HUB_RPC) return hub()
    throw new Error(`unexpected ${url}`)
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('Polkadot balance: relay chain + Asset Hub', () => {
  it('a balance that migrated to Asset Hub is shown, not 0', async () => {
    api.tatumFetch.mockResolvedValue(rpc(null))
    hub = () => rpc(accountInfo(52_500_000_000n))     // 5.25 DOT on Asset Hub only
    expect(await fetchPolkadotNative(DOT, {} as never)).toEqual({ native: 5.25, tokenCount: 0, error: null })
  })

  it('sums what remains on the relay chain with Asset Hub', async () => {
    api.tatumFetch.mockResolvedValue(rpc(accountInfo(10_000_000_000n)))
    hub = () => rpc(accountInfo(20_000_000_000n))
    expect((await fetchPolkadotNative(DOT, {} as never)).native).toBe(3)
  })

  it('both empty is a real zero', async () => {
    api.tatumFetch.mockResolvedValue(rpc(null))
    expect(await fetchPolkadotNative(DOT, {} as never)).toEqual({ native: 0, tokenCount: 0, error: null })
  })

  it('Asset Hub unreadable: unavailable, not the relay balance alone', async () => {
    api.tatumFetch.mockResolvedValue(rpc(accountInfo(10_000_000_000n)))
    hub = () => rpc(null, 503)
    expect(await fetchPolkadotNative(DOT, {} as never)).toMatchObject({ native: 0, error: 'Asset Hub RPC 503' })
  })

  it('reads the same System.Account key on both chains', async () => {
    api.tatumFetch.mockResolvedValue(rpc(null))
    await fetchPolkadotNative(DOT, {} as never)
    const relayKey = api.tatumFetch.mock.calls[0][1].params[0]
    const hubCall = (fetch as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[0]
    expect(JSON.parse(hubCall[1].body).params[0]).toBe(relayKey)
    expect(relayKey.startsWith('0x26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9')).toBe(true)
  })

  it('decodes free balances above 2^64 planck', () => {
    expect(dotFreePlanck(accountInfo(2n ** 70n + 5n))).toBe(2n ** 70n + 5n)
    expect(dotFreePlanck('0x')).toBe(0n)
  })
})
