/**
 * update-manager.ts — in-app auto-update state machine (main process)
 *
 * Wraps electron-updater so BOTH the passive startup check and the user-triggered
 * "Check for Updates" button in Settings share one state machine, and the renderer
 * can render live progress. The app publishes to GitHub Releases (public repo, see
 * package.json build.publish), so end users update with no embedded credentials.
 *
 * Platform behaviour:
 *   • Windows (NSIS) + Linux (AppImage): fully silent — check → download → relaunch.
 *   • macOS: Squirrel.Mac refuses to APPLY an unsigned update (OS requirement), so
 *     we only DETECT the new version and open the GitHub releases page for a manual
 *     drag-install. To make macOS silent later: add an Apple Developer ID cert +
 *     notarization and route mac through the same downloadUpdate/quitAndInstall path.
 */

import { app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { getMainWin } from './browser-manager'

const RELEASES_URL = 'https://github.com/M2AF/Magic-Money-Wallet/releases/latest'

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'mac-available'   // update exists but macOS can't self-apply — offer the download page
  | 'error'

export interface UpdateStatus {
  state: UpdateState
  version?: string      // the available/downloaded version, when known
  percent?: number      // download progress 0–100
  error?: string        // human-readable reason when state === 'error'
}

let status: UpdateStatus = { state: 'idle' }
let wired = false

function setStatus(next: UpdateStatus): void {
  status = next
  const win = getMainWin()
  if (win && !win.isDestroyed()) win.webContents.send('update:status', status)
}

export function getUpdateState(): UpdateStatus {
  return status
}

/** Attach the autoUpdater event handlers exactly once (idempotent). */
function wireEvents(): void {
  if (wired) return
  wired = true

  // The button drives the download; never auto-download in the background. Still
  // stage-on-quit as a safety net for the passive startup check path.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking' }))

  autoUpdater.on('update-available', (info) => {
    const version = info?.version
    // macOS can't self-apply an unsigned update — surface it as a manual download
    // rather than staging a package Squirrel.Mac will reject.
    if (process.platform === 'darwin') {
      setStatus({ state: 'mac-available', version })
      return
    }
    setStatus({ state: 'available', version })
    autoUpdater.downloadUpdate().catch((e) => {
      setStatus({ state: 'error', version, error: reason(e) })
    })
  })

  autoUpdater.on('update-not-available', () => setStatus({ state: 'not-available' }))

  autoUpdater.on('download-progress', (p) => {
    setStatus({ state: 'downloading', version: status.version, percent: Math.round(p?.percent ?? 0) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    setStatus({ state: 'downloaded', version: info?.version ?? status.version })
  })

  autoUpdater.on('error', (e) => {
    setStatus({ state: 'error', error: reason(e) })
  })
}

function reason(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error:\s*/, '')
}

/**
 * Kick off a check. In dev (unpackaged) electron-updater has no feed and throws,
 * so we short-circuit to a friendly not-available state. `silent` only affects
 * the log; the state stream is the same either way.
 */
export function startUpdateCheck(opts: { silent?: boolean } = {}): void {
  if (!app.isPackaged) {
    setStatus({ state: 'not-available', error: 'Updates are only available in the installed app.' })
    return
  }
  wireEvents()
  if (!opts.silent) setStatus({ state: 'checking' })
  autoUpdater.checkForUpdates().catch((e) => {
    setStatus({ state: 'error', error: reason(e) })
  })
}

/**
 * Apply the update. Windows/Linux relaunch into the staged version; macOS opens
 * the releases page (no self-apply without signing).
 */
export function installUpdate(): void {
  if (process.platform === 'darwin' || status.state === 'mac-available') {
    shell.openExternal(RELEASES_URL)
    return
  }
  if (status.state === 'downloaded') {
    autoUpdater.quitAndInstall()
  }
}
