/**
 * asset-filter-sync-stub.ts — No-op for browser extension context.
 *
 * Pairs with supabase-sync-stub.ts: ChainLens profile sync is not available in
 * the extension, and the real module reaches the wallet key through it to sign
 * an ownership proof. Aliased in vite.extension.config.ts so neither module ends
 * up in the extension bundle.
 *
 * `null` entries means "could not read", NOT "nothing hidden" — the dashboard
 * keeps its local list on null, so hiding still works here, it just stays on
 * this install.
 */

import type { AssetFilterEntries } from '../../shared/asset-filter-key'

export interface AssetFilterPushResult {
  entries: AssetFilterEntries | null
  error: string | null
}

export async function fetchAssetFilters(): Promise<AssetFilterEntries | null> {
  return null
}

export async function pushAssetFilters(): Promise<AssetFilterPushResult> {
  return { entries: null, error: 'ChainLens sync not available in extension' }
}