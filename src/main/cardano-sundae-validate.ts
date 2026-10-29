/**
 * cardano-sundae-validate.ts — is this provider-built SundaeSwap V3 order the
 * one the user approved? (privileged layer, shared by all four targets)
 *
 * A SEPARATE validator from the Minswap V2 order check (cardano-swap-validate.ts),
 * which stays exactly as strict as before. A V3 order creation is the same
 * transaction CLASS as a V2 one — it runs no scripts, it only locks the sale at
 * an order script — so the body, input and balance rules are the V2 rules. What
 * differs is the order output and its datum (sundae-v3-order.ts). Accepted only
 * in the shape measured live on 2026-10-28 from Minswap's aggregator
 * (`include_protocols: ["SundaeSwapV3"]`, one pool):
 *
 *   inputs    only the wallet's own unspent key-hash UTxOs
 *   outputs   ONE order output at the published V3 order script, staked to the
 *             aggregator's pinned V3 staking part (or to the wallet), with an
 *             inline datum: the QUOTED pool, this wallet's key as owner, this
 *             wallet's address as destination (no datum), Swap of exactly the
 *             sell amount for at least the approved minimum; at most ONE
 *             aggregator-fee output (pinned address, ADA only, the quoted
 *             amount); change to the wallet's own address; nothing else
 *   body      no certificates, withdrawals, mint, collateral, reference
 *             inputs, required signers, script data, votes, proposals or donation
 *   witnesses none yet (the wallet adds the only one)
 *
 * A V3 order has no expiry: an order the pool can no longer fill at its minimum
 * stays open until its owner cancels it (the owner key's signature alone).
 */

import { decodeCbor, CborMap, CborError, type CborValue } from './cardano-tx-inspect'
import {
  CARDANO_SWAP_LIMITS, MINSWAP_AGGREGATOR_FEE_KEY_HASH, CardanoSwapValidationError,
  hexToBytesStrict, splitTxRoot, txIdOf, strictOutput, strictInputs, walletKeys, uintString,
  type MinswapOrderExpectation, type WalletUtxo, type WalletKeys, type StrictOutput,
} from './cardano-swap-validate'
import { SUNDAE_V3, decodeSundaeV3OrderDatum, SundaeOrderError, type SundaeV3Order } from './sundae-v3-order'
import { CARDANO_LOVELACE, splitCardanoUnit } from '../shared/swap-token-identity'
import type { CardanoSwapCost } from '../shared/swap-quote'

export interface ValidatedSundaeOrder {
  txId: string
  orderOutputIndex: number
  order: SundaeV3Order
  cost: CardanoSwapCost
}

const fail = (why: string): never => { throw new CardanoSwapValidationError(why) }
const hex = (b: Uint8Array): string => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

type OutputRole = 'change' | 'order' | 'aggregator-fee'

function roleOf(addr: Uint8Array, w: WalletKeys): OutputRole | null {
  if ((addr[0] & 0x0f) !== w.networkNibble) fail('an output is addressed to a different Cardano network')
  const type = addr[0] >> 4
  if (hex(addr) === w.bytes) return 'change'
  // Type 1 = script payment + key stake: the V3 order output.
  if (type === 1 && addr.length === 57 && hex(addr.slice(1, 29)) === SUNDAE_V3.orderScriptHash) {
    const stake = hex(addr.slice(29, 57))
    if (stake === SUNDAE_V3.aggregatorOrderStakeHash || stake === w.stakeKeyHash) return 'order'
    fail('the SundaeSwap order is staked to an unknown key')
  }
  if (type === 6 && addr.length === 29 && hex(addr.slice(1, 29)) === MINSWAP_AGGREGATOR_FEE_KEY_HASH) return 'aggregator-fee'
  return null
}

/**
 * Validate a SundaeSwap V3 order-creation transaction against the approved
 * terms. Arguments as `validateMinswapOrderTx`.
 */
