/**
 * xreserve-cardano-mint-proof.ts — did Circle's attested deposit become USDCx
 * at the approved Cardano address? (pure, read-only)
 *
 * PROOF PARSING ONLY. No network, no polling, no quote, no signing. The caller
 * supplies what it fetched — Circle's attestation response for the Ethereum
 * source transaction, the Cardano transaction's CBOR and (optionally) an
 * indexer's view of its outputs — and this decides whether that evidence
 * PROVES the mint. Anything malformed, incomplete or ambiguous is UNVERIFIED.
 *
 * What counts as proof, all of it required:
 *
 *   1. Circle's attestation targets Cardano (remote domain 10004), in the
 *      response AND inside the attested payload, which is parsed by Circle's
 *      published DepositIntent layout (circlefin/evm-xreserve-contracts
 *      src/lib/DepositIntent.sol) and must hash (keccak-256) to the response's
 *      messageHash. Its amount, Cardano recipient credential and local token
 *      must be the user-approved amount, the approved address's payment
 *      credential and Ethereum USDC.
 *   2. The COMPLETE payload and 65-byte signature occur as ADJACENT byte strings
 *      inside the Plutus data of a redeemer that authorizes the mint:
 *        • a MINT redeemer for the USDCx policy, or
 *        • a REWARD redeemer for a zero-lovelace withdrawal from a SCRIPT stake
 *          credential in the same transaction (the "withdraw-zero" pattern) —
 *          measured 2026-09-27 on the public mint 24da9d4f…: its mint redeemers
 *          are empty constructors and the attestation pair is carried here.
 *      A match in metadata, a datum, another redeemer purpose, or as a raw
 *      substring of the CBOR is not evidence.
 *   3. The transaction mints the pinned USDCx asset in EXACTLY the amount of
 *      Circle's attested DepositIntent, and is marked valid (a
 *      phase-2-failed transaction mints nothing). Equality is this wallet's
 *      conservative rule, supported by the public fixture — NOT a claim that
 *      Circle or IOG mandates it. A legitimate mint that differs (e.g. one
 *      that nets a fee out of the minted amount) reports UNVERIFIED until that
 *      fee behaviour is documented.
 *   4. Outputs pay USDCx to the EXACT approved address (full address bytes,
 *      not just the payment credential), and 0 < credited <= minted: a credit
 *      larger than the mint would have to come from other inputs, so it is not
 *      evidence of this mint. The credit and its difference from the source
 *      amount (never negative when verified) are REPORTED; the difference is
 *      not called a fee.
 *
 * TWO STEPS, TYPED OUTCOMES: `validateXReserveAttestation` checks Circle's
 * response against the approval once; `evaluateMintCandidate` then classifies
 * one transaction as verified, unrelated, evidence-unreadable, failed-attempt
 * (carries the attestation but failed phase-2 validation) or mint-conflict
 * (carries the attestation, but the mint or the credit is wrong). Callers
 * branch on those codes; the `reason` strings are only for people.
 *
 * WHAT THIS DOES NOT PROVE: chain inclusion. This is a pure check of the
 * CONSISTENCY of the evidence it is handed. The transaction id is recomputed
 * from the supplied CBOR and must equal the one claimed, and indexer outputs,
 * when supplied, must agree with the CBOR exactly — but a caller can supply
 * CBOR for a transaction that was never submitted, or was rolled back. An
 * online status reader must obtain the CBOR (and the outputs) for a Cardano
 * transaction it has itself confirmed on chain, at an adequate depth, before a
 * `verified` result here means the user holds the USDCx.
 */

import { blake2b } from '@noble/hashes/blake2b'
import { keccak256, type Hex } from 'viem'
import { decodeCbor, CborMap, type CborValue } from './cardano-tx-inspect'
import { decodePlutusData, type PlutusData } from './cardano-plutus-data'
import { hexToBytesStrict, CardanoSwapValidationError } from './cardano-swap-validate'
import { decodeCardanoAddress } from './cardano-pure'
import { encodeCardanoRecipient, XReserveCardanoError } from './xreserve-cardano-deposit'
import { xreserveNetwork, xreserveNetworkById, type XReserveNetwork, type XReserveNetworkId } from './xreserve-network'

export const CARDANO_REMOTE_DOMAIN = 10004

