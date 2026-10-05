import { useCallback, useEffect, useMemo, useState } from 'react'
import { nftFavoritesStorageKey, parseNftFavorites } from './nft-favorites'

function read(key: string): Set<string> {
  try { return parseNftFavorites(localStorage.getItem(key)) } catch { return new Set() }
}

export function useNftFavorites(owner: string, testnet: boolean) {
  const key = nftFavoritesStorageKey(owner, testnet)
  const initial = useMemo(() => read(key), [key])
  const [state, setState] = useState({ key, values: initial })
  // Derive the new account's set immediately; never render the old account's favorites.
  const favorites = state.key === key ? state.values : initial
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setState({ key, values: read(key) })
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [key])
  const toggleFavorite = useCallback((id: string) => {
    const values = new Set(favorites)
    if (values.has(id)) values.delete(id)
    else values.add(id)
    try { localStorage.setItem(key, JSON.stringify([...values])) } catch { /* Still usable in this session. */ }
    setState({ key, values })
  }, [favorites, key])
  return { favorites, toggleFavorite }
}
