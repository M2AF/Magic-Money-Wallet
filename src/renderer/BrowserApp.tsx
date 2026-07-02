import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { FullScreenButton, LayoutMenu } from './components/WindowLayout'
import APP_HUB, { type AppEntry } from './data/app-hub'

const HOME = 'https://chainlensnft.info'

// Address-bar suggestions: same matching as the App Hub search (name/website
// substring), same "Featured" set as the popular default when nothing is typed.
const SUGGEST_LIMIT = 8
function suggestApps(query: string): AppEntry[] {
  const q = query.trim().toLowerCase()
  const pool = q
    ? APP_HUB.apps.filter(a => a.name.toLowerCase().includes(q) || a.website.toLowerCase().includes(q))
    : APP_HUB.apps.filter(a => a.featured)
  return pool.slice(0, SUGGEST_LIMIT)
}

interface TabInfo { id: number; title: string; url: string; loading: boolean }

export function BrowserApp() {
  const [url, setUrl]           = useState(HOME)
  const [inputUrl, setInputUrl] = useState(HOME)
  const [loading, setLoading]   = useState(false)
  const [canBack, setCanBack]   = useState(false)
  const [canFwd, setCanFwd]     = useState(false)
  const [title, setTitle]       = useState('MagicMoney Browser')
  const [tabs, setTabs]         = useState<TabInfo[]>([])
  const [activeTabId, setActiveTabId] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [sugOpen, setSugOpen]   = useState(false)
  const [typed, setTyped]       = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Subscribe to nav events from main process ──────────────────────────
  useEffect(() => {
    const onUrl   = (u: string)  => { setUrl(u); setInputUrl(u) }
    const onLoad  = (v: boolean) => setLoading(v)
    const onNav   = (s: { canBack: boolean; canForward: boolean }) => {
      setCanBack(s.canBack); setCanFwd(s.canForward)
    }
    const onTitle = (t: string)  => setTitle(t || 'MagicMoney Browser')
    const onTabs  = (s: { activeTabId: number; tabs: TabInfo[] }) => {
      setTabs(s.tabs); setActiveTabId(s.activeTabId)
    }

    window.wallet.onBrowserUrl(onUrl)
    window.wallet.onBrowserLoading(onLoad)
    window.wallet.onBrowserNavState(onNav)
    window.wallet.onBrowserTitle(onTitle)
    window.wallet.onBrowserTabs(onTabs)

    window.wallet.browserGetState().then(s => {
      setUrl(s.url); setInputUrl(s.url)
      setCanBack(s.canBack); setCanFwd(s.canForward)
      setLoading(s.loading)
      setTabs(s.tabs ?? []); setActiveTabId(s.activeTabId ?? 0)
    })

    return () => {
      window.wallet.offBrowserUrl(onUrl)
      window.wallet.offBrowserLoading(onLoad)
      window.wallet.offBrowserNavState(onNav)
      window.wallet.offBrowserTitle(onTitle)
      window.wallet.offBrowserTabs(onTabs)
    }
  }, [])

  const navigate = useCallback((target: string) => {
    window.wallet.browserNavigate(target)
    inputRef.current?.blur()
  }, [])

  // Tab overview: snapshot the live page (returned by suspend) and paint it behind
  // the dropdown so the dApp stays visible while the overlay is open.
  const openTabsMenu = useCallback(async () => {
    const img = await window.wallet.browserSuspendTabsMenu()
    setSnapshot(img || null)
    setMenuOpen(true)
  }, [])
  const closeTabsMenu = useCallback(() => {
    setMenuOpen(false)
    setSnapshot(null)
    window.wallet.browserResumeTabsMenu()
  }, [])

  // Address-bar App Hub suggestions. The dropdown extends below the chrome into
  // the area covered by the dApp WebContentsView, so while it is open it reuses
  // the exact suspend/snapshot machinery the tab overview uses: detach the live
  // view, paint its snapshot behind the dropdown, re-attach on close.
  const openSuggest = useCallback(async () => {
    if (menuOpen) return // tab overview owns the overlay right now
    const img = await window.wallet.browserSuspendTabsMenu()
    // Focus may have moved on while the snapshot was being captured.
    if (document.activeElement !== inputRef.current) {
      window.wallet.browserResumeTabsMenu()
      return
    }
    setSnapshot(img || null)
    setSugOpen(true)
  }, [menuOpen])

  const closeSuggest = useCallback(() => {
    setSugOpen(false)
    setSnapshot(null)
    window.wallet.browserResumeTabsMenu()
  }, [])

  // Nothing typed yet → App Hub "Featured" (popular); typing narrows exactly
  // like the App Hub search. Always current: the data is regenerated from
  // ChainLens_Files/app-hub-data.js on every dev run and build.
  const suggestions = useMemo(
    () => (sugOpen ? suggestApps(typed ? inputUrl : '') : []),
    [sugOpen, typed, inputUrl]
  )

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
          <FullScreenButton />
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

        {/* URL bar + App Hub suggestions */}
        <form onSubmit={onSubmit} style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <input
            ref={inputRef}
            type="text"
            value={inputUrl}
            onChange={e => { setInputUrl(e.target.value); setTyped(true) }}
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
            onFocus={e => { setInputUrl(url); setTyped(false); e.currentTarget.select(); e.currentTarget.style.borderColor = 'var(--accent)'; openSuggest() }}
            onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)'; if (sugOpen) closeSuggest() }}
            onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.blur() }}
          />

          {sugOpen && (
            <div
              // Keep focus in the input so clicking a suggestion isn't killed by blur.
              onMouseDown={e => e.preventDefault()}
              style={{
                position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 50,
                background: 'var(--bg-surface)', border: '1px solid var(--border-active)',
                borderRadius: 12, boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
                padding: 4, maxHeight: 340, overflowY: 'auto',
              }}
            >
              <div style={{
                padding: '6px 8px 8px', fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
                textTransform: 'uppercase', color: 'var(--text-muted)',
              }}>
                {typed && inputUrl.trim() ? `Apps (${suggestions.length})` : 'Popular apps'}
              </div>

              {suggestions.map(a => (
                <SuggestRow key={a.id} app={a} onOpen={navigate} />
              ))}

              {suggestions.length === 0 && (
                <div style={{ padding: '4px 8px 10px', fontSize: 12, color: 'var(--text-muted)' }}>
                  No matching apps — press Enter to open the address
                </div>
              )}
            </div>
          )}
        </form>

        {/* Window layout (Full Screen Mode / side / detach) — left of the tabs button */}
        <LayoutMenu />

        {/* Open tabs */}
        <TabsMenu
          tabs={tabs}
          activeTabId={activeTabId}
          open={menuOpen}
          onOpen={openTabsMenu}
          onClose={closeTabsMenu}
        />

        {/* Network switcher (active EVM network + manual switch) */}
        <NetworkSwitcher />

        {loading && (
          <div style={{
            width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
            border: '1.5px solid var(--border)', borderTopColor: 'var(--accent)',
            animation: 'spin 0.7s linear infinite'
          }} />
        )}
      </div>

      {/* ── Content area (filled by WebContentsView from main process) ─────
          While the tab overview is open the live view is detached, so we paint
          the snapshot captured on open here to keep the dApp visible behind it. */}
      <div style={{
        flex: 1,
        background: 'transparent',
        ...(snapshot ? {
          backgroundImage: `url(${snapshot})`,
          backgroundSize: '100% 100%',
          backgroundRepeat: 'no-repeat',
        } : {}),
      }} />
    </div>
  )
}

