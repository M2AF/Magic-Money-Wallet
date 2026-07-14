/**
 * monero-pure.ts — Monero key/address derivation with zero native deps.
 *
 * Mirrors cardano-pure.ts: pure @noble/@scure crypto so it runs in every target
 * (Electron main, extension SW, Capacitor WebView) without loading the ~10 MB
 * monero-ts WASM just to show a receive address. monero-ts is only pulled in by
 * monero.ts for chain scanning + sends, and is fed the SAME keys derived here.
 *
 * Derivation scheme (deterministic from the wallet's single BIP-39 mnemonic):
 *   node        = BIP-32  m/44'/128'/{account}'/0/0        (128 = XMR coin type)
 *   spendScalar = sc_reduce32( keccak256( node.privateKey ) )
 *   viewScalar  = sc_reduce32( keccak256( spendScalarBytes ) )
 *
 * The view-from-spend step is Monero's own H_s convention (identical to what
 * monero-wallet-cli does when restoring from a bare spend key), so exporting the
 * spend key into any official/3rd-party Monero wallet reproduces the same view
 * key and address. The keccak-then-reduce on the BIP-32 key exists because raw
 * BIP-32 output is not a uniformly distributed ed25519 scalar.
 *
 * Monero public keys are raw scalar·G (NO ed25519 clamping/hashing), and scalars
 * are little-endian — both handled explicitly below.
 */

import { keccak_256 } from '@noble/hashes/sha3'
import { ed25519 } from '@noble/curves/ed25519'

// ─── Scalar arithmetic (little-endian, mod l) ────────────────────────────────

const L = ed25519.CURVE.n  // 2^252 + 27742317777372353535851937790883648493

function bytesToBigintLE(bytes: Uint8Array): bigint {
  let v = 0n
  for (let i = bytes.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i])
  return v
}

function bigintToBytesLE(v: bigint, len = 32): Uint8Array {
  const out = new Uint8Array(len)
  for (let i = 0; i < len; i++) { out[i] = Number(v & 0xffn); v >>= 8n }
  return out
}

/** sc_reduce32 — interpret 32 bytes as little-endian and reduce mod l. */
export function scReduce32(bytes: Uint8Array): Uint8Array {
  return bigintToBytesLE(bytesToBigintLE(bytes) % L)
}

/** Monero public key: raw scalar·G (no clamping), compressed 32 bytes. */
export function scalarToPublic(scalarLE: Uint8Array): Uint8Array {
  const s = bytesToBigintLE(scalarLE)
  if (s === 0n) throw new Error('Monero scalar is zero')
  return ed25519.ExtendedPoint.BASE.multiply(s).toRawBytes()
}

// ─── Monero base58 (block encoding) ──────────────────────────────────────────
// NOT bitcoin base58: data is chunked into 8-byte blocks, each encoded as exactly
// 11 chars (zero-padded), with a size table for the final partial block. This
// keeps addresses fixed-length.

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const FULL_BLOCK_SIZE = 8
const FULL_ENCODED_BLOCK_SIZE = 11
// encoded size for a partial block of n bytes (index = n)
const ENCODED_BLOCK_SIZES = [0, 2, 3, 5, 6, 7, 9, 10, 11]

function encodeBlock(data: Uint8Array): string {
  let num = 0n
  for (const b of data) num = (num << 8n) | BigInt(b)   // big-endian within block
  const size = ENCODED_BLOCK_SIZES[data.length]
  let out = ''
  while (num > 0n) {
    out = B58_ALPHABET[Number(num % 58n)] + out
    num /= 58n
  }
  return out.padStart(size, B58_ALPHABET[0])
}

function decodeBlock(str: string, byteLen: number): Uint8Array {
  let num = 0n
  for (const ch of str) {
    const idx = B58_ALPHABET.indexOf(ch)
    if (idx < 0) throw new Error('Invalid base58 character')
    num = num * 58n + BigInt(idx)
  }
  const out = new Uint8Array(byteLen)
  for (let i = byteLen - 1; i >= 0; i--) { out[i] = Number(num & 0xffn); num >>= 8n }
  if (num > 0n) throw new Error('base58 block overflow')
  return out
}

