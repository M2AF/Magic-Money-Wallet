/**
 * TokenPicker.tsx — searchable token selector for the DEX swap.
 *
 * Replaces the two `<select>` dropdowns that could only offer the tokens
 * hard-coded in `swap-tokens.ts` (two on Base, three on Solana) and that
 * identified a token by its SYMBOL — which is not an identity: a live Jupiter
 * search for "BONK" returns five mints with three different decimal counts.
 *
 * Three sources are merged, cheapest first, so the list is never empty and never
 * blocks on the network:
 *   1. the user's own holdings  (instant, and the only source that knows balances)
 *   2. the bundled curated list (instant, and the fallback when discovery is down)
 *   3. proxy discovery          (debounced; Jupiter on Solana, Relay/LI.FI on EVM)
 *
 * Every result carries its contract/mint and an explicit verification state.
 * Unverified tokens are SHOWN and labelled, never hidden — the whole point is
 * that a user who pastes the mint of something nobody has listed yet can still
 * find it. Labelling is the safety measure; hiding would just restore the old
 * problem.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { SwapToken, SwapChain, WalletToken } from '../types/wallet'
import { SWAP_TOKEN_LISTS } from '../types/swap-tokens'
import { swapAssetKey, looksLikeSwapAddress, isValidSwapAddress } from '../../shared/swap-token-identity'

interface Props {
  chain: SwapChain
  value: SwapToken | undefined
  onSelect: (token: SwapToken) => void
  /** Holdings on this chain — supplies balances and surfaces tokens no list has. */
  owned: WalletToken[]
  /**
   * Native balance in human units for THIS picker's chain. Null = not loaded,
   * which is shown as no balance; 0 is a real, loaded zero and is shown as 0.
   */
  nativeBalance: number | null
  label: string
  disabled?: boolean
}

/**
 * The balance to show for one token row, or null when it is not known.
 *
 * Identity is the chain-qualified asset key (mint/contract), never the symbol,
 * and the amount is the exact `rawBalance`. A held token at zero is a real 0; a
 * token the wallet has no holding record for is null (unknown), not 0.
 */
export function pickerBalance(
  token: SwapToken, chain: string, owned: WalletToken[] | undefined, nativeBalance: number | null,
): number | null {
  if (token.isNative) return nativeBalance
  const key = swapAssetKey(chain, token.address)
  const hit = (owned ?? []).find(t => t.chain === chain && swapAssetKey(chain, t.contractAddress) === key)
  return hit ? rawToHuman(hit.rawBalance, hit.decimals) : null
}

/**
 * Logos seen from discovery or holdings, by chain-qualified asset key. Shared by
 * both pickers, so the SELECTED tile can show a logo the bundled list lacks (the
 * curated entries carry none; discovery and holdings do).
 */
const logoCache = new Map<string, string>()
export function rememberLogos(chain: string, tokens: Array<{ address: string; logoUri?: string | null }>): void {
  for (const t of tokens) if (t.logoUri) logoCache.set(swapAssetKey(chain, t.address), t.logoUri)
}
export function cachedLogo(chain: string, address: string): string | null {
  return logoCache.get(swapAssetKey(chain, address)) ?? null
}

/** Exact base units → human number. `balance` is a DISPLAY string and must not be parsed. */
function rawToHuman(raw: string | undefined, decimals: number): number | null {
  if (!raw || !/^[0-9]+$/.test(raw)) return null
  try {
    const v = BigInt(raw)
    const d = BigInt(10) ** BigInt(decimals)
    return Number(v / d) + Number(v % d) / Number(d)
  } catch { return null }
}

