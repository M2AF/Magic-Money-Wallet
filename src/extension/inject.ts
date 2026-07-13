/**
 * inject.ts — MAIN world provider injection (extension shell)
 *
 * Runs in the page's own JavaScript context (world: MAIN).
 * NO chrome.runtime APIs — all background IPC via window.postMessage relay.
 * content.ts (ISOLATED world) bridges postMessage ↔ chrome.runtime.sendMessage.
 *
 * All provider objects live in provider-core.ts (shared with the Android
 * dApp-browser shell); this file only supplies the postMessage transport.
 */

import { installProviders } from './provider-core'

// ── Message relay ─────────────────────────────────────────────────────────────

let _id = 0
const _pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const m = event.data
  if (!m || m.__mm !== 'bg→page') return
  const p = _pending.get(m.id)
  if (!p) return
  _pending.delete(m.id)
  if (m.error) p.reject(new Error(m.error))
  else p.resolve(m.result)
})

function send<T = unknown>(type: string, args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++_id
    _pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    window.postMessage({ __mm: 'page→bg', id, type, args }, '*')
    setTimeout(() => {
      if (_pending.has(id)) {
        _pending.delete(id)
        reject(new Error('Wallet request timed out'))
      }
    }, 30_000)
  })
}

const _eventCbs: Array<(chain: string, event: string, data: unknown) => void> = []

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const m = event.data
  if (!m || m.__mm !== 'bg→page:event') return
  for (const cb of _eventCbs) try { cb(m.chain, m.event, m.data) } catch { /* noop */ }
})

installProviders({
  send,
  onEvent(cb) { _eventCbs.push(cb) },
})
