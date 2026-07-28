/**
 * dapp-inject.ts — Android dApp-browser provider shell
 *
 * Injected into every dApp WebView at document_start by the native DappBrowser
 * plugin (WebViewCompat.addDocumentStartJavaScript), built as a single-file
 * IIFE by esbuild (rollup chunking would break the injected script).
 *
 * Transport: the origin-scoped `__mmBridge` object the native plugin exposes
 * via WebViewCompat.addWebMessageListener. Requests ride
 * `{id, type, args}` JSON strings to native, which forwards them (with the
 * chromium-authenticated page origin) to the wallet WebView's shared handler.
 * Replies come back as `{id, result?, error?}`; wallet push events as
 * `{kind:'event', chain, event, data}`.
 *
 * A `{type:'hello'}` handshake on load hands native this frame's replyProxy so
 * events (chainChanged / accountsChanged) can be pushed later.
 */

import { installProviders } from '../extension/provider-core'

interface MmBridge {
  postMessage(data: string): void
  addEventListener(type: 'message', cb: (e: { data: string }) => void): void
}

const bridge = (window as unknown as { __mmBridge?: MmBridge }).__mmBridge

if (bridge) {
  let _id = 0
  const _pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const _eventCbs: Array<(chain: string, event: string, data: unknown) => void> = []

  bridge.addEventListener('message', (e) => {
    let m: { id?: number; result?: unknown; error?: string; kind?: string; chain?: string; event?: string; data?: unknown }
    try { m = JSON.parse(e.data) } catch { return }
    if (m.kind === 'event') {
      for (const cb of _eventCbs) try { cb(String(m.chain), String(m.event), m.data) } catch { /* noop */ }
      return
    }
    if (typeof m.id !== 'number') return
    const p = _pending.get(m.id)
    if (!p) return
    _pending.delete(m.id)
    if (m.error) p.reject(new Error(m.error))
    else p.resolve(m.result)
  })

  // Handshake — native captures this frame's replyProxy for event pushes.
  try { bridge.postMessage(JSON.stringify({ type: 'hello' })) } catch { /* noop */ }

  installProviders({
    send<T = unknown>(type: string, args: unknown[]): Promise<T> {
      return new Promise((resolve, reject) => {
        const id = ++_id
        _pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
        bridge.postMessage(JSON.stringify({ id, type, args }))
        setTimeout(() => {
          if (_pending.has(id)) {
            _pending.delete(id)
            reject(new Error('Wallet request timed out'))
          }
        }, 30_000)
      })
    },
    onEvent(cb) { _eventCbs.push(cb) },
  })

  // ── Saved-login autofill: tell the wallet a login form appeared ────────────
  // Mirrors the Electron preload's detector. The message carries NO data: native
  // forwards it only for the ACTIVE tab, and the wallet re-derives the host from
  // that tab's own URL before deciding whether to fill. Reported at most once per
  // document; the observer catches SPA logins that render after load and then
  // disconnects.

  const hasVisiblePasswordField = (): boolean => {
    for (const el of Array.from(document.querySelectorAll('input[type="password"]'))) {
      const r = (el as HTMLElement).getBoundingClientRect()
      if (r.width > 0 && r.height > 0) return true
    }
    return false
  }

  let reported = false
  let queued = false
  let observer: MutationObserver | null = null

  const scanForLoginForm = (): void => {
    queued = false
    if (reported || !hasVisiblePasswordField()) return
    reported = true
    observer?.disconnect()
    observer = null
    try { bridge.postMessage(JSON.stringify({ type: 'autofillFormFound' })) } catch { /* noop */ }
  }

  // Coalesce mutation bursts into one scan per frame — pages mutate constantly
  // and the scan walks the DOM.
  const queueScan = (): void => {
    if (reported || queued) return
    queued = true
    requestAnimationFrame(scanForLoginForm)
  }

  const startLoginWatch = (): void => {
    scanForLoginForm()
    if (reported) return
    observer = new MutationObserver(queueScan)
    observer.observe(document.documentElement, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['type', 'style', 'class', 'hidden'],
    })
  }

  // document_start injection means the body usually isn't parsed yet.
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', startLoginWatch)
  } else {
    startLoginWatch()
  }
} else {
  console.warn('[MagicMoney] __mmBridge missing — provider injection skipped')
}
