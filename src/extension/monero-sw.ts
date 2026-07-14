/**
 * monero-sw.ts — EXTENSION (service worker) Monero backend. Aliased over
 * src/main/monero.ts by vite.extension.config.ts.
 *
 * The MV3 service worker can't spawn the Web Worker monero-ts needs, so the
 * WASM wallet runs in the offscreen document (src/extension/offscreen.ts) and
 * this module forwards balance/send/stop over the offscreen RPC. Fee/height
 * are plain fetch (monero-rpc.ts) and run right here in the SW — extension
 * host permissions exempt those calls from CORS.
 *
 * NOTE on sends: the mnemonic crosses into the offscreen document. That page
 * is part of the same extension trust zone (same origin, same CSP) — the same
 * boundary the popup already crosses when revealing the seed.
 */

import { callOffscreen } from './offscreen-rpc'
import type { WalletConfig } from '../main/secure-store'
import type { SendResult } from '../main/tx-sender'
import type { PrivacyAddresses } from '../main/wallet-core'

export { estimateMoneroFee, fetchMoneroHeight } from '../main/monero-rpc'

export async function fetchMoneroBalance(
  privacy: PrivacyAddresses | undefined,
  config: WalletConfig
): Promise<{ native: number; error: string | null }> {
  if (!privacy?.monero || !privacy.moneroViewKey) return { native: 0, error: 'No address' }
  try {
    return await callOffscreen('xmr:balance', { privacy, config })
  } catch (err) {
    return { native: 0, error: String(err instanceof Error ? err.message : err) }
  }
}

export async function sendMoneroTransaction(
  mnemonic: string,
  to: string,
  amountXmr: string,
  config: WalletConfig,
  accountIndex = 0
): Promise<SendResult> {
  return callOffscreen<SendResult>('xmr:send', { mnemonic, to, amountXmr, config, accountIndex })
}

export async function stopMoneroSync(): Promise<void> {
  // If the offscreen document doesn't exist there's nothing to stop.
  try { await callOffscreen('xmr:stop', {}) } catch { /* not running */ }
}
