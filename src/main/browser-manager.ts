/**
 * browser-manager.ts — MagicMoney Wallet
 *
 * Manages a detached popup BrowserWindow for the dApp browser.
 * The popup is independent of the main wallet window so the user
 * can browse dApps and use the wallet portfolio/market simultaneously.
 *
 * Architecture:
 *   Popup BrowserWindow (1100 × 750, resizable)
 *   ├── Chrome renderer: src/renderer/browser.html (titlebar + address bar)
 *   │   Preload: preload/index.js  — exposes wallet.browserNavigate() etc.
 *   └── WebContentsView (dApp content)
 *       Preload: main/web3-inject.js — exposes window.ethereum / window.solana
 *
 * Web3 signing dialogs (eth_requestAccounts, personal_sign, etc.) attach to
 * the MAIN wallet window so the user sees them inside the wallet UI.
 */

import { WebContentsView, BrowserWindow, dialog, shell, app } from 'electron'
import { join } from 'path'

export const BROWSER_HOME = 'https://chainlensnft.info'

// Chrome bar height in the popup: 32px titlebar + 48px address bar
const CHROME_HEIGHT = 80

let popupWin: BrowserWindow | null = null
let dappView: WebContentsView | null = null
let mainWin: BrowserWindow | null = null

const PHISHING_BLOCKLIST = new Set([
  'metarnask.io', 'myehereum.com', 'pancakeswep.finance',
  'unisvvap.org', 'opensea-nft.io', 'etherscan-login.com',
  'metamask-login.com', 'wallet-connect.live', 'claimreward.net'
])

function web3InjectPath(): string {
  return join(__dirname, 'web3-inject.js')
}

function walletPreloadPath(): string {
  return join(__dirname, '../preload/index.js')
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
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    const base = devUrl.replace(/\/$/, '')
    popupWin.loadURL(`${base}/browser.html`)
  } else {
    popupWin.loadFile(join(__dirname, '../renderer/browser.html'))
  }

  popupWin.once('ready-to-show', () => {
    popupWin?.show()
    attachDappView()
  })

  popupWin.on('closed', () => {
    dappView = null
    popupWin = null
    // Tell wallet renderer the popup closed
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('browser:closed')
    }
  })

  popupWin.on('resize', () => {
    if (dappView && popupWin && !popupWin.isDestroyed()) {
      const [w, h] = popupWin.getContentSize()
      dappView.setBounds({ x: 0, y: CHROME_HEIGHT, width: w, height: Math.max(0, h - CHROME_HEIGHT) })
    }
  })
}

function attachDappView(): void {
  if (!popupWin || popupWin.isDestroyed()) return

  dappView = new WebContentsView({
    webPreferences: {
      preload: web3InjectPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  popupWin.contentView.addChildView(dappView)

  const [w, h] = popupWin.getContentSize()
  dappView.setBounds({ x: 0, y: CHROME_HEIGHT, width: w, height: Math.max(0, h - CHROME_HEIGHT) })
  dappView.webContents.loadURL(BROWSER_HOME)

  // ── Forward dApp nav events to popup chrome renderer ──────────────────
  function sendToChrome(channel: string, payload: unknown) {
    if (popupWin && !popupWin.isDestroyed()) {
      popupWin.webContents.send(channel, payload)
    }
  }

  dappView.webContents.on('did-navigate', (_, url) => {
    sendToChrome('browser:url', url)
    sendToChrome('browser:nav-state', {
      canBack: dappView!.webContents.canGoBack(),
      canForward: dappView!.webContents.canGoForward()
    })
  })

  dappView.webContents.on('did-navigate-in-page', (_, url) => {
    sendToChrome('browser:url', url)
    sendToChrome('browser:nav-state', {
      canBack: dappView!.webContents.canGoBack(),
      canForward: dappView!.webContents.canGoForward()
    })
  })

  dappView.webContents.on('page-title-updated', (_, title) => {
    sendToChrome('browser:title', title)
    if (popupWin && !popupWin.isDestroyed()) popupWin.setTitle(title || 'MagicMoney Browser')
  })

  dappView.webContents.on('did-start-loading', () => sendToChrome('browser:loading', true))
  dappView.webContents.on('did-stop-loading', () => {
    sendToChrome('browser:loading', false)
    sendToChrome('browser:url', dappView!.webContents.getURL())
  })

  // ── Phishing guard ──────────────────────────────────────────────────────
  dappView.webContents.on('will-navigate', (event, url) => {
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
        cancelId: 0
      }).then(({ response }) => {
        if (response === 1) dappView?.webContents.loadURL(url)
      })
    }
  })

  dappView.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      dappView?.webContents.loadURL(url)
    } else {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })
}

// ── Control functions called by IPC handlers ──────────────────────────────

export function closeBrowserWindow(): void {
  if (popupWin && !popupWin.isDestroyed()) popupWin.close()
}

export function browserNavigate(url: string): void {
  if (!dappView) return
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`
  dappView.webContents.loadURL(normalized)
}

export function browserBack(): void    { dappView?.webContents.goBack() }
export function browserForward(): void { dappView?.webContents.goForward() }
export function browserReload(): void  { dappView?.webContents.reload() }
export function browserHome(): void    { dappView?.webContents.loadURL(BROWSER_HOME) }

export function getBrowserState() {
  return {
    url: dappView?.webContents.getURL() ?? BROWSER_HOME,
    canBack: dappView?.webContents.canGoBack() ?? false,
    canForward: dappView?.webContents.canGoForward() ?? false,
    loading: dappView?.webContents.isLoading() ?? false,
    isOpen: !!(popupWin && !popupWin.isDestroyed())
  }
}

export function getMainWin(): BrowserWindow | null { return mainWin }
