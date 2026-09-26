/**
 * cardano-plutus-data.ts — tag-preserving Plutus Data decoder (shared)
 *
 * `cardano-tx-inspect.ts`'s CBOR reader treats tags as transparent, which is the
 * right call for rendering a transaction body and the wrong one for a datum: in
 * Plutus Data the TAG is the constructor. `Some x` and `None`, `True` and
 * `False`, `SwapExactIn` and `SwapMultiRouting` differ only in their tag, so a
 * validator that reads datums through a tag-dropping decoder cannot tell a
 * receiver from a refund address. This reader keeps the constructor index.
 *
 * Deliberately hand-rolled and dependency-free, like the rest of the Cardano
 * code here, so it runs unchanged on all four targets. Every decode is total:
 * malformed or out-of-range input throws `PlutusDataError`, never returns a
 * partial value — the caller is a pre-signing check and must fail closed.
 */

export class PlutusDataError extends Error {}

export type PlutusData =
  | { kind: 'constr'; index: number; fields: PlutusData[] }
  | { kind: 'map'; entries: Array<[PlutusData, PlutusData]> }
  | { kind: 'list'; items: PlutusData[] }
  | { kind: 'int'; value: bigint }
  | { kind: 'bytes'; value: Uint8Array }

/** Nesting bound. A datum deeper than this is not an order, it is an attack on the decoder. */
const MAX_DEPTH = 64
const BREAK = Symbol('break')

interface Head { major: number; ai: number; arg: bigint; next: number }

function readHead(b: Uint8Array, off: number): Head {
  if (off >= b.length) throw new PlutusDataError('truncated datum')
  const major = b[off] >> 5
  const ai = b[off] & 0x1f
  if (ai < 24) return { major, ai, arg: BigInt(ai), next: off + 1 }
  const width = ai === 24 ? 1 : ai === 25 ? 2 : ai === 26 ? 4 : ai === 27 ? 8 : 0
  if (width === 0) {
    if (ai === 31) return { major, ai, arg: -1n, next: off + 1 }   // indefinite length / break
    throw new PlutusDataError('reserved CBOR additional info')
  }
  if (off + 1 + width > b.length) throw new PlutusDataError('truncated datum')
  let arg = 0n
  for (let i = 0; i < width; i++) arg = (arg << 8n) | BigInt(b[off + 1 + i])
  return { major, ai, arg, next: off + 1 + width }
}

function toLength(arg: bigint, b: Uint8Array): number {
  if (arg > BigInt(b.length)) throw new PlutusDataError('length exceeds datum size')
  return Number(arg)
}

function bytesFrom(b: Uint8Array, h: Head): { value: Uint8Array; next: number } {
  if (h.ai === 31) {
    // Indefinite byte string: Plutus chunks bytes longer than 64 this way.
    const parts: Uint8Array[] = []
    let pos = h.next
    for (;;) {
      if (pos >= b.length) throw new PlutusDataError('unterminated byte string')
      if (b[pos] === 0xff) { pos++; break }
      const chunk = readHead(b, pos)
      if (chunk.major !== 2 || chunk.ai === 31) throw new PlutusDataError('bad byte-string chunk')
      const len = toLength(chunk.arg, b)
      if (chunk.next + len > b.length) throw new PlutusDataError('truncated datum')
      parts.push(b.slice(chunk.next, chunk.next + len))
      pos = chunk.next + len
    }
    const total = parts.reduce((n, p) => n + p.length, 0)
    const out = new Uint8Array(total)
    let o = 0
    for (const p of parts) { out.set(p, o); o += p.length }
    return { value: out, next: pos }
  }
  const len = toLength(h.arg, b)
  if (h.next + len > b.length) throw new PlutusDataError('truncated datum')
  return { value: b.slice(h.next, h.next + len), next: h.next + len }
}

function readItems(b: Uint8Array, h: Head, depth: number, perItem: 1 | 2): { items: PlutusData[]; next: number } {
  const items: PlutusData[] = []
  let pos = h.next
  if (h.ai === 31) {
    for (;;) {
      const item = readItem(b, pos, depth + 1)
      if (item.value === BREAK) return { items, next: item.next }
      items.push(item.value)
      pos = item.next
    }
  }
  const count = toLength(h.arg, b) * perItem
  for (let i = 0; i < count; i++) {
    const item = readItem(b, pos, depth + 1)
    if (item.value === BREAK) throw new PlutusDataError('unexpected break')
    items.push(item.value)
    pos = item.next
  }
  return { items, next: pos }
}

/** Constructor tags: 121..127 → 0..6, 1280..1400 → 7..127, 102 → [index, fields]. */
function constrIndex(tag: bigint): number | null {
  if (tag >= 121n && tag <= 127n) return Number(tag - 121n)
  if (tag >= 1280n && tag <= 1400n) return Number(tag - 1280n) + 7
  if (tag === 102n) return -1
  return null
}

