/**
 * cardano-danogo-validate.ts — is this provider-built Danogo swap the one the
 * user approved? (privileged layer, shared by all four targets)
 *
 * A SEPARATE validator from the Minswap V2 order check (cardano-swap-validate.ts),
 * which stays exactly as strict as before. A Danogo concentrated-liquidity swap
 * is a different transaction class: it spends the pool's own UTxO, runs the pool
 * script (redeemers, reference scripts, withdraw-zero) and uses collateral. It is
 * accepted only in the shape measured live on 2026-10-05 from Minswap's
 * aggregator (`include_protocols: ["DanogoCLMMV1"]`, one hop), and checked
 * against Danogo's published integration rules (see danogo-clmm.ts):
 *
 *   inputs      the wallet's own unspent coins + exactly ONE foreign input, the
 *               pool UTxO, spent by the swap redeemer
 *   reference   the pinned pool-script and protocol-config UTxOs, plus at most
 *               one more (the pool's staking-script reference)
 *   withdrawals script reward accounts only, including the pool script's
 *               withdraw-zero
 *   collateral  the PROVIDER's coins, never this wallet's
 *   outputs     the pool's continuing output (pool script, its NFT, an inline
 *               pool datum for exactly this token pair); at most one aggregator
 *               fee output (pinned address, the quoted amount); this wallet's
 *               own address; nothing else
 *   redeemers   single-pool SWAP, pointing at that pool input and output, with
 *               delta = the sell amount in the direction of the sale
 *   witnesses   the provider's own vkey witness (for its collateral) and the
 *               redeemers; no scripts or datums in the witness set
 *   body        no mint, certificates, required signers, collateral return,
 *               votes, proposals or donation
 *
 * The pool's pricing rule is enforced by the pool script on chain; it is not
 * re-derived at signing time. What protects the user here is that the wallet's
 * NET change is read out of the bytes: exactly the sell amount and the stated
 * fees leave, and at least the approved amount arrives. The swap is atomic, so
 * the amount written into the transaction is exactly what is delivered — or
 * nothing happens (a pool that moved first makes the transaction invalid).
 *
 * Supported pairs: ADA on one side (both directions measured). Token-to-token
 * Danogo pools and multi-pool routes are refused.
 */

import { blake2b } from '@noble/hashes/blake2b'
import { decodeCbor, CborMap, CborError, type CborValue } from './cardano-tx-inspect'
import {
  CARDANO_SWAP_LIMITS, MINSWAP_AGGREGATOR_FEE_KEY_HASH, CardanoSwapValidationError,
  hexToBytesStrict, splitTxRoot, txIdOf, strictOutput, strictInputs, walletKeys, uintString,
  type MinswapOrderExpectation, type WalletUtxo,
} from './cardano-swap-validate'
import { DANOGO_CLMM, decodeDanogoPoolDatum, decodeDanogoSwapRedeemer, DanogoError, type DanogoSwapRedeemer } from './danogo-clmm'
import { CARDANO_LOVELACE, splitCardanoUnit } from '../shared/swap-token-identity'
import type { CardanoSwapCost } from '../shared/swap-quote'

export interface ValidatedDanogoSwap {
  txId: string
  poolOutputIndex: number
  redeemer: DanogoSwapRedeemer
  /** What the wallet receives, read from its own outputs (base units of the buy token). */
  deliveredRaw: string
  cost: CardanoSwapCost
}

const fail = (why: string): never => { throw new CardanoSwapValidationError(why) }
const hex = (b: Uint8Array): string => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

/** Ledger order of a transaction input or reference input set. */
const byRef = (a: string, b: string): number => {
  const [ha, ia] = a.split('#'); const [hb, ib] = b.split('#')
  return ha !== hb ? (ha < hb ? -1 : 1) : Number(ia) - Number(ib)
}

interface RawRedeemer { tag: bigint; index: bigint; data: CborValue }