export function moneroBase58Encode(data: Uint8Array): string {
  let out = ''
  for (let i = 0; i < data.length; i += FULL_BLOCK_SIZE) {
    out += encodeBlock(data.slice(i, i + FULL_BLOCK_SIZE))
  }
  return out
}

export function moneroBase58Decode(str: string): Uint8Array {
  const fullBlocks = Math.floor(str.length / FULL_ENCODED_BLOCK_SIZE)
  const lastLen = str.length % FULL_ENCODED_BLOCK_SIZE
  const lastByteLen = ENCODED_BLOCK_SIZES.indexOf(lastLen)
  if (lastByteLen < 0) throw new Error('Invalid base58 length')
  const out = new Uint8Array(fullBlocks * FULL_BLOCK_SIZE + lastByteLen)
  for (let i = 0; i < fullBlocks; i++) {
    out.set(decodeBlock(str.slice(i * FULL_ENCODED_BLOCK_SIZE, (i + 1) * FULL_ENCODED_BLOCK_SIZE), FULL_BLOCK_SIZE), i * FULL_BLOCK_SIZE)
  }
  if (lastByteLen > 0) {
    out.set(decodeBlock(str.slice(fullBlocks * FULL_ENCODED_BLOCK_SIZE), lastByteLen), fullBlocks * FULL_BLOCK_SIZE)
  }
  return out
}

// ─── Address encode / validate ───────────────────────────────────────────────

const MAINNET_PREFIX = 0x12            // standard address ("4…")
const MAINNET_INTEGRATED_PREFIX = 0x13 // integrated address (payment id)
const MAINNET_SUBADDRESS_PREFIX = 0x2a // subaddress ("8…")

function addressFromPubkeys(spendPub: Uint8Array, viewPub: Uint8Array, prefix = MAINNET_PREFIX): string {
  const payload = new Uint8Array([prefix, ...spendPub, ...viewPub])
  const checksum = keccak_256(payload).slice(0, 4)
  return moneroBase58Encode(new Uint8Array([...payload, ...checksum]))
}

/**
 * Real structural validation of a mainnet Monero address: base58 block decode,
 * keccak checksum, known network prefix, payload length. (Testnet/stagenet
 * prefixes are deliberately rejected — Privacy Mode is mainnet-only for now.)
 */
export function validateMoneroAddress(address: string): boolean {
  try {
    const raw = moneroBase58Decode(address)
    // standard/subaddress: 1 + 32 + 32 + 4; integrated: + 8-byte payment id
    if (raw.length !== 69 && raw.length !== 77) return false
    const payload = raw.slice(0, raw.length - 4)
    const checksum = raw.slice(raw.length - 4)
    const expect = keccak_256(payload).slice(0, 4)
    if (!checksum.every((b, i) => b === expect[i])) return false
    const prefix = payload[0]
    if (raw.length === 77) return prefix === MAINNET_INTEGRATED_PREFIX
    return prefix === MAINNET_PREFIX || prefix === MAINNET_SUBADDRESS_PREFIX
  } catch {
    return false
  }
}

// ─── Key derivation ──────────────────────────────────────────────────────────

export interface MoneroKeys {
  privateSpendKey: string  // 32-byte little-endian scalar, hex — monero-ts/CLI format
  privateViewKey: string
  publicSpendKey: string
  publicViewKey: string
  address: string          // mainnet standard address (4…)
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

/**
 * Derive the Monero account from a 32-byte BIP-32 private key (the caller does
 * the m/44'/128' derivation — wallet-core owns all mnemonic handling).
 */
export function deriveMoneroKeys(bip32PrivateKey: Uint8Array): MoneroKeys {
  const spendScalar = scReduce32(keccak_256(bip32PrivateKey))
  const viewScalar  = scReduce32(keccak_256(spendScalar))
  const spendPub = scalarToPublic(spendScalar)
  const viewPub  = scalarToPublic(viewScalar)
  return {
    privateSpendKey: hex(spendScalar),
    privateViewKey:  hex(viewScalar),
    publicSpendKey:  hex(spendPub),
    publicViewKey:   hex(viewPub),
    address: addressFromPubkeys(spendPub, viewPub)
  }
}