function readItem(b: Uint8Array, off: number, depth: number): { value: PlutusData | typeof BREAK; next: number } {
  if (depth > MAX_DEPTH) throw new PlutusDataError('datum nested too deeply')
  if (off < b.length && b[off] === 0xff) return { value: BREAK, next: off + 1 }
  const h = readHead(b, off)
  switch (h.major) {
    case 0: return { value: { kind: 'int', value: h.arg }, next: h.next }
    case 1: return { value: { kind: 'int', value: -1n - h.arg }, next: h.next }
    case 2: {
      const r = bytesFrom(b, h)
      return { value: { kind: 'bytes', value: r.value }, next: r.next }
    }
    case 4: {
      const r = readItems(b, h, depth, 1)
      return { value: { kind: 'list', items: r.items }, next: r.next }
    }
    case 5: {
      const r = readItems(b, h, depth, 2)
      if (r.items.length % 2 !== 0) throw new PlutusDataError('odd map entry count')
      const entries: Array<[PlutusData, PlutusData]> = []
      for (let i = 0; i < r.items.length; i += 2) entries.push([r.items[i], r.items[i + 1]])
      return { value: { kind: 'map', entries }, next: r.next }
    }
    case 6: {
      if (h.arg === 2n || h.arg === 3n) {
        // Bignum: the payload is a byte string holding the magnitude.
        const inner = readItem(b, h.next, depth + 1)
        if (inner.value === BREAK || inner.value.kind !== 'bytes') throw new PlutusDataError('bad bignum')
        let mag = 0n
        for (const byte of inner.value.value) mag = (mag << 8n) | BigInt(byte)
        return { value: { kind: 'int', value: h.arg === 2n ? mag : -1n - mag }, next: inner.next }
      }
      const index = constrIndex(h.arg)
      if (index == null) throw new PlutusDataError(`tag ${h.arg} is not Plutus Data`)
      const inner = readItem(b, h.next, depth + 1)
      if (inner.value === BREAK) throw new PlutusDataError('unexpected break')
      if (index === -1) {
        // General form: tag 102 [index, [fields...]].
        const v = inner.value
        if (v.kind !== 'list' || v.items.length !== 2 || v.items[0].kind !== 'int' || v.items[1].kind !== 'list') {
          throw new PlutusDataError('bad general constructor')
        }
        const idx = v.items[0].value
        if (idx < 0n || idx > 0xffffffffn) throw new PlutusDataError('constructor index out of range')
        return { value: { kind: 'constr', index: Number(idx), fields: v.items[1].items }, next: inner.next }
      }
      if (inner.value.kind !== 'list') throw new PlutusDataError('constructor fields must be a list')
      return { value: { kind: 'constr', index, fields: inner.value.items }, next: inner.next }
    }
    default:
      // Text strings, floats and simple values are not Plutus Data.
      throw new PlutusDataError(`CBOR major type ${h.major} is not Plutus Data`)
  }
}

/** Decode exactly one Plutus Data value. Trailing bytes are an error, not ignored. */
export function decodePlutusData(bytes: Uint8Array): PlutusData {
  const r = readItem(bytes, 0, 0)
  if (r.value === BREAK) throw new PlutusDataError('unexpected break')
  if (r.next !== bytes.length) throw new PlutusDataError('trailing bytes after datum')
  return r.value
}

// ── Typed accessors: each one throws rather than coercing ─────────────────────

export function asConstr(d: PlutusData, what: string, index?: number, arity?: number): PlutusData[] {
  if (d.kind !== 'constr') throw new PlutusDataError(`${what}: expected a constructor`)
  if (index != null && d.index !== index) throw new PlutusDataError(`${what}: unexpected constructor ${d.index}`)
  if (arity != null && d.fields.length !== arity) throw new PlutusDataError(`${what}: expected ${arity} fields`)
  return d.fields
}

export function asInt(d: PlutusData, what: string): bigint {
  if (d.kind !== 'int') throw new PlutusDataError(`${what}: expected an integer`)
  return d.value
}

export function asBytes(d: PlutusData, what: string, length?: number): Uint8Array {
  if (d.kind !== 'bytes') throw new PlutusDataError(`${what}: expected bytes`)
  if (length != null && d.value.length !== length) throw new PlutusDataError(`${what}: expected ${length} bytes`)
  return d.value
}

export function asList(d: PlutusData, what: string): PlutusData[] {
  if (d.kind !== 'list') throw new PlutusDataError(`${what}: expected a list`)
  return d.items
}

/** Plutus `Bool`: False = constr 0, True = constr 1, both with no fields. */
export function asBool(d: PlutusData, what: string): boolean {
  if (d.kind !== 'constr' || d.fields.length !== 0 || (d.index !== 0 && d.index !== 1)) {
    throw new PlutusDataError(`${what}: expected a Bool`)
  }
  return d.index === 1
}
