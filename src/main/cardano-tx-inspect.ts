/**
 * cardano-tx-inspect.ts — read-only Cardano transaction decoder (shared)
 *
 * Turns the raw CBOR a dApp hands us into something a human can approve. Before
 * this existed, every CIP-30 `signTx` prompt showed 200 characters of hex, which
 * is a blind sign: the user could not see the recipient, the amount, or whether
 * the transaction burned their NFTs.
 *
 * Deliberately hand-rolled and dependency-free, matching cardano-pure.ts and
 * cardano-cip30.ts. It runs unchanged on all four targets (Electron main, the
 * extension service worker, and the Android/iOS WebViews), so:
 *
 *   • Uint8Array only — no Buffer, no `node:` imports, no Electron API.
 *   • Every decode path is total: malformed input degrades to `resolution:
 *     'failed'` with the raw hex preserved. It must NEVER throw into an IPC
 *     handler, because a decoder crash would turn into "signing is broken".
 *
 * Two tiers, mirroring what Lace does:
 *   1. `inspectCardanoTx`  — stateless structural decode of the tx body.
 *   2. `summarizeCardanoTx` — resolves the inputs the wallet does NOT own (a
 *      dApp tx always references foreign UTxOs) so net balance deltas are real
 *      rather than guessed. When resolution can't complete we say so in the UI
 *      instead of showing a confident, wrong number.
 */

import { bech32, base58 } from '@scure/base'
import { blake2b } from '@noble/hashes/blake2b'
import { hexToBytes, bytesToHex, extractTxBody, bodyFieldBytes } from './cardano-cip30'
import { blockfrostFetch } from './api-proxy'
import { KOIOS_URL, TESTNET_KOIOS_URL, isTestnet } from './chain-config'
import type { WalletConfig } from './secure-store'

// ─── CBOR reader ──────────────────────────────────────────────────────────────
// cardano-cip30.ts has an encoder and a length-walker (`cborItemLen`); neither
// produces values. This is the read side: a full traversal into a value tree.

export type CborValue =
  | bigint
  | Uint8Array
  | string
  | boolean
  | null
  | CborValue[]
  | CborMap

/**
 * Order-preserving CBOR map. A plain object won't do: Cardano map keys are
 * integers (tx body) or byte strings (policy ids, reward addresses), and both
 * would collapse or stringify.
 */
export class CborMap {
  constructor(readonly entries: Array<[CborValue, CborValue]> = []) {}

  /** Lookup by integer key — the tx body, output and value maps are all int-keyed. */
  getInt(key: number): CborValue | undefined {
    for (const [k, v] of this.entries) if (typeof k === 'bigint' && k === BigInt(key)) return v
    return undefined
  }

  get size(): number { return this.entries.length }
}

export class CborError extends Error {}

/** Sentinel for the 0xff "break" byte that closes an indefinite-length item. */
const BREAK = Symbol('cbor-break')

const MAX_DEPTH = 96

interface Head { arg: bigint; next: number; indefinite: boolean }

function readHead(b: Uint8Array, off: number): Head {
  if (off >= b.length) throw new CborError('unexpected end of input')
  const ai = b[off] & 0x1f
  const need = (n: number): void => {
    if (off + n >= b.length) throw new CborError('truncated head')
  }
  if (ai < 24) return { arg: BigInt(ai), next: off + 1, indefinite: false }
  if (ai === 24) { need(1); return { arg: BigInt(b[off + 1]), next: off + 2, indefinite: false } }
  if (ai === 25) {
    need(2)
    return { arg: (BigInt(b[off + 1]) << 8n) | BigInt(b[off + 2]), next: off + 3, indefinite: false }
  }
  if (ai === 26) {
    need(4)
    let v = 0n
    for (let i = 1; i <= 4; i++) v = (v << 8n) | BigInt(b[off + i])
    return { arg: v, next: off + 5, indefinite: false }
  }
  if (ai === 27) {
    need(8)
    let v = 0n
    for (let i = 1; i <= 8; i++) v = (v << 8n) | BigInt(b[off + i])
    return { arg: v, next: off + 9, indefinite: false }
  }
  if (ai === 31) return { arg: 0n, next: off + 1, indefinite: true }
  throw new CborError(`reserved additional info ${ai}`)
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out
}

interface Decoded { value: CborValue | typeof BREAK; next: number }

