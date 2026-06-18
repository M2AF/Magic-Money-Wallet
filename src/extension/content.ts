/**
 * content.ts — Web3 provider injection for browser extension
 *
 * Runs in MAIN world so it can write to page's window object directly.
 * Forwards eth_ / personal_sign requests to the background service worker,
 * which derives keys and signs without exposing them to the page.
 *
 * Equivalent to src/preload/web3-inject.ts in the Electron app.
 */

// ── EIP-1193 window.ethereum ──────────────────────────────────────────────────

function makeEthProvider() {
  const _listeners: Record<string, ((...args: unknown[]) => void)[]> = {}

  return {
    isMetaMask:    true,
    isMagicMoney:  true,

    request({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: 'web3:request', args: [{ method, params: params ?? [] }] },
          (res: { ok: boolean; result?: unknown; error?: string }) => {
            if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return }
            if (!res) { reject(new Error('No response')); return }
            if (res.ok) resolve(res.result)
            else reject(new Error(res.error ?? 'Request failed'))
          }
        )
      })
    },

    on(event: string, cb: (...args: unknown[]) => void) {
      if (!_listeners[event]) _listeners[event] = []
      _listeners[event].push(cb)
    },

    removeListener(event: string, cb: (...args: unknown[]) => void) {
      if (_listeners[event]) _listeners[event] = _listeners[event].filter(l => l !== cb)
    },

    // Legacy send / sendAsync
    send(method: string, params: unknown[]): Promise<unknown> {
      return this.request({ method, params })
    },

    sendAsync(req: { method: string; params?: unknown[] }, cb: (err: Error | null, res: unknown) => void) {
      this.request(req).then(r => cb(null, { id: 1, jsonrpc: '2.0', result: r })).catch((e: Error) => cb(e, null))
    },

    enable(): Promise<string[]> {
      return this.request({ method: 'eth_requestAccounts', params: [] }) as Promise<string[]>
    },

    // EIP-6963 identity
    _isMagicMoney: true
  }
}

// ── window.solana ─────────────────────────────────────────────────────────────

function makeSolanaProvider() {
  return {
    isMagicMoney: true,
    isConnected: false,
    publicKey: null as string | null,

    connect(): Promise<{ publicKey: { toBase58(): string; toString(): string } }> {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: 'web3:solana:connect', args: [] },
          (res: { ok: boolean; result?: string; error?: string }) => {
            if (!res?.ok) { reject(new Error(res?.error ?? 'Connect failed')); return }
            const pk = res.result as string
            this.publicKey = pk
            this.isConnected = true
            resolve({ publicKey: { toBase58: () => pk, toString: () => pk } })
          }
        )
      })
    },

    signMessage(message: Uint8Array): Promise<{ signature: Uint8Array }> {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: 'web3:solana:sign', args: [Array.from(message)] },
          (res: { ok: boolean; result?: number[]; error?: string }) => {
            if (!res?.ok) { reject(new Error(res?.error ?? 'Sign failed')); return }
            resolve({ signature: new Uint8Array(res.result!) })
          }
        )
      })
    }
  }
}

// ── Inject ────────────────────────────────────────────────────────────────────

window.ethereum = makeEthProvider() as unknown as typeof window.ethereum
window.solana   = makeSolanaProvider() as unknown as typeof window.solana

// EIP-6963 announcement so dApps using the new standard detect MagicMoney
window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
  detail: {
    info: { uuid: 'magicmoney-wallet', name: 'MagicMoney Wallet', icon: '', rdns: 'info.chainlens.magicmoney' },
    provider: window.ethereum
  }
}))