function redeemersOf(v: CborValue | undefined): RawRedeemer[] {
  const out: RawRedeemer[] = []
  if (Array.isArray(v)) {
    for (const r of v) {
      if (!Array.isArray(r) || r.length !== 4 || typeof r[0] !== 'bigint' || typeof r[1] !== 'bigint') fail('malformed redeemer')
      out.push({ tag: (r as CborValue[])[0] as bigint, index: (r as CborValue[])[1] as bigint, data: (r as CborValue[])[2] })
    }
  } else if (v instanceof CborMap) {
    for (const [k, val] of v.entries) {
      if (!Array.isArray(k) || k.length !== 2 || typeof k[0] !== 'bigint' || typeof k[1] !== 'bigint'
          || !Array.isArray(val) || val.length !== 2) fail('malformed redeemer')
      out.push({ tag: (k as CborValue[])[0] as bigint, index: (k as CborValue[])[1] as bigint, data: (val as CborValue[])[0] })
    }
  } else {
    fail('the transaction carries no redeemers')
  }
  if (!out.length) fail('the transaction carries no redeemers')
  return out
}

function swapRedeemer(r: RawRedeemer): DanogoSwapRedeemer {
  if (!(r.data instanceof Uint8Array)) return fail('a redeemer is not a Danogo swap')
  try { return decodeDanogoSwapRedeemer(r.data) } catch (e) {
    if (e instanceof DanogoError) return fail(e.message)
    throw e
  }
}

/**
 * Validate a Danogo single-pool swap built by Minswap's aggregator.
 *
 * `walletUtxos` must be the wallet's CURRENT unspent set at `walletAddress`.
 * `nowSlot` checks the validity window (Danogo requires one of at most six
 * minutes); pass null only when the tip genuinely could not be read.
 */
