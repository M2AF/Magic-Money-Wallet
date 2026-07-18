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
  DustSecretKey: {
    fromSeed(seed: Uint8Array): { publicKey: bigint; clear?(): void }
  }
}

// Structural slice of @midnight-ntwrk/wallet-sdk-hd. Pure JS, but ESM-only, so
// wallet-core (which also runs in the extension MV3 service worker, where a
// runtime import() of a BARE package is forbidden) must NOT import it — instead
// each per-target midnight loader imports it and calls deriveMidnightRoleKeys.
export interface WalletSdkHdLike {
  HDWallet: { fromSeed(seed: Uint8Array): { type: string; hdWallet?: HdWalletLike } }
  Roles: { NightExternal: number; Zswap: number; Dust: number; [k: string]: number }
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
export interface MidnightRoleKeys {
  nightKey: Uint8Array
  zswapKey: Uint8Array
  dustKey: Uint8Array   // Roles.Dust — the DUST fee identity (see midnight.ts)
}

export function deriveMidnightRoleKeys(
  hd: WalletSdkHdLike,
  seed: Uint8Array,
  accountIndex: number
): MidnightRoleKeys | null {
  const res = hd.HDWallet.fromSeed(seed)
  if (res.type !== 'seedOk' || !res.hdWallet) return null
  try {
    const account = res.hdWallet.selectAccount(accountIndex)
    const night = account.selectRole(hd.Roles.NightExternal).deriveKeyAt(0)
    const zswap = account.selectRole(hd.Roles.Zswap).deriveKeyAt(0)
    const dust = account.selectRole(hd.Roles.Dust).deriveKeyAt(0)
    if (night.type !== 'keyDerived' || zswap.type !== 'keyDerived' || dust.type !== 'keyDerived'
      || !night.key || !zswap.key || !dust.key) return null
    return { nightKey: night.key, zswapKey: zswap.key, dustKey: dust.key }
  } finally {
    res.hdWallet.clear()
  }
}

// DustAddress bech32m payload = [0x73] ++ little-endian(32-byte pubkey field
// element). The 0x73 is a constant type-tag prefix (verified across wallets and
// byte-for-byte against Midnight's official DustAddress.encodePublicKey codec
// AND a real Lace-generated dust address — see wallet-core.test.ts vectors).
const DUST_ADDR_TAG = 0x73

function encodeDustAddress(pubkey: bigint): string {
  const be = Buffer.from(pubkey.toString(16).padStart(64, '0'), 'hex')   // 32-byte big-endian
  const le = Buffer.from(be).reverse()
  return encode('mn_dust', Buffer.concat([Buffer.from([DUST_ADDR_TAG]), le]))
}

export function computeMidnightAddresses(
  v9: LedgerV9Like,
  keys: MidnightRoleKeys
): MidnightAddresses {
  // Unshielded (NIGHT) — Schnorr/BIP-340 signature key → verifying-key hash.
  const signingKey = v9.signingKeyFromBip340(keys.nightKey)
  const verifyingKey = v9.signatureVerifyingKey(signingKey)
  const userAddress = v9.addressFromKey(verifyingKey)             // 32-byte hex
  const unshielded = encode('mn_addr', Buffer.from(userAddress, 'hex'))

  // Shielded — Zswap key pair; address payload is coinPub || encPub.
  const sk = v9.ZswapSecretKeys.fromSeed(keys.zswapKey)
  const coinPub = Buffer.from(sk.coinPublicKey as string, 'hex')
  const encPub = Buffer.from(sk.encryptionPublicKey as string, 'hex')
  const shielded = encode('mn_shield-addr', Buffer.concat([coinPub, encPub]))

  // Dust — the fee identity DUST generation pays to (mn_dust…).
  const dsk = v9.DustSecretKey.fromSeed(keys.dustKey)
  const dust = encodeDustAddress(dsk.publicKey)
  dsk.clear?.()

  return { unshielded, shielded, dust }
}
