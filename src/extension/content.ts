/**
 * content.ts — ISOLATED world relay
 *
 * Bridges inject.ts (MAIN world, window.postMessage) ↔ background service worker (chrome.runtime).
 * No provider logic here — all providers live in inject.ts.
 */

// ── Forward requests: MAIN world → background ─────────────────────────────────

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const m = event.data
  if (!m || m.__mm !== 'page→bg') return
  const { id, type, args } = m as { id: number; type: string; args: unknown[] }

  let retries = 0
  const attempt = () => {
    chrome.runtime.sendMessage(
      { type, args },
      (res: { ok: boolean; result?: unknown; error?: string } | undefined) => {
        if (chrome.runtime.lastError) {
          const msg = chrome.runtime.lastError.message ?? ''
          if ((msg.includes('Receiving end') || msg.includes('Could not establish')) && retries < 2) {
            retries++; setTimeout(attempt, 400); return
          }
          window.postMessage({ __mm: 'bg→page', id, error: msg }, '*')
          return
        }
        if (!res) {
          window.postMessage({ __mm: 'bg→page', id, error: 'No response from wallet' }, '*')
          return
        }
        window.postMessage({
          __mm: 'bg→page',
          id,
          result: res.ok ? res.result : undefined,
          error:  res.ok ? undefined    : res.error,
        }, '*')
      }
    )
  }
  attempt()
})

// ── Forward push events: background → MAIN world ─────────────────────────────

chrome.runtime.onMessage.addListener((msg: { type: string; event: string; data: unknown }) => {
  if (msg?.type === 'eth:event') {
    window.postMessage({ __mm: 'bg→page:event', chain: 'eth', event: msg.event, data: msg.data }, '*')
  }
})
