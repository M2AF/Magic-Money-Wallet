/**
 * Arc pays gas in native USDC, and the chain ALSO exposes that same balance as
 * a 6-decimal ERC-20 at 0x3600…0000. The native row already carries it, so if
 * the indexer's copy reached the token list the holding would be counted twice
 * in the portfolio total. Real ERC-20s on Arc must still come through.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WalletConfig } from './secure-store'

vi.mock('./secure-store', () => ({
  loadFloorCache: vi.fn(async () => ({})),
  saveFloorCache: vi.fn(),
  loadTokenBalanceCache: vi.fn(async () => ({})),
  saveTokenBalanceCache: vi.fn(),
  loadTokenMetaCache: vi.fn(async () => ({})),
  saveTokenMetaCache: vi.fn(),
}))

vi.mock('./native-prices', () => ({
  getNativeUsd: vi.fn(async (ids: string[]) => Object.fromEntries(ids.map(id => [id, 1]))),
}))

import { fetchAllTokens } from './token-fetcher'
import { ARC_USDC_MIRROR } from './chain-config'

const config: WalletConfig = {
  alchemyKey: '', ankrKey: '', heliusKey: '', blockfrostKey: '', tatumKey: '',
  moralisKey: '', openseaKey: '', ordiscanKey: '', anvilKey: '',
  supabaseUrl: '', supabaseKey: '', walletConnectProjectId: '',
  swapProxyUrl: 'https://proxy.example', clientToken: 'test-client',
  simpleSwapApiKey: '', testnetMode: false, privacyMode: false,
  torBrowserEnabled: false, torBrowserPort: 9050, moneroRestoreHeight: 0,
  magicGuardEnabled: true, customChains: [], customTokens: [], customNfts: [],
}

const OTHER = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('Arc native-USDC mirror', () => {
  it('drops the 0x3600 USDC ERC-20 but keeps other Arc tokens', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname.includes('/alchemy-data/')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { addresses?: Array<{ networks?: string[] }> }
        const onArc = body.addresses?.[0]?.networks?.[0] === 'arc-mainnet'
        return json({ data: { tokens: onArc ? [
          { tokenAddress: ARC_USDC_MIRROR, tokenBalance: '0x' + (5_000_000n).toString(16) },
          { tokenAddress: OTHER,           tokenBalance: '0x' + (10n ** 18n).toString(16) },
        ] : [] } })
      }
      if (url.pathname.includes('/rpc/alchemy/arc-mainnet')) {
        const batch = JSON.parse(String(init?.body ?? '[]')) as Array<{ id: number; params: [string] }>
        return json(batch.map(r => ({
          jsonrpc: '2.0', id: r.id,
          result: r.params[0].toLowerCase() === ARC_USDC_MIRROR
            ? { name: 'USDC', symbol: 'USDC', decimals: 6, logo: null }
            : { name: 'Other', symbol: 'OTH', decimals: 18, logo: null },
        })))
      }
      return json({})
    }))

    const result = await fetchAllTokens({ evm: '0x00000000000000000000000000000000000000a7' }, config)
    const arc = result.tokens.filter(t => t.chain === 'arc')

    expect(arc.map(t => t.contractAddress.toLowerCase())).toEqual([OTHER])
    expect(arc[0]).toEqual(expect.objectContaining({ symbol: 'OTH', nativeSymbol: 'USDC', chainLabel: 'Arc' }))
  }, 30_000)
})
