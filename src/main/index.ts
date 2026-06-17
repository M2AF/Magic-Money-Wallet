import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc-handlers'
import { setMainWindow } from './browser-manager'

// Force HTTP/2 (TCP) instead of QUIC (UDP) — prevents ERR_QUIC_PROTOCOL_ERROR
// when loading IPFS gateway images in Electron's Chromium engine
app.commandLine.appendSwitch('disable-quic')

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

  // Window controls via IPC (custom titlebar)
  const { ipcMain } = require('electron')
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:close', () => mainWindow?.close())
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

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