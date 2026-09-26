/**
 * cardano-swap-validate.ts — is this provider-built Cardano transaction the
 * swap the user approved? (privileged layer, shared by all four targets)
 *
 * The provider hands back CBOR for the WALLET to sign. That CBOR is untrusted
 * data: an aggregator that is compromised, buggy, or simply out of date could
 * return a transaction that sends the sell amount somewhere else, names a
 * different receiver in the order, sets a floor of zero, or spends coins the
 * user never meant to touch. Nothing here trusts what the quote SAID the
 * transaction does; every figure is read out of the bytes that will be signed.
 *
 * WHAT IS ACCEPTED (v1): exactly the Minswap V2 "batcher order" shape measured
 * live on 2026-09-26 (docs/CARDANO-SWAP-DISCOVERY.md, D9/D10):
 *
 *   inputs    only the wallet's own unspent key-hash UTxOs
 *   outputs   ONE order output at the published V2 order script, staked to the
 *             wallet, inline datum naming the wallet as canceller AND receiver;
 *             at most ONE aggregator-fee output (pinned address, ADA only,
 *             the quoted amount); change to the wallet's own address; nothing
 *             else
 *   body      no certificates, withdrawals, mint, collateral, reference
 *             inputs, required signers, script data, votes, proposals or
 *             donation — an order-creation transaction runs no scripts at all
 *   witnesses none yet (the wallet adds the only one)
 *
 * The "direct script" shape some protocols return (pool UTxOs spent in the same
 * transaction, redeemers, collateral, withdraw-zero) is REFUSED here, not
 * half-supported. It moves more value through more moving parts, and it needs
 * its own pinned scripts before it can be checked with the same rigour.
 *
 * Parsing is deliberately STRICT and separate from cardano-tx-inspect.ts's
 * `decodeTxBody`, which skips malformed entries so a signing PROMPT can still
 * render. A validator that skipped an output it could not parse would approve a
 * transaction with an output nobody looked at.
 */

import { blake2b } from '@noble/hashes/blake2b'
import { decodeCbor, CborMap, CborError, type CborValue } from './cardano-tx-inspect'
import { decodeCardanoAddress } from './cardano-pure'
import {
  MINSWAP_V2, decodeMinswapV2OrderDatum, verifyMinswapV2Route, MinswapOrderError,
  type MinswapV2Order,
} from './minswap-v2-order'
import { CARDANO_LOVELACE, splitCardanoUnit } from '../shared/swap-token-identity'
import type { CardanoOrderTerms, CardanoSwapCost } from '../shared/swap-quote'

export class CardanoSwapValidationError extends Error {}

/**
 * The aggregator's fee output. Not documented by Minswap: observed as the
 * `aggregator_fee` recipient in every live build-tx on 2026-09-26 (enterprise
 * address, key hash below). Pinned so a changed recipient fails CLOSED — a
 * route stops quoting rather than paying an address nobody has looked at.
 */
export const MINSWAP_AGGREGATOR_FEE_KEY_HASH = 'a6392a798b36808a3a61790070a1971f606c6ae682ee084bdf1e27ee'

/** Hard caps, independent of anything the provider says. Measured values are far below them. */
export const CARDANO_SWAP_LIMITS = {
  /** Network fee. Measured 0.248 ADA for a 2-input order. */
  maxTxFeeLovelace: 2_000_000n,
  /** Batcher fee committed in the datum. Measured 2 ADA for a 2-hop route. */
  maxBatcherFeeLovelace: 5_000_000n,
  /** Refundable ADA locked with the order. Measured 2 ADA. */
  maxDepositLovelace: 5_000_000n,
  /** Aggregator fee. Measured 0.85-1 ADA. */
  maxAggregatorFeeLovelace: 5_000_000n,
  /** The transaction must stay valid at least this long after checking. */
  minValiditySlots: 60n,
  /** …and must not be valid absurdly far ahead (Minswap builds ~3 h). */
  maxValiditySlots: 6n * 3600n,
} as const

