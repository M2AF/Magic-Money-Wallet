/**
 * supabase-sync-stub.ts — No-op for browser extension context.
 * The service_role key used by supabase-sync is blocked in browsers.
 * ChainLens profile sync is desktop-only for now.
 */

export async function syncWallets(): Promise<{ success: boolean; profile: null; error: string | null }> {
  return { success: false, profile: null, error: 'ChainLens sync not available in extension' }
}

export async function getProfileByAddress(): Promise<null> {
  return null
}

export async function updateProfile(): Promise<{ success: boolean; error: string | null }> {
  return { success: false, error: 'ChainLens sync not available in extension' }
}
