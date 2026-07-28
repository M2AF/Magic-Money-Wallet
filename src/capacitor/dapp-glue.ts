/**
 * dapp-glue.ts — routes dApp-browser page requests into the shared wallet core
 *
 * The Android analog of content.ts + the SW message listener, fused: native
 * forwards each page request (with its chromium-authenticated origin); this
 * module enforces the same PAGE_RPC_TYPES allowlist, runs it through the
 * shared handle() router as kind:'page' (so approval gating, origin scoping
 * and the sign/tx/connect queues all apply unchanged), and posts the reply
 * back. It also installs the platform dApp-event sink so chainChanged /
 * accountsChanged pushes reach the right native WebViews.
 */

import { handle, PAGE_RPC_TYPES, type Msg } from '../extension/wallet-handlers'
import { setDappSink } from './platform-capacitor'
import { DappBrowser, type PageRequestEvent } from './dapp-browser'
import { maybeAutofillActiveTab, resetAutofillGuard } from './wallet-local'

let _installed = false

export function initDappGlue(): void {
  if (_installed) return
  _installed = true

  DappBrowser.addListener('pageRequest', (e: PageRequestEvent) => { onPageRequest(e).catch(() => {}) })
    .catch(() => { /* web/dev context without the native plugin */ })

  // Saved-login autofill. Native forwards the page's payload-free
  // 'autofillFormFound' signal for the ACTIVE tab only; the decision (vault
  // unlocked? exact host match? already filled this document?) is made in
  // wallet-local against the tab's own URL — never against anything the page sent.
  DappBrowser.addListener('autofillFormFound', () => { void maybeAutofillActiveTab() })
    .catch(() => {})

  // A real navigation starts a new document, so allow one fresh auto-fill for it.
  DappBrowser.addListener('urlChanged', () => { resetAutofillGuard() })
    .catch(() => {})

  // EIP-1193 event pushes from wallet-handlers (applyChainSwitch, revokes,
  // connection approvals) → native WebViews. Tab-targeted pushes fall back to
  // origin-wide delivery: the native pipe keys event proxies by tab, and every
  // tab reports its origin, so scoping by origin is equivalent here.
  setDappSink({
    pushToDapps: (event, data) => { emit(undefined, event, data) },
    pushToDappOrigin: (origin, event, data) => { emit(origin, event, data) },
    pushToDappTab: (tabId, event, data) => { void tabId; emit(undefined, event, data) },
  })
}

function emit(origin: string | undefined, event: string, data: unknown): void {
  DappBrowser.emitEvent({ origin, json: JSON.stringify({ kind: 'event', chain: 'eth', event, data }) }).catch(() => {})
}

async function onPageRequest(e: PageRequestEvent): Promise<void> {
  let payload: { id?: number; type?: string; args?: unknown[] }
  try { payload = JSON.parse(e.payloadJson) } catch { return }
  const id = payload.id
  const type = String(payload.type ?? '')
  if (typeof id !== 'number') return

  const reply = (result?: unknown, error?: string) =>
    DappBrowser.respond({ requestId: e.requestId, json: JSON.stringify({ id, result, error }) }).catch(() => {})

  // Same allowlist the extension's content.ts enforces before the SW even sees
  // the message (handle() re-checks via sender.kind === 'page' as well).
  if (!PAGE_RPC_TYPES.has(type)) {
    reply(undefined, `Wallet method not available to web pages: ${type}`)
    return
  }

  const msg: Msg = { type, args: Array.isArray(payload.args) ? payload.args : [] }
  try {
    const result = await handle(msg, { origin: e.origin, tabId: e.tabId, kind: 'page' })
    reply(result)
  } catch (err) {
    reply(undefined, String(err))
  }
}