/** Conway redeemer purposes (CDDL `redeemer_tag`). */
const REDEEMER_TAG = { spend: 0, mint: 1, cert: 2, reward: 3, vote: 4, propose: 5 } as const

/** Circle's DepositIntent layout (DepositIntent.sol), big-endian. */
const DI = {
  magic: '5a2e0acd', version: 1,
  amount: 8, remoteDomain: 40, remoteToken: 44, remoteRecipient: 76, localToken: 108,
  localDepositor: 140, maxFee: 172, nonce: 204, hookLength: 236, hookData: 240,
} as const

export interface DepositIntentFields {
  amountRaw: string
  remoteDomain: number
  remoteToken: string
  remoteRecipient: string
  localToken: string
  localDepositor: string
  maxFeeRaw: string
  nonce: string
  hookData: string
}

export interface MintProofInput {
  /** Circle's `GET /v1/attestations?txHash=` JSON for the Ethereum source transaction. */
  attestationResponse: unknown
  cardanoTx: { txHash: string; cbor: string }
  /** Optional indexer view of the Cardano outputs; must match the CBOR exactly when given. */
  cardanoOutputs?: Array<{ index: number; address: string; lovelace: string; assets: Array<{ unit: string; quantity: string }> }>
  approved: { recipient: string; amountRaw: bigint | string }
  /** xReserve network profile; mainnet when omitted. */
  network?: XReserveNetwork
}

export type MintProof =
  | {
    verified: true
    messageHash: string
    remoteDomain: number
    depositIntent: DepositIntentFields
    /** Which redeemer carried Circle's payload and signature. */
    attestationCarrier: 'mint-redeemer' | 'withdraw-zero-redeemer'
    cardanoTxHash: string
    mintedRaw: string
    creditedRaw: string
    recipientOutputIndexes: number[]
    /** source amount − credit, signed. An observation, not a fee claim. */
    sourceMinusCreditedRaw: string
  }
  | { verified: false; code: MintFailureCode; reason: string }

/** Every way a proof can fail, as a code — see `validateXReserveAttestation` and `evaluateMintCandidate`. */
export type MintFailureCode =
  | AttestationFailureCode
  | MintConflictCode
  | 'unrelated' | 'evidence-unreadable' | 'failed-attempt'

// ── Typed outcomes ────────────────────────────────────────────────────────────
//
// Control flow — here and in the locator — runs on these codes. The `reason`
// strings are for people and may change freely.

/** Why Circle's attestation cannot be used for the approved deposit. */
export type AttestationFailureCode =
  /** The caller's approved recipient or amount is unusable. */
  | 'invalid-approval'
  /** Circle has not attested the deposit yet (empty list). */
  | 'attestation-missing'
  /** The response is not a well-formed attestation (shape, hex, lengths, DepositIntent layout). */
  | 'attestation-malformed'
  /** A well-formed attestation that contradicts the approved deposit, or is ambiguous. */
  | 'attestation-mismatch'

/** A candidate that carries Circle's attestation in a qualifying redeemer, but does not mint as approved. */
export type MintConflictCode =
  /** The pair rides in a withdrawal redeemer that cannot be matched to one withdrawal. */
  | 'carrier-ambiguous'
  /** No positive USDCx mint. */
  | 'no-usdcx-mint'
  /** USDCx minted in a different quantity than attested. */
  | 'mint-amount-mismatch'
  /** No USDCx paid to the exact approved address. */
  | 'no-recipient-credit'
  /** More USDCx credited than minted, or than the approved deposit. */
  | 'excess-recipient-credit'

export interface ValidatedAttestation {
  payload: string
  signature: string
  messageHash: string
  remoteDomain: number
  intent: DepositIntentFields
  approvedAmount: bigint
  recipientAddress: string
  /**
   * The xReserve network this attestation was validated for. Candidates are
   * judged on the SAME network (USDCx unit, reward-address network), so a
   * validated attestation can never be matched against another network's mint.
   */
  network: XReserveNetworkId
}

export type AttestationCheck =
  | { ok: true; attestation: ValidatedAttestation }
  | { ok: false; code: AttestationFailureCode; reason: string }

export type VerifiedMintProof = Extract<MintProof, { verified: true }>

