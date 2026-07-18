/**
 * monero-browser.ts — BROWSER Monero backend (Capacitor WebView + the
 * extension's offscreen document). Aliased over src/main/monero.ts by the
 * Capacitor build. Same export surface as src/main/monero.ts.
 *
 * RECEIVE-ONLY. monero-ts scans every block locally with the view key, which
 * needs real threads: it works on Electron's Node main thread but its WASM
 * worker never reliably initializes inside a Capacitor WebView or the
 * extension's offscreen document (createWalletFull hangs before any block is
 * scanned — the "Syncing… forever" bug). Local scanning would also be slow and
 * battery-heavy on a phone even if it did init.
 *
 * The chosen architecture (2026-07-14) instead is:
 *   - Android  → a NATIVE wallet2 Capacitor plugin (JNI); see the MoneroNative
 *     bridge. Until that lands, Android is receive-only like the extension.
 *   - Extension → receive-only now; an optional self-hosted LWS (view-key
 *     server-side scanning) can add balance/send later.
 *   - Electron  → keeps the monero-ts backend (src/main/monero.ts).
 *
 * So this module no longer imports monero-ts — that keeps ~3.6 MB of WASM out
 * of the extension and Capacitor bundles. It reports a `receive-only` state the
 * dashboard renders as an address-only card, and refuses sends with a clear
 * pointer to the desktop app.
 */

import type { WalletConfig } from '../main/secure-store'
import type { SendResult } from '../main/tx-sender'
import type { PrivacyAddresses } from '../main/wallet-core'

// Fee/height stay available (plain fetch, no WASM) for parity of the API surface.
export { estimateMoneroFee, fetchMoneroHeight } from '../main/monero-rpc'

export async function fetchMoneroBalance(
  privacy: PrivacyAddresses | undefined,
  _config: WalletConfig
): Promise<{ native: number; error: string | null }> {
  if (!privacy?.monero) return { native: 0, error: 'No address' }
  // Address is shown; balance requires a scanning backend (native/desktop/LWS).
  return { native: 0, error: 'receive-only' }
}

export async function sendMoneroTransaction(): Promise<SendResult> {
  throw new Error('Monero sending isn’t available in this build yet — use the desktop app')
}

export async function stopMoneroSync(): Promise<void> {
  /* nothing to stop — no local scanner runs here */
}
