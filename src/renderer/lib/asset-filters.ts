/**
 * asset-filters.ts — the dashboard's hidden/spam list, backed by the profile.
 *
 * Owns three sets of canonical asset keys (../../shared/asset-filter-key.ts):
 *
 *   hidden   the eye icon
 *   spam     the ban icon
 *   allowed  an explicit restore — which also whitelists a token the H-1 spam
 *            filter auto-flagged, so it stops being re-flagged on every fetch
 *
 * Two storage layers, in this order of authority:
 *
 *   localStorage   per account, written synchronously, ALWAYS the thing the UI
 *                  renders from. Sync is a convenience; a wallet with no network
 *                  must still hide assets, instantly.
 *   ChainLens      the same list on the profile, merged in on load and pushed
 *                  after every change, so the answer follows the user across
 *                  devices, reinstalls, and onto the ChainLens website.
 *
 * ⚠ A FAILED SYNC MUST NEVER UN-HIDE ANYTHING. `null` from the bridge means "no
 * answer" — offline, no profile, sync unconfigured, an old build with no such
 * method — and is deliberately not the same value as an empty list. Treating the
 * two alike would make a dropped request show the user every scam airdrop they
 * had already dismissed.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  entriesToSets, mergeFilterEntries, legacyWalletKeyToCanonical,
  type AssetFilterEntries, type AssetFilterState,
} from '../../shared/asset-filter-key'

/** Debounce before pushing. Hiding five scam tokens in a row is one request. */
const PUSH_DEBOUNCE_MS = 1200

export interface AssetFilters {
  hidden: Set<string>
  spam: Set<string>
  allowed: Set<string>
  hide(key: string): void
  markSpam(key: string): void
  restore(key: string): void
}

// ─── Local persistence ───────────────────────────────────────────────────────

const entriesKey  = (acct: number) => `mmw_filters_${acct}`
const migratedKey = (acct: number) => `mmw_filters_migrated_v1_${acct}`
// Pre-sync stores, read once by the migration below and then left alone.
const legacyKeys  = (acct: number) =>
  [`mmw_hidden_${acct}`, `mmw_spam_${acct}`, `mmw_allowed_${acct}`] as const

function loadEntries(acct: number): AssetFilterEntries {
  try {
    const raw = localStorage.getItem(entriesKey(acct))
    return raw ? migrateLegacy(acct, JSON.parse(raw) as AssetFilterEntries) : migrateLegacy(acct, {})
  } catch {
    return {}
  }
}

function saveEntries(acct: number, entries: AssetFilterEntries) {
  try { localStorage.setItem(entriesKey(acct), JSON.stringify(entries)) } catch { /* quota */ }
}

/**
 * Fold the pre-sync per-list stores into the entries map, once per account.
 *
 * The old keys were the wallet's own display ids, which ChainLens cannot match —
 * so without this, upgrading would appear to forget everything the user had ever
 * hidden. Timestamped at 0 so that ANY later decision, on any device, wins: a
 * migrated hide should never out-rank a restore the user has since made.
 *
 * The legacy stores are left in place rather than deleted, so downgrading to the
 * previous build still finds its list.
 */
function migrateLegacy(acct: number, entries: AssetFilterEntries): AssetFilterEntries {
  if (localStorage.getItem(migratedKey(acct)) === '1') return entries
  const out: AssetFilterEntries = { ...entries }
  const states: AssetFilterState[] = ['h', 's', 'a']
  legacyKeys(acct).forEach((storeKey, i) => {
    let legacy: string[] = []
    try { legacy = JSON.parse(localStorage.getItem(storeKey) ?? '[]') } catch { return }
    if (!Array.isArray(legacy)) return
    for (const old of legacy) {
      if (typeof old !== 'string') continue
      // One old key can have two readings (`solana:<mint>` was written for both
      // a token and an NFT); both are recorded, and the wrong one matches
      // nothing the user holds.
      for (const key of legacyWalletKeyToCanonical(old)) {
        if (!out[key]) out[key] = { s: states[i], t: 0 }
      }
    }
  })
  try {
    localStorage.setItem(migratedKey(acct), '1')
    localStorage.setItem(entriesKey(acct), JSON.stringify(out))
  } catch { /* quota */ }
  return out
}

