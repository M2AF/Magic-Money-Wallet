/**
 * cardano-cip30.ts — CIP-30 dApp connector helpers (shared)
 *
 * Used by both the Chrome extension background (via src/extension/background.ts)
 * and the Electron main process (via src/main/ipc-handlers.ts).
 */

import { blake2b }            from '@noble/hashes/blake2b'
import { mnemonicToEntropy }  from '@scure/bip39'
import { wordlist }           from '@scure/bip39/wordlists/english'
import {
  getCardanoSpendingKey,
  cardanoSign,
  decodeCardanoAddress,
  deriveCardanoStakeAddress,
} from './cardano-pure'

// ── CBOR primitives ───────────────────────────────────────────────────────────

export function cborInt(n: bigint | number): Uint8Array {
  const v = BigInt(n)
  if (v < 0n) {
    const m = -1n - v
    if (m < 24n) return new Uint8Array([0x20 + Number(m)])
    if (m < 0x100n) return new Uint8Array([0x38, Number(m)])
    if (m < 0x10000n) {
      const b = new Uint8Array(3); b[0] = 0x39; b[1] = Number(m >> 8n); b[2] = Number(m & 0xffn); return b
    }
    const b = new Uint8Array(5); b[0] = 0x3a
    b[1] = Number((m >> 24n) & 0xffn); b[2] = Number((m >> 16n) & 0xffn)
    b[3] = Number((m >> 8n) & 0xffn);  b[4] = Number(m & 0xffn); return b
  }
  if (v < 24n) return new Uint8Array([Number(v)])
  if (v < 0x100n) return new Uint8Array([0x18, Number(v)])
  if (v < 0x10000n) {
    const b = new Uint8Array(3); b[0] = 0x19
    b[1] = Number(v >> 8n); b[2] = Number(v & 0xffn); return b
  }
  if (v < 0x100000000n) {
    const b = new Uint8Array(5); b[0] = 0x1a
    b[1] = Number((v >> 24n) & 0xffn); b[2] = Number((v >> 16n) & 0xffn)
    b[3] = Number((v >> 8n) & 0xffn);  b[4] = Number(v & 0xffn); return b
  }
  const b = new Uint8Array(9); b[0] = 0x1b
  for (let i = 0; i < 8; i++) b[8 - i] = Number((v >> BigInt(i * 8)) & 0xffn)
  return b
}

export const cborUint = cborInt

export function cborBytes(bytes: Uint8Array): Uint8Array {
  const len = bytes.length
  let prefix: Uint8Array
  if (len < 24)        prefix = new Uint8Array([0x40 + len])
  else if (len < 256)  prefix = new Uint8Array([0x58, len])
  else { prefix = new Uint8Array(3); prefix[0] = 0x59; prefix[1] = len >> 8; prefix[2] = len & 0xff }
  const out = new Uint8Array(prefix.length + len)
  out.set(prefix); out.set(bytes, prefix.length)
  return out
}

export function cborText(s: string): Uint8Array {
  const encoded = new TextEncoder().encode(s)
  const len = encoded.length
  let prefix: Uint8Array
  if (len < 24)        prefix = new Uint8Array([0x60 + len])
  else if (len < 256)  prefix = new Uint8Array([0x78, len])
  else { prefix = new Uint8Array(3); prefix[0] = 0x79; prefix[1] = len >> 8; prefix[2] = len & 0xff }
  const out = new Uint8Array(prefix.length + len)
  out.set(prefix); out.set(encoded, prefix.length)
  return out
}

export function cborArray(items: Uint8Array[]): Uint8Array {
  const len = items.length
  const prefix = len < 24 ? new Uint8Array([0x80 + len]) : new Uint8Array([0x98, len])
  const total = prefix.length + items.reduce((s, b) => s + b.length, 0)
  const out = new Uint8Array(total)
  let off = 0; out.set(prefix, off); off += prefix.length
  for (const item of items) { out.set(item, off); off += item.length }
  return out
}