export type CandidateOutcome =
  /** Carries the attestation, valid, mints exactly the attested USDCx and credits the approved address. */
  | { kind: 'verified'; proof: VerifiedMintProof }
  /** No qualifying redeemer carries the attestation: not this deposit's mint. */
  | { kind: 'unrelated'; reason: string }
  /** The provider's data is unreadable or inconsistent: judge the same candidate again later. */
  | { kind: 'evidence-unreadable'; reason: string }
  /** Carries the attestation, but failed phase-2 validation: an unsuccessful attempt, not a mint and not a refund. */
  | { kind: 'failed-attempt'; reason: string }
  /** Carries the attestation, but the mint or the credit is wrong. Needs review. */
  | { kind: 'mint-conflict'; code: MintConflictCode; reason: string; mintedRaw: string | null; creditedRaw: string }

class Stop extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}
const stop = (code: string, why: string): never => { throw new Stop(code, why) }
const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

// ── 1. Circle's attestation ───────────────────────────────────────────────────

/**
 * Check Circle's attestation against the user's approval, without any Cardano
 * transaction. Never throws.
 */
export function validateXReserveAttestation(
  response: unknown, approved: { recipient: string; amountRaw: bigint | string }, network?: XReserveNetwork,
): AttestationCheck {
  try {
    let net: XReserveNetwork
    try { net = xreserveNetwork(network) } catch { return stop('invalid-approval', 'unknown xReserve network') }
    let recipient
    try { recipient = encodeCardanoRecipient(approved?.recipient, net) } catch (e) {
      if (e instanceof XReserveCardanoError) stop('invalid-approval', `approved recipient: ${e.message}`)
      throw e
    }
    const amount = approved.amountRaw
    const approvedAmount = typeof amount === 'bigint' ? amount
      : typeof amount === 'string' && /^(0|[1-9][0-9]*)$/.test(amount) ? BigInt(amount) : stop('invalid-approval', 'approved amount is not an integer')
    if (approvedAmount <= 0n) stop('invalid-approval', 'approved amount is not positive')

    if (!response || typeof response !== 'object') stop('attestation-malformed', 'Circle attestation response is missing')
    const list = (response as { attestations?: unknown }).attestations
    if (!Array.isArray(list)) stop('attestation-malformed', 'Circle attestation response has no attestation list')
    if ((list as unknown[]).length === 0) stop('attestation-missing', 'Circle returned no attestation for the source transaction')
    // Several deposits in one source transaction: which one is ours is not guessed.
    if ((list as unknown[]).length !== 1) stop('attestation-mismatch', 'Circle returned more than one attestation; the evidence is ambiguous')
    const a = (list as unknown[])[0] as Record<string, unknown>
    if (!a || typeof a !== 'object') stop('attestation-malformed', 'Circle attestation entry is malformed')
    const hexStr = (v: unknown, what: string, bytes?: number): string => {
      if (typeof v !== 'string' || !/^0x([0-9a-fA-F]{2})+$/.test(v)) return stop('attestation-malformed', `attestation ${what} is not hex`)
      const h = v.slice(2).toLowerCase()
      if (bytes != null && h.length !== bytes * 2) stop('attestation-malformed', `attestation ${what} is not ${bytes} bytes`)
      return h
    }
    if (typeof a.remoteDomain !== 'number' || !Number.isInteger(a.remoteDomain)) stop('attestation-malformed', 'attestation remoteDomain is missing')
    const payload = hexStr(a.payload, 'payload')
    const signature = hexStr(a.attestation, 'signature', 65)
    const messageHash = hexStr(a.messageHash, 'messageHash', 32)
    const remoteDomain = a.remoteDomain as number

    if (remoteDomain !== CARDANO_REMOTE_DOMAIN) stop('attestation-mismatch', `attestation targets domain ${remoteDomain}, not Cardano`)
    if (keccak256(`0x${payload}` as Hex).slice(2) !== messageHash) stop('attestation-mismatch', 'attestation messageHash does not match its payload')
    const intent = parseDepositIntent(payload)
    if (intent.remoteDomain !== CARDANO_REMOTE_DOMAIN) stop('attestation-mismatch', 'the attested payload does not target Cardano')
    if (BigInt(intent.amountRaw) !== approvedAmount) stop('attestation-mismatch', 'the attested amount is not the approved amount')
    if (`0x${intent.remoteRecipient}` !== recipient.remoteRecipient.toLowerCase()) {
      stop('attestation-mismatch', 'the attested recipient is not the approved address\'s payment credential')
    }
    if (intent.localToken !== net.ethereum.usdc.slice(2).toLowerCase().padStart(64, '0')) {
      stop('attestation-mismatch', `the attested deposit is not ${net.ethereum.name} USDC`)
    }
    return {
      ok: true,
      attestation: { payload, signature, messageHash, remoteDomain, intent, approvedAmount, recipientAddress: recipient.address, network: net.id },
    }
  } catch (e) {
    if (e instanceof Stop) return { ok: false, code: e.code as AttestationFailureCode, reason: e.message }
    return { ok: false, code: 'attestation-malformed', reason: `attestation could not be read: ${e instanceof Error ? e.message : 'unknown error'}` }
  }
}