function decodeItem(b: Uint8Array, off: number, depth: number): Decoded {
  if (depth > MAX_DEPTH) throw new CborError('nesting too deep')
  if (off >= b.length) throw new CborError('unexpected end of input')

  const mt = b[off] >> 5
  const head = readHead(b, off)

  switch (mt) {
    case 0:
      return { value: head.arg, next: head.next }

    case 1:
      return { value: -1n - head.arg, next: head.next }

    case 2: {
      if (head.indefinite) {
        const chunks: Uint8Array[] = []
        let pos = head.next
        for (;;) {
          const item = decodeItem(b, pos, depth + 1)
          pos = item.next
          if (item.value === BREAK) break
          if (!(item.value instanceof Uint8Array)) throw new CborError('bad byte-string chunk')
          chunks.push(item.value)
        }
        return { value: concatBytes(chunks), next: pos }
      }
      const len = Number(head.arg)
      if (head.next + len > b.length) throw new CborError('truncated byte string')
      return { value: b.slice(head.next, head.next + len), next: head.next + len }
    }

    case 3: {
      if (head.indefinite) {
        let text = ''
        let pos = head.next
        for (;;) {
          const item = decodeItem(b, pos, depth + 1)
          pos = item.next
          if (item.value === BREAK) break
          if (typeof item.value !== 'string') throw new CborError('bad text chunk')
          text += item.value
        }
        return { value: text, next: pos }
      }
      const len = Number(head.arg)
      if (head.next + len > b.length) throw new CborError('truncated text string')
      return { value: new TextDecoder().decode(b.slice(head.next, head.next + len)), next: head.next + len }
    }

    case 4: {
      const items: CborValue[] = []
      let pos = head.next
      if (head.indefinite) {
        for (;;) {
          const item = decodeItem(b, pos, depth + 1)
          pos = item.next
          if (item.value === BREAK) break
          items.push(item.value)
        }
      } else {
        const n = Number(head.arg)
        for (let i = 0; i < n; i++) {
          const item = decodeItem(b, pos, depth + 1)
          if (item.value === BREAK) throw new CborError('unexpected break in array')
          items.push(item.value)
          pos = item.next
        }
      }
      return { value: items, next: pos }
    }

    case 5: {
      const entries: Array<[CborValue, CborValue]> = []
      let pos = head.next
      if (head.indefinite) {
        for (;;) {
          const k = decodeItem(b, pos, depth + 1)
          pos = k.next
          if (k.value === BREAK) break
          const v = decodeItem(b, pos, depth + 1)
          if (v.value === BREAK) throw new CborError('unexpected break in map')
          pos = v.next
          entries.push([k.value, v.value])
        }
      } else {
        const n = Number(head.arg)
        for (let i = 0; i < n; i++) {
          const k = decodeItem(b, pos, depth + 1)
          if (k.value === BREAK) throw new CborError('unexpected break in map')
          const v = decodeItem(b, k.next, depth + 1)
          if (v.value === BREAK) throw new CborError('unexpected break in map')
          entries.push([k.value, v.value])
          pos = v.next
        }
      }
      return { value: new CborMap(entries), next: pos }
    }

    case 6: {
      // Tags are transparent here EXCEPT bignums, which carry the value itself.
      // Tag 258 (set) wraps the inputs/collateral/required_signers arrays in
      // Conway-era transactions — unwrapping keeps every caller shape-stable.
      const inner = decodeItem(b, head.next, depth + 1)
      if (inner.value === BREAK) throw new CborError('unexpected break after tag')
      if ((head.arg === 2n || head.arg === 3n) && inner.value instanceof Uint8Array) {
        let magnitude = 0n
        for (const byte of inner.value) magnitude = (magnitude << 8n) | BigInt(byte)
        return { value: head.arg === 2n ? magnitude : -1n - magnitude, next: inner.next }
      }
      return { value: inner.value, next: inner.next }
    }

    case 7: {
      const ai = b[off] & 0x1f
      if (ai === 20) return { value: false, next: head.next }
      if (ai === 21) return { value: true, next: head.next }
      if (ai === 22 || ai === 23) return { value: null, next: head.next }
      if (ai === 31) return { value: BREAK, next: off + 1 }
      // Floats: Cardano bodies don't use them, but skipping cleanly beats
      // aborting the whole decode over one unexpected field.
      if (ai === 25) return { value: null, next: off + 3 }
      if (ai === 26) return { value: null, next: off + 5 }
      if (ai === 27) return { value: null, next: off + 9 }
      return { value: null, next: head.next }
    }

    default:
      throw new CborError(`unsupported major type ${mt}`)
  }
}

/** Decode one complete CBOR item. Throws `CborError` on malformed input. */
export function decodeCbor(bytes: Uint8Array): CborValue {
  const { value } = decodeItem(bytes, 0, 0)
  if (value === BREAK) throw new CborError('unexpected break at top level')
  return value
}

// ─── Address + asset presentation ─────────────────────────────────────────────

/**
 * Raw address bytes → the bech32 form users recognise. The header's high nibble
 * is the address type and the low nibble is the network (0 = testnet), which is
 * what picks addr/addr_test/stake/stake_test.
 */
export function encodeCardanoAddress(bytes: Uint8Array): string {
  if (bytes.length === 0) return ''
  const header = bytes[0]
  const type = header >> 4
  const testnet = (header & 0x0f) === 0

  // Type 8 is Byron/bootstrap: a CBOR structure shown in base58, not bech32.
  if (type === 8) {
    try { return base58.encode(bytes) } catch { return bytesToHex(bytes) }
  }
  const hrp = type === 14 || type === 15
    ? (testnet ? 'stake_test' : 'stake')
    : (testnet ? 'addr_test' : 'addr')
  try {
    return bech32.encode(hrp, bech32.toWords(bytes), 1000)
  } catch {
    return bytesToHex(bytes)
  }
}