/** A wallet UTxO the transaction may spend, keyed `txHash#index`. */
export interface WalletUtxo {
  lovelace: bigint
  assets: Array<{ unit: string; quantity: bigint }>
}

export interface MinswapOrderExpectation {
  /** The wallet's own base address (bech32) — owner, receiver and change. */
  walletAddress: string
  network: 'mainnet' | 'testnet'
  sellUnit: string
  sellAmountRaw: string
  buyUnit: string
  /** Quoted output. The datum floor may not exceed it. */
  buyAmountRaw: string
  /** The floor the user approved. The datum floor may not be below it. */
  minBuyAmountRaw: string
  terms: CardanoOrderTerms
}

export interface ValidatedMinswapOrder {
  /** blake2b-256 of the body bytes — the transaction id, known before submitting. */
  txId: string
  orderOutputIndex: number
  order: MinswapV2Order
  cost: CardanoSwapCost
}

const fail = (why: string): never => { throw new CardanoSwapValidationError(why) }

const hex = (b: Uint8Array): string => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

export function hexToBytesStrict(value: string): Uint8Array {
  if (typeof value !== 'string' || !/^([0-9a-fA-F]{2})+$/.test(value)) fail('transaction is not hex')
  const out = new Uint8Array(value.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16)
  return out
}

// ── Raw CBOR framing ──────────────────────────────────────────────────────────
// The signed transaction must carry the provider's body bytes UNCHANGED (their
// hash is what the witness signs), so the root is split by byte offsets rather
// than decoded and re-encoded.

/** End offset of the CBOR item starting at `off`. Supports indefinite lengths. */
export function cborItemEnd(b: Uint8Array, off: number, depth = 0): number {
  if (depth > 128) fail('transaction nested too deeply')
  if (off >= b.length) fail('transaction is truncated')
  const major = b[off] >> 5
  const ai = b[off] & 0x1f
  let pos = off + 1
  let arg = 0
  const indefinite = ai === 31
  if (ai < 24) arg = ai
  else if (ai >= 24 && ai <= 27) {
    const width = 1 << (ai - 24)
    if (pos + width > b.length) fail('transaction is truncated')
    let v = 0n
    for (let i = 0; i < width; i++) v = (v << 8n) | BigInt(b[pos + i])
    pos += width
    if (major !== 0 && major !== 1 && major !== 7 && v > BigInt(b.length)) fail('length exceeds transaction size')
    arg = Number(v > BigInt(Number.MAX_SAFE_INTEGER) ? 0n : v)
  } else if (!indefinite) fail('reserved CBOR encoding')

  switch (major) {
    case 0: case 1: return pos
    case 7:
      if (indefinite) fail('unexpected break')
      return pos
    case 2: case 3: {
      if (!indefinite) {
        if (pos + arg > b.length) fail('transaction is truncated')
        return pos + arg
      }
      while (b[pos] !== 0xff) { if (pos >= b.length) fail('transaction is truncated'); pos = cborItemEnd(b, pos, depth + 1) }
      return pos + 1
    }
    case 4: case 5: {
      if (indefinite) {
        while (b[pos] !== 0xff) { if (pos >= b.length) fail('transaction is truncated'); pos = cborItemEnd(b, pos, depth + 1) }
        return pos + 1
      }
      const n = major === 5 ? arg * 2 : arg
      for (let i = 0; i < n; i++) pos = cborItemEnd(b, pos, depth + 1)
      return pos
    }
    case 6: return cborItemEnd(b, pos, depth + 1)
    default: return fail('unknown CBOR major type')
  }
}

export interface TxRootParts { body: Uint8Array; witnessSet: Uint8Array; isValid: Uint8Array; auxData: Uint8Array }

