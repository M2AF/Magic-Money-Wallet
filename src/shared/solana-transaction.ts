/**
 * solana-transaction.ts — read a serialized Solana transaction without web3.js.
 *
 * The swap checks only need to READ an aggregator's transaction: is it well
 * formed, who pays, how many signers does it need, and which accounts does it
 * name. Doing that here, dependency-free, lets the same checks run in Magic
 * Money's privileged layer and in a browser page that has no @solana/web3.js.
 *
 * Strictness matches `VersionedTransaction.deserialize` (web3.js 1.x), which is
 * what these checks used before: truncation fails, a versioned message must be
 * version 0, and the signature count must equal the header's required signers.
 * Trailing bytes are ignored there and here. Nothing in this module signs,
 * verifies signatures, or resolves address lookup tables.
 */

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n
  for (const b of bytes) n = (n << 8n) + BigInt(b)
  let out = ''
  while (n > 0n) { out = B58_ALPHABET[Number(n % 58n)] + out; n /= 58n }
  for (const b of bytes) { if (b !== 0) break; out = '1' + out }
  return out
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[\s=]+/g, '')
  if (!/^[A-Za-z0-9+/]*$/.test(clean) || clean.length % 4 === 1) throw new Error('Invalid base64.')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let bits = 0
  let acc = 0
  let i = 0
  for (const ch of clean) {
    acc = (acc << 6) | B64_ALPHABET.indexOf(ch)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[i++] = (acc >> bits) & 0xff
    }
  }
  return out.subarray(0, i)
}

export interface SolanaInstructionView {
  programIdIndex: number
  accountIndexes: number[]
  data: Uint8Array
}

export interface SolanaTransactionView {
  version: 'legacy' | 0
  signatureCount: number
  header: { numRequiredSignatures: number; numReadonlySignedAccounts: number; numReadonlyUnsignedAccounts: number }
  /** Account keys written in the message, base58. Index 0 is the fee payer. */
  staticAccountKeys: string[]
  recentBlockhash: string
  instructions: SolanaInstructionView[]
  addressTableLookups: Array<{ accountKey: string; writableIndexes: number[]; readonlyIndexes: number[] }>
}

class Reader {
  private pos = 0
  constructor(private readonly bytes: Uint8Array) {}
  u8(): number {
    if (this.pos >= this.bytes.length) throw new Error('Solana transaction is truncated.')
    return this.bytes[this.pos++]
  }
  take(n: number): Uint8Array {
    if (this.pos + n > this.bytes.length) throw new Error('Solana transaction is truncated.')
    const out = this.bytes.subarray(this.pos, this.pos + n)
    this.pos += n
    return out
  }
  /** Solana's compact-u16 ("shortvec"): up to three 7-bit groups. */
  shortvec(): number {
    let value = 0
    for (let shift = 0; shift < 21; shift += 7) {
      const b = this.u8()
      value |= (b & 0x7f) << shift
      if ((b & 0x80) === 0) return value
    }
    throw new Error('Solana transaction has an invalid length prefix.')
  }
  peek(): number {
    if (this.pos >= this.bytes.length) throw new Error('Solana transaction is truncated.')
    return this.bytes[this.pos]
  }
}

/** Parse a serialized transaction (bytes or base64). Throws on malformed input. */
export function parseSolanaTransaction(input: Uint8Array | string): SolanaTransactionView {
  const bytes = typeof input === 'string' ? base64ToBytes(input) : input
  const r = new Reader(bytes)

  const signatureCount = r.shortvec()
  r.take(64 * signatureCount)

  let version: 'legacy' | 0 = 'legacy'
  const prefix = r.peek()
  if (prefix & 0x80) {
    r.u8()
    const v = prefix & 0x7f
    if (v !== 0) throw new Error(`Unsupported Solana transaction version ${v}.`)
    version = 0
  }

  const header = {
    numRequiredSignatures: r.u8(),
    numReadonlySignedAccounts: r.u8(),
    numReadonlyUnsignedAccounts: r.u8(),
  }
  const keyCount = r.shortvec()
  const staticAccountKeys: string[] = []
  for (let i = 0; i < keyCount; i++) staticAccountKeys.push(base58Encode(r.take(32)))
  const recentBlockhash = base58Encode(r.take(32))

  const instructions: SolanaInstructionView[] = []
  const instructionCount = r.shortvec()
  for (let i = 0; i < instructionCount; i++) {
    const programIdIndex = r.u8()
    const accountIndexes = Array.from(r.take(r.shortvec()))
    const data = r.take(r.shortvec())
    instructions.push({ programIdIndex, accountIndexes, data })
  }

  const addressTableLookups: SolanaTransactionView['addressTableLookups'] = []
  if (version === 0) {
    const lookupCount = r.shortvec()
    for (let i = 0; i < lookupCount; i++) {
      const accountKey = base58Encode(r.take(32))
      const writableIndexes = Array.from(r.take(r.shortvec()))
      const readonlyIndexes = Array.from(r.take(r.shortvec()))
      addressTableLookups.push({ accountKey, writableIndexes, readonlyIndexes })
    }
  }

  if (signatureCount !== header.numRequiredSignatures) {
    throw new Error('Solana transaction signature count does not match its required signers.')
  }
  return { version, signatureCount, header, staticAccountKeys, recentBlockhash, instructions, addressTableLookups }
}