function shortAddress(address: string): string {
  if (address.length <= 14) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function TokenPicker({ chain, value, onSelect, owned, nativeBalance, label, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SwapToken[]>([])
  const [loading, setLoading] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [cursor, setCursor] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  // Monotonic id: a slow response for an old query/chain must never overwrite a
  // newer one. Without this, typing "b","bo","bon" can settle out of order and
  // leave the list showing results for a query the user has already moved past.
  const reqId = useRef(0)

  const curated = SWAP_TOKEN_LISTS[chain] ?? []

  /** Holdings on this chain, as selectable tokens with their exact balance. */
  const ownedTokens = useMemo<SwapToken[]>(() => (owned ?? [])
    .filter(t => t.chain === chain && !t.suspectedSpam && Number.isInteger(t.decimals))
    .map(t => ({
      chain,
      symbol: t.symbol,
      name: t.name,
      address: t.contractAddress,
      decimals: t.decimals,
      logoUri: t.logoUri,
      isNative: false,
      source: 'owned',
    })),
  [owned, chain])

  const balanceFor = useCallback(
    (token: SwapToken): number | null => pickerBalance(token, chain, owned, nativeBalance),
    [owned, chain, nativeBalance])

  // ── A logo for the SELECTED token ─────────────────────────────────────────
  // The default selections come from the curated list, which has no logos, so
  // the trigger tile stayed a letter even though the open list showed a logo.
  const [, setLogoTick] = useState(0)
  useEffect(() => { rememberLogos(chain, ownedTokens); setLogoTick(n => n + 1) }, [chain, ownedTokens])
  const valueKey = value ? swapAssetKey(chain, value.address) : ''
  useEffect(() => {
    if (!value || value.logoUri || cachedLogo(chain, value.address)) return
    let on = true
    ;(async () => {
      try {
        // The chain's suggestions carry the native coin and the majors; an exact
        // lookup covers anything else. Both are cached by the Worker.
        const r = await window.wallet.swapGetTokens({ chain, limit: 30 })
        rememberLogos(chain, r.tokens ?? [])
        if (!cachedLogo(chain, value.address) && !value.isNative) {
          const exact = await window.wallet.swapGetTokens({ chain, address: value.address })
          rememberLogos(chain, exact.tokens ?? [])
        }
        if (on) setLogoTick(n => n + 1)
      } catch { /* the letter tile stays; nothing else depends on a logo */ }
    })()
    return () => { on = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, valueKey])
  const valueWithLogo = value && !value.logoUri
    ? { ...value, logoUri: cachedLogo(chain, value.address) }
    : value

  // ── The list shown when the box is empty: holdings + curated, deduped ───────
  const baseList = useMemo<SwapToken[]>(() => {
    const out = new Map<string, SwapToken>()
    for (const t of [...curated, ...ownedTokens]) {
      const key = swapAssetKey(chain, t.address)
      if (!out.has(key)) out.set(key, t)
    }
    return [...out.values()]
  }, [curated, ownedTokens, chain])

  // ── Discovery (debounced, stale-guarded) ───────────────────────────────────
  useEffect(() => {
    if (!open) return
    const term = query.trim()
    const id = ++reqId.current

    // Empty box: show what we already have and fetch suggestions in the background.
    if (!term) {
      setResults([]); setNotFound(false); setLoading(true)
      const timer = setTimeout(async () => {
        try {
          const r = await window.wallet.swapGetTokens({ chain, limit: 30 })
          if (reqId.current !== id) return
          setResults(r.tokens ?? [])
        } catch { if (reqId.current === id) setResults([]) }
        finally { if (reqId.current === id) setLoading(false) }
      }, 0)
      return () => clearTimeout(timer)
    }

    setLoading(true); setNotFound(false)
    const isAddress = looksLikeSwapAddress(chain, term)
    const timer = setTimeout(async () => {
      try {
        const r = await window.wallet.swapGetTokens(
          isAddress ? { chain, address: term } : { chain, query: term, limit: 30 })
        if (reqId.current !== id) return
        const tokens = r.tokens ?? []
        setResults(tokens)
        // Only an exact-address miss is a definite "no such token"; a name search
        // returning nothing may just be a term no provider indexes.
        setNotFound(tokens.length === 0)
      } catch {
        if (reqId.current === id) { setResults([]); setNotFound(false) }
      } finally {
        if (reqId.current === id) setLoading(false)
      }
    }, isAddress ? 0 : 250)   // a pasted address is intentional — resolve it at once
    return () => clearTimeout(timer)
  }, [query, chain, open])

  // Chain change invalidates everything in flight and everything on screen.
  useEffect(() => { reqId.current++; setQuery(''); setResults([]); setNotFound(false) }, [chain])

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  /** What the list actually renders: local matches first, then discovery. */
  const shown = useMemo<SwapToken[]>(() => {
    const term = query.trim().toLowerCase()
    const local = term
      ? baseList.filter(t =>
          t.symbol.toLowerCase().includes(term) ||
          t.name.toLowerCase().includes(term) ||
          t.address.toLowerCase() === term)
      : baseList
    rememberLogos(chain, results)
    const out = new Map<string, SwapToken>()
    for (const t of [...local, ...results]) {
      const key = swapAssetKey(chain, t.address)
      const held = out.get(key)
      if (!held) out.set(key, t)
      // A discovery record can fill in a logo the curated/owned entry lacks.
      else if (held.logoUri == null && t.logoUri != null) out.set(key, { ...held, logoUri: t.logoUri })
    }
    return [...out.values()]
  }, [baseList, results, query, chain])

  useEffect(() => { setCursor(0) }, [query])

  const choose = (token: SwapToken) => {
    reqId.current++          // abandon anything still in flight
    onSelect(token)
    setOpen(false)
    setQuery('')
    setResults([])
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, shown.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter' && shown[cursor]) { e.preventDefault(); choose(shown[cursor]) }
  }

  const addressLooksWrong = query.trim().length > 30 && !isValidSwapAddress(chain, query.trim())

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={label}
        aria-haspopup="dialog"
        style={triggerStyle(!!disabled)}
      >
        <TokenLogo token={valueWithLogo} size={20} />
        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value?.symbol ?? 'Select'}
        </span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ flexShrink: 0, opacity: 0.6 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
          style={overlayStyle}
        >
          <div style={panelStyle} onKeyDown={onKeyDown}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" style={closeBtn}>✕</button>
            </div>

            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search name, symbol or paste an address"
              aria-label="Search tokens"
              spellCheck={false}
              autoComplete="off"
              style={searchInput}
            />

            {addressLooksWrong && (
              <div style={hintStyle('#fca5a5')}>
                That does not look like a valid {chain === 'solana' ? 'mint' : 'contract address'} for {chain}.
              </div>
            )}

            <div role="listbox" aria-label="Token results" style={{ overflowY: 'auto', maxHeight: 340, margin: '0 -4px' }}>
              {shown.map((token, i) => {
                const bal = balanceFor(token)
                const unverified = token.verified !== true && !token.isNative && token.source !== 'owned'
                return (
                  <button
                    key={swapAssetKey(chain, token.address)}
                    type="button"
                    role="option"
                    aria-selected={i === cursor}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => choose(token)}
                    style={rowStyle(i === cursor)}
                  >
                    <TokenLogo token={token.logoUri ? token : { ...token, logoUri: cachedLogo(chain, token.address) }} size={30} />
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {token.symbol}
                        </span>
                        {unverified && <span style={badgeStyle}>UNVERIFIED</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {token.name}
                        {!token.isNative && <span style={{ opacity: 0.7 }}> · {shortAddress(token.address)}</span>}
                      </div>
                    </div>
                    {/* A loaded zero is shown as 0; an unknown balance is left blank. */}
                    {bal != null && (
                      <span style={{ fontSize: 12, color: 'var(--text-primary)', flexShrink: 0 }}>
                        {bal.toLocaleString('en-US', { maximumFractionDigits: 6 })}
                      </span>
                    )}
                  </button>
                )
              })}

              {loading && (
                <div style={hintStyle('var(--text-muted)')}>Searching…</div>
              )}
              {!loading && shown.length === 0 && notFound && (
                <div style={hintStyle('var(--text-muted)')}>
                  No token found for “{query.trim()}” on {chain}. Try pasting the exact
                  {chain === 'solana' ? ' mint' : ' contract address'}.
                </div>
              )}
              {!loading && shown.length === 0 && !notFound && (
                <div style={hintStyle('var(--text-muted)')}>No matches.</div>
              )}
            </div>

            <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Being listed here does not guarantee a tradable route — that is confirmed
              when you request a quote.
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * Token logo, or a letter tile.
 *
 * `logoUri` is attacker-controlled (anyone can mint a token and name its logo),
 * so it is https-only by the time it reaches here and a load failure falls back
 * to the tile rather than leaving a broken image.
 */
function TokenLogo({ token, size }: { token: SwapToken | undefined; size: number }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [token?.logoUri])

  const tile = (
    <span style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'var(--accent-dim)', color: 'var(--accent)',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.42, fontWeight: 700,
    }}>
      {(token?.symbol ?? '?').slice(0, 1).toUpperCase()}
    </span>
  )
  if (!token?.logoUri || failed) return tile
  return (
    <img
      src={token.logoUri}
      alt=""
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }}
    />
  )
}