/** Split `[body, witness_set, is_valid, aux_data]` into its exact byte ranges. */
export function splitTxRoot(tx: Uint8Array): TxRootParts {
  if (tx[0] !== 0x84) fail('transaction root is not a 4-element array')
  const parts: Uint8Array[] = []
  let pos = 1
  for (let i = 0; i < 4; i++) {
    const end = cborItemEnd(tx, pos)
    parts.push(tx.slice(pos, end))
    pos = end
  }
  if (pos !== tx.length) fail('trailing bytes after the transaction')
  return { body: parts[0], witnessSet: parts[1], isValid: parts[2], auxData: parts[3] }
}

/**
 * Re-assemble the transaction with the wallet's witness set. Body, validity
 * flag and auxiliary data are the provider's exact bytes.
 */
export function assembleSignedTx(parts: TxRootParts, witnessSet: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + parts.body.length + witnessSet.length + parts.isValid.length + parts.auxData.length)
  let o = 0
  out[o++] = 0x84
  for (const p of [parts.body, witnessSet, parts.isValid, parts.auxData]) { out.set(p, o); o += p.length }
  return out
}

export function txIdOf(body: Uint8Array): string {
  return hex(blake2b(body, { dkLen: 32 }))
}

// ── Strict value / output parsing ─────────────────────────────────────────────

interface StrictValue { lovelace: bigint; assets: Map<string, bigint> }

function strictValue(v: CborValue | undefined, what: string): StrictValue {
  if (typeof v === 'bigint') {
    if (v < 0n) fail(`${what}: negative coin`)
    return { lovelace: v, assets: new Map() }
  }
  if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== 'bigint' || !(v[1] instanceof CborMap)) {
    return fail(`${what}: malformed value`)
  }
  if (v[0] < 0n) fail(`${what}: negative coin`)
  const assets = new Map<string, bigint>()
  for (const [policy, names] of v[1].entries) {
    if (!(policy instanceof Uint8Array) || policy.length !== 28 || !(names instanceof CborMap)) fail(`${what}: malformed multi-asset`)
    for (const [name, qty] of (names as CborMap).entries) {
      if (!(name instanceof Uint8Array) || name.length > 32 || typeof qty !== 'bigint' || qty <= 0n) {
        fail(`${what}: malformed asset quantity`)
      }
      const unit = hex(policy as Uint8Array) + hex(name as Uint8Array)
      if (assets.has(unit)) fail(`${what}: duplicate asset`)
      assets.set(unit, qty as bigint)
    }
  }
  return { lovelace: v[0], assets }
}

interface StrictOutput {
  addressBytes: Uint8Array
  value: StrictValue
  /** Inline datum bytes; null when absent. A datum HASH is refused outright. */
  inlineDatum: Uint8Array | null
}

function strictOutput(item: CborValue, i: number): StrictOutput {
  const what = `output ${i}`
  if (Array.isArray(item)) {
    // Legacy form [address, value] — a datum hash here would be a third element.
    if (item.length !== 2 || !(item[0] instanceof Uint8Array)) return fail(`${what}: unexpected legacy output`)
    return { addressBytes: item[0], value: strictValue(item[1], what), inlineDatum: null }
  }
  if (!(item instanceof CborMap)) return fail(`${what}: malformed output`)
  let addressBytes: Uint8Array | null = null
  let value: StrictValue | null = null
  let inlineDatum: Uint8Array | null = null
  for (const [k, v] of item.entries) {
    if (k === 0n && v instanceof Uint8Array) addressBytes = v
    else if (k === 1n) value = strictValue(v, what)
    else if (k === 2n) {
      // datum_option = [0, hash] | [1, #6.24(bytes)]. The tag is unwrapped by
      // the reader, so an inline datum arrives as its encoded bytes.
      if (!Array.isArray(v) || v.length !== 2 || v[0] !== 1n || !(v[1] instanceof Uint8Array)) {
        fail(`${what}: only an inline datum is accepted`)
      }
      inlineDatum = (v as CborValue[])[1] as Uint8Array
    } else if (k === 3n) fail(`${what}: carries a reference script`)
    else fail(`${what}: unknown output field`)
  }
  if (!addressBytes || !value) return fail(`${what}: missing address or value`)
  return { addressBytes, value, inlineDatum }
}

