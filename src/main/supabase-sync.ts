/**
 * supabase-sync.ts — MagicMoney Wallet
 *
 * Syncs wallet addresses to the shared ChainLens Supabase database.
 * Uses the service key in the main process (never exposed to renderer).
 *
 * Tables used:
 *   cl_users          — identity record (provider + provider_id unique)
 *   cl_wallets        — wallet addresses linked to a user
 *   cl_linked_accounts — OAuth social accounts linked to a user
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { WalletConfig } from './secure-store'

// Stub transport — satisfies RealtimeClient's constructor check so it doesn't
// throw "Node.js 20 detected without native WebSocket support".
// We only use Supabase REST (PostgREST), never realtime subscriptions,
// so this stub is never actually instantiated.
class _NoopWS {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  close() {}
  send() {}
  addEventListener() {}
  removeEventListener() {}
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

// ── Client singleton ──────────────────────────────────────────────────────────

let _client: SupabaseClient | null = null

function getClient(config: WalletConfig): SupabaseClient {
  if (!_client) {
    _client = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: false },
      realtime: { transport: _NoopWS as unknown as typeof WebSocket }
    })
  }
  return _client
}

// ── Core operations ───────────────────────────────────────────────────────────

/** Find a ChainLens profile by EVM wallet address */
export async function getProfileByAddress(
  evmAddress: string,
  config: WalletConfig
): Promise<ClUser | null> {
  try {
    const db = getClient(config)
    // Look up the cl_wallets entry for this EVM address
    const { data: walletRow } = await db
      .from('cl_wallets')
      .select('user_id')
      .eq('address', evmAddress.toLowerCase())
      .eq('chain', 'evm')
      .single()

    if (!walletRow?.user_id) return null

    const { data: user } = await db
      .from('cl_users')
      .select('*, cl_wallets(*), cl_linked_accounts(*)')
      .eq('id', walletRow.user_id)
      .single()

    return user as ClUser | null
  } catch {
    return null
  }
}

/** Upsert a user record keyed by EVM address, then link all wallet addresses */
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
  try {
    const db = getClient(config)
    const evmLower = addresses.evm.toLowerCase()
    const shortAddr = `${evmLower.slice(0, 6)}…${evmLower.slice(-4)}`

    // 1. Upsert the identity record (EVM address as provider_id)
    const { data: user, error: upsertErr } = await db
      .from('cl_users')
      .upsert(
        {
          provider:      'evm_wallet',
          provider_id:   evmLower,
          display_name:  shortAddr,
          avatar_url:    null,
          email:         null
        },
        { onConflict: 'provider,provider_id' }
      )
      .select()
      .single()

    if (upsertErr || !user) {
      return { success: false, profile: null, error: upsertErr?.message ?? 'upsert failed' }
    }

    // 2. Link all wallet addresses
    const walletRows = [
      { chain: 'evm',      address: evmLower,                             watch_only: false },
      addresses.solana   ? { chain: 'solana',   address: addresses.solana,   watch_only: false } : null,
      addresses.cardano  ? { chain: 'cardano',  address: addresses.cardano,  watch_only: false } : null,
      addresses.bitcoin  ? { chain: 'bitcoin',  address: addresses.bitcoin,  watch_only: false } : null,
      addresses.polkadot ? { chain: 'polkadot', address: addresses.polkadot, watch_only: false } : null,
    ].filter(Boolean).map(w => ({
      ...w!,
      user_id:     user.id,
      verified_at: new Date().toISOString()
    }))

    await db
      .from('cl_wallets')
      .upsert(walletRows, { onConflict: 'user_id,address' })

    // 3. Re-fetch full profile with joined tables
    const { data: profile } = await db
      .from('cl_users')
      .select('*, cl_wallets(*), cl_linked_accounts(*)')
      .eq('id', user.id)
      .single()

    return { success: true, profile: profile as ClUser, error: null }
  } catch (e) {
    return { success: false, profile: null, error: String(e) }
  }
}

/** Update display name or avatar for the current user */
export async function updateProfile(
  userId: string,
  updates: { display_name?: string; avatar_url?: string },
  config: WalletConfig
): Promise<{ success: boolean; error: string | null }> {
  try {
    const db = getClient(config)
    const { error } = await db
      .from('cl_users')
      .update(updates)
      .eq('id', userId)
    return { success: !error, error: error?.message ?? null }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}
