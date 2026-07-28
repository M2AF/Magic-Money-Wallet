/**
 * browser-ui.tsx — shared chrome primitives for the dApp browser
 *
 * The browser chrome styles with inline objects rather than CSS classes (see
 * BrowserApp.tsx), so the dropdown/panel look was being copy-pasted between
 * TabsMenu, SnapMenu and MagicGuardControl. These are that same look, factored
 * out, so the new menus (hamburger, share, bookmarks, passwords) can't drift.
 *
 * Two rules every surface here obeys, both forced by the WebContentsView layering:
 *   • a dropdown MUST be paired with BrowserApp's openOverlay/closeOverlay so the
 *     active dApp view is detached while it's showing, and
 *   • a full-area panel renders INSIDE the content div (position: absolute,
 *     inset: 0), painted over the snapshot BrowserApp puts behind it.
 */
import type { ReactNode, CSSProperties } from 'react'
import { useEffect } from 'react'

// ─── Dropdown panel ──────────────────────────────────────────────────────────

/** Transparent full-screen click-catcher + the floating panel above it. */
export function Dropdown({ width = 260, onClose, children, align = 'right' }: {
  width?: number
  onClose: () => void
  children: ReactNode
  align?: 'left' | 'right'
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'transparent', zIndex: 40 }} />
      <div
        style={{
          position: 'absolute', top: 'calc(100% + 6px)', zIndex: 50,
          ...(align === 'right' ? { right: 0 } : { left: 0 }),
          width, maxHeight: 460, overflowY: 'auto',
          background: 'var(--bg-surface)', border: '1px solid var(--border-active)',
          borderRadius: 12, boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)', padding: 4,
        }}
      >
        {children}
      </div>
    </>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{
      padding: '6px 8px 8px', fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
      textTransform: 'uppercase', color: 'var(--text-muted)',
    }}>
      {children}
    </div>
  )
}

export function Divider() {
  return <div style={{ height: 1, background: 'var(--border)', margin: '4px 6px' }} />
}

/** One clickable row: icon, label, optional trailing hint/chevron. */
export function MenuRow({ icon, label, hint, trailing, onClick, disabled, danger, active }: {
  icon?: ReactNode
  label: ReactNode
  hint?: ReactNode
  trailing?: ReactNode
  onClick?: () => void
  disabled?: boolean
  danger?: boolean
  active?: boolean
}) {
  const color = disabled ? 'var(--text-muted)' : danger ? '#ef4444' : active ? 'var(--text-primary)' : 'var(--text-secondary)'
  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 9,
        padding: '8px', borderRadius: 8,
        cursor: disabled ? 'default' : 'pointer',
        background: active ? 'var(--accent-dim)' : 'transparent',
        transition: 'background 0.12s, color 0.12s',
        color,
      }}
      onMouseEnter={e => { if (!disabled && !active) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      {icon && <span style={{ display: 'flex', flexShrink: 0, width: 15, justifyContent: 'center' }}>{icon}</span>}
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        {hint && (
          <span style={{
            fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {hint}
          </span>
        )}
      </span>
      {trailing && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: 'var(--text-muted)' }}>{trailing}</span>}
    </div>
  )
}

// ─── Toolbar button ──────────────────────────────────────────────────────────

/** Pill-shaped toolbar button matching TabsMenu/SnapMenu (open ⇒ accent border). */
export function ToolbarButton({ open, active, title, onClick, children, ariaLabel }: {
  open?: boolean
  active?: boolean
  title: string
  onClick: () => void
  children: ReactNode
  ariaLabel?: string
}) {
  const lit = open || active
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel ?? title}
      onClick={onClick}
      style={{
        position: 'relative', zIndex: open ? 50 : undefined,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        height: 26, padding: '0 8px',
        background: lit ? 'var(--bg)' : 'var(--surface-raised)',
        border: `1px solid ${lit ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 12,
        flexShrink: 0, cursor: 'pointer',
        color: lit ? 'var(--text-primary)' : 'var(--text-secondary)',
        transition: 'border-color 0.15s, color 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--text-primary)' }}
      onMouseLeave={e => { if (!lit) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' } }}
    >
      {children}
    </button>
  )
}

// ─── Full-area panel (rendered inside BrowserApp's content div) ──────────────

/**
 * A full-bleed sheet covering the page area, used by the bookmarks and password
 * surfaces — both are too big for a dropdown. The active dApp view is already
 * detached (openOverlay), so this sits over the page snapshot.
 */
export function ContentPanel({ title, subtitle, onClose, children, actions }: {
  title: string
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  actions?: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 30,
      display: 'flex', flexDirection: 'column',
      background: 'var(--bg)', color: 'var(--text-primary)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        padding: '14px 16px', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>}
        </div>
        {actions}
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, flexShrink: 0, padding: 0,
            background: 'none', border: '1px solid var(--border)', borderRadius: 8,
            color: 'var(--text-secondary)', cursor: 'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-raised)'; e.currentTarget.style.color = 'var(--text-primary)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-secondary)' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
        {children}
      </div>
    </div>
  )
}

// ─── Form bits ───────────────────────────────────────────────────────────────

export const fieldStyle: CSSProperties = {
  width: '100%', padding: '8px 10px', boxSizing: 'border-box',
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
  color: 'var(--text-primary)', fontSize: 12, outline: 'none',
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
        textTransform: 'uppercase', color: 'var(--text-muted)',
      }}>
        {label}
      </span>
      {children}
    </label>
  )
}

/** Inline status line used by every panel for its "Imported 42 logins" feedback. */
export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: ReactNode }) {
  if (!children) return null
  const color = tone === 'error' ? '#ef4444' : tone === 'success' ? '#22c55e' : 'var(--text-muted)'
  return (
    <div style={{ fontSize: 11, lineHeight: 1.5, color, padding: '2px 0' }} role={tone === 'error' ? 'alert' : undefined}>
      {children}
    </div>
  )
}

/** Empty-state block shared by the bookmarks/apps/passwords lists. */
export function EmptyState({ icon, title, body }: { icon: string; title: string; body: ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '38px 16px', color: 'var(--text-muted)' }}>
      <div aria-hidden="true" style={{ fontSize: 30, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 11, lineHeight: 1.6, maxWidth: 380, margin: '0 auto' }}>{body}</div>
    </div>
  )
}

/** Favicon chip with a letter fallback — same treatment as the App Hub rows. */
export function SiteIcon({ url, size = 20 }: { url: string; size?: number }) {
  let host = url
  try { host = new URL(url).hostname } catch { /* keep raw */ }
  return (
    <div style={{
      width: size, height: size, borderRadius: 6, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--surface-raised)', border: '1px solid var(--border)',
      fontSize: size * 0.5, fontWeight: 700, color: 'var(--text-secondary)',
      textTransform: 'uppercase',
    }}>
      {host.replace(/^www\./, '').charAt(0) || '?'}
    </div>
  )
}