/** Middle-truncate a long address so it fits a prompt without losing the ends. */
export function shortenAddress(address: string, head = 12, tail = 8): string {
  if (address.length <= head + tail + 1) return address
  return `${address.slice(0, head)}…${address.slice(-tail)}`
}

export interface AssetAmount {
  /** policyIdHex + assetNameHex — the same `unit` form Blockfrost reports. */
  unit: string
  policy: string
  /** Asset name, hex-encoded. */
  nameHex: string
  /** Best-effort human name (UTF-8 when printable, CIP-68 label stripped). */
  name: string
  quantity: bigint
}

const CIP68_LABELS = new Set(['000643b0', '000de140', '0014df10', '001bc280'])

/**
 * Safe to show verbatim? Control characters are rejected: a payload containing
 * CR or ANSI escapes could otherwise forge extra lines in the approval prompt
 * and misrepresent what is being signed.
 */
function isPrintable(text: string): boolean {
  if (text.length === 0) return false
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false
  }
  return true
}

/**
 * Same rule, but newlines and tabs are allowed — CIP-30 login challenges are
 * routinely multi-line. CR stays banned so a payload cannot overwrite a line
 * that has already been drawn.
 */
function isReadableMessage(text: string): boolean {
  if (text.length === 0) return false
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code === 0x0a || code === 0x09) continue
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false
  }
  return true
}

/** Asset name for display: UTF-8 when it is printable, else a short hex form. */
export function assetDisplayName(policy: string, nameHex: string): string {
  let hex = nameHex
  // CIP-68 prefixes a 4-byte label (reference/user/… token class) to the name.
  if (hex.length >= 8 && CIP68_LABELS.has(hex.slice(0, 8))) hex = hex.slice(8)
  if (hex.length === 0) return `${policy.slice(0, 8)}… (no name)`
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(hexToBytes(hex))
    if (isPrintable(text)) return text
  } catch { /* not UTF-8 — fall through to hex */ }
  return `${policy.slice(0, 8)}…${hex.slice(0, 8)}`
}

function makeAsset(policy: string, nameHex: string, quantity: bigint): AssetAmount {
  return { unit: policy + nameHex, policy, nameHex, name: assetDisplayName(policy, nameHex), quantity }
}

/** CIP-14 asset fingerprint (`asset1…`) — the id explorers show. */
export function assetFingerprint(policy: string, nameHex: string): string {
  try {
    const digest = blake2b(hexToBytes(policy + nameHex), { dkLen: 20 })
    return bech32.encode('asset', bech32.toWords(digest), 1000)
  } catch {
    return ''
  }
}

// ─── Value / output decoding ──────────────────────────────────────────────────

export interface DecodedValue {
  lovelace: bigint
  assets: AssetAmount[]
}

const EMPTY_VALUE: DecodedValue = { lovelace: 0n, assets: [] }

/** `coin` or `[coin, {policy => {name => qty}}]`. */
function decodeValue(value: CborValue | undefined): DecodedValue {
  if (typeof value === 'bigint') return { lovelace: value, assets: [] }
  if (!Array.isArray(value) || value.length === 0) return { ...EMPTY_VALUE }

  const lovelace = typeof value[0] === 'bigint' ? value[0] : 0n
  const assets: AssetAmount[] = []
  const multiasset = value[1]
  if (multiasset instanceof CborMap) {
    for (const [policyKey, nameMap] of multiasset.entries) {
      if (!(policyKey instanceof Uint8Array) || !(nameMap instanceof CborMap)) continue
      const policy = bytesToHex(policyKey)
      for (const [nameKey, qty] of nameMap.entries) {
        if (!(nameKey instanceof Uint8Array) || typeof qty !== 'bigint') continue
        assets.push(makeAsset(policy, bytesToHex(nameKey), qty))
      }
    }
  }
  return { lovelace, assets }
}

export interface DecodedOutput {
  addressBytes: Uint8Array
  address: string
  value: DecodedValue
  hasDatum: boolean
  hasScriptRef: boolean
}

/** Legacy array output `[addr, value, ?datumHash]` or Babbage map output. */
function decodeOutput(item: CborValue): DecodedOutput | null {
  let addressBytes: Uint8Array | null = null
  let rawValue: CborValue | undefined
  let hasDatum = false
  let hasScriptRef = false

  if (Array.isArray(item)) {
    if (!(item[0] instanceof Uint8Array)) return null
    addressBytes = item[0]
    rawValue = item[1]
    hasDatum = item.length > 2 && item[2] != null
  } else if (item instanceof CborMap) {
    const addr = item.getInt(0)
    if (!(addr instanceof Uint8Array)) return null
    addressBytes = addr
    rawValue = item.getInt(1)
    hasDatum = item.getInt(2) !== undefined
    hasScriptRef = item.getInt(3) !== undefined
  } else {
    return null
  }

  return {
    addressBytes,
    address: encodeCardanoAddress(addressBytes),
    value: decodeValue(rawValue),
    hasDatum,
    hasScriptRef,
  }
}

// ─── Certificates ─────────────────────────────────────────────────────────────

