/**
 * AppInfo — JS handle for the local AppInfoPlugin (AppInfoPlugin.java).
 *
 * Single registration point: registerPlugin() warns if the same plugin name
 * is registered twice, so every consumer imports this handle instead of
 * registering its own.
 */

import { registerPlugin } from '@capacitor/core'

interface AppInfoPlugin {
  getInstallSource(): Promise<{ installer: string | null }>
  setSecureScreen(options: { on: boolean }): Promise<void>
}

export const AppInfo = registerPlugin<AppInfoPlugin>('AppInfo')

/**
 * FLAG_SECURE toggle for seed-phrase screens: while on, Android blocks
 * screenshots/screen recording and blanks the app preview in Recents.
 * Exposed as the optional window.wallet.setSecureScreen — Electron and the
 * extension leave it undefined, so shared-UI call sites no-op there.
 */
export async function setSecureScreen(on: boolean): Promise<void> {
  try {
    await AppInfo.setSecureScreen({ on })
  } catch {
    // Best-effort hardening — never block the seed UI on it.
  }
}
