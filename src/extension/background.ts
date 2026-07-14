/**
 * background.ts — MagicMoney Extension Service Worker
 *
 * Thin MV3 host for the shared wallet router: classifies senders, forwards
 * every chrome.runtime message to handle() in wallet-handlers.ts, and boots
 * WalletConnect. All wallet logic and approval queues live in wallet-handlers.ts
 * (shared with the Android/Capacitor build); chrome side effects live in
 * platform.ts. Private keys and mnemonics never reach the UI pages.
 */

import { handle, type Msg, type Sender } from './wallet-handlers'
import { initWalletConnect } from './wc-ext'

// ── Global error logging (service workers crash silently without this) ────────

self.addEventListener('error', e => console.error('[SW] uncaught error:', e.message, e.error))
self.addEventListener('unhandledrejection', e => console.error('[SW] unhandled rejection:', e.reason))

// ── WalletConnect startup ─────────────────────────────────────────────────────

initWalletConnect().catch(e => console.error('[WC] startup error:', e))

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: Msg, rawSender, sendResponse) => {
  // Offscreen-document RPC (the monero/midnight WASM host) — those messages
  // are answered by the offscreen page's own listener, not the wallet router.
  if ((message as { target?: string })?.target === 'mm-offscreen') return false
  const senderOrigin = rawSender.origin
    ?? (rawSender.url ? (() => { try { return new URL(rawSender.url!).origin } catch { return 'unknown' } })() : 'extension')
  // Classify by origin, not by tab presence: our own pages also live in tabs
  // (windowed approval popup, side panel, popup opened as a tab) and carry
  // sender.tab — but only extension pages can have our chrome-extension origin,
  // which the browser sets and content scripts can't spoof.
  const senderKind: Sender['kind'] =
    senderOrigin === `chrome-extension://${chrome.runtime.id}` ? 'extension' : 'page'
  const sender: Sender = { origin: senderOrigin, tabId: rawSender.tab?.id, kind: senderKind }
  handle(message, sender)
    .then(result => sendResponse({ ok: true, result }))
    .catch(err => sendResponse({ ok: false, error: String(err) }))
  return true // keep channel open for async response
})
