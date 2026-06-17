import { useState, useEffect, useRef, useCallback } from 'react'

const HOME = 'https://chainlensnft.info'

export function BrowserPage() {
  const [url, setUrl]           = useState(HOME)
  const [inputUrl, setInputUrl] = useState(HOME)
  const [loading, setLoading]   = useState(false)
  const [canBack, setCanBack]   = useState(false)
  const [canFwd, setCanFwd]     = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Subscribe to nav events pushed from main process ──────────────────
  useEffect(() => {
    const onUrl = (u: string)                          => { setUrl(u); setInputUrl(u) }
    const onLoad = (v: boolean)                        => setLoading(v)
    const onNav  = (s: { canBack: boolean; canForward: boolean }) => {
      setCanBack(s.canBack)
      setCanFwd(s.canForward)
    }

    window.wallet.onBrowserUrl(onUrl)
    window.wallet.onBrowserLoading(onLoad)
    window.wallet.onBrowserNavState(onNav)

    // Hydrate initial state
    window.wallet.browserGetState().then(s => {
      setUrl(s.url); setInputUrl(s.url)
      setCanBack(s.canBack); setCanFwd(s.canForward)
      setLoading(s.loading)
    })

    return () => {
      window.wallet.offBrowserUrl(onUrl)
      window.wallet.offBrowserLoading(onLoad)
      window.wallet.offBrowserNavState(onNav)
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

  const displayUrl = (() => {
    try { return new URL(url).hostname } catch { return url }
  })()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Browser chrome bar ────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0
      }}>
        {/* Back */}
        <NavBtn onClick={() => window.wallet.browserBack()} disabled={!canBack} title="Back">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </NavBtn>

        {/* Forward */}
        <NavBtn onClick={() => window.wallet.browserForward()} disabled={!canFwd} title="Forward">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </NavBtn>

        {/* Reload / Stop */}
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

        {/* Home */}
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
            onFocus={() => setInputUrl(url)}
            placeholder={displayUrl}
            spellCheck={false}
            style={{
              width: '100%', padding: '4px 10px',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 20,
              color: 'var(--text-primary)',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              outline: 'none',
              boxSizing: 'border-box'
            }}
          />
        </form>

        {/* Loading spinner */}
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
        width: 26, height: 26, flexShrink: 0,
        background: 'none', border: 'none', borderRadius: 6,
        color: disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'background 0.15s, color 0.15s',
        padding: 0
      }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-raised)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
    >
      {children}
    </button>
  )
}