export interface DecodedCertificate {
  type: number
  label: string
  /** False for anything we don't recognise — the UI must warn rather than hide it. */
  known: boolean
  detail?: string
}

const CERTIFICATE_LABELS: Record<number, string> = {
  0:  'Register stake key',
  1:  'Deregister stake key',
  2:  'Delegate stake to a pool',
  3:  'Register stake pool',
  4:  'Retire stake pool',
  5:  'Genesis key delegation',
  6:  'Move instantaneous rewards',
  7:  'Register stake key (with deposit)',
  8:  'Deregister stake key (refund deposit)',
  9:  'Delegate voting power to a DRep',
  10: 'Delegate stake to a pool and voting power to a DRep',
  11: 'Register stake key and delegate to a pool',
  12: 'Register stake key and delegate voting power',
  13: 'Register stake key, delegate to a pool and to a DRep',
  14: 'Authorize committee hot key',
  15: 'Resign committee cold key',
  16: 'Register as a DRep',
  17: 'Retire as a DRep',
  18: 'Update DRep details',
}

/** Deposit-bearing certificates carry the amount as their last integer field. */
function certificateDetail(type: number, fields: CborValue[]): string | undefined {
  if (type === 2 && fields[2] instanceof Uint8Array) {
    return `Pool ${shortenAddress(encodePoolId(fields[2]), 10, 6)}`
  }
  if ((type === 7 || type === 8 || type === 16 || type === 17) && typeof fields[2] === 'bigint') {
    return `${formatAda(fields[2])} ADA deposit`
  }
  return undefined
}

function encodePoolId(hash: Uint8Array): string {
  try { return bech32.encode('pool', bech32.toWords(hash), 1000) } catch { return bytesToHex(hash) }
}

function decodeCertificates(value: CborValue | undefined): DecodedCertificate[] {
  if (!Array.isArray(value)) return []
  return value.map((entry): DecodedCertificate => {
    if (!Array.isArray(entry) || typeof entry[0] !== 'bigint') {
      return { type: -1, label: 'Unrecognised certificate', known: false }
    }
    const type = Number(entry[0])
    const label = CERTIFICATE_LABELS[type]
    // Never render an unknown certificate as nothing — an undecodable action is
    // exactly the case where the user most needs to be told to be careful.
    if (!label) return { type, label: `Unrecognised certificate (type ${type})`, known: false }
    return { type, label, known: true, detail: certificateDetail(type, entry) }
  })
}

// ─── Transaction body ─────────────────────────────────────────────────────────

export interface TxInputRef {
  txHash: string
  index: number
}

export interface DecodedTxBody {
  inputs: TxInputRef[]
  outputs: DecodedOutput[]
  fee: bigint
  ttl?: bigint
  validityStart?: bigint
  certificates: DecodedCertificate[]
  withdrawals: Array<{ rewardAddress: string; rewardAddressBytes: Uint8Array; lovelace: bigint }>
  mint: AssetAmount[]
  collateral: TxInputRef[]
  referenceInputs: TxInputRef[]
  requiredSigners: Uint8Array[]
  collateralReturn?: DecodedOutput
  totalCollateral?: bigint
  scriptDataHash?: Uint8Array
  auxDataHash?: Uint8Array
  networkId?: number
  donation?: bigint
  votingProcedureCount: number
  proposalProcedureCount: number
  /** Body keys we don't decode — surfaced so the UI can admit what it omitted. */
  unknownFields: number[]
}

const KNOWN_BODY_FIELDS = new Set([0, 1, 2, 3, 4, 5, 7, 8, 9, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22])

function decodeInputs(value: CborValue | undefined): TxInputRef[] {
  if (!Array.isArray(value)) return []
  const out: TxInputRef[] = []
  for (const entry of value) {
    if (!Array.isArray(entry) || !(entry[0] instanceof Uint8Array) || typeof entry[1] !== 'bigint') continue
    out.push({ txHash: bytesToHex(entry[0]), index: Number(entry[1]) })
  }
  return out
}

function decodeMint(value: CborValue | undefined): AssetAmount[] {
  if (!(value instanceof CborMap)) return []
  const out: AssetAmount[] = []
  for (const [policyKey, nameMap] of value.entries) {
    if (!(policyKey instanceof Uint8Array) || !(nameMap instanceof CborMap)) continue
    const policy = bytesToHex(policyKey)
    for (const [nameKey, qty] of nameMap.entries) {
      if (!(nameKey instanceof Uint8Array) || typeof qty !== 'bigint') continue
      out.push(makeAsset(policy, bytesToHex(nameKey), qty))
    }
  }
  return out
}

/**
 * Structural decode of a transaction body. Stateless — it knows nothing about
 * which addresses the wallet owns; `summarizeCardanoTx` layers that on top.
 */
