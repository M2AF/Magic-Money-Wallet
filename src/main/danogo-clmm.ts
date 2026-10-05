/**
 * danogo-clmm.ts — Danogo concentrated-liquidity pools: pinned identities and
 * strict decoders for the pool datum and the swap redeemer (privileged layer).
 *
 * Source: Danogo's published integration guide (docs.dano.finance, developers →
 * integration → concentrated-liquidity-pool-integration, read 2026-10-05) and
 * its reference SDK (github.com/dano-finance/clmm-sdk). Every constant below was
 * also checked against mainnet on 2026-10-05: the pool-script reference UTxO
 * carries a PlutusV3 script whose hash is POOL_SCRIPT_HASH, and the protocol
 * config UTxO's inline datum is `[platform_fee_rate 1000, swap_fee 100000]`.
 *
 * A Danogo swap is NOT a batcher order. The transaction spends the pool UTxO
 * itself and pays the trader in the same transaction, so it either executes at
 * exactly the amounts written into it or does not execute at all (if the pool
 * moved first, its old UTxO is gone and Cardano rejects the transaction).
 */

import { decodePlutusData, asConstr, asInt, asBytes, PlutusDataError } from './cardano-plutus-data'
import { CARDANO_LOVELACE } from '../shared/swap-token-identity'

export const DANOGO_CLMM = {
  /** Pool validator; also the pool NFT's minting policy and the withdraw-zero credential. */
  poolScriptHash: 'd8b69fc53637bcfadbc4469083f706bc293f4d9d2296646c5ca167bb',
  /** Reference input carrying the pool script. */
  poolScriptRef: '64d111b957e7d7848ffdde5149aa77fa4090a7fa1ad0ac108067900614848501#0',
  /** Reference input carrying the protocol config datum. */
  protocolConfigRef: '2cafd7c92f7093e5229af274be83dea660b0590b4174bbed79ba662b44fbd1ee#0',
  /**
   * protocol_config.swap_fee: lovelace every swap adds to the pool's
   * total_swap_fee. A changed config lives at a NEW reference UTxO, so the pinned
   * reference above fails closed before a different fee could be charged.
   */
  swapFeeLovelace: 100_000n,
  /** protocol_config.platform_fee_rate, in basis points of the LP fee. */
  platformFeeRate: 1000n,
  /** ADA every ADA-pool UTxO keeps out of its tradable reserve. */
  poolMinAdaLovelace: 3_000_000n,
} as const

/** Action byte of ExchangeActionRedeemer for a swap. */
const SWAP_ACTION = 0x03

export class DanogoError extends Error {}

export interface DanogoPoolDatum {
  /** Full Cardano units: `lovelace` for ADA, else policy + asset name hex. */
  tokenX: string
  tokenY: string
  lpFeeRate: bigint
  platformFeeX: bigint
  platformFeeY: bigint
  totalSwapFee: bigint
  sqrtLowerPrice: [bigint, bigint]
  sqrtUpperPrice: [bigint, bigint]
  minXChange: bigint
  minYChange: bigint
  circulatingLpToken: bigint
  lastWithdrawEpoch: bigint
}

const hex = (b: Uint8Array): string => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

function tupleAsset(fields: ReturnType<typeof asConstr>, what: string): string {
  if (fields.length !== 2) throw new PlutusDataError(`${what}: expected [policy, name]`)
  const policy = asBytes(fields[0], `${what} policy`)
  const name = asBytes(fields[1], `${what} name`)
  if (policy.length === 0) {
    if (name.length !== 0) throw new PlutusDataError(`${what}: ADA with an asset name`)
    return CARDANO_LOVELACE
  }
  if (policy.length !== 28 || name.length > 32) throw new PlutusDataError(`${what}: malformed asset`)
  return hex(policy) + hex(name)
}

function asTupleAsset(d: Parameters<typeof asConstr>[0], what: string): string {
  // TupleAsset is an Aiken tuple: encoded as a Plutus list, or a constr 0 in
  // some encoders. Accept exactly those two shapes.
  if (d.kind === 'list') return tupleAsset(d.items, what)
  return tupleAsset(asConstr(d, what, 0), what)
}

function rational(d: Parameters<typeof asConstr>[0], what: string): [bigint, bigint] {
  const f = asConstr(d, what, 0, 2)
  const num = asInt(f[0], `${what} numerator`)
  const den = asInt(f[1], `${what} denominator`)
  if (num <= 0n || den <= 0n) throw new PlutusDataError(`${what}: not a positive rational`)
  return [num, den]
}

