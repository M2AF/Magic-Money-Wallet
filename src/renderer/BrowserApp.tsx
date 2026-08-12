import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react'
import { FullScreenButton, SnapMenu } from './components/WindowLayout'
import { MagicGuardControl } from './components/MagicGuardControl'
import { AddressBarStar, ShareControl, BrowserMenu } from './components/BrowserMenu'
import { BookmarksPanel } from './components/BookmarksPanel'
import { PasswordManager } from './components/PasswordManager'
import APP_HUB, { type AppEntry } from './data/app-hub'
import wordmarkUrl from './assets/wordmark.png'
import logoUrl from './assets/logo.png'
import type { TorBrowserState, MagicGuardState, BrowserPageState } from './types/wallet'

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
  // The tab overview, address-bar suggestions, wallet-snap menu, Magic Guard
  // panel, hamburger/share dropdowns, and the bookmarks/password panels are all
  // floating surfaces that extend into the area the active dApp WebContentsView
  // covers, so at most one may be open at a time — opening any of them detaches
  // that view and paints a snapshot behind it (see openOverlay), and closing
  // re-attaches it.
  type OverlayKind = 'tabs' | 'suggest' | 'snap' | 'guard' | 'menu' | 'share' | 'bookmarks' | 'passwords'
  const [overlay, setOverlay]   = useState<OverlayKind | null>(null)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [typed, setTyped]       = useState(false)
  const menuOpen     = overlay === 'tabs'
  const sugOpen      = overlay === 'suggest'
  const snapMenuOpen = overlay === 'snap'
  const guardOpen    = overlay === 'guard'
  const appMenuOpen  = overlay === 'menu'
  const shareOpen    = overlay === 'share'
  const [tor, setTor] = useState<TorBrowserState>({
    enabled: false, status: 'off', host: '127.0.0.1', port: 9050,
    isTor: false, message: 'Tor Mode is off',
  })
  const [guard, setGuard] = useState<MagicGuardState>({
    enabled: true, siteEnabled: true, effectiveEnabled: false, status: 'loading',
    hostname: null, blockedThisPage: 0, blockedThisTab: 0,
  })
  // Everything the chrome needs about the page in the active tab (bookmarked?
  // installed as an app? any saved logins?). Re-read from main after every
  // navigation — main derives it from the tab itself, never from `url` here.
  const [page, setPage] = useState<BrowserPageState>({
    url: HOME, title: '', host: '', bookmarked: false, installed: false,
    savedLogins: [], passwordsUnlocked: false,
  })
  const [webAppsSupported, setWebAppsSupported] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
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

  useEffect(() => {
    const onTor = (state: TorBrowserState) => setTor(state)
    window.wallet.browserGetTorState?.().then(onTor).catch(() => {})
    window.wallet.onBrowserTorState?.(onTor)
    return () => window.wallet.offBrowserTorState?.(onTor)
  }, [])

  useEffect(() => {
    const onGuard = (state: MagicGuardState) => setGuard(state)
    window.wallet.browserGetMagicGuardState?.().then(onGuard).catch(() => {})
    window.wallet.onBrowserGuardState?.(onGuard)
    return () => window.wallet.offBrowserGuardState?.(onGuard)
  }, [])

  // Bookmark/app/login state depends only on where the tab actually IS, so it is
  // refreshed on every url change rather than pushed on its own channel.
  const refreshPageState = useCallback(() => {
    window.wallet.browserGetPageState?.().then(setPage).catch(() => {})
  }, [])

  useEffect(() => { refreshPageState() }, [url, refreshPageState])

  useEffect(() => {
    window.wallet.browserWebAppsSupported?.().then(setWebAppsSupported).catch(() => {})
  }, [])

  // Auto-fill confirmation: main filled a saved login into the page (exact-host
  // match only, never submitted) — surface it so the fill is never silent.
  useEffect(() => {
    const onFilled = (s: { host: string; username: string; more: number }) => {
      const who = s.username ? ` for ${s.username}` : ''
      const more = s.more > 0 ? ` (+${s.more} more in the password manager)` : ''
      setToast(`Filled saved login${who}${more}`)
    }
    window.wallet.onBrowserAutofill?.(onFilled)
    return () => window.wallet.offBrowserAutofill?.(onFilled)
  }, [])

  // Status text pushed from main (a download finished, etc).
  useEffect(() => {
    const onToast = (message: string) => setToast(message)
    window.wallet.onBrowserToast?.(onToast)
    return () => window.wallet.offBrowserToast?.(onToast)
  }, [])

  // HTML5 fullscreen: main gives the tab's view the whole window and puts the
  // window into OS fullscreen, so the chrome must get out of the way entirely —
  // otherwise it keeps reporting a chrome height and re-appears on the next
  // layout pass.
  useEffect(() => {
    const onFullscreen = (v: boolean) => setFullscreen(v)
    window.wallet.onBrowserFullscreen?.(onFullscreen)
    return () => window.wallet.offBrowserFullscreen?.(onFullscreen)
  }, [])

  // Transient confirmation ("Bookmark added", "Link copied"). One at a time; a
  // newer message replaces the older one and restarts the timer.
  const showToast = useCallback((message: string) => {
    setToast(message)
  }, [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const navigate = useCallback((target: string) => {
    window.wallet.browserNavigate(target)
    inputRef.current?.blur()
  }, [])

  // Tor Mode now lives in the ☰ menu rather than its own toolbar pill, but the
  // fail-closed contract is unchanged: flip to 'connecting' immediately so the
  // blocking TorStatusPanel appears before any request can go out, and let main's
  // reply settle the real state.
  const setTorMode = useCallback(async (enabled: boolean) => {
    if (!window.wallet.browserSetTorMode) return
    setTor(prev => ({
      ...prev, enabled, status: 'connecting',
      message: enabled ? 'Connecting to local Tor…' : 'Turning Tor Mode off…',
    }))
    try {
      setTor(await window.wallet.browserSetTorMode(enabled))
    } catch {
      setTor(prev => ({ ...prev, status: 'error', message: 'Could not change the browser proxy. Reload the app before browsing.' }))
    }
  }, [])

  // Open any one overlay: snapshot the live page (returned by suspend) and paint it
  // behind the dropdown so the dApp stays visible while the overlay is open.
  //
  // The owner is tracked in a ref as well as state because these transitions
  // happen across separate native events (a blur that closes the suggestions,
  // then the click that opens the share menu). Reading `overlay` from the render
  // closure could still see the previous owner and drop the second interaction;
  // the ref is always current. Handing over while one is already open just swaps
  // which surface owns the already-detached view — no second suspend/snapshot.
  const overlayRef = useRef<OverlayKind | null>(null)
  const openOverlay = useCallback(async (kind: OverlayKind) => {
    if (overlayRef.current === kind) return
    if (overlayRef.current) {
      overlayRef.current = kind
      setOverlay(kind)
      return
    }
    overlayRef.current = kind
    const img = await window.wallet.browserSuspendTabsMenu()
    setSnapshot(img || null)
    setOverlay(kind)
  }, [])

  const closeOverlay = useCallback(() => {
    overlayRef.current = null
    setOverlay(null)
    setSnapshot(null)
    window.wallet.browserResumeTabsMenu()
  }, [])

  const openTabsMenu = useCallback(() => openOverlay('tabs'), [openOverlay])

  // Address-bar App Hub suggestions reuse the same suspend/snapshot machinery, but
  // need an extra focus recheck: focus may have moved on while the snapshot was
  // being captured (the fetch is async), so bail out without opening if so.
  const openSuggest = useCallback(async () => {
    if (overlayRef.current) return
    overlayRef.current = 'suggest'
    const img = await window.wallet.browserSuspendTabsMenu()
    if (document.activeElement !== inputRef.current) {
      overlayRef.current = null
      window.wallet.browserResumeTabsMenu()
      return
    }
    setSnapshot(img || null)
    setOverlay('suggest')
  }, [])

  const closeSuggest = closeOverlay

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

  // Report the real chrome height (titlebar + address bar) to the main process so
  // the dApp view sits flush beneath the address bar — never covering its bottom
  // edge. The content div's viewport-top IS the chrome height; re-measure on any
  // layout change (window resize, font load) so it can never drift.
  const contentRef = useRef<HTMLDivElement>(null)
  // The height reporter runs from a deps-free layout effect, so it reads the
  // fullscreen flag through a ref rather than a stale closure.
  const fullscreenRef = useRef(false)
  fullscreenRef.current = fullscreen
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    const report = () => {
      // While a video is fullscreen the view owns the whole window; reporting a
      // chrome height here would push it back down and re-expose the toolbar.
      if (fullscreenRef.current) return
      const top = Math.round(el.getBoundingClientRect().top)
      if (top > 0) window.wallet.browserSetChromeHeight?.(top)
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(document.body)
    window.addEventListener('resize', report)
    return () => { ro.disconnect(); window.removeEventListener('resize', report) }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)', overflow: 'hidden' }}>
      {/* ── Custom titlebar ────────────────────────────────────────────
          Hidden entirely during HTML5 fullscreen so the video really is
          fullscreen (the view already covers the window; leaving these mounted
          would keep re-reporting a chrome height). */}
      <div
        className="titlebar"
        style={{
          display: fullscreen ? 'none' : 'flex',
          alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <img
          src={logoUrl}
          alt="MagicMoney"
          draggable={false}
          style={{ height: 55, width: 'auto', objectFit: 'contain', marginLeft: 2, position: 'relative', top: 6, userSelect: 'none', pointerEvents: 'none' }}
        />
        <img src={wordmarkUrl} alt="Magic Money" className="titlebar-wordmark" draggable={false} />
        <div className="titlebar-controls">
          <button type="button" className="titlebar-btn min" onClick={() => window.wallet.minimize()} title="Minimize" />
          <FullScreenButton />
          <button type="button" className="titlebar-btn close" onClick={() => window.wallet.close()} title="Close" />
        </div>
      </div>

      {/* ── Address bar / nav chrome ─────────────────────────────────── */}
      <div style={{
        display: fullscreen ? 'none' : 'flex',
        alignItems: 'center', gap: 6,
        padding: '6px 10px',
        background: 'var(--bg)',
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

        {/* Magic Guard — privacy filtering for this dApp tab */}
        <MagicGuardControl
          state={guard}
          onChange={setGuard}
          open={guardOpen}
          onOpen={() => openOverlay('guard')}
          onClose={closeOverlay}
        />

        {/* URL bar + App Hub suggestions */}
        <form onSubmit={onSubmit} style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <input
            ref={inputRef}
            type="text"
            value={inputUrl}
            onChange={e => { setInputUrl(e.target.value); setTyped(true) }}
            spellCheck={false}
            style={{
              width: '100%', padding: '5px 62px 5px 12px',
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

          {/* Bookmark star + share, at the end of the address bar (Brave's layout).
              onMouseDown-preventDefault keeps the input from blurring underneath
              them, which would otherwise close the suggestions and swallow the
              first click. */}
          <div
            onMouseDown={e => e.preventDefault()}
            style={{
              // No transform here on purpose: a transformed ancestor would turn the
              // dropdowns' `position: fixed` backdrop into an absolute one, so
              // outside clicks would stop closing them.
              position: 'absolute', right: 6, top: 0, bottom: 0,
              display: 'flex', alignItems: 'center', gap: 2,
            }}
          >
            <AddressBarStar page={page} onPageState={setPage} onToast={showToast} />
            <ShareControl
              page={page}
              open={shareOpen}
              onOpen={() => openOverlay('share')}
              onClose={closeOverlay}
              onPageState={setPage}
              onToast={showToast}
            />
          </div>

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

        {/* Snap the wallet + browser side by side — left of the tabs button */}
        <SnapMenu
          open={snapMenuOpen}
          onOpen={() => openOverlay('snap')}
          onClose={closeOverlay}
        />

        {/* Open tabs */}
        <TabsMenu
          tabs={tabs}
          activeTabId={activeTabId}
          open={menuOpen}
          onOpen={openTabsMenu}
          onClose={closeOverlay}
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

        {/* ☰ — password manager, bookmarks, Tor Mode, save and share */}
        <BrowserMenu
          page={page}
          tor={tor}
          open={appMenuOpen}
          onOpen={() => openOverlay('menu')}
          onClose={closeOverlay}
          onPageState={setPage}
          onToast={showToast}
          onOpenBookmarks={() => openOverlay('bookmarks')}
          onOpenPasswords={() => openOverlay('passwords')}
          onSetTor={setTorMode}
          webAppsSupported={webAppsSupported}
        />
      </div>

      {/* ── Content area (filled by WebContentsView from main process) ─────
          While the tab overview is open the live view is detached, so we paint
          the snapshot captured on open here to keep the dApp visible behind it. */}
      <div ref={contentRef} style={{
        flex: 1,
        position: 'relative',
        background: 'transparent',
        ...(snapshot ? {
          backgroundImage: `url(${snapshot})`,
          backgroundSize: '100% 100%',
          backgroundRepeat: 'no-repeat',
        } : {}),
      }}>
        {tor.enabled && tor.status !== 'connected' && (
          <TorStatusPanel state={tor} onChange={setTor} />
        )}

        {/* Panels opened from ☰. They own the detached-view overlay slot, so they
            sit over the page snapshot exactly like the Tor block screen above —
            bookmarks full-area, passwords as an anchored card. */}
        {overlay === 'bookmarks' && (
          <BookmarksPanel onClose={closeOverlay} onNavigate={navigate} onToast={showToast} />
        )}
        {overlay === 'passwords' && (
          <PasswordManager
            currentHost={page.host}
            currentUrl={page.url}
            onClose={closeOverlay}
            onToast={showToast}
            onChanged={refreshPageState}
            // Anchored card under the ☰ it came from, not a full-window sheet.
            floating
          />
        )}

        {toast && <Toast message={toast} />}
      </div>
    </div>
  )
}

/**
 * Transient confirmation for actions with no other visible result — "Bookmark
 * added", "Link copied", "Screenshot saved". Sits above the panels but is
 * pointer-transparent so it can never swallow a click.
 */
function Toast({ message }: { message: string }) {
  return (
    <div
      role="status"
      style={{
        position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)',
        zIndex: 60, pointerEvents: 'none', maxWidth: '80%',
        padding: '9px 16px', borderRadius: 999,
        background: 'var(--bg-surface)', border: '1px solid var(--border-active)',
        boxShadow: '0 10px 28px rgba(0, 0, 0, 0.45)',
        color: 'var(--text-primary)', fontSize: 12, fontWeight: 600,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}
    >
      {message}
    </div>
  )
}

function TorStatusPanel({ state, onChange }: { state: TorBrowserState; onChange: (state: TorBrowserState) => void }) {
  const busy = state.status === 'connecting'
  const changeMode = async (enabled: boolean) => {
    if (!window.wallet.browserSetTorMode) return
    onChange({ ...state, enabled, status: 'connecting', message: enabled ? 'Preparing Tor…' : 'Turning Tor Mode off…' })
    try {
      onChange(await window.wallet.browserSetTorMode(enabled))
    } catch {
      onChange({ ...state, status: 'error', message: 'Tor could not be started. Direct browsing remains blocked.' })
    }
  }

  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, background: 'var(--bg)', color: 'var(--text-primary)',
    }}>
      <div style={{
        width: 'min(460px, 100%)', padding: 24, borderRadius: 16,
        border: `1px solid ${state.status === 'error' ? '#7f1d1d' : 'var(--border-active)'}`,
        background: 'var(--bg-surface)', boxShadow: '0 18px 50px rgba(0,0,0,0.32)',
        textAlign: 'center',
      }}>
        <div aria-hidden="true" style={{ fontSize: 36, marginBottom: 10 }}>🧅</div>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>
          {busy ? 'Starting Tor…' : 'Tor is unavailable'}
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--text-secondary)', marginBottom: 6 }}>
          {state.message}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 18 }}>
          Browser traffic is blocked—MagicMoney will never fall back to your direct connection while Tor Mode is on.
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
          {!busy && (
            <button type="button" className="btn btn-secondary" onClick={() => changeMode(true)}>
              Retry Tor
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => changeMode(false)}>
            Turn Off Tor Mode
          </button>
        </div>
      </div>
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
    const onChange = (hex: string) => {
      setChainId(hex)
      // Testnet Mode flips swap the whole chain list (and push a chainChanged),
      // so refresh the options too — not just the selected pill.
      window.wallet.web3GetChains().then(setChains).catch(() => {})
    }
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
