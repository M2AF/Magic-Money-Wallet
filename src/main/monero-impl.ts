/**
 * monero-impl.ts — monero-ts wallet operations (view-only scanning + sends),
 * parameterized by a per-target monero-ts loader:
 *
 *   Electron main        src/main/monero.ts        (runtime node_modules import)
 *   extension offscreen  src/capacitor/monero-browser.ts via offscreen.ts
 *   Capacitor WebView    src/capacitor/monero-browser.ts (lazy chunk + Worker)
 *
 * The loader owns environment setup (worker wiring, axios adapter); this file
 * owns the wallet logic so it exists exactly once. See monero.ts (Electron)
 * for the design doctrine (view-only singleton, wallet birthday, transient
 * full wallet for sends).
 */

import { getMoneroKeys } from './wallet-core'
import { pickNode, XMR_ATOMIC } from './monero-rpc'
import type { WalletConfig } from './secure-store'
import type { SendResult } from './tx-sender'
import type { PrivacyAddresses } from './wallet-core'

const EXPLORER = 'https://xmrchain.net/tx'

export type MoneroTs = typeof import('monero-ts')

interface ViewState {
  key: string                       // address — invalidates on account switch
  wallet: import('monero-ts').MoneroWalletFull | null
  status: 'starting' | 'syncing' | 'ready' | 'error'
  progress: number                  // 0..100
  error: string | null
}

export interface MoneroModule {
  fetchMoneroBalance(privacy: PrivacyAddresses | undefined, config: WalletConfig): Promise<{ native: number; error: string | null }>
  sendMoneroTransaction(mnemonic: string, to: string, amountXmr: string, config: WalletConfig, accountIndex?: number): Promise<SendResult>
  stopMoneroSync(): Promise<void>
}

export function createMoneroModule(loadMoneroTs: () => Promise<MoneroTs>): MoneroModule {
  let view: ViewState | null = null

  async function ensureViewWallet(privacy: PrivacyAddresses, config: WalletConfig): Promise<ViewState> {
    if (view && view.key === privacy.monero && view.status !== 'error') return view
    if (view?.wallet) { try { await view.wallet.close() } catch { /* replaced */ } }

    const state: ViewState = { key: privacy.monero, wallet: null, status: 'starting', progress: 0, error: null }
    view = state

    // Fire-and-forget: the first balance calls report sync status while this runs.
    void (async () => {
      try {
        const ts = await loadMoneroTs()
        const { uri, height } = await pickNode()
        const wallet = await ts.createWalletFull({
          networkType: ts.MoneroNetworkType.MAINNET,
          password: 'view',                    // in-memory wallet — never written to disk
          primaryAddress: privacy.monero,
          privateViewKey: privacy.moneroViewKey,
          // No stamped wallet birthday (older config / stamping failed) →
          // near-tip fallback. The privacy addresses are brand-new derivations,
          // so nothing exists before the mode was first enabled; scanning from
          // genesis would take hours for a guaranteed-empty history.
          restoreHeight: config.moneroRestoreHeight || Math.max(height - 720, 0),
          server: { uri }
        })
        if (view !== state) { await wallet.close(); return }  // superseded meanwhile
        state.wallet = wallet
        state.status = 'syncing'
        await wallet.sync(new class extends ts.MoneroWalletListener {
          async onSyncProgress(_h: number, _s: number, _e: number, percentDone: number) {
            state.progress = Math.round(percentDone * 100)
          }
        }())
        await wallet.startSyncing(20_000)
        state.status = 'ready'
      } catch (err) {
        state.status = 'error'
        state.error = String(err instanceof Error ? err.message : err)
      }
    })()

    return state
  }

  return {
    /**
     * Balance for the dashboard. Non-blocking: while the view wallet is still
     * catching up it returns a sync-status error string (the ChainCard renders
     * it), and real numbers once ready.
     */
    async fetchMoneroBalance(privacy, config) {
      if (!privacy?.monero || !privacy.moneroViewKey) return { native: 0, error: 'No address' }
      try {
        const state = await ensureViewWallet(privacy, config)
        if (state.status === 'error') return { native: 0, error: state.error ?? 'Monero sync failed' }
        if (state.status !== 'ready' || !state.wallet) {
          return { native: 0, error: state.status === 'syncing' ? `Syncing ${state.progress}%` : 'Syncing…' }
        }
        const balance = await state.wallet.getBalance()
        return { native: Number(balance) / XMR_ATOMIC, error: null }
      } catch (err) {
        return { native: 0, error: String(err instanceof Error ? err.message : err) }
      }
    },

    async sendMoneroTransaction(mnemonic, to, amountXmr, config, accountIndex = 0) {
      const atomic = BigInt(Math.round(parseFloat(amountXmr) * XMR_ATOMIC))
      if (atomic <= 0n) throw new Error('Amount must be greater than 0')

      const ts = await loadMoneroTs()
      const keys = await getMoneroKeys(mnemonic, accountIndex)
      const { uri, height } = await pickNode()

      // Transient full wallet — exists only for the duration of this send.
      const wallet = await ts.createWalletFull({
        networkType: ts.MoneroNetworkType.MAINNET,
        password: 'send',                        // in-memory wallet — never written to disk
        primaryAddress: keys.address,
        privateViewKey: keys.privateViewKey,
        privateSpendKey: keys.privateSpendKey,
        restoreHeight: config.moneroRestoreHeight || Math.max(height - 720, 0),  // see view-wallet note
        server: { uri }
      })
      try {
        await wallet.sync()
        const tx = await wallet.createTx({
          accountIndex: 0,
          address: to,
          amount: atomic,
          relay: true
        })
        const hash = tx.getHash()
        return { txHash: hash, explorerUrl: `${EXPLORER}/${hash}` }
      } finally {
        try { await wallet.close() } catch { /* transient wallet */ }
      }
    },

    /** Tear down the scanner (mode disabled / wallet deleted). */
    async stopMoneroSync() {
      const v = view
      view = null
      if (v?.wallet) { try { await v.wallet.close() } catch { /* already closed */ } }
    },
  }
}
