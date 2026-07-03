/**
 * cardano-pure.ts — MagicMoney Wallet
 *
 * Pure TypeScript implementation of Cardano's Shelley address derivation.
 * Implements CIP-3 v2 (Icarus) + CIP-1852 + BIP32-Ed25519.
 *
 * NO external Cardano libraries required. Uses only:
 *   @noble/hashes  — pbkdf2, hmac, sha512, blake2b
 *   @noble/curves  — ed25519 ExtendedPoint (raw scalar multiply)
 *   @scure/base    — bech32 encoding
 *
 * Algorithm sources:
 *   CIP-3 v2 (Icarus): https://github.com/cardano-foundation/CIPs/blob/master/CIP-0003
 *   CIP-1852:          https://github.com/cardano-foundation/CIPs/blob/master/CIP-1852
 *   BIP32-Ed25519:     Khovratovich & Law, 2017
 */

import { pbkdf2 } from '@noble/hashes/pbkdf2'
import { sha512 } from '@noble/hashes/sha512'
import { hmac } from '@noble/hashes/hmac'
import { blake2b } from '@noble/hashes/blake2b'
import { ed25519 } from '@noble/curves/ed25519'
import { bech32 } from '@scure/base'

// ─── Ed25519 curve order ─────────────────────────────────────────────────────
const CURVE_N = ed25519.CURVE.n

// ─── Internal key node type ──────────────────────────────────────────────────
interface KeyNode {
  kL: Uint8Array  // 32-byte left part of extended private key (the scalar)
  kR: Uint8Array  // 32-byte right part of extended private key
  c:  Uint8Array  // 32-byte chain code
}

// ─── Byte / BigInt helpers ───────────────────────────────────────────────────

/** Interpret byte array as an unsigned little-endian BigInt */
function leToBI(bytes: Uint8Array): bigint {
  return BigInt('0x' + Buffer.from(bytes).reverse().toString('hex'))
}

/** Encode BigInt as a fixed 32-byte little-endian buffer */
function biToLE32(n: bigint): Uint8Array {
  const hex = (n & ((1n << 256n) - 1n)).toString(16).padStart(64, '0')
  return Buffer.from(hex, 'hex').reverse()
}

/** Encode a 32-bit unsigned integer as 4-byte little-endian */
function uint32LE(n: number): Uint8Array {
  const buf = Buffer.alloc(4)
  buf.writeUInt32LE(n >>> 0)
  return buf
}

// ─── Root key — CIP-3 v2 Icarus scheme ──────────────────────────────────────

/**
 * Derive the BIP32-Ed25519 root key from BIP-39 raw entropy bytes.
 *
 * IMPORTANT — PBKDF2 argument order:
 *   password = passphrase (usually empty)
 *   salt     = entropy
 *
 * This is verified byte-for-byte against @emurgo/cardano-serialization-lib
 * (the same scheme Yoroi / Eternl / Daedalus use). Swapping these two — a
 * very common mistake, and one present in much of the online example code —
 * produces a valid-LOOKING address that controls entirely different funds.
 */
export function rootKeyFromEntropy(
  entropy: Uint8Array,
  passphrase: Uint8Array = new Uint8Array(0)
): KeyNode {
  // 96-byte seed: kL[32] || kR[32] || chainCode[32]
  const seed = pbkdf2(sha512, passphrase, entropy, { c: 4096, dkLen: 96 })

  const kL = Buffer.from(seed.slice(0, 32))
  const kR = Buffer.from(seed.slice(32, 64))
  const c  = Buffer.from(seed.slice(64, 96))

  // Bit-tweak kL to be a valid ed25519-bip32 scalar:
  //   Clear lowest 3 bits (ensures scalar is a multiple of 8, the cofactor)
  //   Clear highest 3 bits and set bit 6 (bounds the scalar)
  kL[0]  &= 0b11111000
  kL[31] &= 0b00011111
  kL[31] |= 0b01000000

  return { kL, kR, c }
}

// ─── Public key from scalar ───────────────────────────────────────────────────

/**
 * Compute the ed25519 public key from kL (the pre-clamped 32-byte scalar).
 * We bypass getPublicKey() because that applies SHA-512 internally — kL is
 * already the scalar in BIP32-Ed25519, no hashing step.
 */
function pubFromKL(kL: Uint8Array): Uint8Array {
  const scalar = leToBI(kL) % CURVE_N
  return ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes()
}

// ─── Child key derivation ─────────────────────────────────────────────────────

const HARDEN_OFFSET = 0x80000000