export function validateSundaeOrderTx(
  txHex: string,
  expect: MinswapOrderExpectation,
  walletUtxos: ReadonlyMap<string, WalletUtxo>,
  nowSlot: bigint | null,
): ValidatedSundaeOrder {
  const tx = hexToBytesStrict(txHex)
  const parts = splitTxRoot(tx)
  const w = walletKeys(expect.walletAddress, expect.network)

  // ── Terms the quote committed to ─────────────────────────────────────────
  const sellAmount = uintString(expect.sellAmountRaw, 'sell amount')
  const buyAmount = uintString(expect.buyAmountRaw, 'buy amount')
  const approvedMin = uintString(expect.minBuyAmountRaw, 'minimum received')
  const protocolFee = uintString(expect.terms.batcherFeeLovelace, 'protocol fee')
  const deposit = uintString(expect.terms.depositLovelace, 'deposit')
  const aggregatorFee = uintString(expect.terms.aggregatorFeeLovelace, 'aggregator fee')
  if (sellAmount <= 0n || approvedMin <= 0n || approvedMin > buyAmount) fail('quote amounts are inconsistent')
  if (expect.terms.protocol !== 'SundaeSwapV3') fail('only SundaeSwap V3 orders are checked here')
  const poolIdent = expect.terms.poolIdent
  if (typeof poolIdent !== 'string' || !/^[0-9a-f]{2,64}$/.test(poolIdent)) fail('the quote names no SundaeSwap pool')
  if (protocolFee > CARDANO_SWAP_LIMITS.maxBatcherFeeLovelace) fail('protocol fee exceeds the wallet limit')
  if (deposit > CARDANO_SWAP_LIMITS.maxDepositLovelace) fail('order deposit exceeds the wallet limit')
  if (aggregatorFee > CARDANO_SWAP_LIMITS.maxAggregatorFeeLovelace) fail('aggregator fee exceeds the wallet limit')
  const sellIsAda = expect.sellUnit === CARDANO_LOVELACE
  if (!sellIsAda && !splitCardanoUnit(expect.sellUnit)) fail('sell token is not a Cardano unit')
  if (expect.buyUnit !== CARDANO_LOVELACE && !splitCardanoUnit(expect.buyUnit)) fail('buy token is not a Cardano unit')
  const path = expect.terms.path
  if (!Array.isArray(path) || path.length !== 2 || path[0] !== expect.sellUnit || path[1] !== expect.buyUnit) {
    fail('the quoted route is not one pool from the sell token to the buy token')
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

  // Same allow-list as a V2 order: inputs outputs fee ttl aux-hash validity-start network-id.
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
    if (role === null) fail(`output ${i} pays an address that is neither this wallet, the SundaeSwap order script nor the aggregator fee address`)
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
  if (!orderOutput) return fail('the transaction creates no SundaeSwap order')
  const order: StrictOutput = orderOutput

  // ── The order: every term that protects the user ─────────────────────────
  if (!order.inlineDatum) fail('the order carries no inline datum')
  let parsed: SundaeV3Order
  try {
    parsed = decodeSundaeV3OrderDatum(order.inlineDatum as Uint8Array)
  } catch (e) {
    if (e instanceof SundaeOrderError) return fail(e.message)
    throw e
  }
  if (parsed.poolIdent !== poolIdent) fail('the order names a different pool than the quote')
  if (parsed.ownerKeyHash !== w.stakeKeyHash && parsed.ownerKeyHash !== w.paymentKeyHash) {
    fail('someone other than this wallet could cancel the order')
  }
  const d = parsed.destination
  if (d.payment.kind !== 'key' || d.payment.hash !== w.paymentKeyHash || !d.stake || d.stake.kind !== 'key' || d.stake.hash !== w.stakeKeyHash) {
    fail('the order pays its proceeds to an address that is not this wallet')
  }
  if (parsed.offerUnit !== expect.sellUnit || parsed.offerAmount !== sellAmount) fail('the order sells a different amount than the quote')
  if (parsed.minReceivedUnit !== expect.buyUnit) fail('the order buys a different token than the quote')
  if (parsed.minReceived < approvedMin) fail('the order\'s minimum received is below the one you approved')
  if (parsed.minReceived > buyAmount) fail('the order\'s minimum received exceeds the quoted output')
  if (parsed.maxProtocolFee !== protocolFee) fail('the order\'s protocol fee differs from the quote')

  // What the order output must hold: the sell amount, plus the protocol fee and
  // the refundable deposit in ADA — nothing more, nothing less.
  const orderAssets = order.value.assets
  if (sellIsAda) {
    if (orderAssets.size !== 0) fail('the order locks tokens that are not being sold')
    if (order.value.lovelace !== sellAmount + protocolFee + deposit) fail('the order locks a different amount of ADA than quoted')
  } else {
    if (orderAssets.size !== 1 || orderAssets.get(expect.sellUnit) !== sellAmount) {
      fail('the order locks a different token amount than the one being sold')
    }
    if (order.value.lovelace !== protocolFee + deposit) fail('the order locks a different amount of ADA than quoted')
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
  if (adaOut !== fee + order.value.lovelace + aggregatorFee) fail('the transaction does not balance to the quoted costs')

  return {
    txId: txIdOf(parts.body),
    orderOutputIndex: orderIndex,
    order: parsed,
    cost: {
      txFeeLovelace: fee.toString(),
      batcherFeeLovelace: protocolFee.toString(),
      depositLovelace: deposit.toString(),
      aggregatorFeeLovelace: aggregatorFee.toString(),
      adaSpentLovelace: adaOut.toString(),
      validUntilSlot: ttl.toString(),
      orderMinimumRaw: parsed.minReceived.toString(),
      killable: null,
    },
  }
}
