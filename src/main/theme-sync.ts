/**
 * theme-sync.ts — MagicMoney Wallet
 *
 * Carries the user's custom themes on their ChainLens profile, so a theme they
 * built follows them instead of the install: make one on the desktop and it is
 * already in the picker on the phone, and it survives a reinstall.
 *
 * Shape mirrors asset-filter-sync.ts exactly, deliberately: proxy-only (no
 * Supabase key in the client), EIP-191 ownership proof per write, best-effort on
 * every failure. A theme list is a convenience, never a security control — a
 * failed sync must leave the wallet showing the local themes, not an error, and
 * must never look like "you have no themes".
 *
 * ⚠ THIS WRITE CAN CREATE A CHAINLENS ACCOUNT, for the same reason and by the
 * same route as hidden-asset sync: pushing a list needs somewhere to put it, so
 * a push with no profile calls syncWallets() first. `allowCreate` is an explicit
 * argument so the pull path stays strictly read-only.
 */

import type { WalletConfig } from './secure-store'
import { proxyBase, proxyHeaders, proxyUrl } from './api-proxy'
import { loadAddresses } from './secure-store'
import { signOwnership, syncWallets } from './supabase-sync'
import { sanitizeThemeEntries, mergeThemeEntries, type ThemeEntries } from '../shared/theme-sync-wire'

export interface ThemePushResult {
  /** The server's merged view, or null when the sync could not run. */
  entries: ThemeEntries | null
  error: string | null
}

/**
 * The synced themes for this wallet's profile, or null when there is nothing to
 * read (sync unconfigured, no profile yet, network down). Null is NOT an empty
 * map: the caller keeps its local themes rather than emptying the picker
 * because a request timed out.
 */
export async function fetchCustomThemes(config: WalletConfig): Promise<ThemeEntries | null> {
  const base = proxyBase(config)
  if (!base) return null
  const evm = (await loadAddresses())?.evm
  if (!evm) return null
  try {
    const res = await fetch(
      proxyUrl(`${base}/profile/themes?address=${encodeURIComponent(evm.toLowerCase())}`, config),
      { headers: proxyHeaders(config, { accept: 'application/json' }), signal: AbortSignal.timeout(10_000) },
    )
    if (!res.ok) return null
    const body = await res.json().catch(() => null) as
      { entries?: unknown; unavailable?: boolean } | null
    if (!body) return null
    // The Worker says `unavailable` when the cl_themes table itself could not be
    // read (the SQL has not been run). That is NOT an empty profile: returning
    // {} here would report a healthy sync that silently stores nothing.
    if (body.unavailable) return null
    return sanitizeThemeEntries(body.entries)
  } catch {
    return null
  }
}

/**
 * Push local themes and return the server's merge of them with whatever the
 * other devices wrote. Callers apply what comes back rather than what they sent,
 * which is how a theme made on another device arrives.
 */
export async function pushCustomThemes(
  entries: ThemeEntries,
  config: WalletConfig,
  allowCreate = true,
): Promise<ThemePushResult> {
  const base = proxyBase(config)
  if (!base) return { entries: null, error: 'Profile sync not configured.' }
  const addresses = await loadAddresses()
  if (!addresses?.evm) return { entries: null, error: 'No wallet address.' }

  const clean = sanitizeThemeEntries(entries)
  const first = await postThemes(clean, addresses.evm, base, config)

  // A 404 saying "No profile" is the handler asking us to mint one with the
  // ordinary Connect-button upsert and push again — once; a second one means the
  // create itself failed, and retrying would just loop.
  //
  // ⚠ The BODY has to be checked, not just the status. A Worker that has not had
  // this route deployed yet answers the very same 404 from its router, with
  // `{"error":"Not found"}` — measured against the live Worker on 2026-08-23,
  // where /profile/filters returned 200 and /profile/themes returned 404. Acting
  // on the status alone made every theme save fire a /sync account upsert into
  // production to fix a "missing profile" that was never missing.
  if (first.status === 404 && first.error === 'No profile' && allowCreate) {
    const created = await syncWallets(addresses, config)
    if (!created.success) return { entries: null, error: created.error ?? 'Could not create profile.' }
    const second = await postThemes(clean, addresses.evm, base, config)
    return { entries: second.entries, error: second.error }
  }
  return { entries: first.entries, error: first.error }
}

async function postThemes(
  entries: ThemeEntries, evm: string, base: string, config: WalletConfig,
): Promise<ThemePushResult & { status: number }> {
  const sig = await signOwnership('themes-update', evm)
  if (!sig) return { entries: null, error: 'Could not sign ownership proof.', status: 0 }
  try {
    const res = await fetch(proxyUrl(`${base}/profile/themes`, config), {
      method: 'POST',
      headers: proxyHeaders(config, { 'content-type': 'application/json' }),
      body: JSON.stringify({ address: evm.toLowerCase(), ts: sig.ts, signature: sig.signature, entries }),
      signal: AbortSignal.timeout(12_000),
    })
    const body = await res.json().catch(() => null) as { entries?: unknown; error?: string | null } | null
    if (!res.ok) return { entries: null, error: body?.error ?? `Themes ${res.status}`, status: res.status }
    // Merging the reply back over what we sent guarantees the caller never loses
    // an edit it made while the request was in flight.
    return { entries: mergeThemeEntries(entries, sanitizeThemeEntries(body?.entries)), error: null, status: res.status }
  } catch (e) {
    return { entries: null, error: String(e), status: 0 }
  }
}
