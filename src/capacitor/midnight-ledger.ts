/**
 * midnight-ledger.ts — BROWSER loader (Capacitor WebView + the extension's
 * offscreen document). Aliased over src/main/midnight-ledger.ts by the
 * Capacitor build, and imported directly by the offscreen document.
 *
 * Both wallet-sdk-hd (pure JS) and ledger-v9 (WASM) load as lazy Vite chunks —
 * nothing loads until Privacy Mode actually derives an address. Runs the full
 * pipeline (HD role keys → ledger address crypto) so the caller only supplies
 * the seed.
 */

import { computeMidnightAddresses, deriveMidnightRoleKeys, type LedgerV9Like, type WalletSdkHdLike } from '../main/midnight-crypto'
import type { MidnightAddresses } from '../main/midnight'

let _ledger: Promise<LedgerV9Like> | null = null
function loadLedger(): Promise<LedgerV9Like> {
  if (!_ledger) _ledger = import('@midnightntwrk/ledger-v9') as unknown as Promise<LedgerV9Like>
  return _ledger
}

let _hd: Promise<WalletSdkHdLike> | null = null
function loadHd(): Promise<WalletSdkHdLike> {
  if (!_hd) _hd = import('@midnight-ntwrk/wallet-sdk-hd') as unknown as Promise<WalletSdkHdLike>
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
