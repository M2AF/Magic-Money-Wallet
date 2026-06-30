/**
 * browser-manager.ts — MagicMoney Wallet
 *
 * Manages a detached popup BrowserWindow for the dApp browser.
 * The popup is independent of the main wallet window so the user
 * can browse dApps and use the wallet portfolio/market simultaneously.
 *
 * Architecture:
 *   Popup BrowserWindow (1100 × 750, resizable)
 *   ├── Chrome renderer: src/renderer/browser.html (titlebar + address bar + tab button)
 *   │   Preload: preload/index.js  — exposes wallet.browserNavigate() etc.
 *   └── One WebContentsView PER TAB (dApp content); only the active tab is attached
 *       Preload: inject/web3-inject.js — exposes window.ethereum / window.solana
 *
 * Link buttons that window.open a different site open as new TABS; genuine
 * auth/wallet/sign popups (about:blank, sized, or known auth hosts) stay popups.
 *
 * Web3 signing dialogs (eth_requestAccounts, personal_sign, etc.) attach to
 * the MAIN wallet window so the user sees them inside the wallet UI.
 */

import { WebContentsView, BrowserWindow, Menu, dialog, shell, app, ipcMain } from 'electron'
import type { IpcMainEvent, MenuItemConstructorOptions, HandlerDetails, WindowOpenHandlerResponse } from 'electron'
import { join } from 'path'
import { WALLET_ICON } from '../preload/wallet-icon'
import { getDappChainId, setDappChainId, DEFAULT_CHAIN_ID } from './dapp-chain'

export const BROWSER_HOME = 'https://chainlensnft.info'

// Chrome bar height in the popup: 32px titlebar + 48px address bar
const CHROME_HEIGHT = 80

// Each open tab owns its own WebContentsView (its own dApp page + injected provider).
// Only the ACTIVE tab's view is attached to the window; the rest stay alive but hidden.
interface Tab {
  id: number
  view: WebContentsView
  url: string
  title: string
  loading: boolean
  canBack: boolean
  canForward: boolean
}

let popupWin: BrowserWindow | null = null
let mainWin: BrowserWindow | null = null
let tabs: Tab[] = []
let activeTabId = 0
let nextTabId = 1

// Last top-level dApp origin loaded — used to reset the active EVM network when the
// user navigates to a DIFFERENT dApp, so a prior dApp's chain doesn't leak forward.
let _lastDappOrigin: string | null = null

function activeTab(): Tab | undefined {
  return tabs.find(t => t.id === activeTabId)
}
function activeView(): WebContentsView | null {
  return activeTab()?.view ?? null
}

/** Send to the popup's CHROME renderer (titlebar / address bar / tab button). */
function sendToChrome(channel: string, payload: unknown): void {
  try {
    if (popupWin && !popupWin.isDestroyed() && !popupWin.webContents.isDestroyed()) {
      popupWin.webContents.send(channel, payload)
    }
  } catch { /* window torn down mid-send — safe to ignore */ }
}

/** Push the tab list + active id so the chrome can render the tab button/count and menu. */
function pushTabs(): void {
  sendToChrome('browser:tabs', {
    activeTabId,
    tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, loading: t.loading })),
  })
}

/** Re-emit the active tab's nav state on the legacy single-view channels the chrome uses. */
function pushActive(): void {
  const t = activeTab()
  if (!t) return
  sendToChrome('browser:url', t.url)
  sendToChrome('browser:title', t.title)
  sendToChrome('browser:loading', t.loading)
  sendToChrome('browser:nav-state', { canBack: t.canBack, canForward: t.canForward })
}

function layoutActiveView(): void {
  const t = activeTab()
  if (!t || !popupWin || popupWin.isDestroyed()) return
  const [w, h] = popupWin.getContentSize()
  t.view.setBounds({ x: 0, y: CHROME_HEIGHT, width: w, height: Math.max(0, h - CHROME_HEIGHT) })
}

const PHISHING_BLOCKLIST = new Set([
  'metarnask.io', 'myehereum.com', 'pancakeswep.finance',
  'unisvvap.org', 'opensea-nft.io', 'etherscan-login.com',
  'metamask-login.com', 'wallet-connect.live', 'claimreward.net'
])

