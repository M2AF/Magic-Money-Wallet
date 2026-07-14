/**
 * offscreen.ts — the extension's offscreen document (reason: WORKERS).
 *
 * Hosts the WASM-heavy privacy-chain work the MV3 service worker cannot run:
 *   - monero-ts chain scanning + sends (needs a real Web Worker)
 *   - ledger-v9 Midnight key derivation (WASM chunk)
 * The service-worker side lives in offscreen-rpc.ts / monero-sw.ts /
 * midnight-ledger.ts. The document persists across SW restarts, so the Monero
 * view-wallet singleton keeps its sync state while Chrome recycles the SW.
 */

import { OFFSCREEN_TARGET } from './offscreen-rpc'
import { fetchMoneroBalance, sendMoneroTransaction, stopMoneroSync } from '../capacitor/monero-browser'
import { deriveWithLedger } from '../capacitor/midnight-ledger'

const fromHex = (h: string) => new Uint8Array(Buffer.from(h, 'hex'))

type OffscreenMsg = { target?: string; op?: string; args?: Record<string, unknown> }

chrome.runtime.onMessage.addListener((msg: OffscreenMsg, _sender, sendResponse) => {
  if (msg?.target !== OFFSCREEN_TARGET) return false

  void (async () => {
    const a = msg.args ?? {}
    switch (msg.op) {
      case 'xmr:balance':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return fetchMoneroBalance(a.privacy as any, a.config as any)
      case 'xmr:send':
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return sendMoneroTransaction(String(a.mnemonic), String(a.to), String(a.amountXmr), a.config as any, Number(a.accountIndex ?? 0))
      case 'xmr:stop':
        return stopMoneroSync()
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
