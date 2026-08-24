/**
 * update-check.ts — Sideload update check against GitHub Releases (Android)
 *
 * Maps onto the existing UpdateStatus contract so SettingsModal works
 * unchanged: a newer release first reports 'mac-available' (the shared UI's
 * "Download update vX" button), then drives 'downloading' → 'downloaded', at
 * which point the same button installs.
 *
 * THE DOWNLOAD IS NATIVE. It used to be `Browser.open(apkUrl)`, which handed
 * the APK to a Custom Tab: that download runs in whichever browser owns the
 * tab, stalls part-way on plenty of devices, and even when it completes leaves
 * the user to open a file manager, find the APK and tap it. Now DownloadManager
 * fetches it into the app's own external files dir (no storage permission, not
 * dumped in the user's Downloads folder) with progress reported in-app, and the
 * finished file goes straight to the system installer from the same button.
 *
 * Prereleases are included: beta tags (a '-' in the version) are how this
 * project ships, same as electron-updater's prerelease releaseType.
 */

import { App as CapacitorApp } from '@capacitor/app'
import type { UpdateStatus } from '../renderer/types/wallet'
import { AppInfo } from './app-info'
import { Downloader } from './downloader'

/**
 * True when this install came from Google Play. Play policy forbids apps
 * self-updating outside the store, so the whole Software Update surface is
 * removed for Play installs (Play delivers updates itself). Sideload installs
 * (null installer / package installer) keep the GitHub-Releases updater.
 */
export async function isPlayStoreInstall(): Promise<boolean> {
  try {
    const { installer } = await AppInfo.getInstallSource()
    return installer === 'com.android.vending'
  } catch {
    return false
  }
}

const RELEASES_API = 'https://api.github.com/repos/M2AF/Magic-Money-Wallet/releases?per_page=5'

let _state: UpdateStatus = { state: 'idle' }
let _downloadUrl: string | null = null

// Push channel for the Settings row. The shared SettingsModal already
// subscribes via window.wallet.onUpdateStatus; on Android that was a no-op, so
// a native download would have advanced with the button frozen on its old text.
const statusListeners = new Set<(s: UpdateStatus) => void>()
let progressWired = false

export function onUpdateStatus(cb: (s: UpdateStatus) => void): void {
  ensureProgressWired()
  statusListeners.add(cb)
}
export function offUpdateStatus(cb: (s: UpdateStatus) => void): void {
  statusListeners.delete(cb)
}

function publish(next: UpdateStatus): void {
  _state = next
  for (const cb of statusListeners) {
    try { cb(next) } catch { /* one bad subscriber must not stop the rest */ }
  }
}

/** One native listener, wired on the first subscriber — nothing runs at import. */
function ensureProgressWired(): void {
  if (progressWired) return
  progressWired = true
  Downloader.addListener('updateProgress', e => {
    if (e.state === 'downloading') {
      publish({ state: 'downloading', percent: e.percent, version: _state.version })
    } else if (e.state === 'downloaded') {
      publish({
        state: 'downloaded',
        version: _state.version,
        // The shared copy says "Restart to Update", which is Electron's story.
        // Android installs a new APK over the old one; the app is replaced, not
        // relaunched, so both strings are overridden here.
        actionLabel: 'Install update',
        actionHint: 'Opens Android’s installer. Your wallet data is kept.',
      })
    } else {
      publish({ state: 'not-available', error: e.error ?? 'The update download failed' })
    }
  }).catch(() => { progressWired = false })
}

type GhRelease = {
  tag_name: string
  html_url: string
  draft: boolean
  assets: Array<{ name: string; browser_download_url: string }>
}

/** semver compare with prerelease ordering: 0.2.0-beta.1 < 0.2.0 < 0.2.1 */
function isNewer(remote: string, local: string): boolean {
  const parse = (v: string) => {
    const [core, ...pre] = v.replace(/^v/, '').split('-')
    const nums = core.split('.').map(n => parseInt(n, 10) || 0)
    return { nums: [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0], pre: pre.join('-') }
  }
  const r = parse(remote); const l = parse(local)
  for (let i = 0; i < 3; i++) {
    if (r.nums[i] !== l.nums[i]) return r.nums[i] > l.nums[i]
  }
  // Same core: a release without prerelease outranks one with; otherwise
  // compare prerelease tags naturally (beta.2 > beta.1).
  if (!r.pre && l.pre) return true
  if (r.pre && !l.pre) return false
  return r.pre.localeCompare(l.pre, undefined, { numeric: true }) > 0
}

export async function updateCheck(): Promise<UpdateStatus> {
  _state = { state: 'checking' }
  try {
    const local = (await CapacitorApp.getInfo()).version
    const res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}`)
    const releases = await res.json() as GhRelease[]
    const latest = releases.find(r => !r.draft)
    if (!latest) { _state = { state: 'not-available' }; return _state }
    const remote = latest.tag_name.replace(/^v/, '')
    if (!isNewer(remote, local)) {
      _state = { state: 'not-available' }
      return _state
    }
    const apk = latest.assets.find(a => a.name.endsWith('.apk'))
    _downloadUrl = apk?.browser_download_url ?? latest.html_url
    publish({
      state: 'mac-available',
      version: remote,
      actionHint: 'Downloads the APK in the app, then installs it.',
    })
    return _state
  } catch (e) {
    _state = { state: 'not-available', error: 'Could not check for updates' }
    console.error('[update] check failed:', e)
    return _state
  }
}

export async function updateGetState(): Promise<UpdateStatus> {
  return _state
}

/**
 * The Settings button's one action, whatever stage it is at:
 *   found     → start the native download
 *   downloaded → hand the APK to the system installer
 *
 * Installing needs the user's one-time "install unknown apps" grant for
 * MagicMoney. Without it the intent bounces silently, so this checks first and
 * sends them to the exact Settings screen rather than appearing to do nothing.
 */
export function updateInstall(): void {
  if (_state.state === 'downloaded') {
    void (async () => {
      try {
        const { granted } = await Downloader.canInstallUpdates()
        if (!granted) {
          publish({
            ..._state,
            actionLabel: 'Allow installs, then tap again',
            actionHint: 'Android needs permission to install apps from MagicMoney.',
          })
          await Downloader.openInstallPermissionSettings()
          return
        }
        await Downloader.installUpdate()
      } catch (e) {
        publish({ state: 'not-available', error: 'Could not open the installer' })
        console.error('[update] install failed:', e)
      }
    })()
    return
  }

  if (!_downloadUrl) return
  ensureProgressWired()
  publish({ state: 'downloading', percent: 0, version: _state.version })
  Downloader.downloadUpdate({ url: _downloadUrl, version: _state.version ?? '' })
    .catch(e => {
      publish({ state: 'not-available', error: 'Could not start the update download' })
      console.error('[update] download failed:', e)
    })
}
