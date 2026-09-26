/**
 * minswap-v2-order.ts — what a Minswap V2 swap order actually says (shared)
 *
 * A Minswap order transaction does not trade. It locks the sell amount at the
 * V2 ORDER SCRIPT with an inline datum, and a whitelisted batcher later fills it
 * against the pool — or the owner cancels it. Everything that protects the user
 * therefore lives in that datum: who can cancel, where the proceeds and any
 * refund go, which pools the route crosses, and the minimum the batcher must
 * deliver. This module decodes it against the PUBLISHED contract, not a sample:
 *
 *   minswap/minswap-dex-v2 (github), README "Mainnet" and
 *   lib/amm_dex_v2/types.ak `OrderDatum` / `OrderStep` / `SwapRouting`.
 *
 * It also re-derives each pool's LP asset name from the two tokens it trades,
 * exactly as the pool validator does (`utils.compute_lp_asset_name`), so a route
 * can be checked OFFLINE: the datum names pools only by LP asset, and a datum
 * that names a pool for a different pair would otherwise look routine.
 *
 * Platform-neutral: no network, no Buffer, no node: imports.
 */

import { sha3_256 } from '@noble/hashes/sha3'
import {
  decodePlutusData, asConstr, asInt, asBytes, asList, asBool,
  PlutusDataError, type PlutusData,
} from './cardano-plutus-data'
import { CARDANO_LOVELACE, splitCardanoUnit } from '../shared/swap-token-identity'

/**
 * Mainnet script hashes from the minswap-dex-v2 README (checked 2026-09-26).
 * The order script hash also matched the order output of a live
 * `agg-api.minswap.org` build-tx the same day.
 */
export const MINSWAP_V2 = {
  orderScriptHash: 'c3e28c36c3447315ba5a56f33da6a6ddc1770a876a8d9f0cb3a97c4c',
  /** LP token policy — the `authen` minting policy the pool validator uses. */
  lpPolicyId: 'f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c',
} as const

export class MinswapOrderError extends Error {}

/** A payment or stake credential: key hash (constr 0) or script hash (constr 1). */
export interface Credential { kind: 'key' | 'script'; hash: string }

export interface PlutusAddress {
  payment: Credential
  /** Inline stake credential; null when the address has none (enterprise). */
  stake: Credential | null
}

export interface MinswapSwapStep {
  lpAssetName: string
  /** true = the pool's asset A is sold for its asset B. */
  aToB: boolean
}

export interface MinswapV2Order {
  /** Who may cancel. The wallet only ever accepts its own payment key hash here. */
  canceller: Credential
  refundReceiver: PlutusAddress
  refundReceiverHasDatum: boolean
  successReceiver: PlutusAddress
  successReceiverHasDatum: boolean
  /** Pool of the FIRST hop (for SwapExactIn, the only hop). */
  lpAsset: { policyId: string; assetName: string }
  stepKind: 'swap-exact-in' | 'swap-multi-routing'
  /** Every hop in order. A single-hop SwapExactIn is one element. */
  routing: MinswapSwapStep[]
  /** SAOSpecificAmount only — an "all of the order's value" amount is refused. */
  swapAmount: bigint
  minimumReceive: bigint
  /** SwapExactIn only: whether a batcher may kill (refund) an order it cannot fill. */
  killable: boolean | null
  maxBatcherFee: bigint
  /** [expiry POSIX ms, max cancel tip] when set. */
  expiry: { expiresAtMs: bigint; maxTip: bigint } | null
}

