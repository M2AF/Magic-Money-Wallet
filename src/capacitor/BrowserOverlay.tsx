/**
 * BrowserOverlay.tsx — full-screen in-app dApp browser chrome (Android)
 *
 * The JS toolbar/tab UI lives in the wallet WebView; the page content renders
 * in native WebViews positioned by the DappBrowser plugin to fill the area
 * under the toolbar (the Electron WebContentsView + BrowserApp.tsx pattern,
 * phone-shaped). Mounted once by CapApp; opens on 'cap:browser:open' bus
 * events emitted by wallet-local's browser* methods.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { DappBrowser, type DappBrowserState } from './dapp-browser'
import { onUiEvent, offUiEvent, emitUiEvent } from './platform-capacitor'
import { NetworkSwitcher } from '../renderer/components/NetworkSwitcher'
import { BookmarksPanel } from '../renderer/components/BookmarksPanel'
import { PasswordManager } from '../renderer/components/PasswordManager'
import mascotUrl from '../renderer/assets/magic-guard.png'
import type { TorBrowserState, MagicGuardState, BrowserPageState } from '../renderer/types/wallet'

// Android can't read another app's profile, so the desktop "import from Chrome/
// Edge/Brave" affordance is replaced by CSV-only wording in the shared panels.
const ANDROID_PASSWORD_IMPORT_EMPTY =
  'Android apps cannot read another browser’s data. Export your passwords to a CSV file from that browser and import the file instead.'
// Bookmarks have no CSV path — say what is actually possible rather than
// pointing at a file format this panel doesn't accept.
const ANDROID_BOOKMARK_IMPORT_EMPTY =
  'Android apps cannot read another browser’s bookmarks. Add pages here with the ☆ in the address bar.'
const ANDROID_APPS_EMPTY =
  'Open the ☰ menu and choose “Install …” to pin a site to your home screen. It opens straight back into the MagicMoney browser.'

export const HOME_URL = 'https://www.chainlensnft.info/'

// Height of the wallet's bottom nav (index.css .bottom-nav is 54px) — the
// browser overlay stops above it so the Portfolio|Market|Swap|Apps|Browser bar
// stays visible and tappable while browsing (the native dApp WebView fills the
// area above it). Matches the nav's own box; adjust here if the nav height or
// safe-area handling changes.
const NAV_STRIP = '54px'

/** CapApp's hardware-back handler consults this to route back-presses here. */
export const browserUiState = { open: false }

// 'open' = session alive + shown; 'hidden' = session alive but tucked behind the
// wallet (native WebViews hidden, TABS PRESERVED); 'closed' = no tabs.
type Session = 'closed' | 'opening' | 'open' | 'hidden'