function strictInputs(v: CborValue | undefined, what: string): string[] {
  if (!Array.isArray(v) || v.length === 0) return fail(`${what}: missing`)
  const seen = new Set<string>()
  for (const entry of v) {
    if (!Array.isArray(entry) || entry.length !== 2 || !(entry[0] instanceof Uint8Array)
        || entry[0].length !== 32 || typeof entry[1] !== 'bigint' || entry[1] < 0n) {
      fail(`${what}: malformed input`)
    }
    const key = `${hex((entry as CborValue[])[0] as Uint8Array)}#${(entry as CborValue[])[1]}`
    if (seen.has(key)) fail(`${what}: duplicate input`)
    seen.add(key)
  }
  return [...seen]
}

// ── Address helpers ───────────────────────────────────────────────────────────

interface WalletKeys { paymentKeyHash: string; stakeKeyHash: string; networkNibble: number; bytes: string }

function walletKeys(address: string, network: 'mainnet' | 'testnet'): WalletKeys {
  let bytes: Uint8Array
  try { bytes = decodeCardanoAddress(address) } catch { return fail('wallet Cardano address is invalid') }
  // Type 0 = base address, key payment + key stake — the only kind this wallet derives.
  if (bytes.length !== 57 || (bytes[0] >> 4) !== 0) fail('wallet Cardano address is not a base address')
  const networkNibble = bytes[0] & 0x0f
  if (networkNibble !== (network === 'mainnet' ? 1 : 0)) fail('wallet address is for a different Cardano network')
  return {
    paymentKeyHash: hex(bytes.slice(1, 29)),
    stakeKeyHash: hex(bytes.slice(29, 57)),
    networkNibble,
    bytes: hex(bytes),
  }
}

type OutputRole = 'change' | 'order' | 'aggregator-fee'

function roleOf(addr: Uint8Array, w: WalletKeys): OutputRole | null {
  if ((addr[0] & 0x0f) !== w.networkNibble) fail('an output is addressed to a different Cardano network')
  const type = addr[0] >> 4
  if (hex(addr) === w.bytes) return 'change'
  // Type 1 = script payment + key stake: the order output, staked to the wallet.
  if (type === 1 && addr.length === 57
      && hex(addr.slice(1, 29)) === MINSWAP_V2.orderScriptHash
      && hex(addr.slice(29, 57)) === w.stakeKeyHash) return 'order'
  // Type 6 = enterprise, key payment: the aggregator's fee address.
  if (type === 6 && addr.length === 29 && hex(addr.slice(1, 29)) === MINSWAP_AGGREGATOR_FEE_KEY_HASH) {
    return 'aggregator-fee'
  }
  return null
}

function uintString(v: string, what: string): bigint {
  if (typeof v !== 'string' || !/^[0-9]+$/.test(v)) return fail(`quote ${what} is not an integer`)
  return BigInt(v)
}

function sameAddress(a: { payment: { kind: string; hash: string }; stake: { kind: string; hash: string } | null }, w: WalletKeys): boolean {
  return a.payment.kind === 'key' && a.payment.hash === w.paymentKeyHash
    && !!a.stake && a.stake.kind === 'key' && a.stake.hash === w.stakeKeyHash
}

/**
 * Validate a Minswap V2 order-creation transaction against the approved terms.
 *
 * `walletUtxos` must be the wallet's CURRENT unspent set at `walletAddress`:
 * an input missing from it is either not ours or already spent, and both are
 * reasons to refuse. `nowSlot` checks the validity window; pass null only when
 * the tip genuinely could not be read (the executor refuses to sign then).
 */
