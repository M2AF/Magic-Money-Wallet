/**
 * Monad history reads Moralis's wallet-history endpoint.
 *
 * Measured 2026-09-22 through the app's proxy: GET /api/v2.2/{address}/history
 * answers "Cannot GET" (the endpoint does not exist), while
 * /api/v2.2/wallets/{address}/history is the real one. Monad history therefore
 * always fell through to the explorer fallback, which answers 307/403.
 *
 * Since 2026-09-23 Alchemy 'monad-mainnet' is read first; Moralis is the
 * fallback when the Alchemy route is refused (tx-history-coverage.test.ts).
 */
import { describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  moralisFetch: vi.fn(),
  canMoralis: vi.fn(() => true),
  alchemyRpcUrl: vi.fn(() => 'https://alchemy.test/monad-mainnet'),
  heliusApiFetch: vi.fn(),
  blockfrostFetch: vi.fn(),
}))
vi.mock('./api-proxy', () => api)
vi.mock('./chain-config', () => ({
  DOGE_API_BASE: 'https://doge.invalid',
  // Only Monad, so nothing else in the orchestrator reaches the network.
  activeEvmChains: () => [{ id: 'monad', name: 'Monad', nativeSymbol: 'MON' }],
  isTestnet: () => false,
}))

import { fetchAllHistory } from './tx-history'

describe('Monad history', () => {
  it('calls /wallets/{address}/history and maps the result', async () => {
    const addr = '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13'
    api.moralisFetch.mockResolvedValue(new Response(JSON.stringify({
      result: [{
        hash: '0xabc', from_address: addr.toLowerCase(), to_address: '0x2222222222222222222222222222222222222222',
        value: '1000000000000000000', block_timestamp: '2026-09-21T00:00:00.000Z',
      }],
    }), { status: 200 }))
    // Alchemy refuses (an older Worker without monad-mainnet); non-EVM fetchers
    // get empty addresses and return without a request.
    vi.stubGlobal('fetch', vi.fn(async (u: string) => String(u).startsWith('https://alchemy.test/')
      ? new Response('{"error":"Unknown network: monad-mainnet"}', { status: 400 })
      : new Response('{}', { status: 200 })))

    const h = await fetchAllHistory({ evm: addr, solana: '', cardano: null }, {} as never)

    const path = String(api.moralisFetch.mock.calls[0][0])
    expect(path.startsWith(`wallets/${addr}/history?`)).toBe(true)
    expect(path).toContain('chain=0x8f')
    expect(h.monad.error).toBeNull()
    expect(h.monad.records[0]).toMatchObject({ hash: '0xabc', direction: 'out', amount: '1.000000', symbol: 'MON' })
    vi.unstubAllGlobals()
  })
})
