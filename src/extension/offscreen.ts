/**
 * offscreen.ts — the extension's offscreen document (reason: WORKERS).
 *
 * Hosts the WASM the MV3 service worker cannot run: ledger-v9 Midnight key
 * derivation (a WASM chunk). Monero is receive-only in the extension (see
 * monero-sw.ts), so no monero-ts runs here anymore.
 *
 * The service-worker side lives in offscreen-rpc.ts / midnight-ledger.ts.
 */

import { OFFSCREEN_TARGET } from './offscreen-rpc'
import { deriveWithLedger } from '../capacitor/midnight-ledger'
import {
  getMidnightDustStatus, registerMidnightDustIfNeeded, sendMidnightNight, resetMidnightSendManager,
} from '../capacitor/midnight-send-manager'
import type { MidnightNetwork } from '../main/midnight-send'

const fromHex = (h: string) => new Uint8Array(Buffer.from(h, 'hex'))
const net = (v: unknown): MidnightNetwork => (v === 'preprod' ? 'preprod' : 'mainnet')

type OffscreenMsg = { target?: string; op?: string; args?: Record<string, unknown> }

chrome.runtime.onMessage.addListener((msg: OffscreenMsg, _sender, sendResponse) => {
  if (msg?.target !== OFFSCREEN_TARGET) return false

  void (async () => {
    const a = msg.args ?? {}
    switch (msg.op) {
      case 'mn:derive':
        return deriveWithLedger(fromHex(String(a.seed)), Number(a.accountIndex ?? 0), a.network === 'preprod' ? 'preprod' : 'mainnet')

      // ── Midnight NIGHT send (see capacitor/midnight-send-manager.ts) ──────
      // The DUST sync is a multi-minute job; it lives here because this
      // document outlives the service worker.
      case 'mn:dust-status':
        return getMidnightDustStatus(String(a.mnemonic), Number(a.accountIndex ?? 0), net(a.network))
      case 'mn:dust-register':
        return registerMidnightDustIfNeeded(String(a.mnemonic), Number(a.accountIndex ?? 0), net(a.network))
      case 'mn:send-night':
        return sendMidnightNight(
          String(a.mnemonic), Number(a.accountIndex ?? 0), net(a.network),
          String(a.toAddress), BigInt(String(a.amountStars)),
        )
      case 'mn:send-reset':
        resetMidnightSendManager()
        return true

      default:
        throw new Error(`Unknown offscreen op: ${msg.op}`)
    }
  })().then(
    data => sendResponse({ ok: true, data }),
    err => sendResponse({ ok: false, error: String(err instanceof Error ? err.message : err) })
  )
  return true   // async sendResponse
})
