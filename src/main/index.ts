import { app, BrowserWindow, shell, session, net } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc-handlers'
import { setSwapFetch } from './swap-proxy'
import { setMainWindow, initMagicGuard } from './browser-manager'
import { initWalletConnect } from './wc-client'
import { startUpdateCheck } from './update-manager'
import { stopManagedTor } from './tor-manager'

// Force HTTP/2 (TCP) instead of QUIC (UDP) — prevents ERR_QUIC_PROTOCOL_ERROR
// when loading IPFS gateway images in Electron's Chromium engine
app.commandLine.appendSwitch('disable-quic')
// Prevent WebRTC from sending UDP outside the configured browser SOCKS proxy.
// This is process-wide because Chromium exposes the policy only as a startup flag.
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp')

// Force hardware-accelerated rendering for canvas/WebGL-heavy dApps in the built-in
// browser (e.g. nad.fun's TradingView charts). Chromium frequently blocklists the
// GPU on Windows and falls back to slow software rasterization; these override that.
// Verify with chrome://gpu inside the in-app browser ("Canvas: Hardware accelerated").
app.commandLine.appendSwitch('ignore-gpu-blocklist')
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')

// Strict CSP for the packaged wallet renderer (closes C-2: no inline scripts, no
// arbitrary connect targets). Enforced as a response header — stronger than the
// <meta> tag and, unlike the meta, it can be scoped so it does NOT apply to the
// dApp browser's https pages (which need their own CSP). Dev keeps the looser meta
// in index.html so Vite's HMR websocket + react-refresh inline script still work.
const WALLET_CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com; " +
  "connect-src 'self' https://magicmoney-swap-proxy.guildfordking.workers.dev; " +
  "img-src 'self' data: https: ipfs: ar:; " +
  "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"

function installRendererCsp(): void {
  // IMPORTANT: scope the listener with a URL filter to file:// ONLY. The dApp
  // browser (WebContentsView) shares this default session and is extremely chatty
  // (RPC polling, websockets, charts). Without the filter the listener fired for
  // every one of those requests, loading the main process and making the wallet
  // UI sluggish. With the filter, dApp https traffic bypasses this entirely and
  // only the wallet's own documents (loaded from file:// when packaged) are seen.
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['file:///*'] },
    (details, callback) => {
      if (details.resourceType === 'mainFrame') {
        const headers = { ...details.responseHeaders }
        // Drop any existing CSP header variants before setting ours.
        for (const k of Object.keys(headers)) {
          if (k.toLowerCase() === 'content-security-policy') delete headers[k]
        }
        headers['Content-Security-Policy'] = [WALLET_CSP]
        callback({ responseHeaders: headers })
      } else {
        callback({ responseHeaders: details.responseHeaders })
      }
    }
  )
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

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 900,
    minWidth: 380,
    minHeight: 700,
    frame: false,          // custom titlebar
    transparent: false,
    backgroundColor: '#060b18',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,       // renderer in sandbox — cannot access Node.js directly
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    },
    icon: join(__dirname, '../../resources/icon.png'),
    show: false            // prevent white flash on load
  })

  // Open DevTools in development
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  // Graceful show after paint
  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // Force external links to system browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url)
    return { action: 'deny' }
  })

  // Load the renderer
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Register main window for web3 signing dialogs
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) setMainWindow(mainWindow)
  })

  // Window controls via IPC — target the sender window so the popup
  // browser closes itself rather than closing the main wallet window
  const { ipcMain } = require('electron')
  ipcMain.on('window:minimize', (event: Electron.IpcMainEvent) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.on('window:close', (event: Electron.IpcMainEvent) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
}

// F12 opens a detached DevTools for whichever webContents has keyboard focus.
// This covers both the wallet UI and any WebContentsView (dApp browser) windows.
app.on('web-contents-created', (_event, contents) => {
  contents.on('before-input-event', (_e, input) => {
    if (
      input.type === 'keyDown' &&
      (input.key === 'F12' ||
        (input.control && input.shift && input.key.toUpperCase() === 'I'))
    ) {
      if (contents.isDevToolsOpened()) {
        contents.closeDevTools()
      } else {
        contents.openDevTools({ mode: 'detach' })
      }
    }
  })
})

app.whenReady().then(() => {
  // Confirm hardware acceleration is actually active (the in-app browser can't
  // easily reach chrome://gpu). In the terminal, look for "gpu_compositing",
  // "rasterization" and "webgl" = "enabled". If they read "disabled_software" /
  // "unavailable_software", the GPU is being software-rendered (the real cause of
  // slow canvas/WebGL dApps) and the slowness is NOT something the wallet can fix.
  console.log('[GPU] feature status:', app.getGPUFeatureStatus())

  // Route swap/LI.FI fetches through Chromium's network stack (net.fetch). Node's
  // undici fetch can hang on some hosts in the main process; net.fetch matches the
  // (working) renderer/extension behaviour.
  setSwapFetch((input, init) => net.fetch(input, init))

  // Harden the renderer with a strict CSP in packaged builds (see WALLET_CSP).
  if (app.isPackaged) installRendererCsp()
  registerIpcHandlers()
  // Before the browser can open, per MAGIC_GUARD_IMPLEMENTATION_PLAN.md's Batch B
  // initialization-point guidance — attaches the dApp-session request listener
  // and starts loading the bundled filter lists (deferred; see initMagicGuard doc).
  initMagicGuard()
  createWindow()
  initWalletConnect().catch(e => console.error('[WC] startup error:', e))

  // Passive check on launch so Settings can show "update available" before the
  // user clicks. The in-app Settings button (update-manager) drives the actual
  // download + restart — no forced native dialog. No-op in dev (unpackaged).
  startUpdateCheck({ silent: true })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => stopManagedTor())

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})
