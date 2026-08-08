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

import { WebContentsView, BrowserWindow, dialog, shell, app, ipcMain, screen, session } from 'electron'
import type { IpcMainEvent, HandlerDetails, WindowOpenHandlerResponse, WebContents, Rectangle, Session } from 'electron'
import { join, basename } from 'path'
import { writeFileSync, existsSync } from 'fs'
import { Socket } from 'net'
import { showBrowserContextMenu } from './browser-context-menu'
import { addBookmark, isBookmarked, removeBookmarkByUrl, getWebApps } from './browser-store'
// Shared with the Android fill path so the two can never drift (password-fill.ts).
import { buildFillScript } from './password-fill'
import { installWebApp, isWebAppInstalled, type WebAppInstallResult } from './web-apps'
import {
  isPasswordVaultUnlocked,
  matchPasswordsForHost,
  revealPassword,
  type PasswordSummary
} from './password-vault'
import { WALLET_ICON } from '../preload/wallet-icon'
import { getDappChainId, setDappChainId } from './dapp-chain'
import { defaultDappChainId } from './chain-config'
import { loadConfig, saveConfig } from './secure-store'
import { ensureManagedTor, stopManagedTor } from './tor-manager'
import {
  getMagicGuardState,
  setMagicGuardEnabled,
  setMagicGuardForSite,
  hostnameFromUrl,
  initMagicGuardEngine,
  magicGuardDecide,
  registerTab as registerGuardTab,
  unregisterTab as unregisterGuardTab,
  resetPageCounter as resetGuardPageCounter,
  noteBlocked as noteGuardBlocked,
  type MagicGuardState,
  type ElectronResourceType
} from './magic-guard'

export const BROWSER_HOME = 'https://chainlensnft.info'
const DAPP_SESSION_PARTITION = 'persist:mm-dapp-browser'
const TOR_HOST = '127.0.0.1'
const TOR_PORTS = [9050, 9150] as const

export interface TorBrowserState {
  enabled: boolean
  status: 'off' | 'connecting' | 'connected' | 'error'
  host: string
  port: number
  isTor: boolean
  message: string
}

// Height (px) reserved above the dApp view for the browser chrome (titlebar +
// address bar). The exact height depends on CSS/layout, so the chrome renderer
// measures it and reports it live via `browser:set-chrome-height`; this value is
// only a first-paint fallback until that first report arrives. (Previously a stale
// hardcoded 80 left the dApp view covering the bottom of the address bar.)
let chromeHeight = 80

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
  /** Host already auto-filled in this document, so one page fills at most once. */
  autofilledHost: string | null
}

let popupWin: BrowserWindow | null = null
let mainWin: BrowserWindow | null = null
let tabs: Tab[] = []
let activeTabId = 0
let nextTabId = 1
let torState: TorBrowserState = {
  enabled: false,
  status: 'off',
  host: TOR_HOST,
  port: 9050,
  isTor: false,
  message: 'Tor Mode is off',
}

// ── Side-by-side window layout ───────────────────────────────────────────────
// The wallet (mainWin) and dApp browser (popupWin) are two independent OS windows.
// "Full Screen Mode" tiles them to fill the current display's work area — wallet on
// one side, browser on the other — by positioning each with setBounds. This is the
// cross-platform-safe approach (no OS-window merging or fragile move syncing).
type SnapSide = 'left' | 'right'
let snapSide: SnapSide | null = null   // current snap side of the WALLET, or null when detached
let lastSide: SnapSide = 'left'        // remembered side for the toggle / "Enter Full Screen"
let pendingSnap: SnapSide | null = null // snap to apply once a freshly-opened browser is ready
// Free-floating bounds captured before the first snap, restored on Detach.
let preSnap: { main: Rectangle | null; popup: Rectangle | null } = { main: null, popup: null }
const SNAP_WALLET_WIDTH = 440          // wallet pane width when tiled (browser gets the rest)

// True while the chrome renderer's custom tab-overview dropdown is open. The active
// tab's WebContentsView is layered ABOVE the chrome renderer, so it must stay
// detached while the dropdown is showing (otherwise it hides the dropdown). It is
// re-attached when the dropdown closes. See browserSuspendTabsMenu / …Resume….
let tabsMenuOpen = false

// Tab currently in HTML5 fullscreen (a video's fullscreen button), or null.
// Drives both the full-window view bounds and the OS-fullscreen window state.
let htmlFullscreenTabId: number | null = null

// Set for the one download about to be started by a "Save … as…" menu item.
// Consumed by the will-download handler, which then leaves the save path unset
// so Electron shows its Save dialog; every other download saves silently.
let saveAsNextDownload = false

// Last top-level dApp origin loaded — used to reset the active EVM network when the
// user navigates to a DIFFERENT dApp, so a prior dApp's chain doesn't leak forward.
let _lastDappOrigin: string | null = null

// URL that should become the browser's FIRST tab instead of BROWSER_HOME. Set when
// something asks for a specific page before the popup exists — a link clicked in the
// wallet UI, or an http(s) URL handed to us by the OS because MagicMoney is the
// default browser. Consumed once, on the popup's first tab creation.
let pendingOpenUrl: string | null = null

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

function dappSession(): Session {
  // Never change the wallet renderer's default session proxy. All untrusted dApp
  // tabs and their auth popups share this isolated, browser-only session instead.
  return session.fromPartition(DAPP_SESSION_PARTITION)
}

/**
 * Sign the browser out of everything: cookies, localStorage, IndexedDB, service
 * workers and cache, for the dApp session AND the default one (early browsing
 * predates the isolated partition, so data exists in both).
 *
 * Offered when a NEW wallet is created. dApp grants are wallet-scoped and clear
 * automatically, but site logins are not — without this a fresh wallet stays
 * linkable to the previous identity through every site session it inherited.
 * Never automatic: this destroys real logins, so it is always the user's call.
 */
