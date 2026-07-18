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

const fromHex = (h: string) => new Uint8Array(Buffer.from(h, 'hex'))

type OffscreenMsg = { target?: string; op?: string; args?: Record<string, unknown> }

chrome.runtime.onMessage.addListener((msg: OffscreenMsg, _sender, sendResponse) => {
  if (msg?.target !== OFFSCREEN_TARGET) return false

  void (async () => {
    const a = msg.args ?? {}
    switch (msg.op) {
      case 'mn:derive':
        return deriveWithLedger(fromHex(String(a.seed)), Number(a.accountIndex ?? 0))
      default:
        throw new Error(`Unknown offscreen op: ${msg.op}`)
    }
  })().then(
    data => sendResponse({ ok: true, data }),
    err => sendResponse({ ok: false, error: String(err instanceof Error ? err.message : err) })
  )
  return true   // async sendResponse
})