export function parseDepositIntent(payloadHex: string): DepositIntentFields {
  const p = payloadHex.toLowerCase()
  const bytes = p.length / 2
  const field = (off: number, len: number) => p.slice(off * 2, (off + len) * 2)
  const bad = (why: string): never => stop('attestation-malformed', why)
  if (!/^([0-9a-f]{2})+$/.test(p) || bytes < DI.hookData) bad('attestation payload is shorter than a DepositIntent')
  if (field(0, 4) !== DI.magic) bad('attestation payload is not a DepositIntent (magic)')
  if (parseInt(field(4, 4), 16) !== DI.version) bad('attestation payload has an unsupported DepositIntent version')
  const hookLength = parseInt(field(DI.hookLength, 4), 16)
  if (DI.hookData + hookLength !== bytes) bad('attestation payload length does not match its hook-data length')
  return {
    amountRaw: BigInt(`0x${field(DI.amount, 32)}`).toString(),
    remoteDomain: parseInt(field(DI.remoteDomain, 4), 16),
    remoteToken: field(DI.remoteToken, 32),
    remoteRecipient: field(DI.remoteRecipient, 32),
    localToken: field(DI.localToken, 32),
    localDepositor: field(DI.localDepositor, 32),
    maxFeeRaw: BigInt(`0x${field(DI.maxFee, 32)}`).toString(),
    nonce: field(DI.nonce, 32),
    hookData: field(DI.hookData, hookLength),
  }
}

// ── 2. Redeemers (structural failures are provider evidence problems) ─────────

const unreadable = (why: string): never => stop('evidence-unreadable', why)

/**
 * End offset of the CBOR item at `off`. A local walker, deliberately not the
 * one in cardano-swap-validate.ts: that one compares a TAG NUMBER with the
 * buffer length as if it were a byte count, so a small buffer holding a tag
 * >= 24 (Plutus constructor 121, set tag 258, constructor 1280+) is wrongly
 * refused — which here would leave an ordinary small transaction "unreadable"
 * forever and stall the locator on it.
 */
function itemEnd(b: Uint8Array, off: number, depth = 0): number {
  if (depth > 256) unreadable('CBOR nested too deeply')
  if (off >= b.length) unreadable('CBOR is truncated')
  const major = b[off] >> 5
  const ai = b[off] & 0x1f
  let pos = off + 1
  let arg = 0
  if (ai >= 24 && ai <= 27) {
    const width = 1 << (ai - 24)
    if (pos + width > b.length) unreadable('CBOR is truncated')
    let v = 0n
    for (let i = 0; i < width; i++) v = (v << 8n) | BigInt(b[pos + i])
    pos += width
    // Only lengths are bounded by the buffer; integers, tags and simple values are not lengths.
    if ((major === 2 || major === 3 || major === 4 || major === 5) && v > BigInt(b.length)) unreadable('CBOR length exceeds the data')
    arg = Number(v > BigInt(Number.MAX_SAFE_INTEGER) ? 0n : v)
  } else if (ai < 24) arg = ai
  else if (ai !== 31) unreadable('reserved CBOR encoding')
  const indefinite = ai === 31
  const untilBreak = (): number => {
    for (;;) {
      if (pos >= b.length) unreadable('CBOR is truncated')
      if (b[pos] === 0xff) return pos + 1
      pos = itemEnd(b, pos, depth + 1)
    }
  }
  switch (major) {
    case 0: case 1: if (indefinite) unreadable('reserved CBOR encoding'); return pos
    case 7: if (indefinite) unreadable('unexpected CBOR break'); return pos
    case 2: case 3:
      if (indefinite) return untilBreak()
      if (pos + arg > b.length) unreadable('CBOR is truncated')
      return pos + arg
    case 4: case 5: {
      if (indefinite) return untilBreak()
      const n = major === 5 ? arg * 2 : arg
      for (let i = 0; i < n; i++) pos = itemEnd(b, pos, depth + 1)
      return pos
    }
    case 6: if (indefinite) unreadable('reserved CBOR encoding'); return itemEnd(b, pos, depth + 1)
    default: return unreadable('unknown CBOR major type')
  }
}