function web3InjectPath(): string {
  // Built by the `build:inject` esbuild script into out/inject/web3-inject.js.
  // __dirname is out/main at runtime (dev and packaged) → resolves to out/inject/.
  return join(__dirname, '../inject/web3-inject.js')
}

function walletPreloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

// Preload for connect/auth popups — combines the branded MagicMoney titlebar
// with the full web3 provider (window.ethereum + EIP-6963) so flows like
// Abstract Global Wallet "Login with Wallet" can detect MagicMoney and sign
// INSIDE the popup. Built by build:inject into out/inject/popup-connect.js.
function popupConnectPath(): string {
  return join(__dirname, '../inject/popup-connect.js')
}

function isSafe(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    for (const bad of PHISHING_BLOCKLIST) {
      if (hostname === bad || hostname.endsWith(`.${bad}`)) return false
    }
    return true
  } catch { return false }
}

function openExternalSafe(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:') {
      shell.openExternal(parsed.toString())
    }
  } catch {
    // Ignore malformed or unsupported external URLs.
  }
}

function normalizeWebUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null
  } catch {
    return null
  }
}

/** Called once from index.ts so we know which window to show signing dialogs on */
export function setMainWindow(win: BrowserWindow): void {
  mainWin = win
}

/** Opens or focuses the detached browser popup */
export function openBrowserWindow(): void {
  if (popupWin && !popupWin.isDestroyed()) {
    popupWin.focus()
    return
  }

  // ── Create popup BrowserWindow ─────────────────────────────────────────
  popupWin = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 680,
    minHeight: 500,
    frame: false,
    transparent: false,
    backgroundColor: '#060b18',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: walletPreloadPath(),   // gives browser.html the wallet IPC bridge
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    },
    show: false
  })

  // ── Load the browser chrome renderer ──────────────────────────────────
  // Same index.html as the wallet, but with ?browserChrome=1 so main.tsx
  // renders BrowserApp instead of App
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    popupWin.loadURL(`${devUrl.replace(/\/$/, '')}?browserChrome=1`)
  } else {
    popupWin.loadFile(join(__dirname, '../renderer/index.html'), { query: { browserChrome: '1' } })
  }

  popupWin.once('ready-to-show', () => {
    popupWin?.show()
    createTab(BROWSER_HOME, true)
  })

  popupWin.on('close', () => {
    // A WebContentsView is NOT auto-destroyed when its window closes, so each
    // dApp renderer (OpenSea etc.) would keep running in the background —
    // websockets, animation frames, and RPC polling through web3:request —
    // which starves the wallet window and makes it sluggish to drag long after
    // the browser is gone. Tear them all down while the window is still valid.
    destroyAllTabs()
  })

  popupWin.on('closed', () => {
    tabs = []
    activeTabId = 0
    popupWin = null
    // Tell wallet renderer the popup closed
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('browser:closed')
    }
  })

  popupWin.on('resize', () => layoutActiveView())
}

// Hosts whose featureless window.open is still an auth/sign popup (not a link).
// Most OAuth/wallet popups pass window features (width/height) — caught separately —
// but Abstract/Privy sometimes open a featureless auth window, so allow-list them.
const AUTH_POPUP_HOSTS = ['abs.xyz', 'privy.io', 'walletconnect.com', 'walletconnect.org', 'web3auth.io']

/** Options for a frameless branded popup that carries the full web3 provider. */
function popupResult(): WindowOpenHandlerResponse {
  return {
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 480,
      height: 760,
      minWidth: 360,
      minHeight: 480,
      parent: popupWin ?? undefined,
      frame: false,             // frameless — we draw our own branded titlebar
      backgroundColor: '#0b1220',
      webPreferences: {
        // Titlebar + full web3 provider, so AGW/Privy "Login with Wallet" and
        // other in-popup wallet flows can detect MagicMoney and sign here.
        preload: popupConnectPath(),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    },
  }
}

/** True when a window.open should be a real popup window (auth/wallet/sign), not a tab. */
function wantsPopup(url: string, features: string): boolean {
  // Window features (width/height/popup=…) ⇒ an intentional popup (OAuth, sign, WC).
  if (typeof features === 'string' && features.trim().length > 0) return true
  try {
    const h = new URL(url).hostname.toLowerCase()
    return AUTH_POPUP_HOSTS.some(d => h === d || h.endsWith(`.${d}`))
  } catch { return false }
}