// One row of the address-bar App Hub dropdown: favicon, name, hostname, category.
// Clicking navigates the ACTIVE tab to the app — same semantics as typing its URL.
function SuggestRow({ app, onOpen }: { app: AppEntry; onOpen: (url: string) => void }) {
  const [imgErr, setImgErr] = useState(false)
  let host = app.website
  try { host = new URL(app.website).hostname } catch { /* keep raw website */ }

  return (
    <div
      onClick={() => onOpen(app.website)}
      title={app.website}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 8px', borderRadius: 8, cursor: 'pointer',
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {imgErr || !app.favicon ? (
        <div style={{
          width: 20, height: 20, borderRadius: 6, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--surface-raised)', border: '1px solid var(--border)',
          fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)',
        }}>
          {app.name.charAt(0).toUpperCase()}
        </div>
      ) : (
        <img
          src={app.favicon}
          alt=""
          width={20}
          height={20}
          style={{ borderRadius: 6, flexShrink: 0 }}
          onError={() => setImgErr(true)}
          loading="lazy"
        />
      )}

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{
          fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {app.name}
        </span>
        <span style={{
          fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {host}
        </span>
      </div>

      <span style={{
        fontSize: 9, fontWeight: 600, flexShrink: 0, padding: '2px 6px',
        borderRadius: 8, background: 'var(--surface-raised)',
        border: '1px solid var(--border)', color: 'var(--text-secondary)',
        whiteSpace: 'nowrap',
      }}>
        {app.category}
      </span>
    </div>
  )
}

// Active EVM network for the dApp browser. Shows the current network and lets the
// user switch it manually — which fires chainChanged to the dApp exactly like a
// dApp-initiated wallet_switchEthereumChain. A NATIVE <select> is used on purpose:
// its option popup is OS-drawn and floats above the dApp WebContentsView, whereas a
// custom HTML dropdown would be hidden behind that view.
function NetworkSwitcher() {
  const [chains, setChains] = useState<Array<{ chainId: number; id: string; name: string; color: string }>>([])
  const [chainId, setChainId] = useState('0x1')

  useEffect(() => {
    window.wallet.web3GetChains().then(setChains).catch(() => {})
    window.wallet.web3GetChain().then(setChainId).catch(() => {})
    const onChange = (hex: string) => setChainId(hex)
    window.wallet.onWeb3ChainChanged(onChange)
    return () => window.wallet.offWeb3ChainChanged(onChange)
  }, [])

  const numId = parseInt(chainId, 16)
  const current = chains.find(c => c.chainId === numId)
  const color = current?.color ?? '#22c55e'
  const label = current?.name ?? (Number.isFinite(numId) ? `Chain ${numId}` : 'Network')

  return (
    <div
      title="Switch network"
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 5,
        padding: '3px 8px', background: 'var(--surface-raised)',
        border: '1px solid var(--border)', borderRadius: 12,
        flexShrink: 0, maxWidth: 150
      }}
    >
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
        <polyline points="6 9 12 15 18 9" />
      </svg>
      <select
        aria-label="Switch network"
        value={Number.isFinite(numId) ? numId : ''}
        onChange={e => {
          const id = Number(e.target.value)
          if (Number.isFinite(id)) window.wallet.web3SetChain(id).then(setChainId).catch(() => {})
        }}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          opacity: 0, cursor: 'pointer', border: 'none', colorScheme: 'dark'
        }}
      >
        {!current && <option value="" disabled>{label}</option>}
        {chains.map(c => (
          <option key={c.id} value={c.chainId}>{c.name}</option>
        ))}
      </select>
    </div>
  )
}