/** `[body, witness_set, is_valid, aux_data]` as exact byte ranges. */
function splitRoot(tx: Uint8Array): { body: Uint8Array; witnessSet: Uint8Array; isValid: Uint8Array; auxData: Uint8Array } {
  if (tx[0] !== 0x84) unreadable('malformed Cardano transaction: root is not a 4-element array')
  const parts: Uint8Array[] = []
  let pos = 1
  for (let i = 0; i < 4; i++) {
    const end = itemEnd(tx, pos)
    parts.push(tx.slice(pos, end))
    pos = end
  }
  if (pos !== tx.length) unreadable('malformed Cardano transaction: trailing bytes')
  return { body: parts[0], witnessSet: parts[1], isValid: parts[2], auxData: parts[3] }
}

interface Redeemer { tag: number; index: number; data: PlutusData }

/** Unsigned integer or definite container length at `at`: [value, next offset]. */
function readHeadArg(buf: Uint8Array, at: number, what: string): [number, number] {
  const a = buf[at] & 0x1f
  if (a < 24) return [a, at + 1]
  if (a === 24) return [buf[at + 1], at + 2]
  if (a === 25) return [(buf[at + 1] << 8) | buf[at + 2], at + 3]
  if (a === 26) return [((buf[at + 1] << 24) | (buf[at + 2] << 16) | (buf[at + 3] << 8) | buf[at + 4]) >>> 0, at + 5]
  return unreadable(`${what} uses an unsupported length encoding`)
}
function readUint(buf: Uint8Array, at: number, what: string): [number, number] {
  if (buf[at] >> 5 !== 0) unreadable(`redeemer ${what} is not an unsigned integer`)
  return readHeadArg(buf, at, `redeemer ${what}`)
}

/** Read witness-set redeemers in either Conway form: array `[tag, index, data, ex]` or map `{[tag, index]: [data, ex]}`. */
function readRedeemers(w: Uint8Array): Redeemer[] {
  const out: Redeemer[] = []
  if (w[0] >> 5 !== 5) unreadable('witness set is not a map')
  let [keys, pos] = readHeadArg(w, 0, 'witness set')
  for (let i = 0; i < keys; i++) {
    const [key, keyEnd] = readUint(w, pos, 'witness key')
    const valEnd = itemEnd(w, keyEnd)
    if (key === 5) {
      const r = w.slice(keyEnd, valEnd)
      const rMajor = r[0] >> 5
      if (rMajor !== 4 && rMajor !== 5) unreadable('redeemers are neither an array nor a map')
      const [count, first] = readHeadArg(r, 0, 'redeemers')
      let p = first
      for (let j = 0; j < count; j++) {
        let tag: number, index: number, dataStart: number
        if (rMajor === 4) {            // [tag, index, data, ex_units]
          if (r[p] !== 0x84) unreadable('redeemer is not a 4-element array')
          ;[tag, p] = readUint(r, p + 1, 'tag')
          ;[index, dataStart] = readUint(r, p, 'index')
        } else {                       // {[tag, index]: [data, ex_units]}
          if (r[p] !== 0x82) unreadable('redeemer key is not a 2-element array')
          let q: number
          ;[tag, q] = readUint(r, p + 1, 'tag')
          ;[index, q] = readUint(r, q, 'index')
          if (r[q] !== 0x82) unreadable('redeemer value is not a 2-element array')
          dataStart = q + 1
        }
        const dataEnd = itemEnd(r, dataStart)
        out.push({ tag, index, data: decodePlutusData(r.slice(dataStart, dataEnd)) })
        p = itemEnd(r, dataEnd)          // skip ex_units
      }
      if (p !== r.length) unreadable('trailing bytes in the redeemers')
    }
    pos = valEnd
  }
  if (pos !== w.length) unreadable('trailing bytes in the witness set')
  return out
}

