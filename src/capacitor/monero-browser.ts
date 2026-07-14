/**
 * monero-browser.ts — BROWSER Monero backend (Capacitor WebView + the
 * extension's offscreen document). Same export surface as src/main/monero.ts;
 * the Capacitor build aliases './monero' here.
 *
 * Environment setup unique to browser runtimes:
 *   - monero-ts loads as a lazy Vite chunk (nothing at app startup);
 *   - wallet ops run in a real Web Worker (monero.worker.js bundled via Vite's
 *     `?worker` import) so scanning never blocks the UI thread;
 *   - axios (monero-ts's HTTP transport) is forced onto its fetch adapter —
 *     on Android the fetch-guard router can then route node traffic, and
 *     Monero's CORS-enabled nodes (cakewallet) are in BROWSER_HOSTS so the
 *     binary sync RPC stays on the real browser fetch path.
 */

import { createMoneroModule, type MoneroTs } from '../main/monero-impl'

export { estimateMoneroFee, fetchMoneroHeight } from '../main/monero-rpc'

let _moneroTs: Promise<MoneroTs> | null = null
function loadMoneroTs(): Promise<MoneroTs> {
  if (!_moneroTs) {
    _moneroTs = (async () => {
      const [mod, workerMod, axiosMod] = await Promise.all([
        import('monero-ts'),
        import('monero-ts/dist/monero.worker.js?worker'),
        import('axios'),
      ])
      const ts = ((mod as unknown as { default?: MoneroTs }).default ?? mod) as MoneroTs
      // Route monero-ts's HTTP through fetch (Android fetch-guard compatible).
      axiosMod.default.defaults.adapter = 'fetch'
      const WorkerCtor = workerMod.default as unknown as { new (): Worker }
      ts.LibraryUtils.setWorkerLoader(() => new WorkerCtor())
      return ts
    })()
  }
  return _moneroTs
}

const backend = createMoneroModule(loadMoneroTs)

export const fetchMoneroBalance = backend.fetchMoneroBalance
export const sendMoneroTransaction = backend.sendMoneroTransaction
export const stopMoneroSync = backend.stopMoneroSync
