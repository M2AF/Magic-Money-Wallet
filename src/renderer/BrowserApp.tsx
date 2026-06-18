import { useState, useEffect, useRef, useCallback } from 'react'

const HOME = 'https://chainlensnft.info'

export function BrowserApp() {
  const [url, setUrl]           = useState(HOME)
  const [inputUrl, setInputUrl] = useState(HOME)
  const [loading, setLoading]   = useState(false)
  const [canBack, setCanBack]   = useState(false)
  const [canFwd, setCanFwd]     = useState(false)
  const [title, setTitle]       = useState('MagicMoney Browser')
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Subscribe to nav events from main process ──────────────────────────
  useEffect(() => {
    const onUrl   = (u: string)  => { setUrl(u); setInputUrl(u) }
    const onLoad  = (v: boolean) => setLoading(v)
    const onNav   = (s: { canBack: boolean; canForward: boolean }) => {
      setCanBack(s.canBack); setCanFwd(s.canForward)
    }
    const onTitle = (t: string)  => setTitle(t || 'MagicMoney Browser')

    window.wallet.onBrowserUrl(onUrl)
    window.wallet.onBrowserLoading(onLoad)
    window.wallet.onBrowserNavState(onNav)
    window.wallet.onBrowserTitle(onTitle)

    window.wallet.browserGetState().then(s => {
      setUrl(s.url); setInputUrl(s.url)
      setCanBack(s.canBack); setCanFwd(s.canForward)
      setLoading(s.loading)
    })

    return () => {
      window.wallet.offBrowserUrl(onUrl)
      window.wallet.offBrowserLoading(onLoad)
      window.wallet.offBrowserNavState(onNav)
      window.wallet.offBrowserTitle(onTitle)
    }
  }, [])

  const navigate = useCallback((target: string) => {
    window.wallet.browserNavigate(target)
    inputRef.current?.blur()
  }, [])

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    navigate(inputUrl)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)', overflow: 'hidden' }}>
      {/* ── Custom titlebar ──────────────────────────────────────────── */}
      <div
        className="titlebar"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 4 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          <span className="titlebar-title" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </span>
        </div>
        <div className="titlebar-controls">
          <button type="button" className="titlebar-btn min" onClick={() => window.wallet.minimize()} title="Minimize" />
          <button type="button" className="titlebar-btn close" onClick={() => window.wallet.close()} title="Close" />
        </div>
      </div>

      {/* ── Address bar / nav chrome ─────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0
      }}>
        <NavBtn onClick={() => window.wallet.browserBack()} disabled={!canBack} title="Back">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </NavBtn>

        <NavBtn onClick={() => window.wallet.browserForward()} disabled={!canFwd} title="Forward">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </NavBtn>

        <NavBtn onClick={() => window.wallet.browserReload()} title={loading ? 'Stop' : 'Reload'}>
          {loading ? (
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          ) : (
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          )}
        </NavBtn>

        <NavBtn onClick={() => window.wallet.browserHome()} title="Home (ChainLens)">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </NavBtn>

        {/* URL bar */}
        <form onSubmit={onSubmit} style={{ flex: 1, minWidth: 0 }}>
          <input
            ref={inputRef}
            type="text"
            value={inputUrl}
            onChange={e => setInputUrl(e.target.value)}
            spellCheck={false}
            style={{
              width: '100%', padding: '5px 12px',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 20,
              color: 'var(--text-primary)',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              outline: 'none',
              boxSizing: 'border-box',
              transition: 'border-color 0.15s'
            }}
            onFocus={e => { setInputUrl(url); e.currentTarget.select(); e.currentTarget.style.borderColor = 'var(--accent)' }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
          />
        </form>

        {/* Web3 connected badge */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '3px 8px',
          background: 'rgba(34,197,94,0.08)',
          border: '1px solid rgba(34,197,94,0.25)',
          borderRadius: 12,
          flexShrink: 0
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} />
          <span style={{ fontSize: 10, fontWeight: 600, color: '#22c55e', letterSpacing: '0.04em' }}>Web3</span>
        </div>

        {loading && (
          <div style={{
            width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
            border: '1.5px solid var(--border)', borderTopColor: 'var(--accent)',
            animation: 'spin 0.7s linear infinite'
          }} />
        )}
      </div>

      {/* ── Content area (filled by WebContentsView from main process) ── */}
      <div style={{ flex: 1, background: 'transparent' }} />
    </div>
  )
}

function NavBtn({
  onClick, disabled, title, children
}: {
  onClick: () => void
  disabled?: boolean
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, flexShrink: 0,
        background: 'none', border: 'none', borderRadius: 6,
        color: disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'background 0.15s, color 0.15s', padding: 0
      }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-raised)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
    >
      {children}
    </button>
  )
}
