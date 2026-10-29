/**
 * sundae-v3-order.ts — what a SundaeSwap V3 swap order actually says (shared)
 *
 * Like a Minswap V2 order, a V3 order transaction does not trade: it locks the
 * sell amount at the V3 ORDER SCRIPT with an inline datum, and a SundaeSwap
 * scooper later executes it against the named pool, or the owner cancels it.
 * The datum is decoded against the PUBLISHED contract, not a sample:
 *
 *   SundaeSwap-finance/sundae-contracts (github), lib/types/order.ak
 *   `OrderDatum` / `Destination` / `Order`, and aicone lib/sundae/multisig.ak
 *   `MultisigScript`. plutus.json lists `order.spend` under the hash below.
 *
 * Only the shape this wallet asks for is accepted: a `Swap` against ONE named
 * pool, owned by one key, paying a fixed address with no datum. Strategies,
 * deposits, withdrawals, `Self` destinations and multisig owners are refused.
 *
 * Platform-neutral: no network, no Buffer, no node: imports.
 */

import {
  decodePlutusData, asConstr, asInt, asBytes, asList,
  PlutusDataError, type PlutusData,
} from './cardano-plutus-data'
import { address, type PlutusAddress } from './minswap-v2-order'
import { CARDANO_LOVELACE } from '../shared/swap-token-identity'

export const SUNDAE_V3 = {
  /** `order.spend` in sundae-contracts plutus.json (checked 2026-10-28). */
  orderScriptHash: 'fa6a58bbe2d0ff05534431c8e2f0ef2cbdc1602a8456e4b13c8f3077',
  /**
   * The staking part the Minswap aggregator builds every V3 order under, the
   * same for every sender (measured in a live build-tx 2026-10-28; pinned the
   * same way by an independent wallet). It only earns staking rights on the
   * locked ADA; spending is decided by the order script and the owner.
   */
  aggregatorOrderStakeHash: 'f217f435f5f34dba69830d9ada013b5c290a4eee6078371cae55298b',
  /** The `extension` field as the aggregator builds it: the bytes of `Constr 0 []`. */
  extensionHex: 'd87980',
} as const

export class SundaeOrderError extends Error {}

export interface SundaeV3Order {
  /** The pool the order may execute against (hex). */
  poolIdent: string
  /** Owner key hash: its signature alone cancels the order. */
  ownerKeyHash: string
  maxProtocolFee: bigint
  destination: PlutusAddress
  offerUnit: string
  offerAmount: bigint
  minReceivedUnit: string
  minReceived: bigint
}

const hex = (b: Uint8Array): string => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

/** `SingletonValue = (PolicyId, AssetName, Int)`; Aiken encodes a tuple as a list. ADA is "" / "". */
function singleton(d: PlutusData, what: string): { unit: string; amount: bigint } {
  const items = asList(d, what)
  if (items.length !== 3) throw new PlutusDataError(`${what}: expected (policy, name, amount)`)
  const policy = asBytes(items[0], `${what} policy`)
  const name = asBytes(items[1], `${what} name`)
  const amount = asInt(items[2], `${what} amount`)
  if (amount <= 0n) throw new PlutusDataError(`${what}: amount is not positive`)
  if (policy.length === 0) {
    if (name.length !== 0) throw new PlutusDataError(`${what}: ADA with an asset name`)
    return { unit: CARDANO_LOVELACE, amount }
  }
  if (policy.length !== 28 || name.length > 32) throw new PlutusDataError(`${what}: malformed asset`)
  return { unit: hex(policy) + hex(name), amount }
}

/** Decode an inline V3 order datum. Throws `SundaeOrderError` for anything but a plain swap. */
export function decodeSundaeV3OrderDatum(datumBytes: Uint8Array): SundaeV3Order {
  try {
    const [poolOpt, owner, maxFee, destination, details, extension] = asConstr(decodePlutusData(datumBytes), 'OrderDatum', 0, 6)

    // pool_ident: Option<Ident>. None would let the order run against ANY pool.
    if (poolOpt.kind !== 'constr' || poolOpt.index !== 0) throw new PlutusDataError('pool_ident: the order names no pool')
    const [ident] = asConstr(poolOpt, 'pool_ident', 0, 1)
    const poolIdent = hex(asBytes(ident, 'pool_ident'))
    if (poolIdent.length === 0 || poolIdent.length > 64) throw new PlutusDataError('pool_ident: malformed')

    // owner: MultisigScript — only Signature { key_hash } (constr 0).
    if (owner.kind !== 'constr' || owner.index !== 0) throw new PlutusDataError('owner: only a single key owner is accepted')
    const [keyHash] = asConstr(owner, 'owner', 0, 1)

    const maxProtocolFee = asInt(maxFee, 'max_protocol_fee')
    if (maxProtocolFee < 0n) throw new PlutusDataError('max_protocol_fee: negative')

    // destination: Fixed { address, datum } (constr 0); Self (constr 1) is refused.
    if (destination.kind !== 'constr' || destination.index !== 0) throw new PlutusDataError('destination: not a fixed address')
    const [destAddress, destDatum] = asConstr(destination, 'destination', 0, 2)
    // Datum: NoDatum = constr 0 []; DatumHash / InlineDatum attach data to the proceeds.
    if (destDatum.kind !== 'constr' || destDatum.index !== 0 || destDatum.fields.length !== 0) {
      throw new PlutusDataError('destination: attaches a datum to the proceeds')
    }

    // details: Order — Swap { offer, min_received } is constr 1 (Strategy is 0).
    if (details.kind !== 'constr' || details.index !== 1) throw new PlutusDataError(`order ${details.kind === 'constr' ? details.index : '?'} is not a swap`)
    const [offer, minReceived] = asConstr(details, 'Swap', 1, 2)
    const o = singleton(offer, 'offer')
    const m = singleton(minReceived, 'min_received')
    if (o.unit === m.unit) throw new PlutusDataError('Swap: offers and receives the same asset')

    if (extension.kind !== 'bytes' || hex(extension.value) !== SUNDAE_V3.extensionHex) {
      throw new PlutusDataError('extension: unexpected extension data')
    }

    return {
      poolIdent,
      ownerKeyHash: hex(asBytes(keyHash, 'owner key hash', 28)),
      maxProtocolFee,
      destination: address(destAddress, 'destination address'),
      offerUnit: o.unit,
      offerAmount: o.amount,
      minReceivedUnit: m.unit,
      minReceived: m.amount,
    }
  } catch (e) {
    if (e instanceof PlutusDataError) throw new SundaeOrderError(`SundaeSwap order datum: ${e.message}`)
    throw e
  }
}
