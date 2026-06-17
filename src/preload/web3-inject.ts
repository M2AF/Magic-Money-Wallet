/**
 * web3-inject.ts — MagicMoney Wallet
 *
 * Runs as the preload for WebContentsView (dApp browser).
 * Injects window.ethereum (EIP-1193) and window.solana into dApp pages.
 * All signing requests are routed through the main process via IPC
 * so the browser tab can NEVER auto-approve without a native dialog.
 */

import { contextBridge, ipcRenderer } from 'electron'

// ── EIP-1193 provider ─────────────────────────────────────────────────────────

contextBridge.exposeInMainWorld('ethereum', {
  isMetaMask: true,   // most dApps gate on this
  isMagicMoney: true,

  request({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> {
    return ipcRenderer.invoke('web3:request', { method, params: params ?? [] })
  },

  on(event: string, callback: (...args: unknown[]) => void): void {
    ipcRenderer.on(`web3:event:${event}`, (_evt, ...args) => callback(...args))
  },

  removeListener(event: string, callback: (...args: unknown[]) => void): void {
    ipcRenderer.removeListener(`web3:event:${event}`, callback as never)
  },

  // Legacy web3.js 1.x compatibility
  send(method: string, params: unknown[]): Promise<unknown> {
    return ipcRenderer.invoke('web3:request', { method, params })
  },

  sendAsync(
    request: { method: string; params?: unknown[] },
    callback: (err: Error | null, response: unknown) => void
  ): void {
    ipcRenderer.invoke('web3:request', request)
      .then(result => callback(null, { id: 1, jsonrpc: '2.0', result }))
      .catch((err: Error) => callback(err, null))
  },

  // EIP-1102 legacy
  enable(): Promise<string[]> {
    return ipcRenderer.invoke('web3:request', {
      method: 'eth_requestAccounts',
      params: []
    }) as Promise<string[]>
  }
})

// ── Solana wallet adapter ─────────────────────────────────────────────────────

contextBridge.exposeInMainWorld('solana', {
  isMagicMoney: true,
  isConnected: false,
  publicKey: null as string | null,

  connect(): Promise<{ publicKey: { toBase58(): string; toString(): string } }> {
    return ipcRenderer.invoke('web3:solana-connect').then((pk: string) => {
      const key = { toBase58: () => pk, toString: () => pk }
      return { publicKey: key }
    })
  },

  disconnect(): Promise<void> {
    return Promise.resolve()
  },

  signMessage(message: Uint8Array): Promise<{ signature: Uint8Array }> {
    return ipcRenderer.invoke('web3:solana-sign-message', Array.from(message))
      .then((sig: number[]) => ({ signature: new Uint8Array(sig) }))
  },

  on(event: string, callback: (...args: unknown[]) => void): void {
    ipcRenderer.on(`web3:solana:${event}`, (_evt, ...args) => callback(...args))
  }
})