/**
 * Hardened child derivation (index must be < 2^31; HARDEN_OFFSET is added).
 * Uses the private key in the HMAC, so requires the parent kL + kR.
 */
function deriveHardened(parent: KeyNode, index: number): KeyNode {
  const idx = HARDEN_OFFSET + index
  const Z = hmac(sha512, parent.c,
    Buffer.concat([Buffer.from([0x00]), parent.kL, parent.kR, uint32LE(idx)]))
  const I = hmac(sha512, parent.c,
    Buffer.concat([Buffer.from([0x01]), parent.kL, parent.kR, uint32LE(idx)]))

  return buildChild(parent, Z, I)
}

/**
 * Soft (unhardened) child derivation (index must be < 2^31).
 * Uses the parent public key in the HMAC — no private material exposed.
 */
function deriveSoft(parent: KeyNode, index: number): KeyNode {
  const A = pubFromKL(parent.kL)
  const Z = hmac(sha512, parent.c,
    Buffer.concat([Buffer.from([0x02]), A, uint32LE(index)]))
  const I = hmac(sha512, parent.c,
    Buffer.concat([Buffer.from([0x03]), A, uint32LE(index)]))

  return buildChild(parent, Z, I)
}

/** Common child key arithmetic for both hardened and soft derivation */
function buildChild(parent: KeyNode, Z: Uint8Array, I: Uint8Array): KeyNode {
  // BIP32-Ed25519 scalar addition (little-endian arithmetic mod 2^256)
  const Zl = Z.slice(0, 28)   // first 28 bytes only (paper requirement)
  const Zr = Z.slice(32, 64)

  const kL_child = biToLE32(8n * leToBI(Zl) + leToBI(parent.kL))
  const kR_child = biToLE32(leToBI(Zr) + leToBI(parent.kR))
  const c_child  = I.slice(32, 64)

  return {
    kL: kL_child,
    kR: kR_child,
    c:  Buffer.from(c_child)
  }
}

