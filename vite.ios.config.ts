import path from 'path'
import { makeCapacitorConfig } from './vite.capacitor.shared'

const r = (...p: string[]) => path.resolve(__dirname, ...p)

/**
 * iOS/Capacitor build — the shared native recipe rooted at src/ios.
 *
 * src/ios is deliberately thin: an entry point, a stylesheet, and the two
 * modules below. Everything else resolves into src/capacitor, because the
 * WebView-side code is identical on both native targets. Platform differences
 * live in this alias table, never in runtime `getPlatform()` branches.
 *
 * These two aliases come BEFORE the shared table (makeCapacitorConfig prepends
 * extraAliases) — Vite takes the first match, so a target override must win.
 */
export default makeCapacitorConfig({
  root: 'ios',
  outDir: 'dist-ios',
  extraAliases: [
    {
      // The GitHub-Releases APK sideload updater must not exist in an App Store
      // binary (guideline 2.5.2). The stub's isPlayStoreInstall() returns true,
      // which reuses wallet-local.ts's existing removal path to strip the whole
      // Software Update surface off window.wallet.
      find: /^\.\/update-check(\.ts)?$/,
      replacement: r('src/ios/update-check.ts')
    },
    {
      // No RoleManager analog on iOS — an app cannot request or even query the
      // default-browser role. The stub reports supported: false.
      find: /^\.\/default-browser(\.ts)?$/,
      replacement: r('src/ios/default-browser.ts')
    },
  ]
})
