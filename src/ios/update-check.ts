/**
 * update-check.ts (iOS) — no self-updater, by App Store policy.
 *
 * Aliased over src/capacitor/update-check.ts in vite.ios.config.ts. The Android
 * module checks GitHub Releases and hands the user an APK; shipping that code
 * in an App Store binary is an automatic rejection (guideline 2.5.2 — an app
 * may not download or install executable code), and the App Store delivers
 * updates itself anyway.
 *
 * The export surface is kept identical so src/capacitor/wallet-local.ts needs
 * no iOS branch. `isPlayStoreInstall()` resolving true reuses the EXISTING
 * removal path in createCapacitorWallet(): it deletes updateCheck /
 * updateGetState / updateInstall off window.wallet, and SettingsModal's
 * `typeof updateCheck === 'function'` gate then hides the whole Software
 * Update section. The three functions below therefore never run — they exist
 * only to satisfy the import, and are inert rather than merely unused.
 */

import type { UpdateStatus } from '../renderer/types/wallet'

/**
 * Always true on iOS: every install is a store install (App Store or
 * TestFlight). Named for the Android contract it substitutes for rather than
 * renamed, so the shared call site stays untouched.
 */
export async function isPlayStoreInstall(): Promise<boolean> {
  return true
}

const NOT_SUPPORTED: UpdateStatus = { state: 'idle' }

export async function updateCheck(): Promise<UpdateStatus> {
  return NOT_SUPPORTED
}

export async function updateGetState(): Promise<UpdateStatus> {
  return NOT_SUPPORTED
}

export function updateInstall(): void {
  /* no-op — the App Store owns updates on this platform */
}