/**
 * Decide what a dApp's window.open becomes:
 *   • about:* ............ real popup. Wallet/OAuth libs (AGW/Privy message signing)
 *     open an `about:blank` popup synchronously then navigate it — denying it leaves
 *     the sign window inert ("Authentication failed").
 *   • sized / auth-host .. real branded popup (connect, sign, WalletConnect).
 *   • other http(s) ...... a plain link/redirect (e.g. a game's "Play Now") → NEW TAB.
 *   • mailto:/tel:/sms: .. hand to the OS. Everything else is ignored.
 */
function handleWindowOpen(details: HandlerDetails): WindowOpenHandlerResponse {
  const { url, features } = details
  if (/^about:/i.test(url)) return popupResult()
  if (/^https?:\/\//i.test(url)) {
    if (!isSafe(url)) return { action: 'deny' }
    if (wantsPopup(url, features)) return popupResult()
    // Defer: don't mutate the view tree from inside the handler.
    setImmediate(() => createTab(url, true))
    return { action: 'deny' }
  }
  openExternalSafe(url)
  return { action: 'deny' }
}

/** Wire all per-tab webContents events (nav, title, loading, phishing, popups). */
function wireTab(tab: Tab): void {
  const wc = tab.view.webContents
  const isActive = () => tab.id === activeTabId

  wc.on('did-navigate', (_e, url) => {
    tab.url = url
    tab.canBack = wc.canGoBack()
    tab.canForward = wc.canGoForward()
    if (isActive()) {
      sendToChrome('browser:url', url)
      sendToChrome('browser:nav-state', { canBack: tab.canBack, canForward: tab.canForward })

      // Reset the active EVM network to Ethereum when moving to a NEW dApp origin so a
      // prior dApp's chain (e.g. Monad on nad.fun) doesn't leak into the next one.
      // Same-origin reloads and SPA route changes (did-navigate-in-page) keep the chain.
      let origin: string | null = null
      try { origin = new URL(url).origin } catch { origin = null }
      if (origin && origin !== _lastDappOrigin) {
        _lastDappOrigin = origin
        const changed = getDappChainId() !== DEFAULT_CHAIN_ID
        setDappChainId(DEFAULT_CHAIN_ID)
        const hex = `0x${DEFAULT_CHAIN_ID.toString(16)}`
        if (changed) emitDappEvent('eth', 'chainChanged', hex) // correct a page that synced the stale chain
        notifyBrowserChrome('web3:chain-changed', hex)         // keep the toolbar pill in sync
      }
    }
    pushTabs()
  })

  wc.on('did-navigate-in-page', (_e, url) => {
    tab.url = url
    tab.canBack = wc.canGoBack()
    tab.canForward = wc.canGoForward()
    if (isActive()) {
      sendToChrome('browser:url', url)
      sendToChrome('browser:nav-state', { canBack: tab.canBack, canForward: tab.canForward })
    }
    pushTabs()
  })

  wc.on('page-title-updated', (_e, title) => {
    tab.title = title || 'Untitled'
    if (isActive()) {
      sendToChrome('browser:title', tab.title)
      if (popupWin && !popupWin.isDestroyed()) popupWin.setTitle(tab.title)
    }
    pushTabs()
  })

  wc.on('did-start-loading', () => {
    tab.loading = true
    if (isActive()) sendToChrome('browser:loading', true)
    pushTabs()
  })
  wc.on('did-stop-loading', () => {
    tab.loading = false
    tab.url = wc.getURL()
    if (isActive()) {
      sendToChrome('browser:loading', false)
      sendToChrome('browser:url', tab.url)
    }
    pushTabs()
  })

  // ── Phishing guard ──────────────────────────────────────────────────────
  wc.on('will-navigate', (event, url) => {
    if (!isSafe(url)) {
      event.preventDefault()
      const win = popupWin ?? mainWin
      if (!win) return
      dialog.showMessageBox(win, {
        type: 'warning',
        title: 'Phishing Warning',
        message: 'This site may be malicious',
        detail: url,
        buttons: ['Block (Recommended)', 'Visit Anyway'],
        defaultId: 0,
        cancelId: 0,
      }).then(({ response }) => {
        if (response === 1) wc.loadURL(url)
      })
    }
  })

  wc.setWindowOpenHandler(handleWindowOpen)

  // Nested popups (the auth window opening its own) get the same treatment.
  wc.on('did-create-window', (childWin) => {
    childWin.webContents.setWindowOpenHandler(({ url }) => {
      if (/^about:/i.test(url)) return popupResult()
      if (/^https?:\/\//i.test(url) && isSafe(url)) return { action: 'allow' }
      openExternalSafe(url)
      return { action: 'deny' }
    })
  })
}

/** Create a new tab loading `url`; activates it when `activate` is true. */
function createTab(url: string, activate = true): number {
  if (!popupWin || popupWin.isDestroyed()) return -1
  const view = new WebContentsView({
    webPreferences: {
      preload: web3InjectPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  const tab: Tab = { id: nextTabId++, view, url, title: 'New Tab', loading: true, canBack: false, canForward: false }
  tabs.push(tab)
  wireTab(tab)
  view.webContents.loadURL(url)
  if (activate) setActiveTab(tab.id)
  else pushTabs()
  return tab.id
}

/** Bring a tab to the front: only the active tab's view is attached to the window. */
function setActiveTab(id: number): void {
  const next = tabs.find(t => t.id === id)
  if (!next || !popupWin || popupWin.isDestroyed()) return
  const cur = activeTab()
  if (cur && cur.id !== id) {
    try { popupWin.contentView.removeChildView(cur.view) } catch { /* not attached */ }
  }
  activeTabId = id
  try { popupWin.contentView.addChildView(next.view) } catch { /* already attached */ }
  layoutActiveView()
  pushActive()
  pushTabs()
}

/** Close a tab. The last remaining tab is reset to Home rather than left empty. */
function closeTab(id: number): void {
  const idx = tabs.findIndex(t => t.id === id)
  if (idx === -1) return
  const tab = tabs[idx]

  if (tabs.length === 1) {
    _lastDappOrigin = null
    tab.view.webContents.loadURL(BROWSER_HOME)
    return
  }

  try {
    if (popupWin && !popupWin.isDestroyed()) popupWin.contentView.removeChildView(tab.view)
    const wc = tab.view.webContents
    if (wc && !wc.isDestroyed()) { wc.stop(); wc.close() }
  } catch { /* already torn down */ }

  const wasActive = tab.id === activeTabId
  tabs.splice(idx, 1)
  if (wasActive) {
    setActiveTab(tabs[Math.min(idx, tabs.length - 1)].id)
  } else {
    pushTabs()
  }
}

/**
 * Native popup menu listing open tabs (click to switch) with a Close submenu and a
 * New-tab action. A native Menu is used (like the network <select>) so it floats
 * ABOVE the dApp WebContentsView — an HTML dropdown would be hidden behind it.
 */
export function openTabsMenu(): void {
  if (!popupWin || popupWin.isDestroyed() || tabs.length === 0) return
  const trunc = (s: string) => (s.length > 42 ? `${s.slice(0, 41)}…` : s)
  const label = (t: Tab) => {
    const name = t.title && t.title !== 'New Tab' ? t.title : ''
    if (name) return trunc(name)
    try { return new URL(t.url).hostname } catch { return trunc(t.url) }
  }
  const template: MenuItemConstructorOptions[] = [
    { label: `Open tabs (${tabs.length})`, enabled: false },
    { type: 'separator' },
    ...tabs.map<MenuItemConstructorOptions>(t => ({
      label: (t.id === activeTabId ? '● ' : '   ') + label(t),
      click: () => setActiveTab(t.id),
    })),
    { type: 'separator' },
    {
      label: 'Close tab',
      submenu: tabs.map<MenuItemConstructorOptions>(t => ({
        label: trunc(label(t)),
        click: () => closeTab(t.id),
      })),
    },
    { type: 'separator' },
    { label: '＋  New tab', click: () => createTab(BROWSER_HOME, true) },
  ]
  Menu.buildFromTemplate(template).popup({ window: popupWin })
}

// ── Control functions called by IPC handlers ──────────────────────────────

/**
 * Fully tears down every tab's WebContents so they stop consuming CPU/GPU and
 * network once the browser is closed. Without this the renderers leak and the
 * wallet UI stays laggy. Safe to call multiple times.
 */
function destroyAllTabs(): void {
  for (const t of tabs) {
    try {
      if (popupWin && !popupWin.isDestroyed()) popupWin.contentView.removeChildView(t.view)
      const wc = t.view.webContents
      if (wc && !wc.isDestroyed()) { wc.stop(); wc.close() }
    } catch { /* already torn down — safe to ignore */ }
  }
  tabs = []
  activeTabId = 0
}

export function closeBrowserWindow(): void {
  if (popupWin && !popupWin.isDestroyed()) popupWin.close()
}

/** Navigate the ACTIVE tab. Empty/invalid input is ignored. */
export function browserNavigate(url: string): void {
  const v = activeView()
  if (!v) return
  const normalized = normalizeWebUrl(url)
  if (!normalized) return
  v.webContents.loadURL(normalized)
}

export function browserBack(): void    { activeView()?.webContents.goBack() }
export function browserForward(): void { activeView()?.webContents.goForward() }
export function browserReload(): void  { activeView()?.webContents.reload() }
export function browserHome(): void    { activeView()?.webContents.loadURL(BROWSER_HOME) }

/** Open a new tab (used by the tab menu's "New tab" and by IPC). */
export function browserNewTab(url?: string): void { createTab(url || BROWSER_HOME, true) }

/**
 * Push a provider event (e.g. EIP-1193 `chainChanged` / `accountsChanged`) into
 * the currently-loaded dApp page. The web3-inject preload listens on the
 * `web3:event` IPC channel and re-posts it into the page's main world as a
 * `__mm:'main→page:event'` window message, where the injected providers pick it
 * up. No-op when no dApp view is open.
 */
export function emitDappEvent(chain: 'eth' | 'solana' | 'cardano', event: string, data: unknown): void {
  // Chain/account state is global to the browser, so notify every open tab's page.
  for (const t of tabs) {
    if (!t.view.webContents.isDestroyed()) t.view.webContents.send('web3:event', { chain, event, data })
  }
}

/**
 * Send a message to the dApp browser's CHROME renderer (titlebar/toolbar) — e.g.
 * the `web3:chain-changed` push that keeps the toolbar's network pill in sync with
 * the active EVM network. No-op when the browser window isn't open.
 */
export function notifyBrowserChrome(channel: string, payload: unknown): void {
  try {
    if (popupWin && !popupWin.isDestroyed() && !popupWin.webContents.isDestroyed()) {
      popupWin.webContents.send(channel, payload)
    }
  } catch { /* window torn down mid-send — safe to ignore */ }
}

export function getBrowserState() {
  const t = activeTab()
  return {
    url: t?.url ?? BROWSER_HOME,
    canBack: t?.canBack ?? false,
    canForward: t?.canForward ?? false,
    loading: t?.loading ?? false,
    isOpen: !!(popupWin && !popupWin.isDestroyed()),
    tabs: tabs.map(x => ({ id: x.id, title: x.title, url: x.url, loading: x.loading })),
    activeTabId,
  }
}

export function getMainWin(): BrowserWindow | null { return mainWin }

// ── Branded approval / signing window ────────────────────────────────────────
// Replaces the native dialog.showMessageBox() prompts with an in-house frameless
// window styled to match the wallet (MagicMoney titlebar + dark UI). The content
// is OUR HTML, so we control the look entirely; the user's decision comes back
// over the `approval:respond` IPC.

export interface ApprovalOptions {
  title: string          // window title (accessibility / taskbar)
  heading: string        // bold prompt line
  detail: string         // body text (message / tx / address)
  confirmLabel: string   // 'Sign' | 'Connect' | 'Send' | …
  tone?: 'primary' | 'danger'
  origin?: string        // shown in the titlebar (🔒 origin)
}

function approvalPreloadPath(): string {
  return join(__dirname, '../inject/approval-preload.js')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function buildApprovalHtml(opts: ApprovalOptions): string {
  const accent = opts.tone === 'danger' ? '#f59e0b' : '#2563eb'
  const accentHover = opts.tone === 'danger' ? '#d97706' : '#1d4ed8'
  const originBadge = opts.origin ? `🔒 ${escapeHtml(opts.origin)}` : ''
  // Our own trusted content (all dynamic values are HTML-escaped) loaded from a
  // data: URL — no CSP so the inline button handlers are guaranteed to fire.
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{background:#0b1220;color:#e5e7eb;font:14px/1.5 -apple-system,'Segoe UI',system-ui,sans-serif;display:flex;flex-direction:column;overflow:hidden}
  #bar{height:36px;flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:0 6px 0 10px;background:#0b1220;border-bottom:1px solid rgba(255,255,255,.08);-webkit-app-region:drag;user-select:none}
  #bar img{width:18px;height:18px;border-radius:5px;flex:0 0 auto}
  #bar .nm{font-weight:700;color:#f1f5f9;font-size:12px;flex:0 0 auto}
  #bar .og{flex:1 1 auto;text-align:center;color:#9aa4b2;font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #bar .x{-webkit-app-region:no-drag;cursor:pointer;border:0;background:transparent;color:#9aa4b2;font-size:13px;width:28px;height:24px;border-radius:6px}
  #bar .x:hover{background:rgba(255,90,90,.18);color:#ff6b6b}
  main{flex:1 1 auto;display:flex;flex-direction:column;padding:18px 18px 0;min-height:0}
  h1{font-size:16px;font-weight:700;color:#f8fafc;margin-bottom:12px}
  .detail{flex:1 1 auto;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#0f172a;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px 14px;font-size:13px;color:#cbd5e1}
  footer{flex:0 0 auto;display:flex;flex-direction:column;gap:8px;padding:14px 18px 18px}
  button.act{-webkit-app-region:no-drag;cursor:pointer;border:0;border-radius:12px;padding:13px;font-size:15px;font-weight:700;transition:background .12s}
  .confirm{background:${accent};color:#fff}
  .confirm:hover{background:${accentHover}}
  .reject{background:transparent;color:#9aa4b2;border:1px solid rgba(255,255,255,.12)}
  .reject:hover{background:rgba(255,255,255,.05);color:#e5e7eb}
</style></head><body>
  <div id="bar">
    <img src="${WALLET_ICON}"/>
    <span class="nm">MagicMoney</span>
    <span class="og">${originBadge}</span>
    <button class="x" onclick="__mmApproval__.respond(false)" title="Close">✕</button>
  </div>
  <main>
    <h1>${escapeHtml(opts.heading)}</h1>
    <div class="detail">${escapeHtml(opts.detail)}</div>
  </main>
  <footer>
    <button class="act confirm" onclick="__mmApproval__.respond(true)">${escapeHtml(opts.confirmLabel)}</button>
    <button class="act reject" onclick="__mmApproval__.respond(false)">Reject</button>
  </footer>
</body></html>`
}

/**
 * Shows the branded approval window and resolves true (confirmed) / false
 * (rejected or closed). Parented to the dApp browser popup when it's open (where
 * the user is looking), otherwise the main wallet window.
 */
export function showApprovalWindow(opts: ApprovalOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const parent =
      popupWin && !popupWin.isDestroyed() ? popupWin
      : mainWin && !mainWin.isDestroyed() ? mainWin
      : undefined
    if (parent?.isMinimized()) parent.restore()

    const win = new BrowserWindow({
      width: 440,
      height: 560,
      parent,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      frame: false,
      show: false,
      backgroundColor: '#0b1220',
      title: opts.title,
      webPreferences: {
        preload: approvalPreloadPath(),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })

    let settled = false
    const finish = (approved: boolean): void => {
      if (settled) return
      settled = true
      ipcMain.removeListener('approval:respond', onRespond)
      if (!win.isDestroyed()) win.close()
      resolve(approved)
    }
    const onRespond = (event: IpcMainEvent, approved: boolean): void => {
      if (!win.isDestroyed() && event.sender === win.webContents) finish(!!approved)
    }

    ipcMain.on('approval:respond', onRespond)
    win.on('closed', () => finish(false))   // closing the window counts as reject
    win.once('ready-to-show', () => win.show())
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildApprovalHtml(opts)))
  })
}
