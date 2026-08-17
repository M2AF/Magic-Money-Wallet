/**
 * asset-filter-sync-stub.ts — No-op for browser extension context.
 *
 * Aliased in vite.extension.config.ts so the real module stays out of the
 * extension bundle. Turning hidden-asset sync on here is a separate change with
 * its own testing — note that supabase-sync, which it signs its ownership proof
 * through, is no longer stubbed, so nothing structural is in the way any more.
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