export function decodeTxBody(bodyBytes: Uint8Array): DecodedTxBody {
  const body = decodeCbor(bodyBytes)
  if (!(body instanceof CborMap)) throw new CborError('transaction body is not a map')

  const outputsRaw = body.getInt(1)
  const outputs: DecodedOutput[] = []
  if (Array.isArray(outputsRaw)) {
    for (const item of outputsRaw) {
      const decoded = decodeOutput(item)
      if (decoded) outputs.push(decoded)
    }
  }

  const withdrawalsRaw = body.getInt(5)
  const withdrawals: DecodedTxBody['withdrawals'] = []
  if (withdrawalsRaw instanceof CborMap) {
    for (const [addr, coin] of withdrawalsRaw.entries) {
      if (!(addr instanceof Uint8Array) || typeof coin !== 'bigint') continue
      withdrawals.push({ rewardAddress: encodeCardanoAddress(addr), rewardAddressBytes: addr, lovelace: coin })
    }
  }

  const requiredSignersRaw = body.getInt(14)
  const requiredSigners = Array.isArray(requiredSignersRaw)
    ? requiredSignersRaw.filter((s): s is Uint8Array => s instanceof Uint8Array)
    : []

  const collateralReturnRaw = body.getInt(16)
  const votingRaw = body.getInt(19)
  const proposalRaw = body.getInt(20)

  const unknownFields: number[] = []
  for (const [key] of body.entries) {
    if (typeof key === 'bigint' && !KNOWN_BODY_FIELDS.has(Number(key))) unknownFields.push(Number(key))
  }

  const asBig = (v: CborValue | undefined): bigint | undefined => (typeof v === 'bigint' ? v : undefined)
  const asBytes = (v: CborValue | undefined): Uint8Array | undefined => (v instanceof Uint8Array ? v : undefined)

  return {
    inputs: decodeInputs(body.getInt(0)),
    outputs,
    fee: asBig(body.getInt(2)) ?? 0n,
    ttl: asBig(body.getInt(3)),
    validityStart: asBig(body.getInt(8)),
    certificates: decodeCertificates(body.getInt(4)),
    withdrawals,
    mint: decodeMint(body.getInt(9)),
    collateral: decodeInputs(body.getInt(13)),
    referenceInputs: decodeInputs(body.getInt(18)),
    requiredSigners,
    collateralReturn: collateralReturnRaw !== undefined ? decodeOutput(collateralReturnRaw) ?? undefined : undefined,
    totalCollateral: asBig(body.getInt(17)),
    scriptDataHash: asBytes(body.getInt(11)),
    auxDataHash: asBytes(body.getInt(7)),
    networkId: asBig(body.getInt(15)) !== undefined ? Number(body.getInt(15)) : undefined,
    donation: asBig(body.getInt(22)),
    votingProcedureCount: votingRaw instanceof CborMap ? votingRaw.size : 0,
    proposalProcedureCount: Array.isArray(proposalRaw) ? proposalRaw.length : 0,
    unknownFields,
  }
}

// ─── Foreign input resolution ─────────────────────────────────────────────────
// The hard part. A dApp transaction spends UTxOs we don't own, so without
// resolving them the "you send" figure is a guess. Blockfrost on mainnet, Koios
// on Preprod (Blockfrost keys are network-scoped — same split as tx-sender.ts).

export interface ResolvedInput {
  address: string
  value: DecodedValue
}

const inputCache = new Map<string, Map<number, ResolvedInput>>()
const CACHE_LIMIT = 256

function cachePut(txHash: string, outputs: Map<number, ResolvedInput>): void {
  if (inputCache.size >= CACHE_LIMIT) {
    // Spent inputs are immutable, so plain FIFO eviction is safe.
    const oldest = inputCache.keys().next().value
    if (oldest !== undefined) inputCache.delete(oldest)
  }
  inputCache.set(txHash, outputs)
}

function amountsToValue(amount: Array<{ unit: string; quantity: string }>): DecodedValue {
  let lovelace = 0n
  const assets: AssetAmount[] = []
  for (const a of amount ?? []) {
    if (a.unit === 'lovelace') { lovelace += BigInt(a.quantity); continue }
    assets.push(makeAsset(a.unit.slice(0, 56), a.unit.slice(56), BigInt(a.quantity)))
  }
  return { lovelace, assets }
}

async function fetchTxOutputsBlockfrost(
  txHash: string, config: WalletConfig, timeoutMs: number
): Promise<Map<number, ResolvedInput> | null> {
  try {
    const res = await blockfrostFetch(`txs/${txHash}/utxos`, config, timeoutMs)
    if (!res.ok) return null
    const data = await res.json() as {
      outputs?: Array<{ address: string; output_index: number; amount: Array<{ unit: string; quantity: string }> }>
    }
    const map = new Map<number, ResolvedInput>()
    for (const o of data.outputs ?? []) {
      map.set(o.output_index, { address: o.address, value: amountsToValue(o.amount) })
    }
    return map
  } catch { return null }
}

