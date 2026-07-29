/**
 * default-browser.ts (iOS) — permanently unsupported.
 *
 * Aliased over src/capacitor/default-browser.ts in vite.ios.config.ts.
 *
 * iOS has no third-party equivalent of Android's RoleManager.ROLE_BROWSER:
 * an app can neither request the default-browser role nor query whether it
 * holds it. Apple grants that only through its own Settings > Default Browser
 * App list, which requires a separate entitlement request, and there is no API
 * to read the current state at all.
 *
 * Reporting `supported: false` is the honest answer and is what SettingsModal
 * already renders for platforms without the capability — so this is a real
 * stub, not a placeholder waiting on a native plugin.
 */

import type { DefaultBrowserState } from '../renderer/types/wallet'
import type { DefaultBrowserPlugin } from '../capacitor/default-browser'

const UNSUPPORTED: DefaultBrowserState = {
  supported: false,
  registered: false,
  isDefault: false,
}

export const DefaultBrowser: DefaultBrowserPlugin = {
  getStatus: async () => UNSUPPORTED,
  requestDefault: async () => UNSUPPORTED,
}
