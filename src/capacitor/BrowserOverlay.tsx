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

export const HOME_URL = 'https://www.chainlensnft.info/'

/** CapApp's hardware-back handler consults this to route back-presses here. */
export const browserUiState = { open: false }

type Session = 'closed' | 'opening' | 'open'

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

  const close = () => {
    sessionRef.current = 'closed'
    setVisible(false)
    setTabs([])
    setUrl(''); setUrlInput('')
    DappBrowser.close().catch(() => {})
    emitUiEvent('cap:browser:closed', null)
  }

  // Bus commands from wallet-local (openBrowser / browserNavigate / close / back)
  useEffect(() => {
    const onOpen = (d: unknown) => {
      const target = (d as { url?: string })?.url || HOME_URL
      if (sessionRef.current === 'open') {
        DappBrowser.navigate({ url: target }).catch(() => {})
        return
      }
      pendingUrlRef.current = target
      if (sessionRef.current === 'closed') {
        sessionRef.current = 'opening'
        setVisible(true)   // the open effect below fires after layout
      }
    }
    const onClose = () => { if (sessionRef.current !== 'closed') close() }
    const onBack = () => {
      if (canBackRef.current) DappBrowser.goBack().catch(() => {})
      else close()
    }
    onUiEvent('cap:browser:open', onOpen)
    onUiEvent('cap:browser:close', onClose)
    onUiEvent('cap:browser:back', onBack)
    return () => {
      offUiEvent('cap:browser:open', onOpen)
      offUiEvent('cap:browser:close', onClose)
      offUiEvent('cap:browser:back', onBack)
    }
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
    const handles = [
      DappBrowser.addListener('urlChanged', e => { setUrl(e.url); if (!inputFocusedRef.current) setUrlInput(e.url) }),
      DappBrowser.addListener('loadingChanged', e => setLoading(e.loading)),
      DappBrowser.addListener('navState', e => { setCanBack(e.canBack); setCanForward(e.canForward) }),
      DappBrowser.addListener('tabsChanged', e => { setTabs(e.tabs); setActiveTabId(e.activeTabId) }),
      DappBrowser.addListener('closed', () => {
        if (sessionRef.current !== 'closed') {
          sessionRef.current = 'closed'
          setVisible(false)
          emitUiEvent('cap:browser:closed', null)
        }
      }),
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

  if (!visible) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 5000, display: 'flex', flexDirection: 'column',
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
        <button type="button" aria-label="Close browser" onClick={close} style={navBtn}>✕</button>
      </div>

      {/* Tab pills */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px 8px', overflowX: 'auto' }}>
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

      {/* Native WebView renders into this area (bounds tracked via ResizeObserver) */}
      <div ref={contentRef} style={{ flex: 1 }} />
    </div>
  )
}

const navBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 34, height: 34, borderRadius: 10, fontSize: 16, cursor: 'pointer',
  border: '1px solid var(--border, #2a2a2a)', background: 'var(--bg-card, #161616)',
  color: 'var(--text, #fff)'
}