async function fetchTxOutputsKoios(
  txHash: string, base: string, timeoutMs: number
): Promise<Map<number, ResolvedInput> | null> {
  try {
    const res = await fetch(`${base}/tx_info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ _tx_hashes: [txHash], _inputs: false, _assets: true }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    const rows = await res.json() as Array<{
      outputs?: Array<{
        payment_addr?: { bech32?: string }
        tx_index?: number
        value?: string
        asset_list?: Array<{ policy_id: string; asset_name: string | null; quantity: string }>
      }>
    }>
    const outputs = rows?.[0]?.outputs
    if (!Array.isArray(outputs)) return null
    const map = new Map<number, ResolvedInput>()
    for (const o of outputs) {
      if (typeof o.tx_index !== 'number') continue
      const assets = (o.asset_list ?? []).map(a =>
        makeAsset(a.policy_id, a.asset_name ?? '', BigInt(a.quantity))
      )
      map.set(o.tx_index, {
        address: o.payment_addr?.bech32 ?? '',
        value: { lovelace: BigInt(o.value ?? '0'), assets },
      })
    }
    return map
  } catch { return null }
}

/**
 * Resolve the outputs a transaction's inputs point at. Bounded concurrency and
 * a hard timeout: this runs while the user is staring at a signing prompt, so a
 * slow provider must degrade the summary rather than hang the window.
 */
export async function resolveTxInputs(
  inputs: TxInputRef[],
  config: WalletConfig,
  timeoutMs = 6_000
): Promise<{ resolved: Map<string, ResolvedInput>; complete: boolean }> {
  const resolved = new Map<string, ResolvedInput>()
  const hashes = [...new Set(inputs.map(i => i.txHash))]
  if (hashes.length === 0) return { resolved, complete: true }

  const testnet = isTestnet(config)
  const deadline = Date.now() + timeoutMs
  let complete = true

  const CONCURRENCY = 6
  let cursor = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++
      if (index >= hashes.length) return
      const txHash = hashes[index]

      let outputs = inputCache.get(txHash) ?? null
      if (!outputs) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) { complete = false; continue }
        outputs = testnet
          ? await fetchTxOutputsKoios(txHash, TESTNET_KOIOS_URL, remaining)
          : (await fetchTxOutputsBlockfrost(txHash, config, remaining)
             ?? await fetchTxOutputsKoios(txHash, KOIOS_URL, Math.max(0, deadline - Date.now())))
        if (outputs) cachePut(txHash, outputs)
      }
      if (!outputs) { complete = false; continue }

      for (const input of inputs) {
        if (input.txHash !== txHash) continue
        const hit = outputs.get(input.index)
        if (hit) resolved.set(`${input.txHash}#${input.index}`, hit)
        else complete = false
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, hashes.length) }, worker))
  return { resolved, complete }
}

/** Test seam — drops the memoised foreign-input lookups. */
export function clearTxInputCache(): void { inputCache.clear() }

// ─── Summary ──────────────────────────────────────────────────────────────────

export interface AssetDelta {
  unit: string
  name: string
  policy: string
  delta: bigint
}

export interface CardanoTxSummary {
  /** Net lovelace change for the wallet. Negative = leaving. */
  netAda: bigint
  netAssets: AssetDelta[]
  fee: bigint
  /** Outputs that are NOT ours — who is actually receiving. */
  foreignOutputs: Array<{ address: string; lovelace: bigint; assets: AssetAmount[] }>
  certificates: DecodedCertificate[]
  withdrawals: Array<{ rewardAddress: string; lovelace: bigint }>
  mintBurn: AssetAmount[]
  collateralCount: number
  totalCollateral?: bigint
  ttl?: bigint
  validityStart?: bigint
  hasScriptData: boolean
  hasMetadata: boolean
  requiresStakeWitness: boolean
  votingProcedureCount: number
  proposalProcedureCount: number
  warnings: string[]
  /**
   * 'complete' — every input resolved, deltas are exact.
   * 'partial'  — some inputs unresolved; deltas are a lower bound.
   * 'failed'   — the transaction could not be decoded at all.
   */
  resolution: 'complete' | 'partial' | 'failed'
  /** Present when resolution === 'failed'. */
  error?: string
  rawHex: string
}

export interface SummarizeOptions {
  /** Wallet addresses treated as "ours" (bech32 or hex). */
  ownAddresses: string[]
  /** Stake key hash — used to spot the extra witness cip30SignTx would add. */
  stakeKeyHash?: Uint8Array
  config: WalletConfig
  timeoutMs?: number
  /** Skip network resolution (unit tests, offline). */
  skipResolution?: boolean
}

function normalizeAddress(address: string): string {
  // Compare on bytes, not text: dApps hand back hex, our store keeps bech32.
  try {
    if (address.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(address)) return address.toLowerCase()
    const words = bech32.decode(address as `${string}1${string}`, 1000)
    return bytesToHex(bech32.fromWords(words.words))
  } catch {
    return address.toLowerCase()
  }
}

function bytesContain(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || haystack.length < needle.length) return false
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}

function addDelta(map: Map<string, AssetDelta>, asset: AssetAmount, sign: bigint): void {
  const existing = map.get(asset.unit)
  if (existing) { existing.delta += asset.quantity * sign; return }
  map.set(asset.unit, {
    unit: asset.unit, name: asset.name, policy: asset.policy, delta: asset.quantity * sign,
  })
}

/**
 * Decode a dApp transaction and work out what it does to this wallet.
 * Never throws: a decode failure comes back as `resolution: 'failed'`.
 */
