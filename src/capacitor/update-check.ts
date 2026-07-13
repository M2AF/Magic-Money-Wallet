/**
 * update-check.ts — Sideload update check against GitHub Releases (Android)
 *
 * Maps onto the existing UpdateStatus contract so SettingsModal works
 * unchanged: a newer release reports state 'mac-available', which the shared
 * UI already renders as "Download update vX / opens the download page" —
 * exactly the sideload semantics (download the APK, Android installs over the
 * existing app, data intact because the signing key matches).
 *
 * Prereleases are included: beta tags (a '-' in the version) are how this
 * project ships, same as electron-updater's prerelease releaseType.
 */

import { App as CapacitorApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import type { UpdateStatus } from '../renderer/types/wallet'

const RELEASES_API = 'https://api.github.com/repos/M2AF/Magic-Money-Wallet/releases?per_page=5'

let _state: UpdateStatus = { state: 'idle' }
let _downloadUrl: string | null = null

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
    _state = { state: 'mac-available', version: remote }
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

export function updateInstall(): void {
  if (_downloadUrl) Browser.open({ url: _downloadUrl }).catch(() => {})
}
