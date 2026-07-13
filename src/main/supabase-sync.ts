/**
 * supabase-sync.ts — MagicMoney Wallet
 *
 * Syncs wallet addresses to the shared ChainLens Supabase database VIA THE WORKER.
 *
 * SECURITY: the Supabase service-role key is no longer in the client — it lives
 * only as a Worker secret. This module calls the Worker's /profile, /sync and
 * /profile/update routes (which inject the key server-side). Sync is proxy-only:
 * without a configured proxy it degrades to a no-op rather than shipping a key.
 *
 * Tables (server-side, via the Worker): cl_users, cl_wallets, cl_linked_accounts.
 */

import type { WalletConfig } from './secure-store'
import { proxyBase, proxyHeaders, proxyUrl } from './api-proxy'
import { loadMnemonic, loadAddresses } from './secure-store'
import { getEvmPrivateKey } from './wallet-core'
import { privateKeyToAccount } from 'viem/accounts'

// Canonical ownership message — MUST byte-match the Worker (cloudflare-worker/auth.js).
function ownershipMessage(action: 'sync' | 'profile-update', addressLower: string, ts: number): string {
  return `MagicMoney Wallet ownership\naction:${action}\naddress:${addressLower}\nts:${ts}`
}

// Sign an EIP-191 ownership proof with the current account's EVM key. The Worker
// recovers the signer and checks it matches the claimed address, so only the key
// owner can write to a profile. Returns null if the wallet can't be read.
// NOTE: store reads are awaited even though Electron's secure-store is sync —
// the Capacitor build aliases './secure-store' to its async Preferences store,
// and `await` normalizes both (awaiting a plain value is a no-op).
async function signOwnership(
  action: 'sync' | 'profile-update', evmAddress: string
): Promise<{ ts: number; signature: string } | null> {
  try {
    const idx = (await loadAddresses())?.accountIndex ?? 0
    const account = privateKeyToAccount(await getEvmPrivateKey(await loadMnemonic(), idx))
    const ts = Date.now()
    const signature = await account.signMessage({ message: ownershipMessage(action, evmAddress.toLowerCase(), ts) })
    return { ts, signature }
  } catch {
    return null
  }
}

// ── Types matching the ChainLens schema ───────────────────────────────────────

export interface ClWallet {
  id: string
  user_id: string
  chain: string
  address: string
  watch_only: boolean
  verified_at: string | null
  is_primary: boolean | null
  label: string | null
}

export interface ClLinkedAccount {
  id: string
  user_id: string
  provider: string
  provider_id: string
  display_name: string | null
  avatar_url: string | null
  email: string | null
}

export interface ClUser {
  id: string
  provider: string
  provider_id: string
  display_name: string | null
  avatar_url: string | null
  email: string | null
  created_at: string | null
  cl_wallets: ClWallet[]
  cl_linked_accounts: ClLinkedAccount[]
}

export interface SyncResult {
  success: boolean
  profile: ClUser | null
  error: string | null
}

// ── Core operations (all routed through the Worker) ───────────────────────────

/** Find a ChainLens profile by EVM wallet address. Returns null when sync is off. */
export async function getProfileByAddress(
  evmAddress: string,
  config: WalletConfig
): Promise<ClUser | null> {
  const base = proxyBase(config)
  if (!base) return null
  try {
    const res = await fetch(proxyUrl(`${base}/profile?address=${encodeURIComponent(evmAddress.toLowerCase())}`, config), {
      headers: proxyHeaders(config, { accept: 'application/json' }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    return await res.json() as ClUser | null
  } catch {
    return null
  }
}

/** Upsert a user record keyed by EVM address, then link all wallet addresses. */
export async function syncWallets(
  addresses: {
    evm: string
    solana?: string | null
    cardano?: string | null
    bitcoin?: string | null
    polkadot?: string | null
  },
  config: WalletConfig
): Promise<SyncResult> {
  const base = proxyBase(config)
  if (!base) return { success: false, profile: null, error: 'Profile sync not configured.' }
  const sig = await signOwnership('sync', addresses.evm)
  if (!sig) return { success: false, profile: null, error: 'Could not sign ownership proof.' }
  try {
    const res = await fetch(proxyUrl(`${base}/sync`, config), {
      method: 'POST',
      headers: proxyHeaders(config, { 'content-type': 'application/json' }),
      body: JSON.stringify({ ...addresses, ts: sig.ts, signature: sig.signature }),
      signal: AbortSignal.timeout(12_000),
    })
    const data = await res.json().catch(() => null) as SyncResult | null
    if (!res.ok || !data) return { success: false, profile: null, error: (data && data.error) || `Sync ${res.status}` }
    return data
  } catch (e) {
    return { success: false, profile: null, error: String(e) }
  }
}

/** Update display name or avatar for the current user. */
export async function updateProfile(
  userId: string,
  updates: { display_name?: string; avatar_url?: string },
  config: WalletConfig
): Promise<{ success: boolean; error: string | null }> {
  const base = proxyBase(config)
  if (!base) return { success: false, error: 'Profile sync not configured.' }
  const evm = (await loadAddresses())?.evm
  if (!evm) return { success: false, error: 'No wallet address.' }
  const sig = await signOwnership('profile-update', evm)
  if (!sig) return { success: false, error: 'Could not sign ownership proof.' }
  try {
    const res = await fetch(proxyUrl(`${base}/profile/update`, config), {
      method: 'POST',
      headers: proxyHeaders(config, { 'content-type': 'application/json' }),
      body: JSON.stringify({ userId, address: evm.toLowerCase(), ts: sig.ts, signature: sig.signature, ...updates }),
      signal: AbortSignal.timeout(10_000),
    })
    const data = await res.json().catch(() => null) as { success?: boolean; error?: string | null } | null
    if (!res.ok || !data) return { success: false, error: (data && data.error) || `Update ${res.status}` }
    return { success: !!data.success, error: data.error ?? null }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}