export async function summarizeCardanoTx(
  txHex: string,
  opts: SummarizeOptions
): Promise<CardanoTxSummary> {
  const base: CardanoTxSummary = {
    netAda: 0n, netAssets: [], fee: 0n, foreignOutputs: [], certificates: [], withdrawals: [],
    mintBurn: [], collateralCount: 0, hasScriptData: false, hasMetadata: false,
    requiresStakeWitness: false, votingProcedureCount: 0, proposalProcedureCount: 0,
    warnings: [], resolution: 'failed', rawHex: txHex,
  }

  let body: DecodedTxBody
  let bodyBytes: Uint8Array
  try {
    bodyBytes = extractTxBody(hexToBytes(txHex))
    body = decodeTxBody(bodyBytes)
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) }
  }

  const ownSet = new Set(opts.ownAddresses.filter(Boolean).map(normalizeAddress))
  const isOwn = (addressBytes: Uint8Array): boolean => ownSet.has(bytesToHex(addressBytes))

  // Outputs credited to us, and everything else the transaction pays out.
  const deltas = new Map<string, AssetDelta>()
  let netAda = 0n
  const foreignOutputs: CardanoTxSummary['foreignOutputs'] = []

  for (const out of body.outputs) {
    if (isOwn(out.addressBytes)) {
      netAda += out.value.lovelace
      for (const asset of out.value.assets) addDelta(deltas, asset, 1n)
    } else {
      foreignOutputs.push({ address: out.address, lovelace: out.value.lovelace, assets: out.value.assets })
    }
  }

  // Inputs we own are money leaving. Unresolved inputs are the reason a summary
  // can only ever be a lower bound — say so rather than implying precision.
  let resolution: 'complete' | 'partial' = 'complete'
  if (!opts.skipResolution && body.inputs.length > 0) {
    const { resolved, complete } = await resolveTxInputs(body.inputs, opts.config, opts.timeoutMs)
    if (!complete) resolution = 'partial'
    for (const input of body.inputs) {
      const hit = resolved.get(`${input.txHash}#${input.index}`)
      if (!hit) continue
      if (!hit.address || !ownSet.has(normalizeAddress(hit.address))) continue
      netAda -= hit.value.lovelace
      for (const asset of hit.value.assets) addDelta(deltas, asset, -1n)
    }
  } else if (body.inputs.length > 0) {
    resolution = 'partial'
  }

  for (const w of body.withdrawals) netAda += w.lovelace

  const netAssets = [...deltas.values()].filter(d => d.delta !== 0n)

  // Deliberately the SAME scan cip30SignTx uses to decide whether to attach the
  // stake witness (body fields 14/4/5, outputs excluded to avoid false-positives
  // on change). Reusing bodyFieldBytes keeps the prompt honest — if these two
  // ever disagreed, the summary would be describing a different signature than
  // the one actually produced.
  const requiresStakeWitness = opts.stakeKeyHash
    ? [14, 4, 5].some(field => {
        const raw = bodyFieldBytes(bodyBytes, field)
        return raw != null && bytesContain(raw, opts.stakeKeyHash!)
      })
    : false

  const warnings: string[] = []
  if (body.mint.length > 0) {
    const minting = body.mint.some(a => a.quantity > 0n)
    const burning = body.mint.some(a => a.quantity < 0n)
    warnings.push(
      minting && burning ? 'This transaction mints and burns assets'
      : minting ? 'This transaction mints new assets'
      : 'This transaction burns assets — burned assets cannot be recovered'
    )
  }
  if (body.collateral.length > 0) {
    const at = body.totalCollateral ? ` (up to ${formatAda(body.totalCollateral)} ADA)` : ''
    warnings.push(`Uses collateral${at} — a script failure can cost you that ADA`)
  }
  if (body.certificates.length > 0) warnings.push('Includes staking or governance certificates')
  if (body.certificates.some(c => !c.known)) warnings.push('Contains a certificate this wallet cannot decode')
  if (body.withdrawals.length > 0) warnings.push('Withdraws staking rewards')
  if (requiresStakeWitness) warnings.push('Also signs with your stake key')
  if (body.votingProcedureCount > 0) warnings.push('Casts governance votes')
  if (body.proposalProcedureCount > 0) warnings.push('Submits a governance proposal')
  if (body.unknownFields.length > 0) {
    warnings.push(`Contains transaction fields this wallet cannot decode (${body.unknownFields.join(', ')})`)
  }
  if (resolution === 'partial') {
    warnings.push('Could not verify every input — amounts shown may be incomplete')
  }

  return {
    netAda,
    netAssets,
    fee: body.fee,
    foreignOutputs,
    certificates: body.certificates,
    withdrawals: body.withdrawals.map(w => ({ rewardAddress: w.rewardAddress, lovelace: w.lovelace })),
    mintBurn: body.mint,
    collateralCount: body.collateral.length,
    totalCollateral: body.totalCollateral,
    ttl: body.ttl,
    validityStart: body.validityStart,
    hasScriptData: body.scriptDataHash !== undefined,
    hasMetadata: body.auxDataHash !== undefined,
    requiresStakeWitness,
    votingProcedureCount: body.votingProcedureCount,
    proposalProcedureCount: body.proposalProcedureCount,
    warnings,
    resolution,
    rawHex: txHex,
  }
}

