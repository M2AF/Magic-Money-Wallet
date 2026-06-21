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
 *       Preload: inject/web3-inject.js — exposes window.ethereum / window.solana
 *
 * Web3 signing dialogs (eth_requestAccounts, personal_sign, etc.) attach to
 * the MAIN wallet window so the user sees them inside the wallet UI.
 */

import { WebContentsView, BrowserWindow, dialog, shell, app, ipcMain } from 'electron'
import type { IpcMainEvent } from 'electron'
import { join } from 'path'
import { WALLET_ICON } from '../preload/wallet-icon'

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
    attachDappView()
  })

  popupWin.on('close', () => {
    // A WebContentsView is NOT auto-destroyed when its window closes, so the
    // dApp renderer (OpenSea etc.) would keep running in the background —
    // websockets, animation frames, and RPC polling through web3:request —
    // which starves the wallet window and makes it sluggish to drag long after
    // the browser is gone. Tear it down while the window is still valid.
    destroyDappView()
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
    try {
      if (popupWin && !popupWin.isDestroyed() && !popupWin.webContents.isDestroyed()) {
        popupWin.webContents.send(channel, payload)
      }
    } catch { /* window torn down mid-send — safe to ignore */ }
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
    // Non-web schemes (mailto:, etc.) → hand off to the OS.
    if (!/^https?:\/\//i.test(url)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    // Phishing blocklist parity with in-view navigation — block, don't relocate.
    if (!isSafe(url)) return { action: 'deny' }

    // Open a REAL popup window. Wallet-connect / OAuth flows (Abstract Global
    // Wallet cross-app connect, Google sign-in, WalletConnect web) rely on
    // window.open + window.opener.postMessage to return their result to the
    // dApp. Reloading the URL in the same view broke that channel and left the
    // approval UI inert (Approve/Reject did nothing). Letting Electron create
    // the popup keeps the opener relationship and makes it independently
    // interactive.
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
          nodeIntegration: false
        }
      }
    }
  })

  // Configure each popup the dApp opens (auth / wallet-connect windows) so its
  // own nested popups and external links are handled too.
  dappView.webContents.on('did-create-window', (childWin) => {
    childWin.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url) && isSafe(url)) return { action: 'allow' }
      shell.openExternal(url)
      return { action: 'deny' }
    })
  })
}

// ── Control functions called by IPC handlers ──────────────────────────────

/**
 * Fully tears down the dApp WebContents so it stops consuming CPU/GPU and
 * network once the browser is closed. Without this the renderer leaks and the
 * wallet UI stays laggy. Safe to call multiple times.
 */
function destroyDappView(): void {
  if (!dappView) return
  try {
    const wc = dappView.webContents
    if (popupWin && !popupWin.isDestroyed()) {
      popupWin.contentView.removeChildView(dappView)
    }
    if (wc && !wc.isDestroyed()) {
      wc.stop()
      wc.close()
    }
  } catch { /* already torn down — safe to ignore */ }
  dappView = null
}

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
