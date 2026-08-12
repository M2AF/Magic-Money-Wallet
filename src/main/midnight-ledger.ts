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

import {
  computeMidnightAddresses, deriveMidnightRoleKeys, signMidnightData,
  type LedgerV9Like, type LedgerV9SignerLike, type MidnightSignedData, type WalletSdkHdLike,
} from './midnight-crypto'
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

export async function deriveWithLedger(
  seed: Uint8Array,
  accountIndex: number,
  network: 'mainnet' | 'preprod' = 'mainnet'
): Promise<MidnightAddresses> {
  const hd = await loadHd()
  const keys = deriveMidnightRoleKeys(hd, seed, accountIndex)
  if (!keys) throw new Error('Midnight HD key derivation out of bounds')
  return computeMidnightAddresses(await loadLedger(), keys, network)
}

/**
 * Sign bytes with the unshielded NIGHT key (the Midnight connector's signData).
 *
 * Deliberately NOT routed through midnight-send-manager: that opens the whole
 * Midnight wallet (proving keys plus an indexer sync, ~a minute) and signing a
 * message needs none of it — only the HD role key and the ledger's signer.
 */
export async function signWithLedger(
  seed: Uint8Array,
  accountIndex: number,
  data: Uint8Array,
  /** The payload as a readable message, or null when it is binary. */
  text: string | null
): Promise<MidnightSignedData> {
  const hd = await loadHd()
  const keys = deriveMidnightRoleKeys(hd, seed, accountIndex)
  if (!keys) throw new Error('Midnight HD key derivation out of bounds')
  const v9 = await loadLedger() as unknown as LedgerV9SignerLike
  return signMidnightData(v9, keys, data, text)
}
