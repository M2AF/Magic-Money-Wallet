/**
 * content.ts — ISOLATED world relay
 *
 * Bridges inject.ts (MAIN world, window.postMessage) ↔ background service worker (chrome.runtime).
 * No provider logic here — all providers live in inject.ts.
 */

// ── Forward requests: MAIN world → background ─────────────────────────────────

const PAGE_RPC_TYPES = new Set([
  'web3:request',
  'web3:solana:connect',
  'web3:solana:sign',
  'web3:solana:sign-tx',
  'web3:solana:sign-and-send',
  'cardano:is-enabled',
  'cardano:enable',
  'cardano:get-network-id',
  'cardano:get-balance',
  'cardano:get-utxos',
  'cardano:get-used-addresses',
  'cardano:get-unused-addresses',
  'cardano:get-change-address',
  'cardano:get-reward-addresses',
  'cardano:get-collateral',
  'cardano:sign-tx',
  'cardano:sign-data',
  'cardano:submit-tx',
  'bitcoin:get-accounts',
  'bitcoin:request-accounts',
  'bitcoin:request-addresses',
  'bitcoin:get-public-key',
  'bitcoin:get-balance',
  'bitcoin:sign-message',
  'bitcoin:sign-psbt',
  'bitcoin:push-psbt',
  'bitcoin:push-tx',
  'bitcoin:send',
  'polkadot:enable',
  'polkadot:get-accounts',
  'polkadot:sign-payload',
  'polkadot:sign-raw',
])

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  const m = event.data
  if (!m || m.__mm !== 'page→bg') return
  const { id, type, args } = m as { id: number; type: string; args: unknown[] }
  if (!PAGE_RPC_TYPES.has(type)) {
    window.postMessage({ __mm: 'bg→page', id, error: `Wallet method not available to web pages: ${type}` }, '*')
    return
  }

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
