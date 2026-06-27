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
  getCardanoStakeKey,
  cardanoSign,
  decodeCardanoAddress,
  deriveCardanoStakeAddress,
} from './cardano-pure'
import type { WalletConfig } from './secure-store'
import { blockfrostFetch } from './api-proxy'
import { koiosSubmitTx } from './cardano-koios'

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

/**
 * Encode a Cardano Value (CBOR). With no native assets it's a bare coin uint;
 * with assets it's `[coin, multiasset]` where multiasset is
 * `{ policy_id(28B) => { asset_name => quantity } }`. Blockfrost reports each
 * asset `unit` as policyIdHex(56 chars) + assetNameHex. CIP-30 dApps re-serialize
 * via their own CSL, so canonical key ordering is not required here.
 */
export function cborValue(lovelace: bigint, amount: Array<{ unit: string; quantity: string }>): Uint8Array {
  const nonAda = amount.filter(a => a.unit !== 'lovelace')
  if (nonAda.length === 0) return cborUint(lovelace)

  const byPolicy = new Map<string, Array<{ name: string; qty: bigint }>>()
  for (const a of nonAda) {
    const policy = a.unit.slice(0, 56)
    const name   = a.unit.slice(56)
    if (!byPolicy.has(policy)) byPolicy.set(policy, [])
    byPolicy.get(policy)!.push({ name, qty: BigInt(a.quantity) })
  }

  const policyEntries: Array<[Uint8Array, Uint8Array]> = []
  for (const [policy, tokens] of byPolicy) {
    const assetEntries = tokens.map(
      t => [cborBytes(hexToBytes(t.name)), cborUint(t.qty)] as [Uint8Array, Uint8Array]
    )
    policyEntries.push([cborBytes(hexToBytes(policy)), cborMap(assetEntries)])
  }
  return cborArray([cborUint(lovelace), cborMap(policyEntries)])
}