export function BrowserOverlay() {
  const [visible, setVisible] = useState(false)
  const [url, setUrl] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [inputFocused, setInputFocused] = useState(false)
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)
  const [loading, setLoading] = useState(false)
  const [tabs, setTabs] = useState<DappBrowserState['tabs']>([])
  const [activeTabId, setActiveTabId] = useState(-1)
  const [tor, setTor] = useState<TorBrowserState>({
    enabled: false, status: 'off', host: '127.0.0.1', port: 19050,
    isTor: false, message: 'Tor Mode is off',
  })
  const [guard, setGuard] = useState<MagicGuardState>({
    enabled: true, siteEnabled: true, effectiveEnabled: false, status: 'loading',
    hostname: null, blockedThisPage: 0, blockedThisTab: 0,
  })
  // Inline expandable panel (a row between the tab row and the content area) —
  // NOT a floating dropdown: the native dApp WebView is layered above this
  // WebView, so a dropdown would be hidden behind it. An inline row shrinks
  // contentRef, and the bounds ResizeObserver moves the native view down with it.
  const [guardOpen, setGuardOpen] = useState(false)
  // ☰ menu — same inline-panel treatment as the Magic Guard panel above, for the
  // same reason (no floating dropdown can sit over the native dApp WebView).
  const [menuOpen, setMenuOpen] = useState(false)
  // Full-screen panels. These can't be inline (they'd squash the page to nothing),
  // so while one is open the native WebViews are tucked away — the same move
  // CapApp makes for approval overlays.
  const [panel, setPanel] = useState<null | 'passwords' | 'bookmarks'>(null)
  const [page, setPage] = useState<BrowserPageState>({
    url: '', title: '', host: '', bookmarked: false, installed: false,
    savedLogins: [], passwordsUnlocked: false,
  })
  const [toast, setToast] = useState<string | null>(null)

  const sessionRef = useRef<Session>('closed')
  const pendingUrlRef = useRef<string>(HOME_URL)
  const contentRef = useRef<HTMLDivElement>(null)
  const canBackRef = useRef(false)

  canBackRef.current = canBack
  browserUiState.open = visible

  // Read by the hardware-back handler, whose effect has no deps (it is installed
  // once) — so it must see current values through refs, not a stale closure.
  const panelRef = useRef<null | 'passwords' | 'bookmarks'>(null)
  const menuOpenRef = useRef(false)
  const guardOpenRef = useRef(false)
  panelRef.current = panel
  menuOpenRef.current = menuOpen
  guardOpenRef.current = guardOpen

  const measureBounds = () => {
    const r = contentRef.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 96, width: window.innerWidth, height: window.innerHeight - 96 }
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
  }

  // Fully tear down the session (destroys native tab WebViews). Only reached by
  // closing the LAST tab — never by leaving the browser view.
  const close = () => {
    sessionRef.current = 'closed'
    setVisible(false)
    setTabs([])
    setUrl(''); setUrlInput('')
    DappBrowser.close().catch(() => {})
    emitUiEvent('cap:browser:tabs', 0)
    emitUiEvent('cap:browser:closed', null)
  }

  // Leave the browser view but KEEP the tabs (hide native WebViews). This is the
  // path for tapping a wallet nav tab, the toolbar ✕, or hardware-back at the
  // root of history. The session stays alive; showing it again is instant.
  const hide = () => {
    if (sessionRef.current !== 'open') return
    sessionRef.current = 'hidden'
    // Leave the browser in a clean state — a panel or menu left open would be
    // showing (over a hidden page) the next time the session is revealed.
    setPanel(null)
    setMenuOpen(false)
    setGuardOpen(false)
    setVisible(false)
    DappBrowser.hide().catch(() => {})
    emitUiEvent('cap:browser:hidden', null)
  }

  // Reveal a hidden (or already-open) session: re-show native WebViews + re-measure.
  const show = () => {
    sessionRef.current = 'open'
    setVisible(true)
    requestAnimationFrame(() => {
      DappBrowser.show().catch(() => {})
      DappBrowser.setBounds(measureBounds()).catch(() => {})
    })
  }

  // Bus commands from wallet-local (open / navigate / show / hide / close / back)
  useEffect(() => {
    // Open (or navigate to) a specific URL — from the App Hub or a deep link.
    const onOpen = (d: unknown) => {
      const target = (d as { url?: string })?.url || HOME_URL
      if (sessionRef.current === 'open') {
        DappBrowser.navigate({ url: target }).catch(() => {})
        return
      }
      if (sessionRef.current === 'hidden') {
        // Reveal, then point the active tab at the requested URL.
        show()
        DappBrowser.navigate({ url: target }).catch(() => {})
        return
      }
      pendingUrlRef.current = target
      if (sessionRef.current === 'closed') {
        sessionRef.current = 'opening'
        setVisible(true)   // the open effect below fires after layout
      }
    }
    // Show the existing session (Browser nav tap). Opens home if none yet.
    const onShow = () => {
      if (sessionRef.current === 'hidden' || sessionRef.current === 'open') { show(); return }
      pendingUrlRef.current = HOME_URL
      sessionRef.current = 'opening'
      setVisible(true)
    }
    // Open a URL as a NEW tab (App Hub "Open in New Tab").
    const onNewTab = (d: unknown) => {
      const target = (d as { url?: string })?.url || HOME_URL
      if (sessionRef.current === 'open') {
        DappBrowser.newTab({ url: target }).catch(() => {})
        return
      }
      if (sessionRef.current === 'hidden') {
        DappBrowser.newTab({ url: target }).catch(() => {})
        show()
        return
      }
      // No session yet → start the browser with this URL as its first tab.
      pendingUrlRef.current = target
      sessionRef.current = 'opening'
      setVisible(true)
    }
    const onHide = () => hide()
    const onClose = () => { if (sessionRef.current !== 'closed') close() }
    // Hardware back: dismiss whatever is layered on top first (panel, then ☰
    // menu), then page history, and only at the root hide the browser.
    const onBack = () => {
      if (panelRef.current) { setPanel(null); return }
      if (menuOpenRef.current) { setMenuOpen(false); return }
      if (guardOpenRef.current) { setGuardOpen(false); return }
      if (canBackRef.current) DappBrowser.goBack().catch(() => {})
      else hide()
    }
    onUiEvent('cap:browser:open', onOpen)
    onUiEvent('cap:browser:newtab', onNewTab)
    onUiEvent('cap:browser:show', onShow)
    onUiEvent('cap:browser:hide', onHide)
    onUiEvent('cap:browser:close', onClose)
    onUiEvent('cap:browser:back', onBack)
    return () => {
      offUiEvent('cap:browser:open', onOpen)
      offUiEvent('cap:browser:newtab', onNewTab)
      offUiEvent('cap:browser:show', onShow)
      offUiEvent('cap:browser:hide', onHide)
      offUiEvent('cap:browser:close', onClose)
      offUiEvent('cap:browser:back', onBack)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Open the native WebView once the overlay has laid out (bounds need the DOM)
  useEffect(() => {
    if (!visible || sessionRef.current !== 'opening') return
    let cancelled = false
    requestAnimationFrame(() => {
      if (cancelled) return
      DappBrowser.open({ url: pendingUrlRef.current, bounds: measureBounds() })
        .then(() => { if (!cancelled) sessionRef.current = 'open' })
        .catch(() => { if (!cancelled) close() })
    })
    return () => { cancelled = true }
  }, [visible])

  // Track toolbar/keyboard/rotation layout changes → keep native bounds in step
  useEffect(() => {
    if (!visible || !contentRef.current) return
    const apply = () => { if (sessionRef.current === 'open') DappBrowser.setBounds(measureBounds()).catch(() => {}) }
    const ro = new ResizeObserver(apply)
    ro.observe(contentRef.current)
    window.addEventListener('resize', apply)
    return () => { ro.disconnect(); window.removeEventListener('resize', apply) }
  }, [visible])

  // Native plugin state events
  useEffect(() => {
    DappBrowser.getTorState().then(setTor).catch(() => {})
    DappBrowser.getMagicGuardState().then(setGuard).catch(() => {})
    const handles = [
      DappBrowser.addListener('magicGuardStateChanged', setGuard),
      DappBrowser.addListener('urlChanged', e => { setUrl(e.url); if (!inputFocusedRef.current) setUrlInput(e.url) }),
      DappBrowser.addListener('loadingChanged', e => setLoading(e.loading)),
      DappBrowser.addListener('navState', e => { setCanBack(e.canBack); setCanForward(e.canForward) }),
      DappBrowser.addListener('tabsChanged', e => {
        setTabs(e.tabs); setActiveTabId(e.activeTabId)
        emitUiEvent('cap:browser:tabs', e.tabs.length)   // drives the App's saved-tabs dot
        // Closing the last tab exits the browser entirely (nothing left to show).
        if (e.tabs.length === 0 && sessionRef.current !== 'closed') close()
      }),
      DappBrowser.addListener('closed', () => {
        if (sessionRef.current !== 'closed') {
          sessionRef.current = 'closed'
          setVisible(false)
          emitUiEvent('cap:browser:closed', null)
        }
      }),
      DappBrowser.addListener('torStateChanged', setTor),
    ]
    return () => { handles.forEach(h => h.then(x => x.remove()).catch(() => {})) }
  }, [])

  const inputFocusedRef = useRef(false)
  inputFocusedRef.current = inputFocused

  // ── Page state (bookmarked? installed? saved logins?) ─────────────────────
  // Re-read from wallet-local after every navigation; it derives everything from
  // the ACTIVE TAB itself, never from `url` here.
  const refreshPageState = useCallback(() => {
    window.wallet.browserGetPageState?.().then(setPage).catch(() => {})
  }, [])

  useEffect(() => { if (visible) refreshPageState() }, [url, visible, refreshPageState])

  const showToast = useCallback((message: string) => setToast(message), [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  // Auto-fill confirmation — surfaced so a fill is never silent.
  useEffect(() => {
    const onFilled = (d: unknown) => {
      const s = d as { username?: string; more?: number }
      const who = s?.username ? ` for ${s.username}` : ''
      const more = (s?.more ?? 0) > 0 ? ` (+${s.more} more)` : ''
      setToast(`Filled saved login${who}${more}`)
    }
    window.wallet.onBrowserAutofill?.(onFilled)
    return () => window.wallet.offBrowserAutofill?.(onFilled)
  }, [])

  // While a full-screen panel is up the native dApp WebViews must be hidden —
  // they render ABOVE this WebView and would cover the panel entirely.
  useEffect(() => {
    if (panel) { DappBrowser.hide().catch(() => {}); return }
    if (sessionRef.current === 'open') {
      DappBrowser.show().catch(() => {})
      DappBrowser.setBounds(measureBounds()).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel])

  const toggleBookmark = async () => {
    const next = await window.wallet.browserToggleBookmark?.()
    if (next) {
      setPage(next)
      showToast(next.bookmarked ? 'Bookmark added' : 'Bookmark removed')
    }
  }

  const sharePage = async () => {
    setMenuOpen(false)
    const r = await window.wallet.browserShareByEmail?.()
    if (!r?.ok && r?.error) showToast(r.error)
  }

  const copyLink = async () => {
    setMenuOpen(false)
    const r = await window.wallet.browserCopyLink?.()
    showToast(r?.ok ? 'Link copied' : r?.error ?? 'Could not copy the link')
  }

  const installApp = async () => {
    setMenuOpen(false)
    const r = await window.wallet.browserInstallWebApp?.()
    if (r?.ok) { showToast('Added to your home screen'); refreshPageState() }
    else showToast(r?.error ?? 'Could not install this page')
  }

  const go = () => {
    const raw = urlInput.trim()
    if (!raw) return
    let target: string | null = null
    try {
      const scheme = /\.onion(?:[/?#]|$)/i.test(raw) ? 'http' : 'https'
      const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `${scheme}://${raw}`)
      if (u.protocol === 'http:' || u.protocol === 'https:') target = u.toString()
    } catch { /* not a URL */ }
    if (!target) target = `https://duckduckgo.com/?q=${encodeURIComponent(raw)}`
    DappBrowser.navigate({ url: target }).catch(() => {})
    setInputFocused(false)
    ;(document.activeElement as HTMLElement | null)?.blur?.()
  }

  const changeTor = (enabled: boolean) => {
    if (tor.status === 'unsupported') return
    setTor(current => ({
      ...current,
      enabled,
      status: 'connecting',
      message: enabled ? 'Starting embedded Tor… first connection can take up to a minute' : 'Disconnecting from Tor…',
    }))
    DappBrowser.setTorMode({ enabled })
      .then(setTor)
      .catch(() => setTor(current => ({
        ...current,
        enabled,
        status: 'error',
        message: 'Could not change the Android WebView proxy. Traffic remains blocked.',
      })))
  }

  const toggleTor = () => {
    if (tor.status === 'connecting' || tor.status === 'unsupported') return
    changeTor(!tor.enabled)
  }

  const setGuardEnabled = (enabled: boolean) => {
    DappBrowser.setMagicGuardEnabled({ enabled }).then(setGuard).catch(() => {})
  }
  const setGuardSite = (enabled: boolean) => {
    DappBrowser.setMagicGuardForSite({ enabled }).then(setGuard).catch(() => {})
  }

  if (!visible) return null

  return (
    <div style={{
      // Stops above the wallet's bottom nav (NAV_STRIP) so that bar stays visible
      // and tappable — the native dApp WebView renders in the area above it.
      position: 'fixed', top: 0, left: 0, right: 0, bottom: NAV_STRIP,
      zIndex: 5000, display: 'flex', flexDirection: 'column',
      background: 'var(--bg-dark, #0d0d0d)', paddingTop: 'env(safe-area-inset-top)'
    }}>
      {/* Toolbar row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px 6px' }}>
        <button type="button" aria-label="Back" onClick={() => DappBrowser.goBack().catch(() => {})}
          disabled={!canBack} style={{ ...navBtn, opacity: canBack ? 1 : 0.35 }}>‹</button>
        <button type="button" aria-label="Forward" onClick={() => DappBrowser.goForward().catch(() => {})}
          disabled={!canForward} style={{ ...navBtn, opacity: canForward ? 1 : 0.35 }}>›</button>
        <button type="button" aria-label="Reload" onClick={() => DappBrowser.reload().catch(() => {})}
          style={navBtn}>{loading ? '×' : '⟳'}</button>
        <form onSubmit={e => { e.preventDefault(); go() }} style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex' }}>
          <input
            value={inputFocused ? urlInput : (url || urlInput)}
            onChange={e => setUrlInput(e.target.value)}
            onFocus={e => { setInputFocused(true); setUrlInput(url); e.target.select() }}
            onBlur={() => setInputFocused(false)}
            placeholder="Search or enter address"
            autoCapitalize="off" autoCorrect="off" spellCheck={false}
            style={{
              // Right padding reserves room for the star that sits INSIDE the bar.
              flex: 1, minWidth: 0, padding: '8px 34px 8px 12px', borderRadius: 10, fontSize: 12,
              border: '1px solid var(--border, #2a2a2a)', background: 'var(--bg-card, #161616)',
              color: 'var(--text, #fff)', outline: 'none'
            }}
          />
          {/* Bookmark star — inside the address bar, at its end (desktop parity).
              onMouseDown/onTouchStart preventDefault keeps the input from taking
              focus (and popping the keyboard) when the star is tapped. */}
          <button
            type="button"
            aria-label={page.bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
            aria-pressed={page.bookmarked}
            onMouseDown={e => e.preventDefault()}
            onClick={() => void toggleBookmark()}
            disabled={!/^https?:\/\//i.test(page.url)}
            style={{
              position: 'absolute', right: 3, top: 0, bottom: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 30, padding: 0, background: 'none', border: 'none',
              fontSize: 16, lineHeight: 1,
              color: page.bookmarked ? '#f5b301' : 'var(--text-muted, #737373)',
            }}
          >
            {page.bookmarked ? '★' : '☆'}
          </button>
        </form>
        {/* ☰ — password manager, bookmarks, Magic Guard, Tor, save and share.
            It sits where the old "back to wallet" ✕ was: that ✕ was redundant
            (the wallet's bottom nav stays visible over the browser, and hardware
            back at the root of history hides the session too), and moving the
            menu up here frees the tab row for tabs. */}
        <button
          type="button"
          aria-label="Browser menu"
          aria-expanded={menuOpen}
          onClick={() => { setMenuOpen(v => !v); setGuardOpen(false) }}
          style={{
            ...navBtn, width: 40, gap: 3, flexShrink: 0,
            borderColor: menuOpen ? '#48c8e8' : 'var(--border, #2a2a2a)',
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1 }}>☰</span>
          {tor.enabled && (
            <span aria-hidden="true" style={{
              width: 6, height: 6, borderRadius: '50%',
              background: tor.status === 'connected' ? '#22c55e' : tor.status === 'error' ? '#ef4444' : '#737373',
            }} />
          )}
        </button>
      </div>

      {/* Tab row — tabs scroll in the left region; Tor + chain switcher stay
          pinned on the right (outside the scroller) so they're always visible. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, overflowX: 'auto' }}>
          {tabs.map(t => (
            <div key={t.id}
              onClick={() => DappBrowser.selectTab({ tabId: t.id }).catch(() => {})}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, maxWidth: 140, flexShrink: 0,
                padding: '4px 8px', borderRadius: 8, fontSize: 11, cursor: 'pointer',
                background: t.id === activeTabId ? 'var(--accent-dim, rgba(124,58,237,0.18))' : 'var(--bg-card, #161616)',
                border: `1px solid ${t.id === activeTabId ? 'var(--border-active, #7c3aed)' : 'var(--border, #2a2a2a)'}`,
                color: 'var(--text, #fff)'
              }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.title || t.url.replace(/^https?:\/\//, '') || 'New tab'}
              </span>
              {tabs.length > 1 && (
                <span
                  aria-label="Close tab"
                  onClick={e => { e.stopPropagation(); DappBrowser.closeTab({ tabId: t.id }).catch(() => {}) }}
                  style={{ opacity: 0.6, flexShrink: 0 }}>✕</span>
              )}
            </div>
          ))}
          {tabs.length < 5 && (
            <button type="button" aria-label="New tab"
              onClick={() => DappBrowser.newTab({ url: HOME_URL }).catch(() => {})}
              style={{ ...navBtn, flexShrink: 0 }}>＋</button>
          )}
        </div>
        <NetworkSwitcher compact />
      </div>

      {tor.enabled && tor.status === 'connected' && (
        <div style={{
          margin: '0 10px 6px', padding: '5px 8px', borderRadius: 8,
          border: '1px solid #166534', background: 'rgba(34,197,94,0.10)',
          color: 'var(--text, #fff)',
          fontSize: 10, lineHeight: 1.35,
        }}>
          {tor.message} · {tor.host}:{tor.port}
        </div>
      )}

      {menuOpen && (
        <div style={{
          margin: '0 10px 8px', padding: 6, borderRadius: 12, maxHeight: '52vh', overflowY: 'auto',
          border: '1px solid var(--border-active, #48c8e8)', background: 'var(--bg-card, #161616)',
        }}>
          <MenuRow icon="＋" label="New tab"
            onClick={() => { setMenuOpen(false); DappBrowser.newTab({ url: HOME_URL }).catch(() => {}) }} />

          <MenuDivider />
          <MenuRow icon="🔑" label="Password manager"
            hint={page.passwordsUnlocked ? 'Unlocked' : 'Locked'}
            onClick={() => { setMenuOpen(false); setPanel('passwords') }} />
          <MenuRow icon="🔖" label="Bookmarks"
            onClick={() => { setMenuOpen(false); setPanel('bookmarks') }} />

          <MenuDivider />
          <MenuLabel>Privacy</MenuLabel>
          {/* Magic Guard lives here now rather than on its own toolbar pill; the
              panel itself is still the inline one below (it has toggles and
              counters, so it stays expandable rather than becoming a menu row). */}
          <MenuRow
            icon="🛡"
            label="Magic Guard"
            hint={!guard.enabled
              ? 'Off'
              : !guard.siteEnabled ? 'Off for this site'
              : guard.status === 'ready' ? `On · ${guard.blockedThisPage} blocked here`
              : guard.status === 'loading' ? 'Filter lists loading…'
              : 'Temporarily inactive'}
            active={guard.effectiveEnabled}
            trailing={
              <span aria-hidden="true" style={{
                display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                background: guard.effectiveEnabled ? '#48c8e8' : '#737373',
              }} />
            }
            onClick={() => { setMenuOpen(false); setGuardOpen(true) }}
          />
          <MenuRow
            icon="🧅"
            label={tor.enabled ? 'Tor Mode' : 'Turn on Tor Mode'}
            hint={tor.status === 'unsupported'
              ? 'Not supported on this device'
              : tor.status === 'connecting' ? 'Connecting…'
              : tor.status === 'error' ? 'Blocked — traffic is not flowing'
              : tor.enabled ? 'On' : 'Off'}
            active={tor.enabled}
            disabled={tor.status === 'connecting' || tor.status === 'unsupported'}
            trailing={
              <span aria-hidden="true" style={{
                display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                background: tor.status === 'connected' ? '#22c55e' : tor.status === 'error' ? '#ef4444' : '#737373',
              }} />
            }
            onClick={() => { setMenuOpen(false); toggleTor() }}
          />

          <MenuDivider />
          <MenuLabel>Save and share</MenuLabel>
          <MenuRow icon="🔗" label="Copy link" hint={page.host} onClick={() => void copyLink()} />
          <MenuRow icon="↗" label="Share…" hint="Android share sheet" onClick={() => void sharePage()} />
          <MenuRow
            icon="⊞"
            label={page.installed ? 'Re-add to home screen' : `Install ${page.host || 'this page'}…`}
            hint={page.installed ? 'Already added' : 'Opens in MagicMoney Browser'}
            onClick={() => void installApp()}
          />
        </div>
      )}

      {guardOpen && (
        <div style={{
          margin: '0 10px 8px', padding: 12, borderRadius: 12,
          border: '1px solid var(--border-active, #48c8e8)', background: 'var(--bg-card, #161616)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <img src={mascotUrl} alt="" width={38} height={38} style={{ borderRadius: 9, flexShrink: 0, objectFit: 'cover' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: guard.effectiveEnabled ? '#48c8e8' : 'var(--text-muted, #737373)' }}>
                <ShieldIcon active={guard.effectiveEnabled} />
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text, #fff)' }}>Magic Guard</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted, #737373)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {guard.hostname ?? 'No site loaded'}
              </div>
            </div>
            {/* Own close control: this panel is opened from the ☰ menu now, so
                there is no toolbar toggle to close it with. */}
            <button
              type="button"
              aria-label="Close Magic Guard"
              onClick={() => setGuardOpen(false)}
              style={{ ...navBtn, width: 30, height: 30, fontSize: 13, flexShrink: 0 }}
            >
              ✕
            </button>
          </div>

          <GuardToggleRow label="Protection for this site" checked={guard.siteEnabled}
            disabled={!guard.hostname} onChange={setGuardSite} />
          <GuardToggleRow label="Magic Guard (global)" checked={guard.enabled}
            onChange={setGuardEnabled} />

          <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
            <GuardCountTile label="Blocked this page" value={guard.blockedThisPage} />
            <GuardCountTile label="Blocked this tab" value={guard.blockedThisTab} />
          </div>

          <div style={{
            fontSize: 10.5, lineHeight: 1.5, color: 'var(--text-muted, #737373)',
            padding: '8px 9px', borderRadius: 8, background: 'var(--bg-dark, #0d0d0d)',
            border: '1px solid var(--border, #2a2a2a)',
          }}>
            {!guard.enabled
              ? 'Magic Guard is off. Turn it on to filter ads and trackers in the dApp browser.'
              : guard.status === 'ready'
                ? 'Protection is active for this site.'
                : guard.status === 'loading'
                  ? 'Filter lists are loading…'
                  : 'Magic Guard is temporarily inactive — requests are allowed through.'}
          </div>
        </div>
      )}

      {/* Native WebView renders into this area (bounds tracked via ResizeObserver) */}
      <div ref={contentRef} style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {tor.enabled && tor.status !== 'connected' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24, background: 'var(--bg-dark, #0d0d0d)', color: 'var(--text, #fff)',
          }}>
            <div style={{ width: '100%', maxWidth: 390, textAlign: 'center' }}>
              <div aria-hidden="true" style={{ fontSize: 44, marginBottom: 12 }}>🧅</div>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
                {tor.status === 'connecting' ? 'Connecting to Tor' : 'Tor connection blocked'}
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.8, marginBottom: 18 }}>
                {tor.message}
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
                {tor.status === 'error' && (
                  <button type="button" onClick={() => changeTor(true)} style={panelPrimaryBtn}>
                    Retry Tor
                  </button>
                )}
                <button type="button" onClick={() => changeTor(false)} style={panelSecondaryBtn}>
                  Turn Off Tor
                </button>
              </div>
              <div style={{ fontSize: 10, lineHeight: 1.45, opacity: 0.55, marginTop: 18 }}>
                Tor is built into Magic Money on Android. No Orbot installation is required.
                Browser traffic stays blocked until the Tor exit is verified.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Full-screen panels — the native WebViews are hidden while these are up
          (see the `panel` effect), so they cover the whole browser view. The
          components are the SAME ones the desktop chrome uses. */}
      {panel === 'bookmarks' && (
        <div style={panelHost}>
          <BookmarksPanel
            onClose={() => setPanel(null)}
            onNavigate={(target) => { DappBrowser.navigate({ url: target }).catch(() => {}) }}
            onToast={showToast}
            importEmptyText={ANDROID_BOOKMARK_IMPORT_EMPTY}
            appsEmptyBody={ANDROID_APPS_EMPTY}
          />
        </div>
      )}
      {panel === 'passwords' && (
        <div style={panelHost}>
          <PasswordManager
            currentHost={page.host}
            currentUrl={page.url}
            onClose={() => setPanel(null)}
            onToast={showToast}
            onChanged={refreshPageState}
            importEmptyText={ANDROID_PASSWORD_IMPORT_EMPTY}
          />
        </div>
      )}

      {toast && (
        <div role="status" style={{
          position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)',
          zIndex: 60, pointerEvents: 'none', maxWidth: '86%',
          padding: '9px 16px', borderRadius: 999,
          background: 'var(--bg-card, #161616)', border: '1px solid var(--border-active, #48c8e8)',
          boxShadow: '0 10px 28px rgba(0,0,0,0.45)',
          color: 'var(--text, #fff)', fontSize: 12, fontWeight: 600,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {toast}
        </div>
      )}
    </div>
  )
}

// Panels render against the overlay's own box; the native WebViews are hidden
// while one is open, so nothing can cover them.
const panelHost: React.CSSProperties = { position: 'absolute', inset: 0, zIndex: 40 }

// ── ☰ menu primitives (inline panel — no floating dropdown on Android) ───────

function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '6px 8px 4px', fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4,
      textTransform: 'uppercase', color: 'var(--text-muted, #737373)',
    }}>
      {children}
    </div>
  )
}

function MenuDivider() {
  return <div style={{ height: 1, background: 'var(--border, #2a2a2a)', margin: '4px 6px' }} />
}

function MenuRow({ icon, label, hint, trailing, onClick, disabled, active }: {
  icon: string
  label: React.ReactNode
  hint?: string
  trailing?: React.ReactNode
  onClick: () => void
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        padding: '11px 8px', borderRadius: 9, border: 'none', textAlign: 'left',
        background: active ? 'var(--accent-dim, rgba(124,58,237,0.18))' : 'transparent',
        color: disabled ? 'var(--text-muted, #737373)' : 'var(--text, #fff)',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span aria-hidden="true" style={{ width: 18, flexShrink: 0, fontSize: 14, textAlign: 'center' }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        {hint && (
          <span style={{
            fontSize: 10, color: 'var(--text-muted, #737373)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {hint}
          </span>
        )}
      </span>
      {trailing}
    </button>
  )
}

const navBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 34, height: 34, borderRadius: 10, fontSize: 16, cursor: 'pointer',
  border: '1px solid var(--border, #2a2a2a)', background: 'var(--bg-card, #161616)',
  color: 'var(--text, #fff)'
}

const panelPrimaryBtn: React.CSSProperties = {
  padding: '9px 14px', borderRadius: 9, border: '1px solid #7c3aed',
  background: '#7c3aed', color: '#fff', fontSize: 12, fontWeight: 600,
}

const panelSecondaryBtn: React.CSSProperties = {
  ...panelPrimaryBtn, border: '1px solid var(--border, #2a2a2a)',
  background: 'var(--bg-card, #161616)', color: 'var(--text, #fff)',
}

// Neon rim glow in the Magic Money logo's own gradient (blue → cyan → mint),
// matching the desktop MagicGuardControl shield.
const LOGO_GLOW = [
  'drop-shadow(0 0 1.5px #2868f8)',
  'drop-shadow(0 0 3px #2868f8)',
  'drop-shadow(0 0 6px #48c8e8)',
  'drop-shadow(0 0 9px #68f8d0)',
].join(' ')

function ShieldIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'}
      stroke="currentColor" strokeWidth="2" strokeLinejoin="round" style={{ filter: LOGO_GLOW }} aria-hidden="true">
      <path d="M12 2.5l7.5 3.2v5.1c0 5.1-3.2 8.9-7.5 10.2-4.3-1.3-7.5-5.1-7.5-10.2V5.7L12 2.5z"
        fillOpacity={active ? 0.18 : 0} />
    </svg>
  )
}

function GuardToggleRow({ label, checked, disabled, onChange }: {
  label: string; checked: boolean; disabled?: boolean; onChange: (next: boolean) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 2px' }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #b3b3b3)' }}>{label}</span>
      <button
        type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{
          position: 'relative', width: 40, height: 22, flexShrink: 0, padding: 0,
          borderRadius: 999, border: 'none', cursor: disabled ? 'default' : 'pointer',
          background: checked ? '#48c8e8' : 'var(--border, #2a2a2a)',
          opacity: disabled ? 0.5 : 1, transition: 'background 0.15s',
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: checked ? 20 : 2,
          width: 18, height: 18, borderRadius: '50%', background: '#000', transition: 'left 0.15s',
        }} />
      </button>
    </div>
  )
}

function GuardCountTile({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      flex: 1, padding: '7px 8px', borderRadius: 8,
      background: 'var(--bg-dark, #0d0d0d)', border: '1px solid var(--border, #2a2a2a)',
    }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text, #fff)' }}>{value > 99 ? '99+' : value}</div>
      <div style={{ fontSize: 9.5, color: 'var(--text-muted, #737373)' }}>{label}</div>
    </div>
  )
}
