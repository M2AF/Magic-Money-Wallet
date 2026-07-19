/**
 * BrowserOverlay.tsx — full-screen in-app dApp browser chrome (Android)
 *
 * The JS toolbar/tab UI lives in the wallet WebView; the page content renders
 * in native WebViews positioned by the DappBrowser plugin to fill the area
 * under the toolbar (the Electron WebContentsView + BrowserApp.tsx pattern,
 * phone-shaped). Mounted once by CapApp; opens on 'cap:browser:open' bus
 * events emitted by wallet-local's browser* methods.
 */

import { useEffect, useRef, useState } from 'react'
import { DappBrowser, type DappBrowserState } from './dapp-browser'
import { onUiEvent, offUiEvent, emitUiEvent } from './platform-capacitor'
import { NetworkSwitcher } from '../renderer/components/NetworkSwitcher'
import type { TorBrowserState } from '../renderer/types/wallet'

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

  const sessionRef = useRef<Session>('closed')
  const pendingUrlRef = useRef<string>(HOME_URL)
  const contentRef = useRef<HTMLDivElement>(null)
  const canBackRef = useRef(false)

  canBackRef.current = canBack
  browserUiState.open = visible

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
    // Hardware back: page history first; at the root, hide (keep tabs).
    const onBack = () => {
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
    const handles = [
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

  const go = () => {
    const raw = urlInput.trim()
    if (!raw) return
    let target: string | null = null
    try {
      const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
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
        <form onSubmit={e => { e.preventDefault(); go() }} style={{ flex: 1, display: 'flex' }}>
          <input
            value={inputFocused ? urlInput : (url || urlInput)}
            onChange={e => setUrlInput(e.target.value)}
            onFocus={e => { setInputFocused(true); setUrlInput(url); e.target.select() }}
            onBlur={() => setInputFocused(false)}
            placeholder="Search or enter address"
            autoCapitalize="off" autoCorrect="off" spellCheck={false}
            style={{
              flex: 1, minWidth: 0, padding: '8px 12px', borderRadius: 10, fontSize: 12,
              border: '1px solid var(--border, #2a2a2a)', background: 'var(--bg-card, #161616)',
              color: 'var(--text, #fff)', outline: 'none'
            }}
          />
        </form>
        {/* Hide (back to wallet) — tabs are preserved; only per-tab ✕ closes tabs. */}
        <button type="button" aria-label="Back to wallet" onClick={hide} style={navBtn}>✕</button>
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
        <button
          type="button"
          aria-label={tor.enabled ? 'Disable Tor Mode' : 'Enable Tor Mode'}
          aria-pressed={tor.enabled}
          title={`${tor.message} Embedded SOCKS5 ${tor.host}:${tor.port}. On Android, WebView proxy settings apply to all app WebViews.`}
          onClick={toggleTor}
          disabled={tor.status === 'connecting' || tor.status === 'unsupported'}
          style={{
            ...navBtn, width: 42, gap: 3, fontSize: 14, flexShrink: 0,
            borderColor: tor.status === 'connected' ? '#22c55e' : tor.status === 'error' ? '#ef4444' : 'var(--border, #2a2a2a)',
            opacity: tor.status === 'unsupported' ? 0.35 : 1,
          }}
        >
          <span aria-hidden="true">🧅</span>
          <span aria-hidden="true" style={{
            width: 6, height: 6, borderRadius: '50%',
            background: tor.status === 'connected' ? '#22c55e' : tor.status === 'error' ? '#ef4444' : '#737373',
          }} />
        </button>
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
    </div>
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