/** Decode a CBOR-encoded unsigned coin (major type 0). Falls back on bad input. */
function decodeCborUint(b: Uint8Array, fallback: bigint): bigint {
  if (!b.length || (b[0] >> 5) !== 0) return fallback
  const ai = b[0] & 0x1f
  if (ai < 24)    return BigInt(ai)
  if (ai === 24)  return BigInt(b[1])
  if (ai === 25)  return (BigInt(b[1]) << 8n) | BigInt(b[2])
  if (ai === 26)  return (BigInt(b[1]) << 24n) | (BigInt(b[2]) << 16n) | (BigInt(b[3]) << 8n) | BigInt(b[4])
  if (ai === 27)  { let v = 0n; for (let i = 1; i <= 8; i++) v = (v << 8n) | BigInt(b[i]); return v }
  return fallback
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Address → raw bytes, tolerant of input form. CIP-30 dApps hand us hex
 * addresses (the form we now return); our own UI/storage uses bech32
 * (addr1.../stake1...). Detect even-length pure-hex → hex; otherwise bech32.
 */
export function addrToBytes(addr: string): Uint8Array {
  if (addr.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(addr)) return hexToBytes(addr)
  return decodeCardanoAddress(addr)
}

/**
 * Encode an address as the hex string CIP-30 requires (`cbor<address>` — the
 * raw address bytes, hex-encoded — NOT bech32). dApps compare these against
 * indexer-reported owner addresses (hex) to detect ownership, and build datums
 * from them; returning bech32 breaks both (only buyer actions stay available).
 */
export function addressToHex(addr: string): string {
  return bytesToHex(addrToBytes(addr))
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

/**
 * Extract the raw CBOR bytes of one field (by integer key) from a transaction
 * body map. Used to inspect `required_signers` (14), `certificates` (4) and
 * `withdrawals` (5) without pulling in a full CBOR decoder. Returns null if the
 * field is absent or the body isn't a definite-length map.
 */
function bodyFieldBytes(body: Uint8Array, fieldKey: number): Uint8Array | null {
  if ((body[0] >> 5) !== 5) return null   // major type 5 = map
  const ai = body[0] & 0x1f
  let n: number, off: number
  if (ai < 24)        { n = ai;                          off = 1 }
  else if (ai === 24) { n = body[1];                     off = 2 }
  else if (ai === 25) { n = (body[1] << 8) | body[2];    off = 3 }
  else return null

  for (let i = 0; i < n; i++) {
    const keyLen = cborItemLen(body, off)
    if (keyLen < 0) return null
    // Body keys are small unsigned ints (major type 0) — read the value.
    const key = (body[off] & 0x1f) < 24 ? (body[off] & 0x1f)
              : (body[off] & 0x1f) === 24 ? body[off + 1] : -1
    const valOff = off + keyLen
    const valLen = cborItemLen(body, valOff)
    if (valLen < 0) return null
    if (key === fieldKey) return body.slice(valOff, valOff + valLen)
    off = valOff + valLen
  }
  return null
}

/** True if `needle` occurs as a contiguous subsequence of `haystack`. */
function bytesContain(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || haystack.length < needle.length) return false
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}

// ── CIP-30 API implementations ────────────────────────────────────────────────

export async function cip30GetBalance(address: string, config: WalletConfig): Promise<string> {
  const res = await blockfrostFetch(`addresses/${address}`, config, 10_000)
  if (!res.ok) throw new Error(`Blockfrost ${res.status}`)
  const data = await res.json() as { amount?: Array<{ unit: string; quantity: string }> }
  const amount = data.amount ?? []
  const lovelace = BigInt(amount.find(a => a.unit === 'lovelace')?.quantity ?? '0')
  // Full Value (ADA + native assets), not lovelace-only — dApps need the asset
  // balance to build transactions that move tokens/NFTs.
  return bytesToHex(cborValue(lovelace, amount))
}

export async function cip30GetUtxos(address: string, config: WalletConfig): Promise<string[]> {
  const res = await blockfrostFetch(`addresses/${address}/utxos?count=100`, config, 12_000)
  if (!res.ok) return []
  const utxos = await res.json() as Array<{
    tx_hash: string; output_index: number; data_hash?: string | null
    amount: Array<{ unit: string; quantity: string }>
  }>
  const addrBytes = decodeCardanoAddress(address)
  return utxos.map(u => {
    const lovelace = BigInt(u.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0')
    const txIn  = cborArray([cborBytes(hexToBytes(u.tx_hash)), cborUint(u.output_index)])
    // Legacy array output: [address, value, ?datum_hash]. Value carries native
    // assets so the dApp can see tokens/NFTs held at this UTxO.
    const outItems = [cborBytes(addrBytes), cborValue(lovelace, u.amount)]
    if (u.data_hash) outItems.push(cborBytes(hexToBytes(u.data_hash)))
    const txOut = cborArray(outItems)
    return bytesToHex(cborArray([txIn, txOut]))
  })
}

/**
 * CIP-30 getCollateral — pure-ADA UTxOs (no native assets) covering `amountHex`
 * (CBOR coin) or 5 ADA by default. Plutus-script dApps (DEXes, NFT marketplaces)
 * require collateral to build script transactions. Prefers a single sufficient
 * UTxO; otherwise accumulates smallest-first up to the 3-input protocol cap.
 * Returns [] if no pure-ADA UTxOs can meet the target.
 */
export async function cip30GetCollateral(
  address: string, config: WalletConfig, amountHex?: string
): Promise<string[]> {
  const res = await blockfrostFetch(`addresses/${address}/utxos?count=100`, config, 12_000)
  if (!res.ok) return []
  const utxos = await res.json() as Array<{
    tx_hash: string; output_index: number
    amount: Array<{ unit: string; quantity: string }>
  }>

  const target = amountHex ? decodeCborUint(hexToBytes(amountHex), 5_000_000n) : 5_000_000n
  const addrBytes = decodeCardanoAddress(address)

  const pureAda = utxos
    .filter(u => u.amount.every(a => a.unit === 'lovelace'))
    .map(u => ({ u, lovelace: BigInt(u.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0') }))
    .sort((a, b) => (a.lovelace < b.lovelace ? -1 : a.lovelace > b.lovelace ? 1 : 0))

  let chosen: typeof pureAda
  const single = pureAda.find(x => x.lovelace >= target)
  if (single) {
    chosen = [single]
  } else {
    chosen = []
    let sum = 0n
    for (const x of pureAda) {
      chosen.push(x); sum += x.lovelace
      if (sum >= target || chosen.length >= 3) break
    }
    if (sum < target) return []
  }

  return chosen.map(({ u, lovelace }) => {
    const txIn  = cborArray([cborBytes(hexToBytes(u.tx_hash)), cborUint(u.output_index)])
    const txOut = cborArray([cborBytes(addrBytes), cborUint(lovelace)])
    return bytesToHex(cborArray([txIn, txOut]))
  })
}

export async function cip30GetRewardAddresses(mnemonic: string, accountIndex: number): Promise<string[]> {
  const entropy   = mnemonicToEntropy(mnemonic, wordlist)
  const stakeAddr = deriveCardanoStakeAddress(entropy, accountIndex)
  // CIP-30 requires hex-encoded reward-address bytes, not bech32 (stake1...).
  return [addressToHex(stakeAddr)]
}

export async function cip30SignTx(txHex: string, mnemonic: string, accountIndex: number): Promise<string> {
  const txBytes     = hexToBytes(txHex)
  const txBodyBytes = extractTxBody(txBytes)
  const txBodyHash  = blake2b(txBodyBytes, { dkLen: 32 })
  const entropy  = mnemonicToEntropy(mnemonic, wordlist)
  const spendKey = getCardanoSpendingKey(entropy, accountIndex)

  const vkeys: Uint8Array[] = [
    cborArray([cborBytes(spendKey.pub), cborBytes(cardanoSign(txBodyHash, spendKey.kL, spendKey.kR))])
  ]

  // Marketplace cancel/accept/sell txs require the seller's STAKE key signature
  // (its key-hash is listed in required_signers / certs / withdrawals). Add that
  // witness only when the body actually references the stake key — adding it to
  // an ordinary buy/offer tx would inflate the size past the dApp's fee budget.
  // Outputs (field 1) are intentionally NOT scanned: change back to our own base
  // address embeds the stake hash and would false-positive on every tx.
  const stakeKey  = getCardanoStakeKey(entropy, accountIndex)
  const stakeHash = blake2b(stakeKey.pub, { dkLen: 28 })
  const needsStake = [14, 4, 5].some(field => {
    const v = bodyFieldBytes(txBodyBytes, field)
    return v != null && bytesContain(v, stakeHash)
  })
  if (needsStake) {
    vkeys.push(cborArray([cborBytes(stakeKey.pub), cborBytes(cardanoSign(txBodyHash, stakeKey.kL, stakeKey.kR))]))
  }

  const witnessSet = cborMap([[cborUint(0), cborArray(vkeys)]])
  return bytesToHex(witnessSet)
}

export async function cip30SignData(
  address: string, payloadHex: string, mnemonic: string, accountIndex: number
): Promise<{ signature: string; key: string }> {
  const payload   = hexToBytes(payloadHex)
  const entropy   = mnemonicToEntropy(mnemonic, wordlist)
  const spendKey  = getCardanoSpendingKey(entropy, accountIndex)
  // dApps pass the hex address we handed them (getUsedAddresses/getRewardAddresses);
  // tolerate bech32 too for internal callers.
  const addrBytes = addrToBytes(address)

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

export async function cip30SubmitTx(txHex: string, config: WalletConfig): Promise<string> {
  const bytes = new Uint8Array(hexToBytes(txHex))
  // Blockfrost first; fall back to keyless Koios /submittx if it's unreachable or
  // rejects on transport grounds, so a down primary doesn't block a dApp broadcast.
  let res: Response | null = null
  try {
    res = await blockfrostFetch('tx/submit', config, 20_000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/cbor' },
      body: bytes,
    })
  } catch { res = null }

  if (res && res.ok) return res.json()

  try {
    return await koiosSubmitTx(bytes)
  } catch (koiosErr) {
    if (res) {
      const msg = await res.text().catch(() => String(res.status))
      throw new Error(`Submit failed: ${msg}`)
    }
    throw koiosErr instanceof Error ? koiosErr : new Error('Cardano submit failed')
  }
}
