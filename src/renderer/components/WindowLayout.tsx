/**
 * WindowLayout.tsx — MagicMoney Wallet
 *
 * UI for the side-by-side "Full Screen Mode" that tiles the wallet window and the
 * dApp browser window together (filling the current display) so they behave like a
 * paired workspace. The actual window positioning happens in the main process
 * (browser-manager.ts: layoutSnap / layoutDetach / layoutToggle).
 *
 *   • FullScreenButton — the green traffic-light dot in each titlebar (toggles tile).
 *   • LayoutMenu       — the dropdown in the browser chrome (Enter / Left / Right / Detach).
 *
 * LayoutMenu uses a NATIVE <select> on purpose (same reason as NetworkSwitcher): its
 * option popup is OS-drawn and floats ABOVE the dApp WebContentsView, whereas a custom
 * HTML dropdown would be hidden behind that view.
 */
import { useEffect, useState } from 'react'

type Side = 'left' | 'right'
interface LayoutState { snapped: boolean; side: Side | null; browserOpen: boolean }

// The window-layout API only exists in the Electron preload — the browser
// extension's bridge has no second window to tile. Everything here is
// optional-chained and the components render nothing without it, mirroring how
// App.tsx handles onLocked/reportActivity (a hard call would blank the popup).
const layoutSupported = () => typeof window.wallet.layoutGetState === 'function'

/** Subscribe to the main-process layout state and keep it fresh. */
function useLayoutState(): LayoutState {
  const [state, setState] = useState<LayoutState>({ snapped: false, side: null, browserOpen: false })
  useEffect(() => {
    window.wallet.layoutGetState?.().then(setState).catch(() => {})
    const onChange = (s: LayoutState) => setState(s)
    window.wallet.onLayoutChanged?.(onChange)
    return () => window.wallet.offLayoutChanged?.(onChange)
  }, [])
  return state
}

/** Green titlebar dot — tiles the two windows, or un-tiles them if already tiled. */
export function FullScreenButton() {
  const { snapped } = useLayoutState()
  if (!layoutSupported()) return null
  return (
    <button
      type="button"
      className={`titlebar-btn full${snapped ? ' active' : ''}`}
      onClick={() => window.wallet.layoutToggle?.()}
      title={snapped ? 'Exit Full Screen Mode' : 'Full Screen Mode'}
      aria-label={snapped ? 'Exit Full Screen Mode' : 'Full Screen Mode'}
    />
  )
}

/** Dropdown (left of the tabs button) with the full set of layout actions. */
export function LayoutMenu() {
  const { snapped, side } = useLayoutState()

  const act = (value: string) => {
    switch (value) {
      case 'enter':  window.wallet.layoutSnap?.(side ?? 'left'); break
      case 'left':   window.wallet.layoutSnap?.('left');  break
      case 'right':  window.wallet.layoutSnap?.('right'); break
      case 'detach': window.wallet.layoutDetach?.(); break
    }
  }

  if (!layoutSupported()) return null

  const label = snapped ? (side === 'right' ? 'Wallet ›' : '‹ Wallet') : 'Layout'

  return (
    <div
      title="Window layout"
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 5,
        padding: '3px 8px', background: 'var(--surface-raised)',
        border: `1px solid ${snapped ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 12,
        flexShrink: 0,
      }}
    >
      {/* split-pane icon */}
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        style={{ color: snapped ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <line x1={side === 'right' ? '15' : '9'} y1="4" x2={side === 'right' ? '15' : '9'} y2="20" />
      </svg>
      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
        style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
        <polyline points="6 9 12 15 18 9" />
      </svg>

      {/* Native select overlay — OS-drawn options float above the dApp view. */}
      <select
        aria-label="Window layout"
        value=""
        onChange={e => { act(e.target.value); e.currentTarget.value = '' }}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          opacity: 0, cursor: 'pointer', border: 'none', colorScheme: 'dark',
        }}
      >
        <option value="" disabled hidden>Window layout</option>
        <option value="enter">Enter Full Screen Mode</option>
        <option value="left">Left side panel (wallet)</option>
        <option value="right">Right side panel (wallet)</option>
        <option value="detach">Detach</option>
      </select>
    </div>
  )
}
