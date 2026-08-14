/**
 * asset-filter-sync.ts — MagicMoney Wallet
 *
 * Carries the "assets I've hidden" list on the ChainLens profile, so the answer
 * follows the user instead of the install: hide a scam airdrop on the desktop
 * and it is already hidden on the phone, on a reinstall, and on the ChainLens
 * website — which keeps the same list under the same keys (see
 * ../shared/asset-filter-key.ts, the wire contract both products implement).
 *
 * Shape mirrors supabase-sync.ts exactly: proxy-only (no Supabase key in the
 * client), EIP-191 ownership proof per write, best-effort on every failure. The
 * list is a convenience, never a security control — a failed sync must leave the
 * wallet showing the local list, not an error.
 *
 * ⚠ THIS WRITE CAN CREATE A CHAINLENS ACCOUNT. Pushing a list needs somewhere to
 * put it, so a push with no profile calls syncWallets() first — the same upsert
 * the Connect button runs. That is a deliberate product decision (hiding an asset
 * enrols you in profile sync), not an accident, and it is why `allowCreate` is an
 * explicit argument: the pull path passes false and stays strictly read-only.
 */

import type { WalletConfig } from './secure-store'
import { proxyBase, proxyHeaders, proxyUrl } from './api-proxy'
import { loadAddresses } from './secure-store'
import { signOwnership, syncWallets } from './supabase-sync'
import {
  sanitizeFilterEntries, mergeFilterEntries, type AssetFilterEntries,
} from '../shared/asset-filter-key'

export interface AssetFilterPushResult {
  /** The server's merged view, or null when the sync could not run. */
  entries: AssetFilterEntries | null
  error: string | null
}

/**
 * The synced list for this wallet's profile, or null when there is nothing to
 * read (sync unconfigured, no profile yet, network down). Null is not an empty
 * list: the caller must keep showing its local list rather than un-hiding
 * everything because a request timed out.
 */
export async function fetchAssetFilters(config: WalletConfig): Promise<AssetFilterEntries | null> {
  const base = proxyBase(config)
  if (!base) return null
  const evm = (await loadAddresses())?.evm
  if (!evm) return null
  try {
    const res = await fetch(
      proxyUrl(`${base}/profile/filters?address=${encodeURIComponent(evm.toLowerCase())}`, config),
      { headers: proxyHeaders(config, { accept: 'application/json' }), signal: AbortSignal.timeout(10_000) },
    )
    if (!res.ok) return null
    const body = await res.json().catch(() => null) as { entries?: unknown } | null
    if (!body) return null
    return sanitizeFilterEntries(body.entries)
  } catch {
    return null
  }
}

/**
 * Push local decisions and return the server's merge of them with whatever the
 * other devices wrote. Callers apply what comes back rather than what they sent,
 * which is how a hide made on another device arrives.
 */
export async function pushAssetFilters(
  entries: AssetFilterEntries,
  config: WalletConfig,
  allowCreate = true,
): Promise<AssetFilterPushResult> {
  const base = proxyBase(config)
  if (!base) return { entries: null, error: 'Profile sync not configured.' }
  const addresses = await loadAddresses()
  if (!addresses?.evm) return { entries: null, error: 'No wallet address.' }

  const clean = sanitizeFilterEntries(entries)
  const first = await postFilters(clean, addresses.evm, base, config)

  // 404 is the Worker saying "this address has no profile". Mint one with the
  // ordinary Connect-button upsert, then push again — once. A second 404 means
  // the create itself failed, and retrying would just loop.
  if (first.status === 404 && allowCreate) {
    const created = await syncWallets(addresses, config)
    if (!created.success) return { entries: null, error: created.error ?? 'Could not create profile.' }
    const second = await postFilters(clean, addresses.evm, base, config)
    return { entries: second.entries, error: second.error }
  }
  return { entries: first.entries, error: first.error }
}

async function postFilters(
  entries: AssetFilterEntries, evm: string, base: string, config: WalletConfig,
): Promise<AssetFilterPushResult & { status: number }> {
  const sig = await signOwnership('filters-update', evm)
  if (!sig) return { entries: null, error: 'Could not sign ownership proof.', status: 0 }
  try {
    const res = await fetch(proxyUrl(`${base}/profile/filters`, config), {
      method: 'POST',
      headers: proxyHeaders(config, { 'content-type': 'application/json' }),
      body: JSON.stringify({ address: evm.toLowerCase(), ts: sig.ts, signature: sig.signature, entries }),
      signal: AbortSignal.timeout(12_000),
    })
    const body = await res.json().catch(() => null) as { entries?: unknown; error?: string | null } | null
    if (!res.ok) return { entries: null, error: body?.error ?? `Filters ${res.status}`, status: res.status }
    // Merging the reply back over what we sent guarantees the caller never loses
    // a decision it made while the request was in flight.
    return { entries: mergeFilterEntries(entries, sanitizeFilterEntries(body?.entries)), error: null, status: res.status }
  } catch (e) {
    return { entries: null, error: String(e), status: 0 }
  }
}