/** True when `payload` is immediately followed by `signature` in some list or constructor field sequence. */
function carriesPair(d: PlutusData, payload: string, signature: string): boolean {
  const seq = d.kind === 'list' ? d.items : d.kind === 'constr' ? d.fields : null
  if (seq) {
    for (let i = 0; i + 1 < seq.length; i++) {
      const a = seq[i], b = seq[i + 1]
      if (a.kind === 'bytes' && b.kind === 'bytes' && hex(a.value) === payload && hex(b.value) === signature) return true
    }
    return seq.some(x => carriesPair(x, payload, signature))
  }
  if (d.kind === 'map') return d.entries.some(([k, v]) => carriesPair(k, payload, signature) || carriesPair(v, payload, signature))
  return false
}

// ── 3-4. Body: mint, withdrawals, outputs ─────────────────────────────────────

interface Output { index: number; addressBytes: string; lovelace: bigint; assets: Map<string, bigint> }

function readValue(v: CborValue | undefined, what: string): { lovelace: bigint; assets: Map<string, bigint> } {
  if (typeof v === 'bigint') return { lovelace: v, assets: new Map() }
  if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== 'bigint' || !(v[1] instanceof CborMap)) return unreadable(`${what}: malformed value`)
  const assets = new Map<string, bigint>()
  for (const [pid, names] of (v[1] as CborMap).entries) {
    if (!(pid instanceof Uint8Array) || !(names instanceof CborMap)) unreadable(`${what}: malformed multi-asset`)
    for (const [name, qty] of (names as CborMap).entries) {
      if (!(name instanceof Uint8Array) || typeof qty !== 'bigint') unreadable(`${what}: malformed asset`)
      const unit = hex(pid as Uint8Array) + hex(name as Uint8Array)
      if (assets.has(unit)) unreadable(`${what}: duplicate asset`)
      assets.set(unit, qty as bigint)
    }
  }
  return { lovelace: v[0] as bigint, assets }
}

function readOutputs(raw: CborValue | undefined): Output[] {
  if (!Array.isArray(raw)) return unreadable('transaction has no outputs')
  return raw.map((o, index) => {
    let addr: CborValue | undefined, value: CborValue | undefined
    if (Array.isArray(o)) { addr = o[0]; value = o[1] } else if (o instanceof CborMap) { addr = o.getInt(0); value = o.getInt(1) } else unreadable(`output ${index} is malformed`)
    if (!(addr instanceof Uint8Array)) unreadable(`output ${index} has no address`)
    const v = readValue(value, `output ${index}`)
    return { index, addressBytes: hex(addr as Uint8Array), ...v }
  })
}

/**
 * Classify ONE Cardano transaction against an already-validated attestation.
 * Never throws. The carrier is established BEFORE the mint and the credit are
 * judged, so a transaction that genuinely carries Circle's attestation but
 * mints or pays wrongly is a `mint-conflict`, never "unrelated".
 */
