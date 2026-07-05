/**
 * WindowLayout.tsx — MagicMoney Wallet
 *
 * UI for the side-by-side "Full Screen Mode" that tiles the wallet window and the
 * dApp browser window together (filling the current display) so they behave like a
 * paired workspace. The actual window positioning happens in the main process
 * (browser-manager.ts: layoutSnap / layoutDetach / layoutToggle).
 *
 *   • FullScreenButton — the green traffic-light dot in the BROWSER titlebar. It
 *     maximizes/restores the dApp browser window only (never touches the wallet).
 *   • SnapButtons      — two pills in the browser chrome (‹ Wallet / Wallet ›) that
 *     tile the wallet+browser to that side; clicking the active side un-tiles.
 */
import { useEffect, useState } from 'react'

type Side = 'left' | 'right'
interface LayoutState { snapped: boolean; side: Side | null; browserOpen: boolean; maximized: boolean }

// The window-layout API only exists in the Electron preload — the browser
// extension's bridge has no second window to tile. Everything here is
// optional-chained and the components render nothing without it, mirroring how
// App.tsx handles onLocked/reportActivity (a hard call would blank the popup).
const layoutSupported = () => typeof window.wallet.layoutGetState === 'function'

/** Subscribe to the main-process layout state and keep it fresh. */
function useLayoutState(): LayoutState {
  const [state, setState] = useState<LayoutState>({ snapped: false, side: null, browserOpen: false, maximized: false })
  useEffect(() => {
    window.wallet.layoutGetState?.().then(setState).catch(() => {})
    const onChange = (s: LayoutState) => setState(s)
    window.wallet.onLayoutChanged?.(onChange)
    return () => window.wallet.offLayoutChanged?.(onChange)
  }, [])
  return state
}

/** Green titlebar dot (browser only) — maximizes/restores the dApp browser window. */
export function FullScreenButton() {
  const { maximized } = useLayoutState()
  if (!layoutSupported()) return null
  return (
    <button
      type="button"
      className={`titlebar-btn full${maximized ? ' active' : ''}`}
      onClick={() => window.wallet.browserToggleMaximize?.()}
      title={maximized ? 'Restore Browser' : 'Maximize Browser'}
      aria-label={maximized ? 'Restore Browser' : 'Maximize Browser'}
    />
  )
}

/**
 * Two pills (left of the tabs button) that tile the wallet + browser side by side.
 * "‹ Wallet" puts the wallet on the left, "Wallet ›" on the right. Clicking the
 * side that's already active un-tiles (restores both windows to pre-snap bounds).
 */
export function SnapButtons() {
  const { snapped, side } = useLayoutState()
  if (!layoutSupported()) return null

  const snap = (target: Side) => {
    if (snapped && side === target) window.wallet.layoutDetach?.()
    else window.wallet.layoutSnap?.(target)
  }

  const pill = (target: Side, label: string) => {
    const active = snapped && side === target
    return (
      <button
        type="button"
        onClick={() => snap(target)}
        title={active ? 'Un-tile windows' : `Snap wallet to the ${target}`}
        aria-pressed={active ? 'true' : 'false'}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 8px', cursor: 'pointer', flexShrink: 0,
          background: active ? 'var(--accent)' : 'var(--surface-raised)',
          border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 12,
          fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
          color: active ? '#fff' : 'var(--text-secondary)',
        }}
      >
        {/* split-pane icon: the divider sits on the wallet's side */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ color: active ? '#fff' : 'var(--text-muted)', flexShrink: 0 }}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1={target === 'right' ? '15' : '9'} y1="4" x2={target === 'right' ? '15' : '9'} y2="20" />
        </svg>
        {label}
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      {pill('left', '‹ Wallet')}
      {pill('right', 'Wallet ›')}
    </div>
  )
}
