/**
 * Regression: a throttled `alchemy_getTokenMetadata` must not blank the token list.
 *
 * The failure this pins down was live in production: once the shared Alchemy key
 * hit its monthly capacity, the metadata batch answered HTTP 200 with a per-entry
 * JSON-RPC `error` instead of a `result`. Every token then fell back to symbol
 * '???' and was dropped by the caller's filter, so the wallet showed "No tokens
 * found across all chains" — even though alchemy-cache.ts had just served good
 * balances from its own last-known-good disk cache, and even though the user's
 * holdings were unchanged.
 *
 * Two guarantees are asserted here:
 *   1. With metadata already cached (the normal case for a returning user), a
 *      throttled batch changes nothing — the list still renders.
 *   2. With nothing cached, the tokens genuinely cannot be named, but the result
 *      REPORTS the failure instead of presenting an empty wallet as the truth.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WalletConfig } from './secure-store'

let metaDisk: Record<string, { name: string; symbol: string; decimals: number; logo: string | null; at: number }> = {}
const saveTokenMetaCache = vi.fn((m: Record<string, never>) => { metaDisk = m })

vi.mock('./secure-store', () => ({
  loadFloorCache: vi.fn(async () => ({})),
  saveFloorCache: vi.fn(),
  loadTokenBalanceCache: vi.fn(async () => ({})),
  saveTokenBalanceCache: vi.fn(),
  loadTokenMetaCache: vi.fn(async () => metaDisk),
  saveTokenMetaCache: (m: Record<string, never>) => saveTokenMetaCache(m),
}))

vi.mock('./native-prices', () => ({
  getNativeUsd: vi.fn(async (ids: string[]) => Object.fromEntries(ids.map(id => [id, 1]))),
}))

import { fetchAllTokens } from './token-fetcher'

const config: WalletConfig = {
  alchemyKey: '', ankrKey: '', heliusKey: '', blockfrostKey: '', tatumKey: '',
  moralisKey: '', openseaKey: '', ordiscanKey: '', anvilKey: '',
  supabaseUrl: '', supabaseKey: '', walletConnectProjectId: '',
  swapProxyUrl: 'https://proxy.example', clientToken: 'test-client',
  simpleSwapApiKey: '', testnetMode: true, privacyMode: false,
  torBrowserEnabled: false, torBrowserPort: 9050, moneroRestoreHeight: 0,
  magicGuardEnabled: true, customChains: [], customTokens: [], customNfts: [],
}

const TOKEN = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
// Ethereum in Testnet Mode. A distinct address per test defeats the 10s
// in-memory coalescing cache in alchemy-cache.ts.
const NETWORK = 'eth-sepolia'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** The exact shape a spent Alchemy capacity budget returns: HTTP 200, per-entry error. */
const CAPACITY_ERROR = { code: 429, message: 'Monthly capacity limit exceeded.' }

interface Opts { metadata: 'throttled' | 'live' }

function stubFetch({ metadata }: Opts) {
  const metaCalls: string[][] = []
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)

    // Balances: only Ethereum holds anything.
    if (url.includes('/alchemy-data/assets/tokens/by-address')) {
      const body = JSON.parse(String(init?.body)) as { addresses: Array<{ networks: string[] }> }
      return body.addresses[0].networks[0] === NETWORK
        ? json({ data: { tokens: [{ tokenAddress: TOKEN, tokenBalance: '0x05' }] } })
        : json({ data: { tokens: [] } })
    }

    if (url.includes(`/rpc/alchemy/${NETWORK}`)) {
      const reqs = JSON.parse(String(init?.body)) as Array<{ id: number; params: [string] }>
      metaCalls.push(reqs.map(r => r.params[0]))
      if (metadata === 'throttled') {
        return json(reqs.map(r => ({ jsonrpc: '2.0', id: r.id, error: CAPACITY_ERROR })))
      }
      return json(reqs.map(r => ({
        jsonrpc: '2.0', id: r.id,
        result: { name: 'Live Token', symbol: 'LIVE', decimals: 2, logo: null },
      })))
    }

    throw new Error(`Unexpected request: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return metaCalls
}

beforeEach(() => {
  metaDisk = {}
  saveTokenMetaCache.mockClear()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('throttled token metadata', () => {
  it('still renders held tokens from the metadata cache', async () => {
    metaDisk = {
      [`${NETWORK}:${TOKEN}`]: { name: 'Cached Token', symbol: 'CACHE', decimals: 2, logo: null, at: Date.now() },
    }
    stubFetch({ metadata: 'throttled' })

    const result = await fetchAllTokens({ evm: '0x1111111111111111111111111111111111111111' }, config)

    expect(result.tokens).toEqual([
      expect.objectContaining({ contractAddress: TOKEN, symbol: 'CACHE', name: 'Cached Token', balance: '0.05000' }),
    ])
    // Nothing was lost, so nothing is reported.
    expect(result.error).toBeNull()
    expect(result.chainErrors).toBeUndefined()
  })

  it('reports the failure instead of presenting an empty wallet as the truth', async () => {
    stubFetch({ metadata: 'throttled' })

    const result = await fetchAllTokens({ evm: '0x2222222222222222222222222222222222222222' }, config)

    // Unnameable tokens still cannot be rendered — but the UI must be told why,
    // rather than falling through to "No tokens found across all chains".
    expect(result.tokens).toEqual([])
    expect(result.error).toBe('1 network unavailable')
    expect(result.chainErrors?.ethereum).toContain('Monthly capacity limit exceeded')
  })

  it('caches resolved metadata so the lookup is never repeated', async () => {
    const metaCalls = stubFetch({ metadata: 'live' })

    const result = await fetchAllTokens({ evm: '0x3333333333333333333333333333333333333333' }, config)

    expect(result.tokens).toEqual([
      expect.objectContaining({ contractAddress: TOKEN, symbol: 'LIVE', balance: '0.05000' }),
    ])
    expect(metaCalls).toEqual([[TOKEN]])
    expect(saveTokenMetaCache).toHaveBeenCalled()
    expect(metaDisk[`${NETWORK}:${TOKEN}`]).toMatchObject({ symbol: 'LIVE', decimals: 2 })

    // Second pass on a fresh address: the contract is known, so no metadata call.
    const again = stubFetch({ metadata: 'live' })
    const result2 = await fetchAllTokens({ evm: '0x4444444444444444444444444444444444444444' }, config)
    expect(result2.tokens).toEqual([
      expect.objectContaining({ contractAddress: TOKEN, symbol: 'LIVE' }),
    ])
    expect(again).toEqual([])
  })
})
