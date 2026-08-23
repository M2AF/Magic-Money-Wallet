/**
 * eyedropper.ts — pick a colour from anywhere on the screen.
 *
 * WHY THIS EXISTS: Chromium ships the EyeDropper API and Electron even exposes
 * the constructor in a secure context — but it does not work. Calling open()
 * rejects straight away with `AbortError: The user canceled the selection`,
 * because the picker's browser-side implementation lives in //chrome, not
 * //content, and Electron never provides one. Measured on Electron 43 /
 * Chrome 150 (a file:// page; on a data: URL the binding is missing outright,
 * EyeDropper being secure-context-only). A renderer that feature-detects the
 * constructor therefore gets a picker that silently "cancels" every time, so
 * the desktop app must run its own.
 *
 * HOW: freeze the screen (desktopCapturer grabs every display at native
 * resolution), put a borderless always-on-top window over each display showing
 * its own frozen capture, and let the user click. The capture is taken BEFORE
 * the overlays exist, so what the user clicks is exactly what was on screen —
 * any application, any photo, the wallet itself. The pixel is read in the
 * overlay from the image it is already displaying (see eyedropper-preload.ts);
 * nothing is written to disk and the captures die with the windows.
 *
 * Returns the picked colour as `#rrggbb`, or null when the user cancels.
 */

import { BrowserWindow, desktopCapturer, ipcMain, screen } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'

/** Generous: the user is hunting for a pixel, possibly across monitors. */
const PICK_TIMEOUT_MS = 2 * 60_000

interface Capture {
  bounds: Electron.Rectangle
  /** PNG data URL of that display at native (pre-DIP-scaling) resolution. */
  dataUrl: string
  /** The cursor is on this display, so its overlay takes the keyboard focus. */
  hasCursor: boolean
}

/**
 * One full-resolution capture per display, in the same order as
 * screen.getAllDisplays(). Displays whose source can't be matched are dropped
 * rather than shown blank.
 */
async function captureDisplays(): Promise<Capture[]> {
  const displays = screen.getAllDisplays()

  // thumbnailSize is a bounding box every source is scaled to FIT, so the width
  // and height are maxed independently: a box of (widest, tallest) leaves every
  // display at its own native size. Measured on this machine's mixed
  // landscape/portrait setup — passing 1920x1080 halved the portrait screens,
  // passing 1920x1920 returned all four untouched.
  const maxWidth = Math.max(...displays.map(d => Math.round(d.size.width * d.scaleFactor)))
  const maxHeight = Math.max(...displays.map(d => Math.round(d.size.height * d.scaleFactor)))

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: maxWidth, height: maxHeight },
    fetchWindowIcons: false
  })

  const cursor = screen.getCursorScreenPoint()
  const cursorDisplayId = screen.getDisplayNearestPoint(cursor).id

  const captures: Capture[] = []
  displays.forEach((display, i) => {
    // display_id is the reliable link; fall back to positional order, which is
    // the order desktopCapturer uses when it doesn't report ids (some Linux WMs).
    const source =
      sources.find(s => s.display_id && s.display_id === String(display.id)) ?? sources[i]
    if (!source || source.thumbnail.isEmpty()) return
    captures.push({
      bounds: display.bounds,
      dataUrl: source.thumbnail.toDataURL(),
      hasCursor: display.id === cursorDisplayId
    })
  })
  return captures
}

/**
 * Show the picker and resolve with the chosen colour.
 *
 * Rejects only when the screen could not be captured at all (e.g. macOS screen
 * recording permission denied) so the caller can say so; a user who presses
 * Escape gets a plain null.
 */
export async function pickScreenColor(parent?: BrowserWindow): Promise<string | null> {
  const captures = await captureDisplays()
  if (captures.length === 0) throw new Error('The screen could not be captured')

  return new Promise<string | null>((resolve, reject) => {
    const channel = `eyedropper:result:${randomUUID()}`
    const windows: BrowserWindow[] = []
    let settled = false
    let timer: NodeJS.Timeout | undefined

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      ipcMain.removeAllListeners(channel)
      for (const w of windows) if (!w.isDestroyed()) w.destroy()
      windows.length = 0
      // The wallet lost focus to the overlay — hand it back.
      if (parent && !parent.isDestroyed()) parent.focus()
    }
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }

    ipcMain.on(channel, (event, payload: { hex?: string; focus?: boolean }) => {
      // Focus follows the pointer across displays — see the note in the preload.
      // Not a result: an overlay asking for focus must not settle the pick.
      if (payload?.focus) {
        const win = BrowserWindow.fromWebContents(event.sender)
        if (win && !win.isDestroyed()) win.focus()
        return
      }
      const hex = typeof payload?.hex === 'string' ? payload.hex : null
      settle(() => resolve(/^#[0-9a-f]{6}$/i.test(hex ?? '') ? hex!.toLowerCase() : null))
    })

    for (const capture of captures) {
      const win = new BrowserWindow({
        x: capture.bounds.x,
        y: capture.bounds.y,
        width: capture.bounds.width,
        height: capture.bounds.height,
        frame: false,
        transparent: false,
        backgroundColor: '#000000',
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        show: false,
        // Above the taskbar and any other always-on-top app, so the overlay
        // really covers what was captured.
        alwaysOnTop: true,
        webPreferences: {
          // Built by build:inject into out/inject (see package.json), the same
          // route approval-preload.js and passkey-preload.js take.
          preload: join(__dirname, '../inject/eyedropper-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          // The overlay draws only our own capture; nothing may navigate here.
          webSecurity: true
        }
      })
      windows.push(win)

      win.setAlwaysOnTop(true, 'screen-saver')
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      win.webContents.on('will-navigate', e => e.preventDefault())
      // Closing any overlay (alt-F4, task switcher) counts as a cancel.
      win.on('closed', () => settle(() => resolve(null)))

      win.webContents.once('did-finish-load', () => {
        if (win.isDestroyed()) return
        win.webContents.send('eyedropper:start', { channel, image: capture.dataUrl })
        win.showInactive()
        // Only the overlay under the cursor takes focus, so Escape has a
        // keyboard target; focusing each in turn would just fight itself.
        if (capture.hasCursor) win.focus()
      })

      // An empty document — the preload builds the whole overlay in it, which
      // keeps the picker out of the renderer bundle and needs no CSP dance.
      win.loadURL('data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Chtml%3E%3Cbody%3E%3C/body%3E%3C/html%3E')
        .catch(e => settle(() => reject(new Error(`Colour picker failed to open: ${String(e)}`))))
    }

    timer = setTimeout(() => settle(() => resolve(null)), PICK_TIMEOUT_MS)
  })
}
