import { app, BrowserWindow, shell, dialog, session } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc-handlers'
import { setMainWindow } from './browser-manager'
import { initWalletConnect } from './wc-client'
import { autoUpdater } from 'electron-updater'

// Force HTTP/2 (TCP) instead of QUIC (UDP) — prevents ERR_QUIC_PROTOCOL_ERROR
// when loading IPFS gateway images in Electron's Chromium engine
app.commandLine.appendSwitch('disable-quic')

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
  // Only the wallet's own document (loaded from file:// in the packaged app) gets
  // the strict policy. dApp pages (https) and the data: approval windows are left
  // untouched. mainFrame-only so we set it on the document, not every sub-resource.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType === 'mainFrame' && details.url.startsWith('file://')) {
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
  })
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
    shell.openExternal(url)
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
  // Harden the renderer with a strict CSP in packaged builds (see WALLET_CSP).
  if (app.isPackaged) installRendererCsp()
  registerIpcHandlers()
  createWindow()
  initWalletConnect().catch(e => console.error('[WC] startup error:', e))

  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify()
    autoUpdater.on('update-downloaded', () => {
      dialog.showMessageBox({
        type: 'info',
        title: 'Update Ready',
        message: 'A new version of MagicMoney Wallet is ready.',
        detail: 'Restart now to apply the update.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0
      }).then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall()
      })
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})