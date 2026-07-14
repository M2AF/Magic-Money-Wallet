/**
 * midnight-crypto.ts — pure address computation given a loaded ledger-v9 module.
 *
 * Shared by every target's midnight-ledger loader (Electron main, extension
 * offscreen document, Capacitor WebView) so the Lace-verified recipe lives in
 * exactly one place. See midnight.ts for the derivation provenance.
 */

import { bech32m } from '@scure/base'
import type { MidnightAddresses } from './midnight'

// Structural slice of @midnightntwrk/ledger-v9 — keeps this module free of a
// static dependency on the WASM package (each loader imports it its own way).
export interface LedgerV9Like {
  signingKeyFromBip340(seed: Uint8Array): unknown
  signatureVerifyingKey(signingKey: unknown): unknown
  addressFromKey(verifyingKey: unknown): string
  ZswapSecretKeys: {
    fromSeed(seed: Uint8Array): { coinPublicKey: unknown; encryptionPublicKey: unknown }
  }
}

// Structural slice of @midnight-ntwrk/wallet-sdk-hd. Pure JS, but ESM-only, so
// wallet-core (which also runs in the extension MV3 service worker, where a
// runtime import() of a BARE package is forbidden) must NOT import it — instead
// each per-target midnight loader imports it and calls deriveMidnightRoleKeys.
export interface WalletSdkHdLike {
  HDWallet: { fromSeed(seed: Uint8Array): { type: string; hdWallet?: HdWalletLike } }
  Roles: { NightExternal: number; Zswap: number; [k: string]: number }
}
interface HdWalletLike {
  selectAccount(i: number): { selectRole(r: number): { deriveKeyAt(i: number): { type: string; key?: Uint8Array } } }
  clear(): void
}

const encode = (hrp: string, payload: Uint8Array): string =>
  bech32m.encode(hrp, bech32m.toWords(payload), 250)

/**
 * Derive the two Midnight HD role keys (NIGHT external + Zswap) at account
 * `accountIndex`, index 0 — the exact path Lace uses. Returns null when the
 * seed or a key derivation is out of bounds (caller leaves midnight unset).
 */
export function deriveMidnightRoleKeys(
  hd: WalletSdkHdLike,
  seed: Uint8Array,
  accountIndex: number
): { nightKey: Uint8Array; zswapKey: Uint8Array } | null {
  const res = hd.HDWallet.fromSeed(seed)
  if (res.type !== 'seedOk' || !res.hdWallet) return null
  try {
    const account = res.hdWallet.selectAccount(accountIndex)
    const night = account.selectRole(hd.Roles.NightExternal).deriveKeyAt(0)
    const zswap = account.selectRole(hd.Roles.Zswap).deriveKeyAt(0)
    if (night.type !== 'keyDerived' || zswap.type !== 'keyDerived' || !night.key || !zswap.key) return null
    return { nightKey: night.key, zswapKey: zswap.key }
  } finally {
    res.hdWallet.clear()
  }
}

export function computeMidnightAddresses(
  v9: LedgerV9Like,
  nightKey: Uint8Array,
  zswapKey: Uint8Array
): MidnightAddresses {
  // Unshielded (NIGHT) — Schnorr/BIP-340 signature key → verifying-key hash.
  const signingKey = v9.signingKeyFromBip340(nightKey)
  const verifyingKey = v9.signatureVerifyingKey(signingKey)
  const userAddress = v9.addressFromKey(verifyingKey)             // 32-byte hex
  const unshielded = encode('mn_addr', Buffer.from(userAddress, 'hex'))

  // Shielded — Zswap key pair; address payload is coinPub || encPub.
  const sk = v9.ZswapSecretKeys.fromSeed(zswapKey)
  const coinPub = Buffer.from(sk.coinPublicKey as string, 'hex')
  const encPub = Buffer.from(sk.encryptionPublicKey as string, 'hex')
  const shielded = encode('mn_shield-addr', Buffer.concat([coinPub, encPub]))

  return { unshielded, shielded }
}
