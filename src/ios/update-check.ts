/**
 * update-check.ts (iOS) — sideload update check against GitHub Releases.
 *
 * MagicMoney is not distributed through the App Store, so nothing here is
 * constrained by guideline 2.5.2 (which forbids an App Store app fetching
 * executable code). The app ships as an unsigned .ipa from GitHub Releases and
 * the ChainLens site, and the user installs it with Sideloadly/AltStore.
 *
 * That makes an in-app update check MORE useful than on Android, not less:
 * free-provisioning sideloads expire after 7 days, so users are already
 * returning to their computer weekly. Telling them a newer build exists at
 * that moment is exactly the right prompt.
 *
 * Aliased over src/capacitor/update-check.ts in vite.ios.config.ts. Same export
 * surface, so src/capacitor/wallet-local.ts needs no iOS branch. Two real
 * differences from the Android module:
 *   - it looks for the `.ipa` asset, not `.apk`
 *   - isPlayStoreInstall() is always false (there is no store install path on
 *     iOS for this app), so the Software Update section always stays visible
 *
 * The semver comparison is duplicated from the Android module rather than
 * shared: it is ~15 lines of pure logic, and importing across the seam would
 * drag @capacitor/browser and the AppInfo plugin registration into this bundle
 * for no benefit.
 */

import { App as CapacitorApp } from '@capacitor/app'
import type { UpdateStatus } from '../renderer/types/wallet'

/**
 * Always false: there is no App Store / TestFlight build of this app, so the
 * self-updater is never policy-restricted and must never be stripped.
 * (Kept under the Android name so the shared call site in wallet-local.ts —
 * which deletes the update methods when this returns true — is untouched.)
 */
export async function isPlayStoreInstall(): Promise<boolean> {
  return false
}

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
    // Prefer the .ipa itself; fall back to the release page so the user still
    // has somewhere to go if the asset naming ever changes.
    const ipa = latest.assets.find(a => a.name.endsWith('.ipa'))
    _downloadUrl = ipa?.browser_download_url ?? latest.html_url
    // 'mac-available' is the shared UI's "download this build yourself" state —
    // a historical name, and exactly the sideload semantics we want here.
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

/**
 * Opens the .ipa/release URL in Safari. iOS cannot install it directly — the
 * user re-signs and installs it from their computer with Sideloadly/AltStore,
 * the same flow they already use every 7 days.
 *
 * Uses window.open rather than @capacitor/browser: an in-app SFSafariViewController
 * is a dead end for a file download, whereas Safari proper can hand the .ipa
 * to Files/AirDrop.
 */
export function updateInstall(): void {
  if (_downloadUrl) window.open(_downloadUrl, '_system')
}

// ── Update-status push channel ──────────────────────────────────────────
//
// wallet-local.ts imports these from './update-check', which the alias table in
// vite.ios.config.ts points HERE on the iOS build. They exist because Android's
// updater downloads the APK itself and has to push progress at the Settings
// row; iOS cannot install its own unsigned .ipa, so updateInstall() just opens
// the release page and the status never moves after the check. Subscribing is
// therefore a no-op rather than a lie about progress that will never arrive.
//
// They are NOT optional: without them the iOS bundle fails to build, because
// Rollup resolves the alias even though tsc never does.

export function onUpdateStatus(_cb: (s: UpdateStatus) => void): void {
  /* no status changes after the check on this platform - see above */
}

export function offUpdateStatus(_cb: (s: UpdateStatus) => void): void {
  /* nothing was ever subscribed */
}

// ── Drop-in check against the Android module ────────────────────────────
//
// Same guard as src/ios/biometric.ts, and for the same reason: tsc only ever
// checks the shared importers against the ANDROID shapes (see tsconfig.ios.json),
// so a signature that drifts from capacitor/update-check.ts would compile clean
// here and break the iOS bundle at build time. Type-only; nothing is emitted.

type Assert<T extends true> = T

export type UpdateCheckMatchesAndroid = Assert<{
  isPlayStoreInstall: typeof isPlayStoreInstall
  updateCheck: typeof updateCheck
  updateGetState: typeof updateGetState
  updateInstall: typeof updateInstall
  onUpdateStatus: typeof onUpdateStatus
  offUpdateStatus: typeof offUpdateStatus
} extends Pick<
  typeof import('../capacitor/update-check'),
  'isPlayStoreInstall' | 'updateCheck' | 'updateGetState' | 'updateInstall' | 'onUpdateStatus' | 'offUpdateStatus'
> ? true : false>