export async function clearBrowsingData(): Promise<void> {
  // Inlined per call so TS infers the literal union from the parameter type
  // rather than widening to string[].
  const wipe = (s: Session) => s.clearStorageData({
    storages: [
      'cookies', 'localstorage', 'indexdb', 'filesystem',
      'serviceworkers', 'cachestorage', 'shadercache',
    ],
  })
  await Promise.allSettled([
    wipe(dappSession()),
    dappSession().clearCache(),
    wipe(session.defaultSession),
    session.defaultSession.clearCache(),
  ])
}

function publishTorState(): void {
  sendToChrome('browser:tor-state', torState)
}

function torPageAllowed(): boolean {
  return !torState.enabled || torState.status === 'connected'
}

function syncTorViewVisibility(): void {
  const cur = activeTab()
  if (!cur || !popupWin || popupWin.isDestroyed()) return
  if (!torPageAllowed() || tabsMenuOpen) {
    try { popupWin.contentView.removeChildView(cur.view) } catch { /* not attached */ }
    return
  }
  try { popupWin.contentView.addChildView(cur.view) } catch { /* already attached */ }
  layoutActiveView()
}

function setTorState(next: TorBrowserState): TorBrowserState {
  torState = next
  syncTorViewVisibility()
  publishTorState()
  return torState
}

function localPortOpen(port: number, timeoutMs = 700): Promise<boolean> {
  return new Promise(resolve => {
    const socket = new Socket()
    let settled = false
    const finish = (open: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, TOR_HOST)
  })
}

async function discoverTorPort(preferred: number): Promise<number | null> {
  const candidates = [preferred, ...TOR_PORTS.filter(p => p !== preferred)]
  for (const port of candidates) {
    if (await localPortOpen(port)) return port
  }
  return null
}

async function ensureTorPort(preferred: number): Promise<number | null> {
  const existing = await discoverTorPort(preferred)
  if (existing) return existing
  await ensureManagedTor(preferred, message => {
    setTorState({ enabled: true, status: 'connecting', host: TOR_HOST, port: preferred, isTor: false, message })
  })
  return discoverTorPort(preferred)
}

function torErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Tor could not be started'
}

async function verifyTorExit(ses: Session): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await ses.fetch('https://check.torproject.org/api/ip', {
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) return false
    const body = await response.json() as { IsTor?: boolean }
    return body.IsTor === true
  } finally {
    clearTimeout(timeout)
  }
}

async function applyTorProxy(port: number): Promise<void> {
  const ses = dappSession()
  await ses.setProxy({
    mode: 'fixed_servers',
    proxyRules: `socks5://${TOR_HOST}:${port}`,
    // Chromium normally bypasses proxies for loopback destinations. Removing the
    // implicit bypass prevents a dApp from using localhost as a proxy escape hatch.
    proxyBypassRules: '<-loopback>',
  })
  await ses.closeAllConnections()
}

async function applyDirectConnection(): Promise<void> {
  const ses = dappSession()
  await ses.setProxy({ mode: 'direct' })
  await ses.closeAllConnections()
}

function reloadAllTabs(): void {
  for (const tab of tabs) {
    try { tab.view.webContents.reload() } catch { /* tab closed mid-toggle */ }
  }
}

/** Restore the persisted fail-closed proxy before the browser's first page loads. */
async function prepareTorSession(): Promise<void> {
  const cfg = loadConfig()
  if (!cfg.torBrowserEnabled) {
    await applyDirectConnection()
    setTorState({ enabled: false, status: 'off', host: TOR_HOST, port: cfg.torBrowserPort, isTor: false, message: 'Tor Mode is off' })
    return
  }

  setTorState({ enabled: true, status: 'connecting', host: TOR_HOST, port: cfg.torBrowserPort, isTor: false, message: 'Connecting to local Tor…' })
  await applyTorProxy(cfg.torBrowserPort)
  let discovered: number | null = null
  try {
    discovered = await ensureTorPort(cfg.torBrowserPort)
  } catch (error) {
    setTorState({ enabled: true, status: 'error', host: TOR_HOST, port: cfg.torBrowserPort, isTor: false, message: `${torErrorMessage(error)}. Traffic is blocked.` })
    return
  }
  const port = discovered ?? cfg.torBrowserPort
  if (port !== cfg.torBrowserPort) await applyTorProxy(port)
  if (port !== cfg.torBrowserPort) saveConfig({ torBrowserPort: port })

  if (!discovered) {
    setTorState({ enabled: true, status: 'error', host: TOR_HOST, port, isTor: false, message: 'Tor is not running on ports 9050 or 9150. Traffic is blocked.' })
    return
  }

  try {
    const isTor = await verifyTorExit(dappSession())
    setTorState({
      enabled: true,
      status: isTor ? 'connected' : 'error',
      host: TOR_HOST,
      port,
      isTor,
      message: isTor ? 'Connected and verified through Tor' : 'The proxy responded, but the exit was not verified as Tor. Traffic remains proxied.',
    })
  } catch {
    setTorState({ enabled: true, status: 'error', host: TOR_HOST, port, isTor: false, message: 'Could not verify the Tor exit. Traffic remains fail-closed through the proxy.' })
  }
}

export function getTorBrowserState(): TorBrowserState {
  return torState
}