const hex = (b: Uint8Array): string => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
const hexToBytes = (h: string): Uint8Array => {
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

function credential(d: PlutusData, what: string): Credential {
  if (d.kind !== 'constr' || (d.index !== 0 && d.index !== 1)) {
    throw new PlutusDataError(`${what}: expected a credential`)
  }
  const [h] = asConstr(d, what, d.index, 1)
  return { kind: d.index === 0 ? 'key' : 'script', hash: hex(asBytes(h, what, 28)) }
}

/** Plutus `Address { payment_credential, stake_credential: Option<StakeCredential> }`. */
function address(d: PlutusData, what: string): PlutusAddress {
  const [pay, stakeOpt] = asConstr(d, what, 0, 2)
  const payment = credential(pay, `${what} payment`)
  if (stakeOpt.kind !== 'constr') throw new PlutusDataError(`${what}: bad stake option`)
  if (stakeOpt.index === 1) {
    asConstr(stakeOpt, `${what} stake`, 1, 0)   // None
    return { payment, stake: null }
  }
  const [stakeCred] = asConstr(stakeOpt, `${what} stake`, 0, 1)   // Some
  // StakeCredential: Inline(Credential) = constr 0; Pointer = constr 1. A pointer
  // address is legal but never one this wallet derives, so it is refused.
  const [inner] = asConstr(stakeCred, `${what} stake credential`, 0, 1)
  return { payment, stake: credential(inner, `${what} stake`) }
}

/** ExtraOrderDatum: EODNoDatum = constr 0 (no fields); others carry a hash. */
function hasExtraDatum(d: PlutusData, what: string): boolean {
  if (d.kind !== 'constr' || d.index < 0 || d.index > 2) throw new PlutusDataError(`${what}: bad extra datum`)
  if (d.index === 0) { asConstr(d, what, 0, 0); return false }
  asConstr(d, what, d.index, 1)
  return true
}

function swapAmount(d: PlutusData, what: string): bigint {
  // SAOSpecificAmount = constr 0 { swap_amount }; SAOAll = constr 1 { deducted }.
  if (d.kind !== 'constr' || d.index !== 0) {
    throw new PlutusDataError(`${what}: only a specific swap amount is accepted`)
  }
  const [amount] = asConstr(d, what, 0, 1)
  return asInt(amount, what)
}

function asset(d: PlutusData, what: string): { policyId: string; assetName: string } {
  const [pid, name] = asConstr(d, what, 0, 2)
  return { policyId: hex(asBytes(pid, `${what} policy`)), assetName: hex(asBytes(name, `${what} name`)) }
}

/**
 * Decode an inline order datum. Throws `MinswapOrderError` for anything that is
 * not a plain swap order — deposits, withdrawals, stop-losses, partial swaps and
 * "swap whatever the order holds" amounts are all refused, because the wallet
 * only ever asks for, and only knows how to verify, a fixed-input swap.
 */
export function decodeMinswapV2OrderDatum(datumBytes: Uint8Array): MinswapV2Order {
  try {
    const fields = asConstr(decodePlutusData(datumBytes), 'OrderDatum', 0, 9)
    const lpAsset = asset(fields[5], 'lp_asset')
    const step = fields[6]
    if (step.kind !== 'constr') throw new PlutusDataError('step: expected a constructor')

    let stepKind: MinswapV2Order['stepKind']
    let routing: MinswapSwapStep[]
    let amount: bigint
    let minimumReceive: bigint
    let killable: boolean | null = null
    if (step.index === 0) {
      // SwapExactIn { a_to_b_direction, swap_amount_option, minimum_receive, killable }
      const [dir, amt, min, kill] = asConstr(step, 'SwapExactIn', 0, 4)
      stepKind = 'swap-exact-in'
      routing = [{ lpAssetName: lpAsset.assetName, aToB: asBool(dir, 'a_to_b_direction') }]
      amount = swapAmount(amt, 'swap_amount_option')
      minimumReceive = asInt(min, 'minimum_receive')
      killable = asBool(kill, 'killable')
      if (lpAsset.policyId !== MINSWAP_V2.lpPolicyId) throw new PlutusDataError('lp_asset: not a Minswap V2 LP token')
    } else if (step.index === 9) {
      // SwapMultiRouting { routings: List<SwapRouting>, swap_amount_option, minimum_receive }
      const [routes, amt, min] = asConstr(step, 'SwapMultiRouting', 9, 3)
      stepKind = 'swap-multi-routing'
      routing = asList(routes, 'routings').map((r, i) => {
        const [lp, dir] = asConstr(r, `routing[${i}]`, 0, 2)
        const a = asset(lp, `routing[${i}].lp_asset`)
        if (a.policyId !== MINSWAP_V2.lpPolicyId) throw new PlutusDataError(`routing[${i}]: not a Minswap V2 LP token`)
        return { lpAssetName: a.assetName, aToB: asBool(dir, `routing[${i}].a_to_b_direction`) }
      })
      if (routing.length < 2) throw new PlutusDataError('SwapMultiRouting: fewer than two hops')
      // The contract requires the order's lp_asset to be the FIRST pool's.
      if (lpAsset.policyId !== MINSWAP_V2.lpPolicyId || lpAsset.assetName !== routing[0].lpAssetName) {
        throw new PlutusDataError('lp_asset does not match the first routing pool')
      }
      amount = swapAmount(amt, 'swap_amount_option')
      minimumReceive = asInt(min, 'minimum_receive')
    } else {
      throw new PlutusDataError(`order step ${step.index} is not a plain swap`)
    }

    const expiryOpt = fields[8]
    let expiry: MinswapV2Order['expiry'] = null
    if (expiryOpt.kind !== 'constr') throw new PlutusDataError('expiry: bad option')
    if (expiryOpt.index === 0) {
      const [pair] = asConstr(expiryOpt, 'expiry', 0, 1)
      // Aiken encodes a 2-tuple as a list.
      const items = asList(pair, 'expiry tuple')
      if (items.length !== 2) throw new PlutusDataError('expiry: expected a pair')
      expiry = { expiresAtMs: asInt(items[0], 'expiry time'), maxTip: asInt(items[1], 'expiry tip') }
    } else {
      asConstr(expiryOpt, 'expiry', 1, 0)
    }

    return {
      canceller: credential(fields[0], 'canceller'),
      refundReceiver: address(fields[1], 'refund_receiver'),
      refundReceiverHasDatum: hasExtraDatum(fields[2], 'refund_receiver_datum'),
      successReceiver: address(fields[3], 'success_receiver'),
      successReceiverHasDatum: hasExtraDatum(fields[4], 'success_receiver_datum'),
      lpAsset,
      stepKind,
      routing,
      swapAmount: amount,
      minimumReceive,
      killable,
      maxBatcherFee: asInt(fields[7], 'max_batcher_fee'),
      expiry,
    }
  } catch (e) {
    if (e instanceof PlutusDataError) throw new MinswapOrderError(`Minswap order datum: ${e.message}`)
    throw e
  }
}

/** `policy ‖ name` bytes of an asset as the contracts hash it. ADA is empty ‖ empty. */
function assetIdentBytes(unit: string): Uint8Array {
  if (unit === CARDANO_LOVELACE) return new Uint8Array(0)
  const split = splitCardanoUnit(unit)
  if (!split) throw new MinswapOrderError(`not a Cardano asset unit: ${unit}`)
  return hexToBytes(split.policyId + split.assetNameHex)
}

/** (policy, name) of a unit, ADA being the empty pair — the contracts' sort key. */
function sortKey(unit: string): [string, string] {
  if (unit === CARDANO_LOVELACE) return ['', '']
  const split = splitCardanoUnit(unit)
  if (!split) throw new MinswapOrderError(`not a Cardano asset unit: ${unit}`)
  return [split.policyId, split.assetNameHex]
}

/**
 * `sorted_asset(a, b)` from utils.ak: policy first, then name, as raw bytes.
 * Lowercase hex strings of equal-width bytes compare the same as the bytes, and a
 * shorter prefix sorts first in both, so string comparison is exact here.
 */
function sortsBefore(a: string, b: string): boolean {
  const [pa, na] = sortKey(a)
  const [pb, nb] = sortKey(b)
  return pa === pb ? na < nb : pa < pb
}

/**
 * The pool's asset A and asset B for a pair, and the LP asset name the pool
 * validator would mint for it:
 * sha3_256(sha3_256(A.policy ‖ A.name) ‖ sha3_256(B.policy ‖ B.name)).
 */
export function minswapV2Pool(unitX: string, unitY: string): { assetA: string; assetB: string; lpAssetName: string } {
  if (unitX === unitY) throw new MinswapOrderError('a pool cannot trade an asset for itself')
  const [assetA, assetB] = sortsBefore(unitX, unitY) ? [unitX, unitY] : [unitY, unitX]
  const identA = sha3_256(assetIdentBytes(assetA))
  const identB = sha3_256(assetIdentBytes(assetB))
  const pair = new Uint8Array(64)
  pair.set(identA, 0)
  pair.set(identB, 32)
  return { assetA, assetB, lpAssetName: hex(sha3_256(pair)) }
}

/**
 * Prove the order's route turns `path[0]` into `path[path.length - 1]`.
 *
 * `path` is the token sequence the quote described (sell, intermediates, buy).
 * It is a claim from the backend, but a harmless one to accept: every hop is
 * checked against the datum, so a path that does not match the pools the order
 * actually names — or ends at a different token — fails here. What cannot be
 * forged is the final token, which the caller pins to the approved buy unit.
 */
export function verifyMinswapV2Route(order: MinswapV2Order, path: string[]): void {
  if (path.length !== order.routing.length + 1) {
    throw new MinswapOrderError(
      `route has ${order.routing.length} hop(s) but the quote described ${Math.max(0, path.length - 1)}`)
  }
  order.routing.forEach((hop, i) => {
    const from = path[i]
    const to = path[i + 1]
    const pool = minswapV2Pool(from, to)
    if (pool.lpAssetName !== hop.lpAssetName) {
      throw new MinswapOrderError(`hop ${i + 1} names a pool that does not trade ${from} for ${to}`)
    }
    const expectedAToB = pool.assetA === from
    if (hop.aToB !== expectedAToB) {
      throw new MinswapOrderError(`hop ${i + 1} swaps in the wrong direction`)
    }
  })
}
