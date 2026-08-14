/**
 * platform-caps.ts (iOS) — see src/capacitor/platform-caps.ts for the contract.
 *
 * Both flags are false because of platform limits, not missing work:
 */

/**
 * iOS has no third-party API for pinning a site to the Home Screen — that is a
 * Safari-only privilege. `DappBrowserPlugin.installShortcut` rejects, so the
 * affordance must not be offered; a menu row that always errors is worse than
 * no row.
 */
export const WEB_APPS_SUPPORTED = false

/**
 * WKContentRuleList never reports a match — WebKit evaluates the rules inside
 * the engine and provides no callback. Blocking is fully active, but the count
 * is unobtainable, so the UI must omit it rather than show a permanent 0 that
 * reads as "this isn't working".
 */
export const BLOCK_COUNTS_SUPPORTED = false