// ── styles ───────────────────────────────────────────────────────────────────

function triggerStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 6, width: 124, flexShrink: 0,
    background: 'var(--bg-card)', color: 'var(--text-primary)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    padding: '8px 10px', fontSize: 14, cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1, outline: 'none',
  }
}
// Matches the app's other modals (AddChainModal, ImportTokenModal) rather than
// inventing a second overlay treatment.
const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 200,
  background: 'rgba(6, 11, 24, 0.85)', backdropFilter: 'blur(8px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
}
const panelStyle: React.CSSProperties = {
  width: '100%', maxWidth: 400, maxHeight: '80vh',
  background: 'var(--bg-card)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius)', padding: 16,
  display: 'flex', flexDirection: 'column', gap: 10,
}
const closeBtn: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'var(--text-muted)',
  fontSize: 14, cursor: 'pointer', padding: 4, lineHeight: 1,
}
const searchInput: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)', padding: '10px 12px',
  color: 'var(--text-primary)', fontSize: 13, outline: 'none', width: '100%',
}
function rowStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
    background: active ? 'var(--accent-dim)' : 'transparent',
    border: 'none', borderRadius: 'var(--radius-sm)', padding: '9px 10px',
    cursor: 'pointer', color: 'var(--text-primary)', textAlign: 'left',
  }
}
const badgeStyle: React.CSSProperties = {
  fontSize: 8, fontWeight: 800, letterSpacing: '0.05em', padding: '2px 5px',
  borderRadius: 4, flexShrink: 0,
  background: 'rgba(250,204,21,0.15)', color: '#facc15', border: '1px solid rgba(250,204,21,0.35)',
}
function hintStyle(color: string): React.CSSProperties {
  return { fontSize: 11, color, padding: '10px 12px', lineHeight: 1.5 }
}