export async function setTorBrowserMode(enabled: boolean): Promise<TorBrowserState> {
  const cfg = loadConfig()
  if (!enabled) {
    saveConfig({ torBrowserEnabled: false })
    await applyDirectConnection()
    stopManagedTor()
    reloadAllTabs()
    return setTorState({ enabled: false, status: 'off', host: TOR_HOST, port: cfg.torBrowserPort, isTor: false, message: 'Tor Mode is off' })
  }

  saveConfig({ torBrowserEnabled: true })
  setTorState({ enabled: true, status: 'connecting', host: TOR_HOST, port: cfg.torBrowserPort, isTor: false, message: 'Connecting to local Tor…' })
  // Apply the configured SOCKS endpoint first so the switch is fail-closed from
  // this point onward; discovery of an alternate standard port happens behind it.
  await applyTorProxy(cfg.torBrowserPort)
  let discovered: number | null = null
  try {
    discovered = await ensureTorPort(cfg.torBrowserPort)
  } catch (error) {
    reloadAllTabs()
    return setTorState({ enabled: true, status: 'error', host: TOR_HOST, port: cfg.torBrowserPort, isTor: false, message: `${torErrorMessage(error)}. Traffic is blocked.` })
  }
  const port = discovered ?? cfg.torBrowserPort
  if (port !== cfg.torBrowserPort) await applyTorProxy(port)
  if (port !== cfg.torBrowserPort) saveConfig({ torBrowserPort: port })
  reloadAllTabs()

  if (!discovered) {
    return setTorState({ enabled: true, status: 'error', host: TOR_HOST, port, isTor: false, message: 'Tor is not running on ports 9050 or 9150. Traffic is blocked.' })
  }

  try {
    const isTor = await verifyTorExit(dappSession())
    return setTorState({
      enabled: true,
      status: isTor ? 'connected' : 'error',
      host: TOR_HOST,
      port,
      isTor,
      message: isTor ? 'Connected and verified through Tor' : 'The proxy responded, but the exit was not verified as Tor. Traffic remains proxied.',
    })
  } catch {
    return setTorState({ enabled: true, status: 'error', host: TOR_HOST, port, isTor: false, message: 'Could not verify the Tor exit. Traffic remains fail-closed through the proxy.' })
  }
}

// ── Magic Guard (privacy filtering for the dApp browser) ────────────────────
// Main derives the hostname from the active tab itself — never from a value the
// renderer passes in — so a compromised dApp page cannot spoof which site its
// on/off toggle applies to.

export function browserGetMagicGuardState(): MagicGuardState {
  const t = activeTab()
  return getMagicGuardState(hostnameFromUrl(t?.url ?? null), t?.view.webContents.id)
}

export function browserSetMagicGuardEnabled(enabled: boolean): MagicGuardState {
  const t = activeTab()
  const state = setMagicGuardEnabled(enabled, hostnameFromUrl(t?.url ?? null), t?.view.webContents.id)
  publishGuardState()
  return state
}

export function browserSetMagicGuardForSite(protect: boolean): MagicGuardState {
  const t = activeTab()
  const state = setMagicGuardForSite(hostnameFromUrl(t?.url ?? null), protect, t?.view.webContents.id)
  publishGuardState()
  return state
}

/**
 * Attach the ONE onBeforeRequest listener on dappSession() (Electron only honors
 * the last listener registered per session/event, so this must never be called
 * more than once) and kick off the engine load. Called once from index.ts's
 * app.whenReady() — before the browser can open, per the plan's Batch B
 * initialization-point guidance.
 */
/**
 * Downloads started from the dApp browser — a "Save … as…" context-menu item, or
 * a page navigating to a file. Without a will-download handler these silently
 * did nothing.
 *
 * "Save as…" leaves the path unset so Electron shows its own Save dialog;
 * everything else saves straight to the OS Downloads folder under a
 * collision-safe name. Progress rides the same `download:progress` channel the
 * wallet's neon top bar already uses, pushed to the browser chrome.
 *
 * Registered once, next to the Magic Guard listener, because both attach to
 * dappSession() and Electron only honours the last listener per session event.
 */
export function initBrowserDownloads(): void {
  dappSession().on('will-download', (_event, item) => {
    const saveAs = saveAsNextDownload
    saveAsNextDownload = false

    if (!saveAs) {
      item.setSavePath(uniqueDownloadPath(item.getFilename() || 'download'))
    }

    item.on('updated', (_e, state) => {
      if (state !== 'progressing') return
      const total = item.getTotalBytes()
      sendToChrome('download:progress', {
        active: true,
        percent: total > 0 ? Math.round((item.getReceivedBytes() / total) * 100) : null,
      })
    })

    item.once('done', (_e, state) => {
      sendToChrome('download:progress', { active: false, percent: null })
      if (state === 'completed') sendToChrome('browser:toast', `Saved ${basename(item.getSavePath())}`)
      else if (state === 'cancelled') sendToChrome('browser:toast', 'Download cancelled')
      else sendToChrome('browser:toast', 'The download failed')
    })
  })
}

/** "photo.png" → "photo (1).png" when the first name is taken. */
function uniqueDownloadPath(fileName: string): string {
  const dir = app.getPath('downloads')
  const dot = fileName.lastIndexOf('.')
  const base = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot) : ''
  for (let i = 0; i < 100; i++) {
    const candidate = join(dir, i === 0 ? `${base}${ext}` : `${base} (${i})${ext}`)
    if (!existsSync(candidate)) return candidate
  }
  return join(dir, `${base} (${Date.now()})${ext}`)
}

export function initMagicGuard(): void {
  dappSession().webRequest.onBeforeRequest((details, callback) => {
    const tab = tabs.find(t => t.view.webContents.id === details.webContentsId)
    const response = magicGuardDecide({
      url: details.url,
      method: details.method,
      resourceType: details.resourceType as ElectronResourceType,
      frameUrl: details.frame?.url ?? null,
      referrer: details.referrer || null,
      tabUrl: tab?.url ?? null,
    })
    if (response.cancel && tab) {
      noteGuardBlocked(tab.view.webContents.id)
      scheduleGuardPublish()
    }
    callback(response)
  })
  // Deferred so this never runs inline with startup's synchronous module-eval
  // path; parsing ~3.6MB of bundled filter lists is still a blocking native
  // call when it runs (see magic-guard.ts's initMagicGuardEngine doc comment).
  setImmediate(() => { initMagicGuardEngine().catch(e => console.error('[magic-guard] init failed:', e)) })
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
  publishGuardState()
}

/** Push the Magic Guard state for the currently active tab's hostname to the chrome. */
function publishGuardState(): void {
  const t = activeTab()
  sendToChrome('browser:guard-state', getMagicGuardState(hostnameFromUrl(t?.url ?? null), t?.view.webContents.id))
}

// Blocked-request counts can arrive many times a second on a busy page; batching
// to at most once per 100ms (plan section 8 "Counter semantics") keeps the IPC
// channel from turning into an event storm. Nav/tab-switch state changes stay
// on the unthrottled publishGuardState() path above — only the block-counter
// path uses this.
let guardPublishTimer: ReturnType<typeof setTimeout> | null = null
function scheduleGuardPublish(): void {
  if (guardPublishTimer) return
  guardPublishTimer = setTimeout(() => { guardPublishTimer = null; publishGuardState() }, 100)
}

