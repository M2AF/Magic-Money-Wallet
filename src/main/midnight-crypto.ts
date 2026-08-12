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

/**
 * ledger-v9 annotates keys and signatures as `{ tag, value }`, where `value` is
 * hex: a 32-byte BIP-340 verifying key, a 64-byte Schnorr signature.
 */
export interface LedgerTagged { tag: string; value: string }

/**
 * The signing slice of ledger-v9, kept separate from LedgerV9Like so the
 * extension/Capacitor address loaders — which never sign messages — are not
 * forced to widen their structural type.
 */
export interface LedgerV9SignerLike {
  signingKeyFromBip340(seed: Uint8Array): unknown
  signatureVerifyingKey(signingKey: unknown): LedgerTagged
  signData(signingKey: unknown, data: Uint8Array): LedgerTagged
  verifySignature(vk: LedgerTagged, data: Uint8Array, signature: LedgerTagged): boolean
}

/** What a Midnight dApp receives back from the connector's signData. */
export interface MidnightSignedData {
  /**
   * The EXACT bytes that were signed, hex — prefix included. Handed back so a
   * verifier can check `signature` against `verifyingKey` without having to
   * know the prefixing rule out of band.
   */
  data: string
  /** 64-byte BIP-340 Schnorr signature, hex. */
  signature: string
  /** 32-byte verifying key, hex — the note-owner identity dApps key off. */
  verifyingKey: string
}

/**
 * The connector spec's mandatory domain separator for application data:
 * `midnight_signed_message:<byte length of the payload>:` prepended to the
 * payload before signing.
 *
 * This is a SECURITY requirement, not a formatting one. Without it a dApp
 * could hand us bytes that are really a valid raw transaction segment, call
 * them "data", and walk away with a signature that authorises a transfer —
 * while the user only ever saw a sign-a-message prompt. The prefix makes a
 * signed message structurally unusable as a signed transaction.
 */
export function midnightSignedMessagePrefix(payloadLength: number): Uint8Array {
  return new TextEncoder().encode(`midnight_signed_message:${payloadLength}:`)
}

/**
 * Sign arbitrary bytes with the UNSHIELDED (NIGHT) identity — the same
 * BIP-340 key `computeMidnightAddresses` turns into `mn_addr…`, so a dApp can
 * tie the signature to the address it was given.
 *
 * Returns bare hex rather than ledger's `{ tag, value }` wrappers: dApps read
 * `verifyingKey` as a string (Pulse Finance hex/base64-decodes it and rejects
 * anything that is not exactly 32 bytes), and an object there decodes to
 * nothing.
 */
export function signMidnightData(
  v9: LedgerV9SignerLike,
  keys: MidnightRoleKeys,
  data: Uint8Array,
  /**
   * The payload as a readable message when it is one (see
   * decodeMidnightSignPayload), otherwise null. This selects the signing mode —
   * see the comment below, it is a security decision, not a formatting one.
   */
  text: string | null
): MidnightSignedData {
  // Text messages sign RAW, binary payloads sign PREFIXED.
  //
  // The spec prose says every payload is prefixed, and Gero implements that.
  // The live ecosystem does not: Pulse Finance's backend verifies over the raw
  // bytes and rejects a prefixed signature outright (confirmed against their
  // API), because it was built against Lace — whose rdns this wallet answers
  // to. Prefixing everything would make us spec-pure and unusable.
  //
  // Dropping the prefix wholesale is the unsafe half of that trade: it turns
  // signData into an oracle that signs arbitrary bytes with the very key that
  // authorises NIGHT transfers, so a dApp could have a transaction signed via a
  // "sign this message" prompt. Splitting on readability keeps that door shut
  // where it matters — a transaction segment is a serialization of hashes and
  // keys, which cannot masquerade as printable UTF-8 — while letting real
  // messages (logins, identity registrations) interoperate.
  const signed = text === null ? withPrefix(data) : data

  const signingKey = v9.signingKeyFromBip340(keys.nightKey)
  const verifyingKey = v9.signatureVerifyingKey(signingKey)
  const signature = v9.signData(signingKey, signed)

  // Verify our own output before handing it out. A signature over the wrong
  // bytes, or from a key that does not match the address the dApp was shown,
  // fails silently at the far end (a dApp's backend rejects the registration
  // with no clue why) — this turns that into an error here instead.
  if (!v9.verifySignature(verifyingKey, signed, signature)) {
    throw new Error('Midnight signature failed self-verification — refusing to return it.')
  }

  return {
    // `data` is the signed content in its natural encoding: the message itself
    // for text, hex of the exact prefixed bytes for binary. Both let a verifier
    // reconstruct what was signed without knowing our rules.
    data: text ?? Buffer.from(signed).toString('hex'),
    signature: signature.value,
    verifyingKey: verifyingKey.value,
  }
}

/** payload → `midnight_signed_message:<payload length>:` ++ payload */
function withPrefix(data: Uint8Array): Uint8Array {
  // Length is the PAYLOAD's, not the prefixed total.
  const prefix = midnightSignedMessagePrefix(data.length)
  const prefixed = new Uint8Array(prefix.length + data.length)
  prefixed.set(prefix, 0)
  prefixed.set(data, prefix.length)
  return prefixed
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

// HRP network segment: '' for mainnet, '_<network>' otherwise — verified
// against @midnightntwrk/wallet-sdk-address-format's actual MidnightBech32m
// implementation (asString(): `mn_${type}${network == mainnet ? '' : '_' + network}`),
// not guessed. 'mainnet' | 'preprod' matches midnight-send.ts's MidnightNetwork.
function networkSegment(network: 'mainnet' | 'preprod'): string {
  return network === 'mainnet' ? '' : `_${network}`
}

function encodeDustAddress(pubkey: bigint, network: 'mainnet' | 'preprod'): string {
  const be = Buffer.from(pubkey.toString(16).padStart(64, '0'), 'hex')   // 32-byte big-endian
  const le = Buffer.from(be).reverse()
  return encode(`mn_dust${networkSegment(network)}`, Buffer.concat([Buffer.from([DUST_ADDR_TAG]), le]))
}

export function computeMidnightAddresses(
  v9: LedgerV9Like,
  keys: MidnightRoleKeys,
  network: 'mainnet' | 'preprod' = 'mainnet'
): MidnightAddresses {
  const seg = networkSegment(network)

  // Unshielded (NIGHT) — Schnorr/BIP-340 signature key → verifying-key hash.
  const signingKey = v9.signingKeyFromBip340(keys.nightKey)
  const verifyingKey = v9.signatureVerifyingKey(signingKey)
  const userAddress = v9.addressFromKey(verifyingKey)             // 32-byte hex
  const unshielded = encode(`mn_addr${seg}`, Buffer.from(userAddress, 'hex'))

  // Shielded — Zswap key pair; address payload is coinPub || encPub.
  const sk = v9.ZswapSecretKeys.fromSeed(keys.zswapKey)
  const coinPub = Buffer.from(sk.coinPublicKey as string, 'hex')
  const encPub = Buffer.from(sk.encryptionPublicKey as string, 'hex')
  const shielded = encode(`mn_shield-addr${seg}`, Buffer.concat([coinPub, encPub]))

  // Dust — the fee identity DUST generation pays to (mn_dust…).
  const dsk = v9.DustSecretKey.fromSeed(keys.dustKey)
  const dust = encodeDustAddress(dsk.publicKey, network)
  dsk.clear?.()

  return { unshielded, shielded, dust }
}