export function cborMap(entries: Array<[Uint8Array, Uint8Array]>): Uint8Array {
  const len = entries.length
  const prefix = len < 24 ? new Uint8Array([0xa0 + len]) : new Uint8Array([0xb8, len])
  const total = prefix.length + entries.reduce((s, [k, v]) => s + k.length + v.length, 0)
  const out = new Uint8Array(total)
  let off = 0; out.set(prefix, off); off += prefix.length
  for (const [k, v] of entries) {
    out.set(k, off); off += k.length
    out.set(v, off); off += v.length
  }
  return out
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length >> 1)
  for (let i = 0; i < hex.length; i += 2) bytes[i >> 1] = parseInt(hex.slice(i, i + 2), 16)
  return bytes
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── CBOR length calculator (for tx body extraction) ───────────────────────────

function cborItemLen(buf: Uint8Array, off: number): number {
  const b = buf[off]; const mt = b >> 5; const ai = b & 0x1f
  const uLen = (ai: number) => { if (ai < 24) return 1; if (ai === 24) return 2; if (ai === 25) return 3; if (ai === 26) return 5; if (ai === 27) return 9; return -1 }
  if (mt === 0 || mt === 1) return uLen(ai)
  if (mt === 2 || mt === 3) {
    let len = 0, hdr = 1
    if (ai < 24) len = ai
    else if (ai === 24) { len = buf[off+1]; hdr = 2 }
    else if (ai === 25) { len = (buf[off+1] << 8)|buf[off+2]; hdr = 3 }
    else if (ai === 26) { len = ((buf[off+1]<<24)|(buf[off+2]<<16)|(buf[off+3]<<8)|buf[off+4])>>>0; hdr = 5 }
    else return -1
    return hdr + len
  }
  const colLen = (count: number, hdr: number) => {
    let pos = off + hdr
    for (let i = 0; i < count; i++) { const l = cborItemLen(buf, pos); if (l < 0) return -1; pos += l }
    return pos - off
  }
  if (mt === 4) { if (ai < 24) return colLen(ai, 1); if (ai === 24) return colLen(buf[off+1], 2); if (ai === 25) return colLen((buf[off+1]<<8)|buf[off+2], 3); return -1 }
  if (mt === 5) { if (ai < 24) return colLen(ai*2, 1); if (ai === 24) return colLen(buf[off+1]*2, 2); if (ai === 25) return colLen(((buf[off+1]<<8)|buf[off+2])*2, 3); return -1 }
  if (mt === 6) { const hdr = uLen(ai); if (hdr < 0) return -1; const inner = cborItemLen(buf, off+hdr); return inner < 0 ? -1 : hdr + inner }
  if (mt === 7) return uLen(ai)
  return -1
}

export function extractTxBody(txBytes: Uint8Array): Uint8Array {
  let start = 0
  if (txBytes[start] === 0xd8) start += 2
  else if (txBytes[start] === 0xd9) start += 3
  const arrByte = txBytes[start]
  if ((arrByte >> 5) !== 4) throw new Error('Expected CBOR array at transaction root')
  const ai = arrByte & 0x1f
  const bodyStart = start + (ai < 24 ? 1 : ai === 24 ? 2 : 3)
  const bodyLen = cborItemLen(txBytes, bodyStart)
  if (bodyLen < 0) throw new Error('Could not determine transaction body length')
  return txBytes.slice(bodyStart, bodyStart + bodyLen)
}

// ── CIP-30 API implementations ────────────────────────────────────────────────

const BF = 'https://cardano-mainnet.blockfrost.io/api/v0'

export async function cip30GetBalance(address: string, blockfrostKey: string): Promise<string> {
  const res = await fetch(`${BF}/addresses/${address}`, {
    headers: { project_id: blockfrostKey },
    signal: AbortSignal.timeout(10_000)
  })
  if (!res.ok) throw new Error(`Blockfrost ${res.status}`)
  const data = await res.json() as { amount?: Array<{ unit: string; quantity: string }> }
  const lovelace = BigInt((data.amount ?? []).find(a => a.unit === 'lovelace')?.quantity ?? '0')
  return bytesToHex(cborUint(lovelace))
}