/** Derive a child key along a path segment (hardened if index >= HARDEN_OFFSET) */
function deriveChild(parent: KeyNode, index: number): KeyNode {
  return index >= HARDEN_OFFSET
    ? deriveHardened(parent, index - HARDEN_OFFSET)
    : deriveSoft(parent, index)
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Derive a Cardano Shelley mainnet base address from BIP-39 raw entropy.
 *
 * Path: m/1852'/1815'/0' (account)
 *   Payment key: account/0/0
 *   Stake key:   account/2/0
 *
 * Address = bech32("addr", [0x01] || blake2b-224(payPub) || blake2b-224(stkPub))
 */
export function deriveCardanoAddress(entropy: Uint8Array, accountIndex = 0, testnet = false): string {
  const root    = rootKeyFromEntropy(entropy)
  const account = [deriveHardened, deriveHardened, deriveHardened]
    .reduce((key, fn, i) => fn(key, [1852, 1815, accountIndex][i]), root)

  const payPub = pubFromKL(deriveSoft(deriveSoft(account, 0), 0).kL)
  const stkPub = pubFromKL(deriveSoft(deriveSoft(account, 2), 0).kL)

  // blake2b-224 = 28-byte output (Cardano uses 224-bit key hashes)
  const payHash = blake2b(payPub, { dkLen: 28 })
  const stkHash = blake2b(stkPub, { dkLen: 28 })

  // Header low nibble = network id (1 = mainnet, 0 = testnet/preprod); high
  // nibble 0b0000 = base address on both. Keys/paths are identical either way.
  const addrBytes = Buffer.concat([Buffer.from([testnet ? 0x00 : 0x01]), payHash, stkHash])

  // Cardano uses standard bech32 with a generous limit (base addresses are 57 bytes)
  return bech32.encode(testnet ? 'addr_test' : 'addr', bech32.toWords(addrBytes), 1000)
}

/**
 * Also derive the raw stake (reward) address — useful for showing in the UI
 * and for Blockfrost stake-history queries.
 *
 * Stake address = bech32("stake", [0xE1] || blake2b-224(stkPub))
 */
export function deriveCardanoStakeAddress(entropy: Uint8Array, accountIndex = 0, testnet = false): string {
  const root    = rootKeyFromEntropy(entropy)
  const account = [deriveHardened, deriveHardened, deriveHardened]
    .reduce((key, fn, i) => fn(key, [1852, 1815, accountIndex][i]), root)

  const stkPub  = pubFromKL(deriveSoft(deriveSoft(account, 2), 0).kL)
  const stkHash = blake2b(stkPub, { dkLen: 28 })

  // Header 0xE1 = mainnet reward/stake address, 0xE0 = testnet
  const addrBytes = Buffer.concat([Buffer.from([testnet ? 0xe0 : 0xe1]), stkHash])
  return bech32.encode(testnet ? 'stake_test' : 'stake', bech32.toWords(addrBytes), 1000)
}

// ─── Signing key export ───────────────────────────────────────────────────────

export interface CardanoSpendingKey {
  kL: Uint8Array   // 32-byte scalar (spending private key)
  kR: Uint8Array   // 32-byte nonce seed
  pub: Uint8Array  // 32-byte ed25519 public key
}

/**
 * Derive the spending key at m/1852'/1815'/0'/0/0.
 * This is used to sign Cardano transactions.
 */
export function getCardanoSpendingKey(entropy: Uint8Array, accountIndex = 0): CardanoSpendingKey {
  const root    = rootKeyFromEntropy(entropy)
  const account = [deriveHardened, deriveHardened, deriveHardened]
    .reduce((key, fn, i) => fn(key, [1852, 1815, accountIndex][i]), root)

  const spendNode = deriveSoft(deriveSoft(account, 0), 0)
  return {
    kL:  spendNode.kL,
    kR:  spendNode.kR,
    pub: pubFromKL(spendNode.kL)
  }
}

/**
 * Derive the stake key at m/1852'/1815'/account'/2/0 (same path the base
 * address's stake credential uses). Marketplace cancel/accept/sell transactions
 * put this key in `required_signers`, so CIP-30 signTx must add its witness too.
 */
export function getCardanoStakeKey(entropy: Uint8Array, accountIndex = 0): CardanoSpendingKey {
  const root    = rootKeyFromEntropy(entropy)
  const account = [deriveHardened, deriveHardened, deriveHardened]
    .reduce((key, fn, i) => fn(key, [1852, 1815, accountIndex][i]), root)

  const stakeNode = deriveSoft(deriveSoft(account, 2), 0)
  return {
    kL:  stakeNode.kL,
    kR:  stakeNode.kR,
    pub: pubFromKL(stakeNode.kL)
  }
}

// ─── BIP32-Ed25519 signing ────────────────────────────────────────────────────

/**
 * Sign a message (transaction body hash) using BIP32-Ed25519.
 * This differs from standard Ed25519: the nonce comes from SHA-512(kR || msg)
 * rather than SHA-512(sk), and kL is the pre-computed scalar.
 *
 * Returns a 64-byte signature: R (32 bytes) || S (32 bytes).
 */
export function cardanoSign(message: Uint8Array, kL: Uint8Array, kR: Uint8Array): Uint8Array {
  // nonce = SHA-512(kR || message), interpreted as little-endian
  const nonce = sha512(Buffer.concat([kR, message]))
  const r = leToBI(nonce) % CURVE_N

  // R = r * G (compressed 32-byte point)
  const R = ed25519.ExtendedPoint.BASE.multiply(r).toRawBytes()

  // A = public key from kL scalar
  const A = pubFromKL(kL)

  // h = SHA-512(R || A || message) as little-endian scalar mod n
  const h = leToBI(sha512(Buffer.concat([R, A, message]))) % CURVE_N

  // s = (r + h * kL_scalar) mod n
  const scalar = leToBI(kL) % CURVE_N
  const s = (r + h * scalar) % CURVE_N

  return Buffer.concat([R, biToLE32(s)])
}

// ─── Minimal CBOR encoder (Cardano transaction serialization) ─────────────────

function cborUint(n: bigint | number): Buffer {
  const v = BigInt(n)
  if (v < 24n) return Buffer.from([Number(v)])
  if (v < 0x100n) return Buffer.from([0x18, Number(v)])
  if (v < 0x10000n) {
    const b = Buffer.alloc(3); b[0] = 0x19; b.writeUInt16BE(Number(v), 1); return b
  }
  if (v < 0x100000000n) {
    const b = Buffer.alloc(5); b[0] = 0x1a; b.writeUInt32BE(Number(v), 1); return b
  }
  const b = Buffer.alloc(9); b[0] = 0x1b; b.writeBigUInt64BE(v, 1); return b
}

function cborBytes(bytes: Uint8Array): Buffer {
  const len = bytes.length
  if (len < 24) return Buffer.concat([Buffer.from([0x40 + len]), bytes])
  if (len < 256) return Buffer.concat([Buffer.from([0x58, len]), bytes])
  const prefix = Buffer.alloc(3); prefix[0] = 0x59; prefix.writeUInt16BE(len, 1)
  return Buffer.concat([prefix, bytes])
}

function cborArray(items: Buffer[]): Buffer {
  const len = items.length
  const prefix = len < 24
    ? Buffer.from([0x80 + len])
    : Buffer.from([0x98, len])
  return Buffer.concat([prefix, ...items])
}

function cborMap(entries: Array<[Buffer, Buffer]>): Buffer {
  const len = entries.length
  const prefix = len < 24
    ? Buffer.from([0xa0 + len])
    : Buffer.from([0xb8, len])
  return Buffer.concat([prefix, ...entries.flatMap(([k, v]) => [k, v])])
}

// ─── Cardano transaction builder ──────────────────────────────────────────────

export interface CardanoUtxo {
  txHash: string    // hex
  txIndex: number
  lovelace: bigint
}

export interface CardanoTxResult {
  /** Signed transaction bytes ready for Blockfrost /tx/submit */
  txCbor: Uint8Array
  /** blake2b-256 of the transaction body (for display / tracking) */
  txHash: string
  /** Actual fee paid in lovelace */
  fee: bigint
}

/**
 * Build and sign a simple ADA transfer transaction.
 *
 * @param utxos     - UTXOs to spend from (must sum to >= amountLovelace + fee)
 * @param toAddress - Recipient bech32 address
 * @param fromAddressBytes - Sender address as raw bytes (for change output)
 * @param amountLovelace - Amount to send
 * @param spendKey  - Spending key for signing
 */
export function buildCardanoTx(
  utxos: CardanoUtxo[],
  toAddress: Uint8Array,
  fromAddressBytes: Uint8Array,
  amountLovelace: bigint,
  spendKey: CardanoSpendingKey
): CardanoTxResult {
  // Fixed fee: 170000 lovelace (comfortably above min for a simple transfer)
  const fee = 170000n

  const inputSum = utxos.reduce((acc, u) => acc + u.lovelace, 0n)
  if (inputSum < amountLovelace + fee) {
    throw new Error(
      `Insufficient funds: have ${inputSum} lovelace, need ${amountLovelace + fee}`
    )
  }

  const change = inputSum - amountLovelace - fee
  const MIN_UTXO = 1_000_000n  // 1 ADA minimum output

  // Build inputs CBOR
  const inputsCbor = cborArray(
    utxos.map(u =>
      cborArray([cborBytes(Buffer.from(u.txHash, 'hex')), cborUint(u.txIndex)])
    )
  )

  // Build outputs CBOR — send to recipient + change back (if above min)
  const outputItems: Buffer[] = [
    cborArray([cborBytes(toAddress), cborUint(amountLovelace)])
  ]
  if (change >= MIN_UTXO) {
    outputItems.push(cborArray([cborBytes(fromAddressBytes), cborUint(change)]))
  }
  const outputsCbor = cborArray(outputItems)

  // Transaction body map: {0: inputs, 1: outputs, 2: fee}
  const txBodyCbor = cborMap([
    [cborUint(0), inputsCbor],
    [cborUint(1), outputsCbor],
    [cborUint(2), cborUint(fee)]
  ])

  // Transaction body hash (blake2b-256)
  const txBodyHash = blake2b(txBodyCbor, { dkLen: 32 })

  // Sign the body hash
  const signature = cardanoSign(txBodyHash, spendKey.kL, spendKey.kR)

  // Witness set: {0: [[pubkey, signature]]}
  const witnessCbor = cborMap([
    [cborUint(0), cborArray([cborArray([cborBytes(spendKey.pub), cborBytes(signature)])])]
  ])

  // Full transaction: [body, witnesses, true, null]
  const txCbor = cborArray([
    txBodyCbor,
    witnessCbor,
    Buffer.from([0xf5]),  // true
    Buffer.from([0xf6])   // null (no aux data)
  ])

  return {
    txCbor,
    txHash: Buffer.from(txBodyHash).toString('hex'),
    fee
  }
}

/**
 * Decode a bech32 Cardano address (addr1q... or addr...) to raw bytes.
 */
export function decodeCardanoAddress(addr: string): Uint8Array {
  // @scure/base types the arg as a `${string}1${string}` template literal; a
  // runtime bech32 string satisfies it but TS can't prove the shape — cast.
  const decoded = bech32.decode(addr as `${string}1${string}`, 1000)
  return bech32.fromWords(decoded.words)
}
