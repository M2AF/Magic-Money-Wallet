/**
 * midnight-send-manager.ts — EXTENSION (service worker) side.
 *
 * Same seam as midnight-ledger.ts: the MV3 service worker can't import() a bare
 * package or run WASM codegen, and it's killed after ~30s idle — which the DUST
 * sync (a multi-minute network-wide merkle walk) would never survive. So the
 * real manager lives in the OFFSCREEN document (capacitor/midnight-send-manager.ts,
 * shared with Android) and this proxies to it. Aliased over
 * src/main/midnight-send-manager.ts by vite.extension.config.ts.
 *
 * The mnemonic travels in the message (Chrome messages are JSON). It stays
 * inside the extension trust zone — same origin/CSP as the popup, which can
 * already reveal the seed phrase — and never reaches a page or the network.
 */

import { callOffscreen } from './offscreen-rpc'
import type { MidnightNetwork } from '../main/midnight-send'

export interface MidnightDustStatus {
  ready: boolean
  percent: number
  isConnected: boolean
  error: string | null
}

export function resetMidnightSendManager(): void {
  // Fire-and-forget: the offscreen document owns the handle. If it isn't up
  // there's nothing to tear down.
  void callOffscreen('mn:send-reset', {}).catch(() => { /* nothing open */ })
}

export function getMidnightDustStatus(
  mnemonic: string, accountIndex: number, network: MidnightNetwork
): Promise<MidnightDustStatus> {
  return callOffscreen<MidnightDustStatus>('mn:dust-status', { mnemonic, accountIndex, network })
}

export function registerMidnightDustIfNeeded(
  mnemonic: string, accountIndex: number, network: MidnightNetwork
): Promise<{ registered: boolean; txId: string | null }> {
  return callOffscreen('mn:dust-register', { mnemonic, accountIndex, network })
}

export function sendMidnightNight(
  mnemonic: string, accountIndex: number, network: MidnightNetwork,
  toAddress: string, amountStars: bigint
): Promise<string> {
  // bigint doesn't survive JSON — send Stars as a decimal string.
  return callOffscreen<string>('mn:send-night', {
    mnemonic, accountIndex, network, toAddress, amountStars: amountStars.toString(),
  })
}
