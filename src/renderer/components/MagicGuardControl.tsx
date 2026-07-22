/**
 * MagicGuardControl.tsx — MagicMoney Wallet
 *
 * Toolbar entry point for Magic Guard, the built-in dApp browser's privacy
 * filtering feature (a Brave-Shields-style boundary around untrusted dApp pages —
 * not affiliated with or claiming parity with Brave Shields). Sits between the
 * Home button and the address bar, and is CONTROLLED the same way as TabsMenu/
 * SnapMenu: BrowserApp owns open/close so the toolbar's dropdowns never overlap.
 *
 * v1 note: this ships the on/off + per-site toggle UI only. `state.effectiveEnabled`
 * is always false and `state.status` is 'degraded' while enabled — the actual
 * filtering engine (adblock-rust) is a separate, later integration. The panel says
 * so plainly rather than implying protection that isn't happening yet; see
 * src/main/magic-guard.ts.
 */
import { useState } from 'react'
import mascotUrl from '../assets/magic-guard.png'
import type { MagicGuardState } from '../types/wallet'

export function MagicGuardControl({ state, onChange, open, onOpen, onClose }: {
  state: MagicGuardState
  onChange: (state: MagicGuardState) => void
  open: boolean
  onOpen: () => void
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)

  const setEnabled = async (enabled: boolean) => {
    if (busy || !window.wallet.browserSetMagicGuardEnabled) return
    setBusy(true)
    try { onChange(await window.wallet.browserSetMagicGuardEnabled(enabled)) }
    finally { setBusy(false) }
  }
  const setSiteEnabled = async (enabled: boolean) => {
    if (busy || !window.wallet.browserSetMagicGuardForSite) return
    setBusy(true)
    try { onChange(await window.wallet.browserSetMagicGuardForSite(enabled)) }
    finally { setBusy(false) }
  }

  const active = state.enabled && state.siteEnabled
  const color = !state.enabled || !state.siteEnabled ? 'var(--text-muted)' : 'var(--accent)'

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => (open ? onClose() : onOpen())}
        title="Magic Guard"
        aria-label="Magic Guard"
        aria-pressed={open}
        style={{
          position: 'relative', zIndex: open ? 50 : undefined,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, flexShrink: 0,
          background: open ? 'var(--bg)' : 'var(--surface-raised)',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 8, color, cursor: 'pointer', padding: 0,
          transition: 'border-color 0.15s, color 0.15s',
        }}
      >
        <ShieldIcon active={active} />
      </button>

      {open && (
        <>
          <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'transparent', zIndex: 40 }} />
          <div
            style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 50,
              width: 280, background: 'var(--bg-surface)', border: '1px solid var(--border-active)',
              borderRadius: 12, boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)', padding: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <img
                src={mascotUrl}
                alt=""
                width={40}
                height={40}
                style={{ borderRadius: 10, flexShrink: 0, objectFit: 'cover' }}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>Magic Guard</div>
                <div style={{
                  fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {state.hostname ?? 'No site loaded'}
                </div>
              </div>
            </div>

            <ToggleRow
              label="Protection for this site"
              checked={state.siteEnabled}
              disabled={busy || !state.hostname}
              onChange={setSiteEnabled}
            />
            <ToggleRow
              label="Magic Guard (global)"
              checked={state.enabled}
              disabled={busy}
              onChange={setEnabled}
            />

            <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
              <CountTile label="Blocked this page" value={state.blockedThisPage} />
              <CountTile label="Blocked this tab" value={state.blockedThisTab} />
            </div>

            <div style={{
              fontSize: 10.5, lineHeight: 1.5, color: 'var(--text-muted)',
              padding: '8px 9px', borderRadius: 8, background: 'var(--surface-raised)',
              border: '1px solid var(--border)',
            }}>
              {state.enabled
                ? (state.error ?? 'Protection is active for this site.')
                : 'Magic Guard is off. Turn it on to filter ads and trackers in the dApp browser.'}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ToggleRow({ label, checked, disabled, onChange }: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 8, padding: '6px 2px',
    }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{
          position: 'relative', width: 34, height: 18, flexShrink: 0, padding: 0,
          borderRadius: 999, border: 'none', cursor: disabled ? 'default' : 'pointer',
          background: checked ? 'var(--accent)' : 'var(--border)',
          opacity: disabled ? 0.5 : 1, transition: 'background 0.15s',
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: checked ? 18 : 2,
          width: 14, height: 14, borderRadius: '50%', background: '#000',
          transition: 'left 0.15s',
        }} />
      </button>
    </div>
  )
}

function CountTile({ label, value }: { label: string; value: number }) {
  const shown = value > 99 ? '99+' : String(value)
  return (
    <div style={{
      flex: 1, padding: '7px 8px', borderRadius: 8,
      background: 'var(--surface-raised)', border: '1px solid var(--border)',
    }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{shown}</div>
      <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )
}

// Neon rim glow in the Magic Money logo's own gradient (blue → cyan → mint),
// sampled directly from logos and Banners/icon128.png — not the theme accent,
// since the logo itself stays the same fixed colors across every theme.
const LOGO_GLOW = [
  'drop-shadow(0 0 1.5px #2868f8)',
  'drop-shadow(0 0 3px #2868f8)',
  'drop-shadow(0 0 6px #48c8e8)',
  'drop-shadow(0 0 10px #68f8d0)',
  'drop-shadow(0 0 14px rgba(104, 248, 208, 0.65))',
].join(' ')

function ShieldIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="15" height="15" viewBox="0 0 24 24"
      fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round"
      style={{ filter: LOGO_GLOW }}
    >
      <path d="M12 2.5l7.5 3.2v5.1c0 5.1-3.2 8.9-7.5 10.2-4.3-1.3-7.5-5.1-7.5-10.2V5.7L12 2.5z" fillOpacity={active ? 0.18 : 0} />
    </svg>
  )
}
