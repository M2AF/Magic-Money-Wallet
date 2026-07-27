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

import { app, shell, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { spawn } from 'child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'
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
/** Staged installer path from the 'update-downloaded' event (Windows flow). */
let downloadedFile: string | null = null

function setStatus(next: UpdateStatus): void {
  status = next
  const win = getMainWin()
  if (win && !win.isDestroyed()) win.webContents.send('update:status', status)
}

export function getUpdateState(): UpdateStatus {
  return status
}

/**
 * Append-only update log next to the app's other logs. electron-updater is
 * otherwise completely silent, which left a failed update with no forensics at
 * all — the NSIS installer aborts in its own process, so this file is the only
 * record of what the app did before handing over.
 */
function logLine(line: string): void {
  try {
    const dir = app.getPath('logs')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'update.log'), `${new Date().toISOString()} ${line}\n`)
  } catch { /* logging must never break the update */ }
}

/** Attach the autoUpdater event handlers exactly once (idempotent). */
function wireEvents(): void {
  if (wired) return
  wired = true

  autoUpdater.logger = {
    info: (m: unknown) => logLine(`info  ${String(m)}`),
    warn: (m: unknown) => logLine(`warn  ${String(m)}`),
    error: (m: unknown) => logLine(`error ${String(m)}`),
    debug: (m: unknown) => logLine(`debug ${String(m)}`),
  }

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
    // Path to the staged installer — the Windows replace flow runs it directly
    // instead of letting electron-updater drive the handover (see installUpdate).
    downloadedFile = (info as unknown as { downloadedFile?: string })?.downloadedFile ?? null
    logLine(`update-downloaded ${info?.version ?? '?'} file=${downloadedFile ?? 'unknown'}`)
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
 * Windows update handover: force-close → uninstall old → install new.
 *
 * WHY NOT electron-updater's quitAndInstall(): that lets the NSIS installer run
 * the uninstall internally, and that path aborts with
 *     "MagicMoney Wallet cannot be closed. Please close it manually and click
 *      Retry to continue."
 * Retry re-runs the same failing check so it can never succeed, and Cancel makes
 * the installer report "Failed to uninstall old application files ...: 2" and
 * leave the old version in place. It was observed firing even with ZERO app
 * processes running, so it is not simply "the app didn't quit".
 *
 * Each step below was verified by hand against a running install: the silent
 * uninstaller exits 0 (it closes the running app itself), and the installer then
 * exits 0 on the clean state. Driving them as separate processes keeps that
 * working order instead of relying on the installer's internal sequencing.
 *
 * /KEEP_APP_DATA is what preserves the wallet — userData (wallet.enc, addresses,
 * approved origins) must survive the uninstall step.
 *
 * Returns false when the flow can't be staged, so the caller can fall back.
 */
function runWindowsReplace(installer: string): boolean {
  try {
    if (!existsSync(installer)) {
      logLine(`replace: staged installer missing at ${installer}`)
      return false
    }
    const instDir = dirname(app.getPath('exe'))
    const appExe = basename(app.getPath('exe'))
    const uninstaller = readdirSync(instDir).find(f => /^Uninstall .*\.exe$/i.test(f))
    if (!uninstaller) {
      logLine(`replace: no uninstaller found in ${instDir}`)
      return false
    }

    const script = join(app.getPath('temp'), 'magicmoney-update.cmd')
    const oldUn = join(app.getPath('temp'), 'magicmoney-old-uninstaller.exe')
    // The uninstaller is copied out first: with _?= it runs in place and would
    // otherwise be deleting the directory it is executing from.
    writeFileSync(script, [
      '@echo off',
      'setlocal',
      // Give the app a moment to exit on its own, then make sure it is gone —
      // the uninstaller must not race a live process holding open file handles.
      'ping -n 3 127.0.0.1 >nul',
      `taskkill /F /T /IM "${appExe}" >nul 2>&1`,
      'ping -n 2 127.0.0.1 >nul',
      `copy /Y "${join(instDir, uninstaller)}" "${oldUn}" >nul`,
      `"${oldUn}" /S /KEEP_APP_DATA /currentuser _?=${instDir}`,
      `"${installer}"`,
      // Safety net: if the install somehow did not land, run it once more rather
      // than leaving the machine with no app at all.
      `if not exist "${join(instDir, appExe)}" "${installer}"`,
      `del /f /q "${oldUn}" >nul 2>&1`,
    ].join('\r\n') + '\r\n')

    logLine(`replace: spawning ${script} (instDir=${instDir}, installer=${installer})`)
    spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    return true
  } catch (e) {
    logLine(`replace: failed to stage — ${reason(e)}`)
    return false
  }
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
  if (status.state !== 'downloaded') return

  // Nothing may veto this quit. The NSIS installer (and the old build's
  // uninstaller it runs) aborts with "<app> cannot be closed. Please close it
  // manually and click Retry" if any process from the install dir survives —
  // and Retry re-runs the identical check, so it can never succeed.
  //
  // Two things here could keep us alive: the tray's close-to-hide interceptor
  // (index.ts) and a dApp page's beforeunload veto in the built-in browser.
  // destroy() tears a window down without firing 'close' or beforeunload, so
  // neither can block the handover.
  logLine(`installUpdate: destroying ${BrowserWindow.getAllWindows().length} window(s)`)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.destroy()
  }

  // Windows: drive force-close → uninstall → install ourselves (see above).
  // The script waits for this process to go away, so exit immediately after.
  if (process.platform === 'win32' && downloadedFile && runWindowsReplace(downloadedFile)) {
    app.exit(0)
    return
  }

  logLine('installUpdate: falling back to quitAndInstall')
  autoUpdater.quitAndInstall()
}