export function evaluateMintCandidate(
  att: ValidatedAttestation,
  cardanoTx: { txHash: string; cbor: string },
  cardanoOutputs?: MintProofInput['cardanoOutputs'],
): CandidateOutcome {
  try {
    const net = xreserveNetworkById(att?.network)
    if (!net) return unreadable('the attestation carries no known xReserve network')
    const usdcxUnit = net.cardano.usdcxUnit
    const USDCX_POLICY = usdcxUnit.slice(0, 56)
    const USDCX_NAME = usdcxUnit.slice(56)
    // ── Is this the transaction that was asked for, and readable? ───────────
    const claimed = String(cardanoTx?.txHash ?? '').toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(claimed)) unreadable('Cardano transaction hash is malformed')
    let bytes: Uint8Array
    try { bytes = hexToBytesStrict(String(cardanoTx?.cbor ?? '')) } catch (e) {
      return unreadable(`malformed Cardano transaction: ${e instanceof Error ? e.message : 'unreadable'}`)
    }
    let parts: ReturnType<typeof splitRoot>
    try { parts = splitRoot(bytes) } catch (e) {
      if (e instanceof Stop && !e.message.startsWith('malformed Cardano transaction')) {
        return unreadable(`malformed Cardano transaction: ${e.message}`)
      }
      throw e
    }
    const txId = hex(blake2b(parts.body, { dkLen: 32 }))
    if (txId !== claimed) unreadable('the CBOR is not the claimed Cardano transaction')
    const body = decodeCbor(parts.body)
    if (!(body instanceof CborMap)) return unreadable('transaction body is not a map')
    const outputs = readOutputs(body.getInt(1))

    const mint = body.getInt(9)
    const policies: string[] = []
    let minted: bigint | null = null
    if (mint !== undefined) {
      if (!(mint instanceof CborMap)) unreadable('malformed mint field')
      for (const [pid, names] of (mint as CborMap).entries) {
        if (!(pid instanceof Uint8Array) || !(names instanceof CborMap)) unreadable('malformed mint field')
        const policy = hex(pid as Uint8Array)
        if (policies.includes(policy)) unreadable('duplicate policy in the mint field')
        policies.push(policy)
        if (policy !== USDCX_POLICY) continue
        for (const [name, qty] of (names as CborMap).entries) {
          if (!(name instanceof Uint8Array) || typeof qty !== 'bigint') unreadable('malformed mint field')
          if (hex(name as Uint8Array) === USDCX_NAME) minted = qty as bigint
        }
      }
    }
    const withdrawals = body.getInt(5)
    const rewards: Array<{ account: string; amount: bigint }> = []
    if (withdrawals !== undefined) {
      if (!(withdrawals instanceof CborMap)) unreadable('malformed withdrawals')
      for (const [acct, amt] of (withdrawals as CborMap).entries) {
        if (!(acct instanceof Uint8Array) || typeof amt !== 'bigint') unreadable('malformed withdrawals')
        rewards.push({ account: hex(acct as Uint8Array), amount: amt as bigint })
      }
    }
    const redeemers = readRedeemers(parts.witnessSet)

    // Indexer view, when supplied, must agree with the CBOR before anything is concluded from it.
    if (cardanoOutputs) {
      const mismatch = () => unreadable('the indexer\'s outputs do not match the CBOR')
      if (!Array.isArray(cardanoOutputs) || cardanoOutputs.length !== outputs.length) mismatch()
      for (const io of cardanoOutputs) {
        const o = outputs[io?.index]
        let addrBytes: string
        try { addrBytes = hex(decodeCardanoAddress(io.address)) } catch { return unreadable('the indexer reported an unreadable address') }
        if (!o || o.addressBytes !== addrBytes || !/^[0-9]+$/.test(String(io.lovelace)) || o.lovelace !== BigInt(io.lovelace)) mismatch()
        const want = new Map(io.assets.map(a => [a.unit.toLowerCase(), BigInt(a.quantity)]))
        if (want.size !== o.assets.size || [...want].some(([u, q]) => o.assets.get(u) !== q)) mismatch()
      }
    }

    // ── Does a QUALIFYING redeemer carry Circle's payload and signature? ────
    const sortedPolicies = [...policies].sort()
    let carrier: 'mint-redeemer' | 'withdraw-zero-redeemer' | null = null
    let ambiguous = false
    let nonQualifying = false
    for (const r of redeemers) {
      if (!carriesPair(r.data, att.payload, att.signature)) continue
      if (r.tag === REDEEMER_TAG.mint && sortedPolicies[r.index] === USDCX_POLICY) { carrier = 'mint-redeemer'; break }
      if (r.tag === REDEEMER_TAG.reward) {
        // With several withdrawals, the ledger's ordering of reward accounts
        // would decide which one this redeemer authorizes; not guessed here.
        if (rewards.length !== 1 || r.index !== 0) { ambiguous = true; continue }
        const w = rewards[0]
        const header = parseInt(w.account.slice(0, 2), 16)
        // A SCRIPT reward account (header type 0xf) on the profile's Cardano network.
        const scriptReward = header >> 4 === 0xf && (header & 0x0f) === net.cardano.networkId && w.account.length === 58
        if (scriptReward && w.amount === 0n) { carrier = 'withdraw-zero-redeemer'; break }
      }
      nonQualifying = true
    }
    if (!carrier) {
      if (ambiguous) {
        return { kind: 'mint-conflict', code: 'carrier-ambiguous', mintedRaw: minted?.toString() ?? null, creditedRaw: '0',
          reason: 'the attestation is carried by a withdrawal redeemer that cannot be matched unambiguously' }
      }
      return { kind: 'unrelated', reason: nonQualifying
        ? 'Circle\'s payload and signature are only carried by a redeemer that does not authorize the USDCx mint'
        : 'Circle\'s payload and signature are not carried by a redeemer that authorizes the USDCx mint' }
    }

    // ── It carries the attestation. From here, anything wrong needs review. ─
    if (parts.isValid.length !== 1 || parts.isValid[0] !== 0xf5) {
      return { kind: 'failed-attempt', reason: 'the Cardano transaction carrying the attestation failed script validation, so it minted nothing' }
    }
    const approvedBytes = hex(decodeCardanoAddress(att.recipientAddress))
    let credited = 0n
    const indexes: number[] = []
    for (const o of outputs) {
      if (o.addressBytes !== approvedBytes) continue
      const q = o.assets.get(usdcxUnit) ?? 0n
      if (q > 0n) { credited += q; indexes.push(o.index) }
    }
    const conflict = (code: MintConflictCode, reason: string): CandidateOutcome =>
      ({ kind: 'mint-conflict', code, reason, mintedRaw: minted?.toString() ?? null, creditedRaw: credited.toString() })
    if (minted == null || minted <= 0n) {
      return conflict('no-usdcx-mint', mint === undefined ? 'the transaction mints nothing' : 'the transaction does not mint USDCx')
    }
    // Wallet rule, not a Circle mandate: the mint must be exactly the attested amount.
    if (minted !== BigInt(att.intent.amountRaw)) return conflict('mint-amount-mismatch', 'the transaction mints a different USDCx amount than Circle attested')
    if (credited === 0n) return conflict('no-recipient-credit', 'no output pays USDCx to the approved address')
    // More USDCx to the recipient than this transaction minted must include
    // coins from elsewhere; it cannot be read as the outcome of this mint.
    if (credited > minted) return conflict('excess-recipient-credit', 'the recipient is credited more USDCx than the transaction minted')
    if (att.approvedAmount - credited < 0n) return conflict('excess-recipient-credit', 'the recipient is credited more than the approved deposit')

    return {
      kind: 'verified',
      proof: {
        verified: true,
        messageHash: `0x${att.messageHash}`,
        remoteDomain: att.remoteDomain,
        depositIntent: att.intent,
        attestationCarrier: carrier,
        cardanoTxHash: txId,
        mintedRaw: minted.toString(),
        creditedRaw: credited.toString(),
        recipientOutputIndexes: indexes,
        sourceMinusCreditedRaw: (att.approvedAmount - credited).toString(),
      },
    }
  } catch (e) {
    if (e instanceof Stop) return { kind: 'evidence-unreadable', reason: e.message }
    if (e instanceof CardanoSwapValidationError) return { kind: 'evidence-unreadable', reason: `malformed Cardano transaction: ${e.message}` }
    return { kind: 'evidence-unreadable', reason: `evidence could not be read: ${e instanceof Error ? e.message : 'unknown error'}` }
  }
}

/**
 * Verify an inbound xReserve mint: `validateXReserveAttestation` then
 * `evaluateMintCandidate`. Never throws: every failure is returned as
 * `{ verified: false, code, reason }`.
 */
export function verifyXReserveCardanoMint(input: MintProofInput): MintProof {
  if (!input || typeof input !== 'object') return { verified: false, code: 'invalid-approval', reason: 'no evidence supplied' }
  const check = validateXReserveAttestation(input.attestationResponse, input.approved, input.network)
  if (!check.ok) return { verified: false, code: check.code, reason: check.reason }
  const outcome = evaluateMintCandidate(check.attestation, input.cardanoTx, input.cardanoOutputs)
  if (outcome.kind === 'verified') return outcome.proof
  return { verified: false, code: outcome.kind === 'mint-conflict' ? outcome.code : outcome.kind, reason: outcome.reason }
}