function layoutActiveView(): void {
  const t = activeTab()
  if (!t || !popupWin || popupWin.isDestroyed()) return
  const [w, h] = popupWin.getContentSize()
  // HTML5 fullscreen (a video's fullscreen button): the view must cover the
  // ENTIRE window, not just the area under the chrome — otherwise the toolbar
  // and titlebar stay visible and it isn't really fullscreen. The window itself
  // is put into OS fullscreen alongside this (see wireTab's handlers).
  if (htmlFullscreenTabId === t.id) {
    t.view.setBounds({ x: 0, y: 0, width: w, height: h })
    return
  }
  t.view.setBounds({ x: 0, y: chromeHeight, width: w, height: Math.max(0, h - chromeHeight) })
}

/**
 * The chrome renderer measures its real height (titlebar + address bar) and reports
 * it here so the dApp view sits flush beneath the address bar — never covering it,
 * never leaving a gap — regardless of future CSS/layout changes.
 */
export function setChromeHeight(h: number): void {
  const next = Math.round(h)
  if (!Number.isFinite(next) || next <= 0 || next === chromeHeight) return
  chromeHeight = next
  layoutActiveView()
}

function navCanGo(wc: WebContents): { canBack: boolean; canForward: boolean } {
  return {
    canBack: wc.navigationHistory.canGoBack(),
    canForward: wc.navigationHistory.canGoForward(),
  }
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
    // Proxy configuration must finish before the first dApp request. A persisted
    // Tor preference therefore fails closed even when Tor is not currently running.
    void prepareTorSession().then(() => {
      if (!popupWin || popupWin.isDestroyed()) return
      const first = pendingOpenUrl ?? BROWSER_HOME
      pendingOpenUrl = null
      createTab(first, true)
      // If the browser was opened as part of an "Enter Full Screen Mode" action,
      // tile the two windows now that the popup exists and is visible.
      if (pendingSnap) {
        const side = pendingSnap
        pendingSnap = null
        applySnap(side)
      }
    }).catch(() => {
      pendingOpenUrl = null   // no tab was opened — don't leak it into the next session
      setTorState({
        enabled: true,
        status: 'error',
        host: TOR_HOST,
        port: loadConfig().torBrowserPort,
        isTor: false,
        message: 'The Tor proxy could not be applied, so no browser page was opened.',
      })
    })
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
    tabsMenuOpen = false
    popupWin = null
    // The window that was tiled with the wallet is gone — drop snap state (the
    // wallet keeps its current position) and refresh the wallet's layout controls.
    snapSide = null
    preSnap = { main: null, popup: null }
    // Tell wallet renderer the popup closed
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('browser:closed')
    }
    broadcastLayout()
  })

  popupWin.on('resize', () => layoutActiveView())
  // Keep the green (maximize) button's active styling in sync with the OS state.
  popupWin.on('maximize', () => broadcastLayout())
  popupWin.on('unmaximize', () => broadcastLayout())

  // The user can leave OS fullscreen behind the page's back (Esc / F11 / the
  // green button). Tell the page so it drops its own fullscreen too, otherwise
  // the view would stay sized to the whole window with the chrome hidden.
  popupWin.on('leave-full-screen', () => {
    if (htmlFullscreenTabId === null) return
    const t = tabs.find(x => x.id === htmlFullscreenTabId)
    htmlFullscreenTabId = null
    try { t?.view.webContents.executeJavaScript('document.exitFullscreen?.()', true) } catch { /* gone */ }
    layoutActiveView()
    sendToChrome('browser:fullscreen', false)
  })
}

// ── Window layout control ────────────────────────────────────────────────────

/** Current snap state, pushed to both renderers so their controls stay in sync. */
export function getLayoutState(): { snapped: boolean; side: SnapSide | null; browserOpen: boolean; maximized: boolean } {
  return {
    snapped: snapSide !== null,
    side: snapSide,
    browserOpen: !!(popupWin && !popupWin.isDestroyed()),
    maximized: !!(popupWin && !popupWin.isDestroyed() && popupWin.isMaximized()),
  }
}

/**
 * Green titlebar button (browser only): maximize the dApp browser window to the
 * display's work area, or restore it if already maximized. Independent of the
 * side-by-side snap (which uses setBounds, not maximize), so the two don't fight.
 */
export function browserToggleMaximize(): void {
  if (!popupWin || popupWin.isDestroyed()) return
  if (popupWin.isFullScreen()) popupWin.setFullScreen(false)
  if (popupWin.isMaximized()) popupWin.unmaximize()
  else popupWin.maximize()
}

/** Push the layout state to the wallet + browser chromes (green button / dropdown). */
function broadcastLayout(): void {
  const state = getLayoutState()
  for (const win of [mainWin, popupWin]) {
    try {
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('layout:changed', state)
      }
    } catch { /* window torn down mid-send — safe to ignore */ }
  }
}

/** The work area (screen minus taskbar/dock) of the display the browser is on. */
function snapWorkArea(): Rectangle {
  const anchor = popupWin && !popupWin.isDestroyed() ? popupWin : mainWin
  const bounds = anchor && !anchor.isDestroyed() ? anchor.getBounds() : { x: 0, y: 0, width: 0, height: 0 }
  return screen.getDisplayMatching(bounds).workArea
}

