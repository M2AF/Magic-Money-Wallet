/**
 * midnight-ledger.ts — ELECTRON MAIN loader.
 *
 * Does both the wallet-sdk-hd role-key derivation AND the ledger-v9 address
 * computation, so wallet-core never imports either ESM/WASM package (a runtime
 * import() of a bare package crashes the extension MV3 service worker; keeping
 * both behind this per-target loader sidesteps that everywhere).
 *
 * In Node, `import()` of an ESM-only package resolves fine (unlike a compiled
 * CJS `require`, which threw ERR_PACKAGE_PATH_NOT_EXPORTED). Variable specifiers
 * keep the bundler's static analysis away from the packages.
 *
 * The extension/capacitor builds alias this module to their own loaders.
 */

import { computeMidnightAddresses, deriveMidnightRoleKeys, type LedgerV9Like, type WalletSdkHdLike } from './midnight-crypto'
import type { MidnightAddresses } from './midnight'

let _ledger: Promise<LedgerV9Like> | null = null
function loadLedger(): Promise<LedgerV9Like> {
  if (!_ledger) {
    const spec = '@midnightntwrk/ledger-v9'
    _ledger = import(/* @vite-ignore */ spec) as Promise<LedgerV9Like>
  }
  return _ledger
}

let _hd: Promise<WalletSdkHdLike> | null = null
function loadHd(): Promise<WalletSdkHdLike> {
  if (!_hd) {
    const spec = '@midnight-ntwrk/wallet-sdk-hd'
    _hd = import(/* @vite-ignore */ spec) as Promise<WalletSdkHdLike>
  }
  return _hd
}

export async function deriveWithLedger(seed: Uint8Array, accountIndex: number): Promise<MidnightAddresses> {
  const hd = await loadHd()
  const keys = deriveMidnightRoleKeys(hd, seed, accountIndex)
  if (!keys) throw new Error('Midnight HD key derivation out of bounds')
  return computeMidnightAddresses(await loadLedger(), keys)
}
