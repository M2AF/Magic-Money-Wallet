/**
 * monero.ts — ELECTRON MAIN Monero backend.
 *
 * Monero has NO address-indexed balance API by design — the only way to know a
 * balance is to scan blocks with the private view key. monero-ts (WASM) does
 * that against the keyless remote nodes in MONERO_NODES:
 *
 *   - Balance: a long-lived VIEW-ONLY wallet (address + view key from
 *     addresses.json — spendless) scans in the background; the first fetch
 *     after enabling Privacy Mode reports "Syncing…" until it catches up.
 *   - Send: a transient FULL wallet from the spend key (unlocked mnemonic),
 *     synced from the cached restore height, then create-and-relay.
 *
 * The wallet birthday (config.moneroRestoreHeight) is captured at first enable,
 * so scanning starts near the tip instead of from 2014.
 *
 * Per-target builds swap this module (same export surface — see monero-impl.ts):
 *   extension SW → src/extension/monero-sw.ts   (offscreen-document RPC)
 *   Capacitor    → src/capacitor/monero-browser.ts (WebView + Web Worker)
 *
 * monero-ts is ~10 MB of WASM — the variable-specifier lazy import below keeps
 * it out of every bundle and off the startup path; Node resolves it from
 * node_modules only when a Monero call actually happens.
 */

import { createMoneroModule, type MoneroTs } from './monero-impl'

export { estimateMoneroFee, fetchMoneroHeight } from './monero-rpc'

let _moneroTs: Promise<MoneroTs> | null = null
function loadMoneroTs(): Promise<MoneroTs> {
  if (!_moneroTs) {
    const spec = 'monero-ts'
    _moneroTs = import(/* @vite-ignore */ spec)
      .then(m => ((m as unknown as { default?: MoneroTs }).default ?? m) as MoneroTs)
  }
  return _moneroTs
}

const backend = createMoneroModule(loadMoneroTs)

export const fetchMoneroBalance = backend.fetchMoneroBalance
export const sendMoneroTransaction = backend.sendMoneroTransaction
export const stopMoneroSync = backend.stopMoneroSync