/** Tile the wallet + browser side by side to fill the current display. */
function applySnap(side: SnapSide): void {
  if (!mainWin || mainWin.isDestroyed() || !popupWin || popupWin.isDestroyed()) return

  // Bring both out of any state that would fight setBounds.
  for (const win of [mainWin, popupWin]) {
    if (win.isMinimized()) win.restore()
    if (win.isFullScreen()) win.setFullScreen(false)
    if (win.isMaximized()) win.unmaximize()
  }

  // Capture free-floating bounds the first time we tile, so Detach can restore them.
  if (snapSide === null) {
    preSnap = { main: mainWin.getBounds(), popup: popupWin.getBounds() }
  }

  const wa = snapWorkArea()
  const walletW = Math.min(SNAP_WALLET_WIDTH, Math.floor(wa.width / 2))
  const browserW = wa.width - walletW
  const walletX = side === 'left' ? wa.x : wa.x + browserW
  const browserX = side === 'left' ? wa.x + walletW : wa.x

  mainWin.setBounds({ x: walletX, y: wa.y, width: walletW, height: wa.height })
  popupWin.setBounds({ x: browserX, y: wa.y, width: browserW, height: wa.height })

  snapSide = side
  lastSide = side
  layoutActiveView()
  broadcastLayout()
}

/** Snap the wallet to `side`; opens the browser first if it isn't already open. */
export function layoutSnap(side: SnapSide): void {
  if (!popupWin || popupWin.isDestroyed()) {
    pendingSnap = side           // applied from popupWin's ready-to-show handler
    openBrowserWindow()
    return
  }
  applySnap(side)
}

/** Un-tile: restore both windows to their pre-snap free-floating bounds. */
export function layoutDetach(): void {
  if (snapSide === null) return
  const restore = (win: BrowserWindow | null, saved: Rectangle | null, fallback: { width: number; height: number }): void => {
    if (!win || win.isDestroyed()) return
    if (saved) { win.setBounds(saved); return }
    const wa = screen.getDisplayMatching(win.getBounds()).workArea
    win.setBounds({
      x: wa.x + Math.max(0, Math.floor((wa.width - fallback.width) / 2)),
      y: wa.y + Math.max(0, Math.floor((wa.height - fallback.height) / 2)),
      width: fallback.width,
      height: fallback.height,
    })
  }
  restore(mainWin, preSnap.main, { width: 420, height: 900 })
  restore(popupWin, preSnap.popup, { width: 1100, height: 750 })
  snapSide = null
  preSnap = { main: null, popup: null }
  layoutActiveView()
  broadcastLayout()
}

