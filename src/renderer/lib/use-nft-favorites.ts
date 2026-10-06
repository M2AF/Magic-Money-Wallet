import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { nftFavoritesStorageKey, parseNftFavorites } from './nft-favorites'
import { mergeFilterEntries, sanitizeFilterEntries, type AssetFilterEntries } from '../../shared/asset-filter-key'

const prefixFor = (testnet: boolean) => `favorite:${testnet ? 'testnet' : 'mainnet'}:`
function read(key: string, prefix: string): AssetFilterEntries {
  let entries: AssetFilterEntries = {}
  try { entries = sanitizeFilterEntries(JSON.parse(localStorage.getItem(`${key}_decisions`) ?? '{}')) } catch {}
  // Legacy favorites migrate at zero, never overriding remote decisions.
  try {
    for (const id of parseNftFavorites(localStorage.getItem(key))) {
      if (!entries[prefix + id]) entries[prefix + id] = { s: 'f', t: 0 }
    }
  } catch { /* Unavailable storage. */ }
  return entries
}
function save(key: string, prefix: string, entries: AssetFilterEntries) {
  try {
    localStorage.setItem(`${key}_decisions`, JSON.stringify(entries))
    localStorage.setItem(key, JSON.stringify(Object.keys(entries).filter(id => id.startsWith(prefix) && entries[id].s === 'f').map(id => id.slice(prefix.length))))
  } catch { /* Keep optimistic state if storage is unavailable. */ }
}
export function useNftFavorites(owner: string, testnet: boolean) {
  const key = nftFavoritesStorageKey(owner, testnet), prefix = prefixFor(testnet)
  const initial = useMemo(() => read(key, prefix), [key, prefix])
  const [state, setState] = useState({ key, entries: initial })
  const entries = state.key === key ? state.entries : initial
  const current = useRef({ key, entries }); current.current = { key, entries }
  const [revision, setRevision] = useState(0)
  const favorites = useMemo(() => new Set(Object.keys(entries).filter(id => id.startsWith(prefix) && entries[id].s === 'f').map(id => id.slice(prefix.length))), [entries, prefix])
  useEffect(() => {
    let cancelled = false, busy = false
    const apply = (remote: AssetFilterEntries) => {
      if (cancelled || current.current.key !== key) return
      const scoped = Object.fromEntries(Object.entries(remote).filter(([id, entry]) => id.startsWith(prefix) && (entry.s === 'f' || entry.s === 'u')))
      const merged = mergeFilterEntries(current.current.entries, scoped)
      current.current = { key, entries: merged }; save(key, prefix, merged); setState({ key, entries: merged })
      return merged
    }
    const sync = async () => {
      if (busy || !owner || cancelled) return
      busy = true
      try {
        const addresses = await window.wallet.getAddresses()
        if (cancelled || addresses?.evm.toLowerCase() !== owner.toLowerCase()) return
        const remote = await window.wallet.assetFiltersGet?.(owner)
        if (cancelled || !remote) return
        const merged = apply(remote)
        if (!merged || !Object.entries(merged).some(([id, entry]) => remote[id]?.s !== entry.s || remote[id]?.t !== entry.t)) return
        const latest = await window.wallet.getAddresses()
        if (cancelled || latest?.evm.toLowerCase() !== owner.toLowerCase()) return
        const result = await window.wallet.assetFiltersPush?.(current.current.entries, owner)
        if (result?.entries) apply(result.entries)
      } catch { /* Offline choices remain queued for the next pull/focus/online. */ }
      finally { busy = false }
    }
    const timer = setTimeout(() => void sync(), 800)
    const poll = setInterval(() => void sync(), 30000)
    const refresh = () => void sync()
    const storage = (event: StorageEvent) => { if (event.key === `${key}_decisions` || event.key === key || event.key === null) apply(read(key, prefix)) }
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh); window.addEventListener('storage', storage)
    return () => { cancelled = true; clearTimeout(timer); clearInterval(poll); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); window.removeEventListener('storage', storage) }
  }, [key, prefix, owner, revision])
  const toggleFavorite = useCallback((id: string) => {
    const held = current.current.key === key ? current.current.entries : initial
    const next: AssetFilterEntries = { ...held, [prefix + id]: { s: held[prefix + id]?.s === 'f' ? 'u' : 'f', t: Math.max(Date.now(), (held[prefix + id]?.t ?? 0) + 1) } }
    current.current = { key, entries: next }; save(key, prefix, next); setState({ key, entries: next }); setRevision(n => n + 1)
  }, [key, prefix, initial])
  return { favorites, toggleFavorite }
}