// Custom HTML tab overview. Rendered by the chrome renderer (this React app), NOT a
// native Electron menu — native menus can't put a clickable × on the same row, which
// is what forced the old two-row-per-tab layout. One row per tab: an active-tab dot,
// the tab label (click to switch), and an inline × (click to close).
//
// The active tab's dApp WebContentsView is layered ABOVE this renderer, so it would
// hide the dropdown. On open the main process snapshots the live page and detaches
// the view (browserSuspendTabsMenu); BrowserApp paints that snapshot behind the
// dropdown so the site stays visible, and the view is re-attached on close
// (browserResumeTabsMenu).
function TabsMenu({ tabs, activeTabId, open, onOpen, onClose }: {
  tabs: TabInfo[]
  activeTabId: number
  open: boolean
  onOpen: () => void
  onClose: () => void
}) {
  const count = tabs.length
  const closeMenu = onClose

  // Close on Escape while the overlay is open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeMenu])

  // If every tab closes (shouldn't happen — the last tab resets to Home), fold up.
  useEffect(() => { if (open && count === 0) closeMenu() }, [open, count, closeMenu])

  const tabLabel = (t: TabInfo) => {
    const name = t.title && t.title !== 'New Tab' && t.title !== 'Untitled' ? t.title : ''
    if (name) return name
    try { return new URL(t.url).hostname } catch { return t.url }
  }

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        title={`${count} open tab${count !== 1 ? 's' : ''}`}
        onClick={() => (open ? closeMenu() : onOpen())}
        style={{
          position: 'relative', zIndex: open ? 50 : undefined,
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '3px 9px', background: open ? 'var(--bg)' : 'var(--surface-raised)',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 12,
          flexShrink: 0, cursor: 'pointer', color: open ? 'var(--text-primary)' : 'var(--text-secondary)',
          transition: 'border-color 0.15s, color 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--text-primary)' }}
        onMouseLeave={e => { if (!open) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' } }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
        </svg>
        <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{count}</span>
      </button>

      {open && (
        <>
          {/* Transparent backdrop: keeps the page (snapshot) visible and catches
              outside clicks to close. */}
          <div
            onClick={closeMenu}
            style={{ position: 'fixed', inset: 0, background: 'transparent', zIndex: 40 }}
          />
          {/* Dropdown panel */}
          <div
            style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 50,
              width: 280, maxHeight: 360, overflowY: 'auto',
              background: 'var(--bg-surface)', border: '1px solid var(--border-active)',
              borderRadius: 12, boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
              padding: 4,
            }}
          >
            <div style={{
              padding: '6px 8px 8px', fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
              textTransform: 'uppercase', color: 'var(--text-muted)',
            }}>
              Open tabs ({count})
            </div>

            {tabs.map(t => {
              const isActive = t.id === activeTabId
              return (
                <div
                  key={t.id}
                  onClick={() => { window.wallet.browserSetActiveTab(t.id); closeMenu() }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 6px 7px 8px', borderRadius: 8, cursor: 'pointer',
                    background: isActive ? 'var(--accent-dim)' : 'transparent',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)' }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                >
                  {/* Active-tab dot */}
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: isActive ? 'var(--accent)' : 'transparent',
                    border: isActive ? 'none' : '1px solid var(--border)',
                  }} />

                  <span style={{
                    flex: 1, minWidth: 0, fontSize: 12,
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {tabLabel(t)}
                  </span>

                  {/* Inline close — hidden for the last remaining tab (it can't be removed). */}
                  {count > 1 && (
                    <button
                      type="button"
                      title="Close tab"
                      aria-label={`Close ${tabLabel(t)}`}
                      onClick={e => { e.stopPropagation(); window.wallet.browserCloseTab(t.id) }}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: 20, height: 20, flexShrink: 0, padding: 0,
                        background: 'none', border: 'none', borderRadius: 5,
                        color: 'var(--text-muted)', cursor: 'pointer', transition: 'background 0.12s, color 0.12s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--border)'; e.currentTarget.style.color = 'var(--text-primary)' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)' }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
              )
            })}

            <div style={{ height: 1, background: 'var(--border)', margin: '4px 6px' }} />

            <div
              onClick={() => { window.wallet.browserNewTab(); closeMenu() }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px', borderRadius: 8, cursor: 'pointer',
                fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)',
                transition: 'background 0.12s, color 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-raised)'; e.currentTarget.style.color = 'var(--text-primary)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New tab
            </div>
          </div>
        </>
      )}
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