export function validateMinswapOrderTx(
  txHex: string,
  expect: MinswapOrderExpectation,
  walletUtxos: ReadonlyMap<string, WalletUtxo>,
  nowSlot: bigint | null,
): ValidatedMinswapOrder {
  const tx = hexToBytesStrict(txHex)
  const parts = splitTxRoot(tx)
  const w = walletKeys(expect.walletAddress, expect.network)

  // ── Terms the quote committed to ─────────────────────────────────────────
  const sellAmount = uintString(expect.sellAmountRaw, 'sell amount')
  const buyAmount = uintString(expect.buyAmountRaw, 'buy amount')
  const approvedMin = uintString(expect.minBuyAmountRaw, 'minimum received')
  const batcherFee = uintString(expect.terms.batcherFeeLovelace, 'batcher fee')
  const deposit = uintString(expect.terms.depositLovelace, 'deposit')
  const aggregatorFee = uintString(expect.terms.aggregatorFeeLovelace, 'aggregator fee')
  if (sellAmount <= 0n || approvedMin <= 0n || approvedMin > buyAmount) fail('quote amounts are inconsistent')
  if (expect.terms.protocol !== 'MinswapV2') fail('only Minswap V2 orders are supported')
  if (batcherFee > CARDANO_SWAP_LIMITS.maxBatcherFeeLovelace) fail('batcher fee exceeds the wallet limit')
  if (deposit > CARDANO_SWAP_LIMITS.maxDepositLovelace) fail('order deposit exceeds the wallet limit')
  if (aggregatorFee > CARDANO_SWAP_LIMITS.maxAggregatorFeeLovelace) fail('aggregator fee exceeds the wallet limit')
  const sellIsAda = expect.sellUnit === CARDANO_LOVELACE
  if (!sellIsAda && !splitCardanoUnit(expect.sellUnit)) fail('sell token is not a Cardano unit')
  if (expect.buyUnit !== CARDANO_LOVELACE && !splitCardanoUnit(expect.buyUnit)) fail('buy token is not a Cardano unit')
  const path = expect.terms.path
  if (!Array.isArray(path) || path[0] !== expect.sellUnit || path[path.length - 1] !== expect.buyUnit) {
    fail('the quoted route does not run from the sell token to the buy token')
  }

  // ── Root: nothing signed yet, nothing that runs scripts ──────────────────
  let witnessSet: CborValue
  try { witnessSet = decodeCbor(parts.witnessSet) } catch (e) { return fail(`witness set: ${(e as Error).message}`) }
  if (!(witnessSet instanceof CborMap) || witnessSet.size !== 0) {
    fail('the transaction already carries witnesses or scripts; an order creation needs neither')
  }
  if (parts.isValid.length !== 1 || parts.isValid[0] !== 0xf5) fail('the transaction is not marked valid')

  let body: CborValue
  try { body = decodeCbor(parts.body) } catch (e) { return fail(`body: ${e instanceof CborError ? e.message : 'undecodable'}`) }
  if (!(body instanceof CborMap)) return fail('body is not a map')

  // Allowed body fields: inputs(0) outputs(1) fee(2) ttl(3) aux-hash(7)
  // validity-start(8) network-id(15). Everything else is refused by NAME, so an
  // unknown future field is refused too.
  const ALLOWED = new Set([0, 1, 2, 3, 7, 8, 15])
  const seenKeys = new Set<number>()
  for (const [k] of body.entries) {
    if (typeof k !== 'bigint') fail('body has a non-integer key')
    const key = Number(k)
    if (seenKeys.has(key)) fail('body repeats a field')
    seenKeys.add(key)
    if (!ALLOWED.has(key)) {
      const names: Record<number, string> = {
        4: 'certificates', 5: 'withdrawals', 9: 'minting', 11: 'script data', 13: 'collateral',
        14: 'required signers', 16: 'collateral return', 17: 'total collateral', 18: 'reference inputs',
        19: 'governance votes', 20: 'governance proposals', 21: 'treasury value', 22: 'a treasury donation',
      }
      fail(`the transaction includes ${names[key] ?? `unknown body field ${key}`}`)
    }
  }
  const networkId = body.getInt(15)
  if (networkId !== undefined && networkId !== (expect.network === 'mainnet' ? 1n : 0n)) {
    fail('the transaction is for a different Cardano network')
  }

  const fee = body.getInt(2)
  if (typeof fee !== 'bigint' || fee <= 0n) return fail('missing network fee')
  if (fee > CARDANO_SWAP_LIMITS.maxTxFeeLovelace) fail('network fee exceeds the wallet limit')

  const ttl = body.getInt(3)
  if (typeof ttl !== 'bigint') return fail('the transaction never expires')
  if (nowSlot != null) {
    if (ttl < nowSlot + CARDANO_SWAP_LIMITS.minValiditySlots) fail('the quote has expired — refresh it and try again')
    if (ttl > nowSlot + CARDANO_SWAP_LIMITS.maxValiditySlots) fail('the transaction stays valid for an unusually long time')
  }
  const validFrom = body.getInt(8)
  if (validFrom !== undefined && (typeof validFrom !== 'bigint' || (nowSlot != null && validFrom > nowSlot))) {
    fail('the transaction is not valid yet')
  }

  // ── Inputs: the wallet's own unspent coins, and nothing else ─────────────
  const inputKeys = strictInputs(body.getInt(0), 'inputs')
  const spent = { lovelace: 0n, assets: new Map<string, bigint>() }
  for (const key of inputKeys) {
    const utxo = walletUtxos.get(key)
    if (!utxo) fail('the transaction spends a coin that is not an unspent coin of this wallet')
    spent.lovelace += utxo!.lovelace
    for (const a of utxo!.assets) spent.assets.set(a.unit, (spent.assets.get(a.unit) ?? 0n) + a.quantity)
  }

  // ── Outputs: every one classified, none skipped ──────────────────────────
  const outputsRaw = body.getInt(1)
  if (!Array.isArray(outputsRaw) || outputsRaw.length === 0) return fail('the transaction has no outputs')
  const kept = { lovelace: 0n, assets: new Map<string, bigint>() }
  let orderIndex = -1
  let orderOutput: StrictOutput | null = null
  let feeOutputs = 0
  outputsRaw.forEach((raw, i) => {
    const out = strictOutput(raw, i)
    const role = roleOf(out.addressBytes, w)
    if (role === null) fail(`output ${i} pays an address that is neither this wallet, the Minswap order script nor its fee address`)
    if (role === 'change') {
      if (out.inlineDatum) fail(`output ${i} attaches a datum to this wallet's own coins`)
      kept.lovelace += out.value.lovelace
      for (const [u, q] of out.value.assets) kept.assets.set(u, (kept.assets.get(u) ?? 0n) + q)
    } else if (role === 'order') {
      if (orderOutput) fail('the transaction creates more than one order')
      orderIndex = i
      orderOutput = out
    } else {
      feeOutputs++
      if (feeOutputs > 1) fail('the transaction pays the aggregator fee more than once')
      if (out.inlineDatum || out.value.assets.size) fail('the aggregator fee output carries more than ADA')
      if (out.value.lovelace !== aggregatorFee) fail('the aggregator fee differs from the quote')
    }
  })
  if (feeOutputs === 0 && aggregatorFee !== 0n) fail('the quoted aggregator fee is missing')
  if (!orderOutput) return fail('the transaction creates no Minswap order')
  const order: StrictOutput = orderOutput

  // ── The order: every term that protects the user ─────────────────────────
  if (!order.inlineDatum) fail('the order carries no inline datum')
  let parsed: MinswapV2Order
  try {
    parsed = decodeMinswapV2OrderDatum(order.inlineDatum as Uint8Array)
    verifyMinswapV2Route(parsed, path)
  } catch (e) {
    if (e instanceof MinswapOrderError) return fail(e.message)
    throw e
  }
  if (parsed.canceller.kind !== 'key' || parsed.canceller.hash !== w.paymentKeyHash) {
    fail('someone other than this wallet could cancel the order')
  }
  if (!sameAddress(parsed.successReceiver, w)) fail('the order pays its proceeds to an address that is not this wallet')
  if (!sameAddress(parsed.refundReceiver, w)) fail('the order refunds to an address that is not this wallet')
  if (parsed.successReceiverHasDatum || parsed.refundReceiverHasDatum) fail('the order attaches a datum to this wallet\'s proceeds')
  if (parsed.swapAmount !== sellAmount) fail('the order sells a different amount than the quote')
  if (parsed.minimumReceive < approvedMin) fail('the order\'s minimum received is below the one you approved')
  if (parsed.minimumReceive > buyAmount) fail('the order\'s minimum received exceeds the quoted output')
  if (parsed.maxBatcherFee !== batcherFee) fail('the order\'s batcher fee differs from the quote')

  // What the order output must hold: the sell amount, plus the batcher fee and
  // the refundable deposit in ADA — nothing more, nothing less.
  const orderAssets = order.value.assets
  if (sellIsAda) {
    if (orderAssets.size !== 0) fail('the order locks tokens that are not being sold')
    if (order.value.lovelace !== sellAmount + batcherFee + deposit) fail('the order locks a different amount of ADA than quoted')
  } else {
    if (orderAssets.size !== 1 || orderAssets.get(expect.sellUnit) !== sellAmount) {
      fail('the order locks a different token amount than the one being sold')
    }
    if (order.value.lovelace !== batcherFee + deposit) fail('the order locks a different amount of ADA than quoted')
  }

  // ── Net effect on the wallet: exactly the sale, the fees and the deposit ──
  const units = new Set([...spent.assets.keys(), ...kept.assets.keys()])
  for (const unit of units) {
    const delta = (spent.assets.get(unit) ?? 0n) - (kept.assets.get(unit) ?? 0n)
    const expected = !sellIsAda && unit === expect.sellUnit ? sellAmount : 0n
    if (delta !== expected) fail('the transaction moves a token of this wallet that is not part of the swap')
  }
  if (!sellIsAda && !units.has(expect.sellUnit)) fail('the transaction does not spend the token being sold')
  const adaOut = spent.lovelace - kept.lovelace
  const expectedAdaOut = fee + order.value.lovelace + aggregatorFee
  if (adaOut !== expectedAdaOut) fail('the transaction does not balance to the quoted costs')

  return {
    txId: txIdOf(parts.body),
    orderOutputIndex: orderIndex,
    order: parsed,
    cost: {
      txFeeLovelace: fee.toString(),
      batcherFeeLovelace: batcherFee.toString(),
      depositLovelace: deposit.toString(),
      aggregatorFeeLovelace: aggregatorFee.toString(),
      adaSpentLovelace: adaOut.toString(),
      validUntilSlot: ttl.toString(),
      orderMinimumRaw: parsed.minimumReceive.toString(),
      killable: parsed.killable,
    },
  }
}

/** Index a wallet UTxO list the way the validator reads it. */
export function indexWalletUtxos(
  utxos: Array<{ txHash: string; txIndex: number; lovelace: bigint; assets: Array<{ unit: string; quantity: bigint }> }>,
): Map<string, WalletUtxo> {
  const map = new Map<string, WalletUtxo>()
  for (const u of utxos) {
    map.set(`${u.txHash.toLowerCase()}#${u.txIndex}`, {
      lovelace: u.lovelace,
      assets: u.assets.map(a => ({ unit: a.unit.toLowerCase(), quantity: a.quantity })),
    })
  }
  return map
}