export function decodeDanogoPoolDatum(datumBytes: Uint8Array): DanogoPoolDatum {
  try {
    const f = asConstr(decodePlutusData(datumBytes), 'PoolDatum', 0, 12)
    return {
      tokenX: asTupleAsset(f[0], 'token_X'),
      tokenY: asTupleAsset(f[1], 'token_Y'),
      lpFeeRate: asInt(f[2], 'lp_fee_rate'),
      platformFeeX: asInt(f[3], 'platform_fee_X'),
      platformFeeY: asInt(f[4], 'platform_fee_Y'),
      totalSwapFee: asInt(f[5], 'total_swap_fee'),
      sqrtLowerPrice: rational(f[6], 'sqrt_lower_price'),
      sqrtUpperPrice: rational(f[7], 'sqrt_upper_price'),
      minXChange: asInt(f[8], 'min_x_change'),
      minYChange: asInt(f[9], 'min_y_change'),
      circulatingLpToken: asInt(f[10], 'circulating_lp_token'),
      lastWithdrawEpoch: asInt(f[11], 'last_withdraw_epoch'),
    }
  } catch (e) {
    if (e instanceof PlutusDataError) throw new DanogoError(`Danogo pool datum: ${e.message}`)
    throw e
  }
}

/** One pool's swap: `<in_idx><0x03><pool_in_idx><pool_out_idx><delta: int256>`. */
export interface DanogoSwapRedeemer {
  inIdx: number
  poolInIdx: number
  poolOutIdx: number
  /** > 0: the trader sells token X; < 0: the trader sells token Y. */
  delta: bigint
}

/**
 * Decode a single-pool swap redeemer from the redeemer's ByteArray CONTENT. A
 * multi-pool redeemer (more than one SwapParams) and every other action are
 * refused.
 */
export function decodeDanogoSwapRedeemer(bytes: Uint8Array): DanogoSwapRedeemer {
  if (!(bytes instanceof Uint8Array)) throw new DanogoError('Danogo redeemer is not a byte array')
  if (bytes.length !== 36) throw new DanogoError('Danogo redeemer is not a single-pool swap')
  if (bytes[1] !== SWAP_ACTION) throw new DanogoError('Danogo redeemer is not a swap')
  let delta = 0n
  for (let i = 4; i < 36; i++) delta = (delta << 8n) | BigInt(bytes[i])
  if (bytes[4] & 0x80) delta -= 1n << 256n
  if (delta === 0n) throw new DanogoError('Danogo redeemer swaps nothing')
  return { inIdx: bytes[0], poolInIdx: bytes[2], poolOutIdx: bytes[3], delta }
}

// ── The published swap rule (used to check recorded transactions) ─────────────

function isqrt(v: bigint): bigint {
  if (v < 0n) throw new DanogoError('negative square root')
  if (v < 2n) return v
  let x0 = v
  let x1 = (x0 + v / x0) >> 1n
  while (x1 < x0) { x0 = x1; x1 = (x0 + v / x0) >> 1n }
  return x0
}

const ceilDiv = (a: bigint, b: bigint): bigint => {
  const q = a / b
  return a % b !== 0n && (a < 0n) === (b < 0n) ? q + 1n : q
}

/**
 * The smallest amount the pool must keep after a swap, per Danogo's published
 * rule: for the token the pool pays out, `poolChange >= CEIL(X_v*Y_v /
 * (V_in + amountIn*offFee) - V_out)` (a negative number — the most the pool may
 * pay). Returns the most the pool may pay out, as a positive amount. Mirrors the
 * reference SDK's `calculateConcentratedPoolSwap` for one pool with no reward
 * withdrawal. Used by tests on recorded transactions; signing never depends on
 * it, because the pool script enforces it on chain.
 */
export function danogoMaxPayout(
  pool: { reserveX: bigint; reserveY: bigint },
  datum: DanogoPoolDatum,
  delta: bigint,
): bigint {
  const excludedAda = datum.tokenX === CARDANO_LOVELACE ? DANOGO_CLMM.poolMinAdaLovelace + datum.totalSwapFee : 0n
  const x = pool.reserveX - datum.platformFeeX - excludedAda
  const y = pool.reserveY - datum.platformFeeY
  const [pa0, pa1] = datum.sqrtLowerPrice
  const [pb0, pb1] = datum.sqrtUpperPrice
  const denAB = pa1 * pb1
  const numAB = pa0 * pb0
  const diff = y * denAB - x * numAB
  const root = isqrt(diff * diff + 4n * x * y * pa1 * pa1 * pb0 * pb0)
  const lNum = y * denAB + x * numAB + root
  const lDen = 2n * (pb0 * pa1 - pb1 * pa0)
  const xV = ceilDiv(lNum * pb1, lDen * pb0) + x
  const yV = ceilDiv(lNum * pa0, lDen * pa1) + y
  const BASE = 10_000n
  const amountIn = delta < 0n ? -delta : delta
  const [vIn, vOut] = delta > 0n ? [xV, yV] : [yV, xV]
  const offFee = BASE - datum.lpFeeRate
  const denominator = vIn * BASE + amountIn * offFee
  return (vOut * denominator - vIn * vOut * BASE) / denominator
}