/** Green titlebar button: tile if detached, detach if tiled. */
export function layoutToggle(): void {
  if (snapSide !== null) { layoutDetach(); return }
  layoutSnap(lastSide)
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
        partition: DAPP_SESSION_PARTITION,
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

  // Magic Guard: blockedThisPage resets at the start of a top-level navigation,
  // before subresources begin loading (plan section 8 "Counter semantics").
  // blockedThisTab is untouched here — it persists until the tab closes.
  wc.on('did-start-navigation', (_e, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame) {
      resetGuardPageCounter(wc.id)
      if (isActive()) publishGuardState()
    }
  })

  wc.on('did-navigate', (_e, url) => {
    tab.url = url
    // New document ⇒ its preload will re-report any login form; allow one fresh
    // auto-fill for it. In-page (SPA) navigations keep the guard.
    tab.autofilledHost = null
    const nav = navCanGo(wc)
    tab.canBack = nav.canBack
    tab.canForward = nav.canForward
    if (isActive()) {
      sendToChrome('browser:url', url)
      sendToChrome('browser:nav-state', { canBack: tab.canBack, canForward: tab.canForward })
      publishGuardState()

      // Reset the active EVM network to the mode default (Ethereum, or Sepolia in
      // Testnet Mode) when moving to a NEW dApp origin so a prior dApp's chain
      // (e.g. Monad on nad.fun) doesn't leak into the next one. Same-origin
      // reloads and SPA route changes (did-navigate-in-page) keep the chain.
      let origin: string | null = null
      try { origin = new URL(url).origin } catch { origin = null }
      if (origin && origin !== _lastDappOrigin) {
        _lastDappOrigin = origin
        const def = defaultDappChainId(loadConfig())
        const changed = getDappChainId() !== def
        setDappChainId(def)
        const hex = `0x${def.toString(16)}`
        if (changed) emitDappEvent('eth', 'chainChanged', hex) // correct a page that synced the stale chain
        notifyBrowserChrome('web3:chain-changed', hex)         // keep the toolbar pill in sync
      }
    }
    pushTabs()
  })

  wc.on('did-navigate-in-page', (_e, url) => {
    tab.url = url
    const nav = navCanGo(wc)
    tab.canBack = nav.canBack
    tab.canForward = nav.canForward
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

  // ── HTML5 fullscreen ────────────────────────────────────────────────────
  // Electron leaves the WebContentsView where it is when a page goes
  // fullscreen, so the video stayed boxed under the toolbar. Take the window
  // into OS fullscreen and let layoutActiveView give the view the whole frame.
  wc.on('enter-html-full-screen', () => {
    htmlFullscreenTabId = tab.id
    if (popupWin && !popupWin.isDestroyed() && !popupWin.isFullScreen()) popupWin.setFullScreen(true)
    layoutActiveView()
    sendToChrome('browser:fullscreen', true)
  })

  wc.on('leave-html-full-screen', () => {
    if (htmlFullscreenTabId !== tab.id) return
    htmlFullscreenTabId = null
    if (popupWin && !popupWin.isDestroyed() && popupWin.isFullScreen()) popupWin.setFullScreen(false)
    layoutActiveView()
    sendToChrome('browser:fullscreen', false)
  })

  // Right-click. Electron ships no default menu for a WebContentsView, which is
  // why saving an image or copying a link was impossible in this browser.
  wc.on('context-menu', (_event, params) => {
    showBrowserContextMenu(wc, params, {
      openInNewTab: (url) => { setImmediate(() => createTab(url, true)) },
      download: (target, url, saveAs) => {
        saveAsNextDownload = saveAs
        target.downloadURL(url)
      },
      window: () => popupWin,
    })
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
      partition: DAPP_SESSION_PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  const tab: Tab = { id: nextTabId++, view, url, title: 'New Tab', loading: true, canBack: false, canForward: false, autofilledHost: null }
  tabs.push(tab)
  registerGuardTab(view.webContents.id)
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
  // While the tab-overview dropdown is open the active view stays detached so it
  // doesn't hide the dropdown; browserResumeTabsMenu re-attaches it on close.
  if (!tabsMenuOpen && torPageAllowed()) {
    try { popupWin.contentView.addChildView(next.view) } catch { /* already attached */ }
    layoutActiveView()
  }
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
    unregisterGuardTab(wc.id)
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
 * The tab overview is a custom HTML dropdown drawn by the chrome renderer
 * (BrowserApp.tsx) — a single row per tab with an active-tab dot and an inline
 * close (×). Native Electron menus can't render a clickable × on the same row,
 * which forced the old two-row layout; the HTML dropdown replaces it.
 *
 * Because the active tab's WebContentsView is layered above the chrome renderer,
 * it must be detached while the dropdown is open. The renderer calls suspend when
 * it opens the dropdown and resume when it closes.
 *
 * Returns a JPEG data-URL snapshot of the live page, captured just before the view
 * is detached, so the chrome renderer can paint it behind the dropdown — the dApp
 * stays visible while the overlay is open instead of blanking to an empty area.
 */
export async function browserSuspendTabsMenu(): Promise<string> {
  if (tabsMenuOpen) return ''
  const cur = activeTab()
  let snapshot = ''
  if (cur && popupWin && !popupWin.isDestroyed() && torPageAllowed()) {
    try {
      const img = await cur.view.webContents.capturePage()
      if (!img.isEmpty()) snapshot = `data:image/jpeg;base64,${img.toJPEG(85).toString('base64')}`
    } catch { /* capture unavailable — fall back to an empty content area */ }
  }
  tabsMenuOpen = true
  if (cur && popupWin && !popupWin.isDestroyed()) {
    try { popupWin.contentView.removeChildView(cur.view) } catch { /* not attached */ }
  }
  return snapshot
}

export function browserResumeTabsMenu(): void {
  if (!tabsMenuOpen) return
  tabsMenuOpen = false
  const cur = activeTab()
  if (cur && popupWin && !popupWin.isDestroyed() && torPageAllowed()) {
    try { popupWin.contentView.addChildView(cur.view) } catch { /* already attached */ }
    layoutActiveView()
  }
}

/** Activate a tab by id (from the tab-overview dropdown). */
export function browserSetActiveTab(id: number): void { setActiveTab(id) }

/** Close a tab by id (from the tab-overview dropdown's inline × button). */
export function browserCloseTab(id: number): void { closeTab(id) }

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
      unregisterGuardTab(wc.id)
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
 * Show `rawUrl` in the MagicMoney browser, opening/focusing the popup as needed.
 *
 * This is the single entry point for "a link happened outside the dApp browser":
 *   • a link in the wallet UI (index.ts's window-open handler), and
 *   • a URL handed to the app by Windows when MagicMoney is the default browser
 *     (index.ts's argv / second-instance / open-url paths).
 *
 * Deliberately independent of the wallet's lock state: a browser that refuses to
 * show a page until you type your password is not usable as a system browser, and
 * the page gets no wallet access anyway — every web3 request still goes through
 * the per-origin approval + unlocked-wallet checks.
 */
export function openBrowserWithUrl(rawUrl: string): void {
  const url = normalizeWebUrl(rawUrl)
  if (!url || !isSafe(url)) return

  if (!popupWin || popupWin.isDestroyed()) {
    pendingOpenUrl = url          // becomes the first tab once the popup is ready
    openBrowserWindow()
    return
  }
  if (popupWin.isMinimized()) popupWin.restore()
  popupWin.focus()
  // The window exists but its first tab hasn't been created yet (still awaiting
  // the Tor/proxy setup) — hand the URL to that pending first tab instead of
  // racing it with a second one.
  if (tabs.length === 0) pendingOpenUrl = url
  else createTab(url, true)
}

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

// ── Page-level actions (address-bar star / share, "Save and share" menu) ─────
//
// Every one of these reads the URL and title from the ACTIVE TAB in main — never
// from a value the chrome renderer passes in. The chrome renderer is trusted, but
// keeping the page identity single-sourced here is what makes the password-fill
// host check below meaningful: a tab that navigated a millisecond ago can't be
// made to look like a different site.

export interface BrowserPageState {
  url: string
  title: string
  host: string
  bookmarked: boolean
  installed: boolean
  /** Saved logins matching this host (metadata only — never the password). */
  savedLogins: PasswordSummary[]
  /** True when the password vault is open, so the menu can prompt instead of lying. */
  passwordsUnlocked: boolean
}

/** The active tab's live URL + title, or null when no tab is open. */
export function browserActivePage(): { url: string; title: string } | null {
  const t = activeTab()
  if (!t) return null
  return { url: t.url, title: t.title }
}

export function browserGetPageState(): BrowserPageState {
  const t = activeTab()
  const url = t?.url ?? ''
  const host = hostnameFromUrl(url) ?? ''
  const web = /^https?:\/\//i.test(url)
  return {
    url,
    title: t?.title ?? '',
    host,
    bookmarked: web ? isBookmarked(url) : false,
    installed: web ? isWebAppInstalled(url) : false,
    savedLogins: host && isPasswordVaultUnlocked() ? matchPasswordsForHost(host) : [],
    passwordsUnlocked: isPasswordVaultUnlocked(),
  }
}

/** Address-bar star: bookmark the current page, or un-bookmark it if already saved. */
export function browserToggleBookmark(): BrowserPageState {
  const t = activeTab()
  if (t && /^https?:\/\//i.test(t.url)) {
    if (isBookmarked(t.url)) removeBookmarkByUrl(t.url)
    else addBookmark(t.url, t.title && t.title !== 'New Tab' ? t.title : t.url)
  }
  return browserGetPageState()
}

/** "Install this page as an app" — the shortcut name defaults to the page title. */
export async function browserInstallPageAsApp(): Promise<WebAppInstallResult> {
  const t = activeTab()
  if (!t || !/^https?:\/\//i.test(t.url)) {
    return { ok: false, apps: getWebApps(), error: 'There is no page to install' }
  }
  const name = t.title && t.title !== 'New Tab' && t.title !== 'Untitled'
    ? t.title
    : (hostnameFromUrl(t.url) ?? 'Web App')
  return installWebApp(t.url, name)
}

export interface PageSaveResult { ok: boolean; path?: string; error?: string }

/** "Save page as…" — a complete offline copy, via the OS save dialog. */
export async function browserSavePage(): Promise<PageSaveResult> {
  const t = activeTab()
  if (!t || !popupWin || popupWin.isDestroyed()) return { ok: false, error: 'There is no page to save' }
  const base = sanitizeFileBase(t.title || hostnameFromUrl(t.url) || 'page')

  const { canceled, filePath } = await dialog.showSaveDialog(popupWin, {
    title: 'Save page',
    defaultPath: join(app.getPath('downloads'), `${base}.html`),
    filters: [{ name: 'Web page, complete', extensions: ['html'] }],
  })
  if (canceled || !filePath) return { ok: false }

  try {
    // HTMLComplete writes the document plus a "<name>_files" folder of assets.
    await t.view.webContents.savePage(filePath, 'HTMLComplete')
    return { ok: true, path: filePath }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The page could not be saved' }
  }
}

/** "Screenshot" — capture the visible page straight into the Downloads folder. */
export async function browserCapturePage(): Promise<PageSaveResult> {
  const t = activeTab()
  if (!t) return { ok: false, error: 'There is no page to capture' }
  try {
    const image = await t.view.webContents.capturePage()
    if (image.isEmpty()) return { ok: false, error: 'The page could not be captured' }
    const base = sanitizeFileBase(t.title || hostnameFromUrl(t.url) || 'screenshot')
    const target = join(app.getPath('downloads'), `${base} ${Date.now()}.png`)
    writeFileSync(target, image.toPNG())
    return { ok: true, path: target }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The page could not be captured' }
  }
}

function sanitizeFileBase(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 80)
  return cleaned || 'page'
}

/**
 * Type a saved login into the page's sign-in form.
 *
 * Only ever reached from an explicit click in the password panel — MagicMoney
 * never fills automatically, so a hidden form on a hostile page cannot harvest a
 * credential just by existing. Two further guards:
 *   • the entry's host must match the ACTIVE TAB's host (read here, not passed in)
 *   • values are embedded with JSON.stringify, so a password containing quotes or
 *     newlines is data, never script
 */
export async function browserFillCredentials(id: string): Promise<{ ok: boolean; error?: string }> {
  const t = activeTab()
  if (!t) return { ok: false, error: 'There is no page to fill' }
  return fillEntryIntoTab(t, id)
}

async function fillEntryIntoTab(t: Tab, id: string): Promise<{ ok: boolean; error?: string }> {
  if (!isPasswordVaultUnlocked()) return { ok: false, error: 'Unlock the password manager first' }

  const host = hostnameFromUrl(t.url)
  if (!host) return { ok: false, error: 'This page has no address to match' }
  const match = matchPasswordsForHost(host).find(m => m.id === id)
  if (!match) return { ok: false, error: 'That login is not saved for this site' }

  let password: string
  let username: string
  try {
    password = revealPassword(id)
    username = match.username
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not read that saved password' }
  }

  const script = buildFillScript(username, password)

  try {
    const result = await t.view.webContents.executeJavaScript(script, true)
    if (result === 'no-form') return { ok: false, error: 'No sign-in form was found on this page' }
    return { ok: true }
  } catch {
    return { ok: false, error: 'The page would not accept the fill' }
  }
}

// ── Auto-fill ────────────────────────────────────────────────────────────────
// The dApp tab's preload sends `autofill:form-found` (no payload) when a visible
// password field appears in the TOP frame. Main then decides everything from its
// own state: the tab is identified by the SENDER's webContents id, the host by
// the tab's own URL, and a fill happens only when the vault is already unlocked
// and a saved login matches that EXACT host — the same posture as Chrome/Brave.
// Related-domain matches stay click-to-fill in the password panel, nothing is
// ever auto-submitted, and each document auto-fills at most once.

/** True for origins we'll auto-fill on: https, or plain-http loopback (dev). */
function autofillOriginOk(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol === 'https:') return true
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
  } catch {
    return false
  }
}

export async function browserAutofillFormFound(senderWcId: number): Promise<void> {
  const tab = tabs.find(t => t.view.webContents.id === senderWcId)
  if (!tab || !isPasswordVaultUnlocked() || !autofillOriginOk(tab.url)) return
  const host = hostnameFromUrl(tab.url)
  if (!host || tab.autofilledHost === host) return
  const exact = matchPasswordsForHost(host).filter(m => m.host === host)
  if (exact.length === 0) return

  // matchPasswordsForHost sorts deterministically; fill the first exact match.
  tab.autofilledHost = host
  const result = await fillEntryIntoTab(tab, exact[0].id)
  if (result.ok) {
    sendToChrome('browser:autofill-filled', {
      host,
      username: exact[0].username,
      more: exact.length - 1,   // shown as "+n more in the password manager"
    })
  } else {
    // The form vanished between detection and fill — let a later form retry.
    tab.autofilledHost = null
  }
}

/**
 * Unlocking the password manager AFTER a login page already loaded would miss
 * the preload's one-shot report, so the unlock handler calls this: re-check the
 * ACTIVE tab for a visible password field and run the same auto-fill decision.
 */
export async function browserTryAutofillActiveTab(): Promise<void> {
  const t = activeTab()
  if (!t || !isPasswordVaultUnlocked() || !autofillOriginOk(t.url)) return
  const probe = `(() => {
    for (const el of document.querySelectorAll('input[type="password"]')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return true;
    }
    return false;
  })()`
  try {
    const hasForm = await t.view.webContents.executeJavaScript(probe, true)
    if (hasForm === true) await browserAutofillFormFound(t.view.webContents.id)
  } catch { /* page navigating — the next form-found report covers it */ }
}

// ── Branded approval / signing window ────────────────────────────────────────
// Replaces the native dialog.showMessageBox() prompts with an in-house frameless
// window styled to match the wallet (MagicMoney titlebar + dark UI). The content
// is OUR HTML, so we control the look entirely; the user's decision comes back
// over the `approval:respond` IPC.

/**
 * One selectable identity in a pick-one approval (a discoverable passkey
 * sign-in that matched several credentials). Rendered as a radio list; the id
 * comes back on ApprovalDecision.
 */
export interface ApprovalChoice {
  id: string
  label: string
  sublabel?: string
}

/**
 * The richer approval result. `showApprovalWindow` keeps returning a bare
 * boolean for the two dozen yes/no prompts that predate choosers; anything
 * offering `choices` must use `showApprovalDecision` to learn WHICH was picked.
 */
export interface ApprovalDecision {
  approved: boolean
  choiceId?: string
}

export interface ApprovalOptions {
  title: string          // window title (accessibility / taskbar)
  heading: string        // bold prompt line
  detail: string         // body text (message / tx / address)
  confirmLabel: string   // 'Sign' | 'Connect' | 'Send' | …
  tone?: 'primary' | 'danger'
  origin?: string        // shown in the titlebar (🔒 origin)
  /**
   * Risk callouts pulled out of `detail` into a band above it, so the things
   * that can cost the user money (burns, collateral, undecodable fields) are
   * read before the amounts rather than scrolled past with them.
   */
  warnings?: string[]
  /**
   * When present the window becomes a chooser: the user picks one entry and the
   * decision carries its id. The first entry is preselected, so a confirm with
   * no interaction still means something sensible.
   */
  choices?: ApprovalChoice[]
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
  const warningBand = opts.warnings?.length
    ? `<div class="warn">${opts.warnings.map(w => `<div>⚠ ${escapeHtml(w)}</div>`).join('')}</div>`
    : ''
  // Chooser: a radio list above the detail pane. The confirm handler reads the
  // checked value, so the picked id travels back with the decision.
  const choiceList = opts.choices?.length
    ? `<div class="choices">${opts.choices.map((c, i) => `
        <label class="choice">
          <input type="radio" name="mmchoice" value="${escapeHtml(c.id)}"${i === 0 ? ' checked' : ''}/>
          <span class="ct"><span class="cl">${escapeHtml(c.label)}</span>${
            c.sublabel ? `<span class="cs">${escapeHtml(c.sublabel)}</span>` : ''
          }</span>
        </label>`).join('')}</div>`
    : ''
  const confirmCall = opts.choices?.length
    ? `__mmApproval__.respondWith(true, (document.querySelector('input[name=mmchoice]:checked')||{}).value)`
    : `__mmApproval__.respond(true)`
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
  .warn{flex:0 0 auto;margin-bottom:10px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.35);border-radius:10px;padding:10px 12px;font-size:12.5px;line-height:1.45;color:#fcd34d}
  .warn div + div{margin-top:5px}
  .choices{flex:0 0 auto;margin-bottom:10px;display:flex;flex-direction:column;gap:6px;max-height:190px;overflow:auto}
  .choice{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#0f172a;border:1px solid rgba(255,255,255,.10);border-radius:10px;cursor:pointer}
  .choice:hover{border-color:rgba(255,255,255,.22)}
  .choice:has(input:checked){border-color:${accent};background:rgba(37,99,235,.12)}
  .choice input{accent-color:${accent};width:16px;height:16px;flex:0 0 auto;cursor:pointer}
  .choice .ct{display:flex;flex-direction:column;min-width:0}
  .choice .cl{font-size:13.5px;color:#f1f5f9;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .choice .cs{font-size:12px;color:#9aa4b2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .detail{flex:1 1 auto;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#0f172a;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px 14px;font-size:13px;color:#cbd5e1;font-family:ui-monospace,'Cascadia Mono','Segoe UI Mono',Menlo,monospace}
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
    ${warningBand}
    ${choiceList}
    <div class="detail">${escapeHtml(opts.detail)}</div>
  </main>
  <footer>
    <button class="act confirm" onclick="${confirmCall}">${escapeHtml(opts.confirmLabel)}</button>
    <button class="act reject" onclick="__mmApproval__.respond(false)">Reject</button>
  </footer>
</body></html>`
}

/**
 * Shows the branded approval window and resolves true (confirmed) / false
 * (rejected or closed). The long-standing yes/no form — use
 * `showApprovalDecision` when the window offers `choices`.
 */
export async function showApprovalWindow(opts: ApprovalOptions): Promise<boolean> {
  return (await showApprovalDecision(opts)).approved
}

/**
 * Shows the branded approval window and resolves the full decision, including
 * which entry the user picked when `choices` were offered. Parented to the dApp
 * browser popup when it's open (where the user is looking), otherwise the main
 * wallet window.
 */
export function showApprovalDecision(opts: ApprovalOptions): Promise<ApprovalDecision> {
  return new Promise((resolve) => {
    const parent =
      popupWin && !popupWin.isDestroyed() ? popupWin
      : mainWin && !mainWin.isDestroyed() ? mainWin
      : undefined
    if (parent?.isMinimized()) parent.restore()

    const win = new BrowserWindow({
      width: 440,
      // A decoded transaction summary plus a warning band needs more room than
      // the one-line prompts this window was originally built for. The detail
      // pane still scrolls, so this only reduces how often it has to.
      height: (opts.warnings?.length ? 660 : 560) + (opts.choices?.length ? 150 : 0),
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
    const finish = (approved: boolean, choiceId?: string): void => {
      if (settled) return
      settled = true
      ipcMain.removeListener('approval:respond', onRespond)
      if (!win.isDestroyed()) win.close()
      resolve({ approved, choiceId })
    }
    // `choiceId` is absent for every pre-chooser caller (the old preload sends a
    // single argument), so an approve with no selection stays a plain approve.
    const onRespond = (event: IpcMainEvent, approved: boolean, choiceId?: unknown): void => {
      if (win.isDestroyed() || event.sender !== win.webContents) return
      finish(!!approved, typeof choiceId === 'string' ? choiceId : undefined)
    }

    ipcMain.on('approval:respond', onRespond)
    win.on('closed', () => finish(false))   // closing the window counts as reject
    win.once('ready-to-show', () => win.show())
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildApprovalHtml(opts)))
  })
}