// ─── Presentation ─────────────────────────────────────────────────────────────

/** Lovelace → ADA, trailing zeros trimmed. */
export function formatAda(lovelace: bigint): string {
  const negative = lovelace < 0n
  const abs = negative ? -lovelace : lovelace
  const whole = abs / 1_000_000n
  const frac = (abs % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`
}

function signed(value: bigint, formatted: string): string {
  return value > 0n ? `+${formatted}` : formatted
}

function formatQuantity(value: bigint): string {
  const negative = value < 0n
  const abs = (negative ? -value : value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${abs}`
}

export interface FormatOptions {
  /**
   * Append the ⚠ warning lines. Leave on when the caller renders one plain
   * string (the extension/mobile overlay, which splits them back out); turn it
   * OFF when the caller already renders `summary.warnings` in its own band, or
   * the user sees every warning twice.
   */
  includeWarnings?: boolean
}

/**
 * One plain-text block describing the transaction. Deliberately a string rather
 * than structured rows: the Electron approval window, the extension overlay and
 * both mobile WebViews all render it, so this is the single source of truth for
 * what the user is told. Electron layers a styled warning band on top.
 */
export function formatCardanoTxSummary(
  summary: CardanoTxSummary, opts: FormatOptions = {}
): string {
  const { includeWarnings = true } = opts
  if (summary.resolution === 'failed') {
    return [
      'This transaction could not be decoded.',
      'Only continue if you fully trust this site.',
      summary.error ? `\nReason: ${summary.error}` : '',
      `\nRaw transaction:\n${summary.rawHex.slice(0, 400)}${summary.rawHex.length > 400 ? '…' : ''}`,
    ].filter(Boolean).join('\n')
  }

  const lines: string[] = []
  const pad = (label: string): string => label.padEnd(16, ' ')

  if (summary.netAda !== 0n) {
    lines.push(`${pad(summary.netAda < 0n ? 'You send' : 'You receive')}${signed(summary.netAda, formatAda(summary.netAda))} ADA`)
  }

  const outgoing = summary.netAssets.filter(a => a.delta < 0n)
  const incoming = summary.netAssets.filter(a => a.delta > 0n)
  for (const asset of outgoing) {
    lines.push(`${pad(lines.length === 0 ? 'You send' : '')}${formatQuantity(asset.delta)} ${asset.name}`)
  }
  for (const asset of incoming) {
    lines.push(`${pad('')}+${formatQuantity(asset.delta)} ${asset.name}`)
  }

  if (lines.length === 0) lines.push(`${pad('Balance change')}None detected`)

  lines.push(`${pad('Fee')}${formatAda(summary.fee)} ADA`)

  const recipients = summary.foreignOutputs.filter(o => o.lovelace > 0n || o.assets.length > 0)
  if (recipients.length === 1) {
    lines.push(`${pad('To')}${shortenAddress(recipients[0].address)}`)
  } else if (recipients.length > 1) {
    lines.push(`${pad('To')}${recipients.length} addresses (not your wallet)`)
    for (const r of recipients.slice(0, 3)) {
      lines.push(`${pad('')}${shortenAddress(r.address)} — ${formatAda(r.lovelace)} ADA`)
    }
    if (recipients.length > 3) lines.push(`${pad('')}…and ${recipients.length - 3} more`)
  }

  for (const cert of summary.certificates) {
    lines.push(`${pad('Certificate')}${cert.label}${cert.detail ? ` — ${cert.detail}` : ''}`)
  }
  for (const w of summary.withdrawals) {
    lines.push(`${pad('Withdraw')}${formatAda(w.lovelace)} ADA from ${shortenAddress(w.rewardAddress)}`)
  }
  for (const asset of summary.mintBurn) {
    lines.push(`${pad(asset.quantity < 0n ? 'Burn' : 'Mint')}${formatQuantity(asset.quantity)} ${asset.name}`)
  }

  if (includeWarnings && summary.warnings.length > 0) {
    lines.push('')
    for (const warning of summary.warnings) lines.push(`⚠ ${warning}`)
  }

  return lines.join('\n')
}

/**
 * CIP-30 signData payloads are usually a login challenge. Show the text when it
 * is genuinely text — a readable message is the whole point of the prompt — and
 * be explicit when it isn't rather than dressing hex up as a message.
 */
export function formatSignDataPayload(payloadHex: string): string {
  let text: string | null = null
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(hexToBytes(payloadHex))
    if (isReadableMessage(decoded)) text = decoded
  } catch { /* not UTF-8 */ }

  if (text) return `Message:\n${text}`
  return [
    'This payload is not readable text — you cannot verify what it says.',
    'Only continue if you fully trust this site.',
    `\nRaw data:\n${payloadHex.slice(0, 400)}${payloadHex.length > 400 ? '…' : ''}`,
  ].join('\n')
}