export async function cip30GetUtxos(address: string, blockfrostKey: string): Promise<string[]> {
  const res = await fetch(`${BF}/addresses/${address}/utxos?count=100`, {
    headers: { project_id: blockfrostKey },
    signal: AbortSignal.timeout(12_000)
  })
  if (!res.ok) return []
  const utxos = await res.json() as Array<{
    tx_hash: string; output_index: number
    amount: Array<{ unit: string; quantity: string }>
  }>
  const addrBytes = decodeCardanoAddress(address)
  return utxos.map(u => {
    const lovelace = BigInt(u.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0')
    const txIn  = cborArray([cborBytes(hexToBytes(u.tx_hash)), cborUint(u.output_index)])
    const txOut = cborArray([cborBytes(addrBytes), cborUint(lovelace)])
    return bytesToHex(cborArray([txIn, txOut]))
  })
}

export async function cip30GetRewardAddresses(mnemonic: string, accountIndex: number): Promise<string[]> {
  const entropy   = mnemonicToEntropy(mnemonic, wordlist)
  const stakeAddr = deriveCardanoStakeAddress(entropy, accountIndex)
  return [stakeAddr]
}

export async function cip30SignTx(txHex: string, mnemonic: string, accountIndex: number): Promise<string> {
  const txBytes     = hexToBytes(txHex)
  const txBodyBytes = extractTxBody(txBytes)
  const txBodyHash  = blake2b(txBodyBytes, { dkLen: 32 })
  const entropy  = mnemonicToEntropy(mnemonic, wordlist)
  const spendKey = getCardanoSpendingKey(entropy, accountIndex)
  const sig      = cardanoSign(txBodyHash, spendKey.kL, spendKey.kR)
  const witnessSet = cborMap([
    [cborUint(0), cborArray([cborArray([cborBytes(spendKey.pub), cborBytes(sig)])])]
  ])
  return bytesToHex(witnessSet)
}

export async function cip30SignData(
  address: string, payloadHex: string, mnemonic: string, accountIndex: number
): Promise<{ signature: string; key: string }> {
  const payload   = hexToBytes(payloadHex)
  const entropy   = mnemonicToEntropy(mnemonic, wordlist)
  const spendKey  = getCardanoSpendingKey(entropy, accountIndex)
  const addrBytes = decodeCardanoAddress(address)

  const protectedHdrMap = cborMap([
    [cborInt(1),      cborInt(-8)],
    [cborInt(-66001), cborBytes(addrBytes)],
  ])
  const protectedHdrBstr = cborBytes(protectedHdrMap)

  const sigStructure = cborArray([
    cborText('Signature1'),
    protectedHdrBstr,
    cborBytes(new Uint8Array(0)),
    cborBytes(payload)
  ])

  const hash = blake2b(sigStructure, { dkLen: 32 })
  const sig  = cardanoSign(hash, spendKey.kL, spendKey.kR)

  const coseSign1 = cborArray([protectedHdrBstr, cborMap([]), cborBytes(payload), cborBytes(sig)])
  const coseKey   = cborMap([
    [cborInt(1),  cborInt(1)],
    [cborInt(3),  cborInt(-8)],
    [cborInt(-1), cborInt(6)],
    [cborInt(-2), cborBytes(spendKey.pub)],
  ])
  return { signature: bytesToHex(coseSign1), key: bytesToHex(coseKey) }
}

export async function cip30SubmitTx(txHex: string, blockfrostKey: string): Promise<string> {
  const res = await fetch(`${BF}/tx/submit`, {
    method: 'POST',
    headers: { project_id: blockfrostKey, 'Content-Type': 'application/cbor' },
    body: hexToBytes(txHex),
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) {
    const msg = await res.text().catch(() => String(res.status))
    throw new Error(`Submit failed: ${msg}`)
  }
  return res.json()
}
