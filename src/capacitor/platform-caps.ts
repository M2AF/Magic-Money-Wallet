/**
 * platform-caps.ts — per-target capability flags for the native builds.
 *
 * This is the Android set. `vite.ios.config.ts` aliases the module to
 * `src/ios/platform-caps.ts`, exactly like `./biometric`, `./update-check` and
 * `./default-browser`.
 *
 * WHY A MODULE RATHER THAN `Capacitor.getPlatform()` CHECKS: the UI should ask
 * "can this device do X" and not "which OS is this". A platform conditional
 * sprinkled at the call site is how the biometric label ended up mapping every
 * unrecognised sensor to "Windows Hello" and how the "Install as app" row ended
 * up rendering on a platform where it always fails. Adding a capability here
 * forces both targets to answer the question explicitly.
 */

/**
 * Can a page be pinned to the launcher/home screen?
 * Android: yes, via ShortcutManagerCompat.requestPinShortcut.
 */
export const WEB_APPS_SUPPORTED = true

/**
 * Does the content blocker report how many requests it blocked?
 * Android: yes — the Rust engine counts every shouldInterceptRequest hit.
 */
export const BLOCK_COUNTS_SUPPORTED = true