/**
 * Does this list hold anything the other one doesn't?
 *
 * Used to answer "is there something here the server has never seen" without
 * pushing a signed write on every launch just to find out.
 */
function sameEntries(a: AssetFilterEntries, b: AssetFilterEntries): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every(k => b[k] && b[k].s === a[k].s && b[k].t === a[k].t)
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * @param accountIndex the wallet account whose list this is. Each account has
 *   its own EVM address and therefore its own ChainLens profile, so switching
 *   accounts must switch lists — sharing one would leak "what I hide" between
 *   identities the user deliberately keeps apart.
 */
export function useAssetFilters(accountIndex: number): AssetFilters {
  const [entries, setEntries] = useState<AssetFilterEntries>(() => loadEntries(accountIndex))
  // Read inside the debounced push, which fires long after the render that
  // scheduled it — a ref is what keeps it from pushing a stale list.
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Declared before the effects that depend on it: a dependency array is
  // evaluated during render, so a later `const` would be in its TDZ there.
  const schedulePush = useCallback(() => {
    if (pushTimer.current) clearTimeout(pushTimer.current)
    pushTimer.current = setTimeout(() => {
      pushTimer.current = null
      void (async () => {
        const push = window.wallet.assetFiltersPush
        if (!push) return
        const result = await push.call(window.wallet, entriesRef.current).catch(() => null)
        // What comes back is the server's merge with the other devices, so
        // applying it is how a hide made on the phone arrives here.
        if (!result?.entries) return
        setEntries(prev => {
          const merged = mergeFilterEntries(prev, result.entries)
          saveEntries(accountIndex, merged)
          return merged
        })
      })()
    }, PUSH_DEBOUNCE_MS)
  }, [accountIndex])

  // Account switch: adopt that account's list before anything renders from it.
  useEffect(() => {
    setEntries(loadEntries(accountIndex))
  }, [accountIndex])

  // Pull on mount and on account switch. Merged, never assigned: a decision made
  // offline on this device is still newer than whatever the server holds, and
  // must survive the pull that follows reconnecting.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Bound before calling: `fn?.().catch()` throws on the builds that don't
      // define the bridge, because the optional call yields undefined.
      const get = window.wallet.assetFiltersGet
      if (!get) return
      const remote = await get.call(window.wallet).catch(() => null)
      if (cancelled || !remote) return
      let localOnly = false
      setEntries(prev => {
        const merged = mergeFilterEntries(prev, remote)
        // Anything the merge added on top of the server's copy exists only here:
        // decisions taken offline, or the one-time migration off the pre-sync
        // stores. Without pushing them back, they would stay on this install
        // forever — nothing else ever triggers a push until the NEXT change.
        localOnly = !sameEntries(merged, remote)
        saveEntries(accountIndex, merged)
        return merged
      })
      if (localOnly) schedulePush()
    })()
    return () => { cancelled = true }
  }, [accountIndex, schedulePush])

  useEffect(() => () => { if (pushTimer.current) clearTimeout(pushTimer.current) }, [])

  const set = useCallback((key: string, state: AssetFilterState) => {
    if (!key) return
    setEntries(prev => {
      const next = { ...prev, [key]: { s: state, t: Date.now() } }
      saveEntries(accountIndex, next)
      return next
    })
    schedulePush()
  }, [accountIndex, schedulePush])

  // Memoized because these Sets are dependencies of the dashboard's own memos
  // and effects — rebuilding them every render would invalidate all of it on
  // every keystroke in the search box.
  const { hidden, spam, allowed } = useMemo(() => entriesToSets(entries), [entries])

  return {
    hidden, spam, allowed,
    hide:     useCallback((key: string) => set(key, 'h'), [set]),
    markSpam: useCallback((key: string) => set(key, 's'), [set]),
    // 'a' is a tombstone, not a deletion: the other devices still hold the hide,
    // and only a NEWER decision can outrank it. Removing the key would let their
    // next push put the asset straight back.
    restore:  useCallback((key: string) => set(key, 'a'), [set]),
  }
}
