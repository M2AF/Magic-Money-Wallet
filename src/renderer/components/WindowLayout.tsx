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
 *   • SnapMenu         — a dropdown button in the browser chrome (same pattern as
 *     the tabs/Magic Guard dropdowns) holding the "‹ Wallet" / "Wallet ›" tiling
 *     options; clicking the active side un-tiles. It is a CONTROLLED component —
 *     BrowserApp owns open/close so at most one chrome dropdown is open at a time.
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
 * Dropdown that tiles the wallet + browser side by side. "‹ Wallet" puts the
 * wallet on the left, "Wallet ›" on the right. Picking the side that's already
 * active un-tiles (restores both windows to pre-snap bounds). Controlled the same
 * way as TabsMenu/MagicGuardControl: open/onOpen/onClose come from BrowserApp so
 * this dropdown, the tab overview, the address-bar suggestions, and the Magic
 * Guard panel never overlap.
 */
export function SnapMenu({ open, onOpen, onClose }: {
  open: boolean
  onOpen: () => void
  onClose: () => void
}) {
  const { snapped, side } = useLayoutState()
  if (!layoutSupported()) return null

  const snap = (target: Side) => {
    if (snapped && side === target) window.wallet.layoutDetach?.()
    else window.wallet.layoutSnap?.(target)
    onClose()
  }

  const row = (target: Side, label: string) => {
    const active = snapped && side === target
    return (
      <div
        key={target}
        onClick={() => snap(target)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 6px 7px 8px', borderRadius: 8, cursor: 'pointer',
          background: active ? 'var(--accent-dim)' : 'transparent',
          transition: 'background 0.12s',
        }}
        onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)' }}
        onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ color: active ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1={target === 'right' ? '15' : '9'} y1="4" x2={target === 'right' ? '15' : '9'} y2="20" />
        </svg>
        <span style={{
          flex: 1, fontSize: 12,
          fontWeight: active ? 600 : 500,
          color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        }}>
          {label}
        </span>
        {active && (
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)' }}>Tiled</span>
        )}
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        title={snapped ? `Wallet tiled ${side} — click to change` : 'Tile wallet + browser side by side'}
        onClick={() => (open ? onClose() : onOpen())}
        style={{
          position: 'relative', zIndex: open ? 50 : undefined,
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '3px 9px', background: open || snapped ? 'var(--bg)' : 'var(--surface-raised)',
          border: `1px solid ${open || snapped ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 12,
          flexShrink: 0, cursor: 'pointer', color: open || snapped ? 'var(--text-primary)' : 'var(--text-secondary)',
          transition: 'border-color 0.15s, color 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--text-primary)' }}
        onMouseLeave={e => { if (!open && !snapped) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' } }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1={snapped && side === 'right' ? '15' : '9'} y1="4" x2={snapped && side === 'right' ? '15' : '9'} y2="20" />
        </svg>
        {snapped && (
          <span style={{ fontSize: 11, fontWeight: 700 }}>{side === 'left' ? '‹' : '›'}</span>
        )}
      </button>

      {open && (
        <>
          <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'transparent', zIndex: 40 }} />
          <div
            style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 50,
              width: 200, background: 'var(--bg-surface)', border: '1px solid var(--border-active)',
              borderRadius: 12, boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)', padding: 4,
            }}
          >
            <div style={{
              padding: '6px 8px 8px', fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
              textTransform: 'uppercase', color: 'var(--text-muted)',
            }}>
              Window layout
            </div>
            {row('left', '‹ Snap wallet left')}
            {row('right', 'Snap wallet right ›')}
          </div>
        </>
      )}
    </div>
  )
}
