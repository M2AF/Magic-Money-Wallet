import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WalletConfig } from './secure-store'
vi.mock('./secure-store', () => ({ loadAddresses: async () => ({ evm: '0xother' }) }))
vi.mock('./api-proxy', () => ({ proxyBase: () => 'https://proxy.example', proxyHeaders: () => ({}), proxyUrl: (url: string) => url }))
vi.mock('./supabase-sync', () => ({ signOwnership: vi.fn(), syncWallets: vi.fn() }))
import { fetchAssetFilters, pushAssetFilters } from './asset-filter-sync'
afterEach(() => vi.unstubAllGlobals())
describe('favorites expected account guard', () => {
  it('refuses reads and writes if the account changed before the IPC request executes', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    expect(await fetchAssetFilters({} as WalletConfig, '0xowner')).toBeNull()
    const result = await pushAssetFilters({ 'favorite:mainnet:base:n:0xabc:7': { s: 'f', t: 1 } }, {} as WalletConfig, true, '0xowner')
    expect(result.entries).toBeNull(); expect(result.error).toBe('Wallet account changed.')
    expect(fetch).not.toHaveBeenCalled()
  })
})