export function validateDanogoSwapTx(
  txHex: string,
  expect: MinswapOrderExpectation,
  walletUtxos: ReadonlyMap<string, WalletUtxo>,
  nowSlot: bigint | null,
): ValidatedDanogoSwap {
  const parts = splitTxRoot(hexToBytesStrict(txHex))
  const w = walletKeys(expect.walletAddress, expect.network)

  // ── Terms the quote committed to ─────────────────────────────────────────
  const terms = expect.terms
  if (terms.protocol !== 'DanogoCLMMV1') fail('this check only accepts Danogo swaps')
  const sellAmount = uintString(expect.sellAmountRaw, 'sell amount')
  const buyAmount = uintString(expect.buyAmountRaw, 'buy amount')
  const approvedMin = uintString(expect.minBuyAmountRaw, 'minimum received')
  const aggregatorFee = uintString(terms.aggregatorFeeLovelace, 'aggregator fee')
  const swapFee = uintString(terms.dexFeeLovelace ?? '', 'Danogo swap fee')
  if (sellAmount <= 0n || approvedMin <= 0n || approvedMin > buyAmount) fail('quote amounts are inconsistent')
  if (terms.batcherFeeLovelace !== '0' || terms.depositLovelace !== '0') fail('a Danogo swap has no batcher fee or deposit')
  if (swapFee !== DANOGO_CLMM.swapFeeLovelace) fail('the Danogo swap fee differs from the protocol\'s')
  if (aggregatorFee > CARDANO_SWAP_LIMITS.maxAggregatorFeeLovelace) fail('aggregator fee exceeds the wallet limit')
  const sellIsAda = expect.sellUnit === CARDANO_LOVELACE
  const buyIsAda = expect.buyUnit === CARDANO_LOVELACE
  if (sellIsAda === buyIsAda) fail('only Danogo swaps between ADA and a token are supported')
  const token = sellIsAda ? expect.buyUnit : expect.sellUnit
  if (!splitCardanoUnit(token)) fail('the token is not a Cardano unit')
  if (!Array.isArray(terms.path) || terms.path.length !== 2
      || terms.path[0] !== expect.sellUnit || terms.path[1] !== expect.buyUnit) {
    fail('the quoted route is not one Danogo pool between the sell and buy tokens')
  }

  // ── Root ─────────────────────────────────────────────────────────────────
  if (parts.isValid.length !== 1 || parts.isValid[0] !== 0xf5) fail('the transaction is not marked valid')
  let body: CborValue
  let witnessSet: CborValue
  try {
    body = decodeCbor(parts.body)
    witnessSet = decodeCbor(parts.witnessSet)
  } catch (e) { return fail(`transaction: ${e instanceof CborError ? e.message : 'undecodable'}`) }
  if (!(body instanceof CborMap)) return fail('body is not a map')
  if (!(witnessSet instanceof CborMap)) return fail('witness set is not a map')

  // inputs(0) outputs(1) fee(2) ttl(3) withdrawals(5) aux-hash(7) validity-start(8)
  // script-data hash(11) collateral(13) network-id(15) reference inputs(18).
  const ALLOWED = new Set([0, 1, 2, 3, 5, 7, 8, 11, 13, 15, 18])
  const names: Record<number, string> = {
    4: 'certificates', 9: 'minting', 14: 'required signers', 16: 'collateral return', 17: 'total collateral',
    19: 'governance votes', 20: 'governance proposals', 21: 'treasury value', 22: 'a treasury donation',
  }
  const seenKeys = new Set<number>()
  for (const [k] of body.entries) {
    if (typeof k !== 'bigint') fail('body has a non-integer key')
    const key = Number(k)
    if (seenKeys.has(key)) fail('body repeats a field')
    seenKeys.add(key)
    if (!ALLOWED.has(key)) fail(`the transaction includes ${names[key] ?? `unknown body field ${key}`}`)
  }
  for (const required of [5, 11, 13, 18]) if (!seenKeys.has(required)) fail('the transaction is not a Danogo pool swap')
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

  // ── Inputs: the wallet's coins, plus exactly one pool UTxO ───────────────
  const inputs = strictInputs(body.getInt(0), 'inputs').sort(byRef)
  const spent = { lovelace: 0n, assets: new Map<string, bigint>() }
  const foreign: number[] = []
  inputs.forEach((key, i) => {
    const utxo = walletUtxos.get(key)
    if (!utxo) { foreign.push(i); return }
    spent.lovelace += utxo.lovelace
    for (const a of utxo.assets) spent.assets.set(a.unit, (spent.assets.get(a.unit) ?? 0n) + a.quantity)
  })
  if (foreign.length !== 1) fail('the transaction must spend exactly one pool besides this wallet\'s coins')
  if (foreign.length === inputs.length) fail('the transaction spends none of this wallet\'s coins')
  const poolInputIndex = foreign[0]

  const collateral = strictInputs(body.getInt(13), 'collateral')
  if (collateral.length > 3) fail('the transaction offers unusual collateral')
  if (collateral.some(k => walletUtxos.has(k))) fail('the transaction would put this wallet\'s coins up as collateral')

  const refs = strictInputs(body.getInt(18), 'reference inputs').sort(byRef)
  if (!refs.includes(DANOGO_CLMM.poolScriptRef) || !refs.includes(DANOGO_CLMM.protocolConfigRef)) {
    fail('the transaction does not use Danogo\'s published pool script and protocol config')
  }
  if (refs.length > 3) fail('the transaction reads unexpected reference inputs')
  if (refs.some(k => walletUtxos.has(k))) fail('the transaction reads this wallet\'s coins as reference inputs')
  const protocolConfigIndex = refs.indexOf(DANOGO_CLMM.protocolConfigRef)

  // ── Withdrawals: script reward accounts only, incl. the pool withdraw-zero ─
  const withdrawalsRaw = body.getInt(5)
  if (!(withdrawalsRaw instanceof CborMap) || withdrawalsRaw.size === 0 || withdrawalsRaw.size > 3) {
    return fail('the transaction has unexpected withdrawals')
  }
  const withdrawals: Array<{ hash: string; bytes: string; amount: bigint }> = []
  for (const [acct, amount] of withdrawalsRaw.entries) {
    if (!(acct instanceof Uint8Array) || acct.length !== 29 || typeof amount !== 'bigint' || amount < 0n) {
      fail('malformed withdrawal')
    }
    const a = acct as Uint8Array
    // Header 0xF_: a reward account whose credential is a SCRIPT.
    if ((a[0] >> 4) !== 0xf || (a[0] & 0x0f) !== w.networkNibble) fail('the transaction withdraws from a non-script reward account')
    withdrawals.push({ hash: hex(a.slice(1, 29)), bytes: hex(a), amount: amount as bigint })
  }
  withdrawals.sort((x, y) => (x.bytes < y.bytes ? -1 : x.bytes > y.bytes ? 1 : 0))
  const poolWithdrawal = withdrawals.findIndex(x => x.hash === DANOGO_CLMM.poolScriptHash)
  if (poolWithdrawal < 0 || withdrawals[poolWithdrawal].amount !== 0n) fail('the transaction lacks the pool script\'s withdraw-zero')

  // ── Outputs: every one classified, none skipped ──────────────────────────
  const outputsRaw = body.getInt(1)
  if (!Array.isArray(outputsRaw) || outputsRaw.length === 0) return fail('the transaction has no outputs')
  const kept = { lovelace: 0n, assets: new Map<string, bigint>() }
  let poolOutputIndex = -1
  let feeOutputs = 0
  const pool = { tokenX: '' }
  outputsRaw.forEach((raw, i) => {
    const out = strictOutput(raw, i)
    const addr = out.addressBytes
    if ((addr[0] & 0x0f) !== w.networkNibble) fail('an output is addressed to a different Cardano network')
    const type = addr[0] >> 4
    if (hex(addr) === w.bytes) {
      if (out.inlineDatum) fail(`output ${i} attaches a datum to this wallet's own coins`)
      kept.lovelace += out.value.lovelace
      for (const [u, q] of out.value.assets) kept.assets.set(u, (kept.assets.get(u) ?? 0n) + q)
      return
    }
    if (type === 6 && addr.length === 29 && hex(addr.slice(1, 29)) === MINSWAP_AGGREGATOR_FEE_KEY_HASH) {
      feeOutputs++
      if (feeOutputs > 1) fail('the transaction pays the aggregator fee more than once')
      if (out.inlineDatum || out.value.assets.size) fail('the aggregator fee output carries more than ADA')
      if (out.value.lovelace !== aggregatorFee) fail('the aggregator fee differs from the quote')
      return
    }
    // Script payment credential (address types 1, 3, 5, 7) of the pool validator.
    if (type <= 7 && (type & 1) === 1 && addr.length >= 29 && hex(addr.slice(1, 29)) === DANOGO_CLMM.poolScriptHash) {
      if (poolOutputIndex >= 0) fail('the transaction pays more than one Danogo pool')
      poolOutputIndex = i
      const nfts = [...out.value.assets].filter(([u]) => u.startsWith(DANOGO_CLMM.poolScriptHash))
      if (nfts.length !== 1 || nfts[0][1] !== 1n) fail('the pool output does not carry exactly one Danogo pool NFT')
      if (!out.inlineDatum) fail('the pool output carries no pool datum')
      let pair: [string, string]
      try {
        const d = decodeDanogoPoolDatum(out.inlineDatum as Uint8Array)
        pair = [d.tokenX, d.tokenY]
      } catch (e) {
        if (e instanceof DanogoError) return fail(e.message)
        throw e
      }
      const want = [expect.sellUnit, expect.buyUnit].sort().join()
      if ([...pair].sort().join() !== want) fail('the pool trades a different token pair than the quote')
      pool.tokenX = pair[0]
      return
    }
    fail(`output ${i} pays an address that is neither this wallet, the Danogo pool nor the aggregator's fee address`)
  })
  if (feeOutputs === 0 && aggregatorFee !== 0n) fail('the quoted aggregator fee is missing')
  if (poolOutputIndex < 0) fail('the transaction does not return the Danogo pool')

  // ── Witnesses and redeemers: one single-pool swap, pointed at that pool ──
  for (const [k, v] of witnessSet.entries) {
    if (k === 0n) {
      if (!Array.isArray(v) || v.length > 2) fail('the transaction carries unexpected signatures')
      for (const vk of v as CborValue[]) {
        if (!Array.isArray(vk) || vk.length !== 2 || !(vk[0] instanceof Uint8Array) || vk[0].length !== 32) {
          fail('malformed provider signature')
        }
        if (hex(blake2b((vk as CborValue[])[0] as Uint8Array, { dkLen: 28 })) === w.paymentKeyHash) {
          fail('the transaction already carries a signature from this wallet')
        }
      }
    } else if (k !== 5n) {
      fail('the transaction carries scripts or data in its witness set')
    }
  }
  const redeemers = redeemersOf(witnessSet.getInt(5))
  let spends = 0
  const rewardIndexes = new Set<bigint>()
  let swap: DanogoSwapRedeemer | null = null
  for (const r of redeemers) {
    const s = swapRedeemer(r)
    if (s.poolInIdx !== poolInputIndex || s.poolOutIdx !== poolOutputIndex) fail('the swap redeemer points at a different pool')
    if (swap && s.delta !== swap.delta) fail('the redeemers disagree about the swap amount')
    swap = s
    if (r.tag === 0n) {
      spends++
      if (r.index !== BigInt(poolInputIndex) || s.inIdx !== poolInputIndex) fail('the spend redeemer is not for the pool input')
    } else if (r.tag === 3n) {
      if (r.index < 0n || r.index >= BigInt(withdrawals.length) || rewardIndexes.has(r.index)) fail('a withdrawal redeemer is misplaced')
      rewardIndexes.add(r.index)
      if (r.index === BigInt(poolWithdrawal) && s.inIdx !== protocolConfigIndex) {
        fail('the pool withdraw-zero does not reference the protocol config')
      }
    } else {
      fail('the transaction runs a script that is not part of a Danogo swap')
    }
  }
  if (spends !== 1 || rewardIndexes.size !== withdrawals.length || !swap) fail('the swap redeemers are incomplete')
  const redeemer = swap as DanogoSwapRedeemer

  // The pool's X/Y order decides the sign: delta > 0 sells X, delta < 0 sells Y.
  const sellsX = expect.sellUnit === pool.tokenX
  if (redeemer.delta !== (sellsX ? sellAmount : -sellAmount)) fail('the swap sells a different amount than the quote')

  // ── Net effect on the wallet ─────────────────────────────────────────────
  const units = new Set([...spent.assets.keys(), ...kept.assets.keys()])
  let delivered = 0n
  for (const unit of units) {
    const net = (kept.assets.get(unit) ?? 0n) - (spent.assets.get(unit) ?? 0n)
    if (unit === token) {
      if (sellIsAda) { if (net <= 0n) fail('the transaction delivers none of the token being bought'); delivered = net }
      else if (net !== -sellAmount) fail('the transaction sells a different token amount than the quote')
    } else if (net !== 0n) {
      fail('the transaction moves a token of this wallet that is not part of the swap')
    }
  }
  if (!units.has(token)) fail(sellIsAda ? 'the transaction delivers none of the token being bought' : 'the transaction does not spend the token being sold')
  const netAda = kept.lovelace - spent.lovelace
  let adaSpent: bigint
  if (sellIsAda) {
    adaSpent = sellAmount + swapFee + aggregatorFee + fee
    if (-netAda !== adaSpent) fail('the transaction does not balance to the quoted costs')
  } else {
    // The pool pays the ADA bought; the wallet pays the network and aggregator fees.
    delivered = netAda + fee + aggregatorFee
    adaSpent = fee + aggregatorFee
  }
  if (delivered < approvedMin) fail('the transaction delivers less than the minimum you approved')

  return {
    txId: txIdOf(parts.body),
    poolOutputIndex,
    redeemer,
    deliveredRaw: delivered.toString(),
    cost: {
      txFeeLovelace: fee.toString(),
      batcherFeeLovelace: '0',
      depositLovelace: '0',
      aggregatorFeeLovelace: aggregatorFee.toString(),
      dexFeeLovelace: swapFee.toString(),
      adaSpentLovelace: adaSpent.toString(),
      validUntilSlot: ttl.toString(),
      orderMinimumRaw: delivered.toString(),
      killable: null,
    },
  }
}
