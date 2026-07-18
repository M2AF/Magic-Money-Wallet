/**
 * monero-sw.ts — EXTENSION (service worker) Monero backend. Aliased over
 * src/main/monero.ts by vite.extension.config.ts.
 *
 * RECEIVE-ONLY (see src/capacitor/monero-browser.ts for the full rationale):
 * the extension can't run local wallet2 scanning — MV3 service workers can't
 * spawn Workers, and the offscreen document's monero-ts WASM worker never
 * initializes. Balance/send therefore require the desktop app (or a future
 * self-hosted LWS). Fee/height are plain fetch and stay available.
 *
 * The address itself is derived and shown; only balance + send are gated.
 */

import type { WalletConfig } from '../main/secure-store'
import type { SendResult } from '../main/tx-sender'
import type { PrivacyAddresses } from '../main/wallet-core'

export { estimateMoneroFee, fetchMoneroHeight } from '../main/monero-rpc'

export async function fetchMoneroBalance(
  privacy: PrivacyAddresses | undefined,
  _config: WalletConfig
): Promise<{ native: number; error: string | null }> {
  if (!privacy?.monero) return { native: 0, error: 'No address' }
  return { native: 0, error: 'receive-only' }
}

export async function sendMoneroTransaction(): Promise<SendResult> {
  throw new Error('Monero sending isn’t available in the extension yet — use the desktop app')
}

export async function stopMoneroSync(): Promise<void> {
  /* no local scanner in the extension */
}
