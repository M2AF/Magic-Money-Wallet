/**
 * xreserve-cardano-burn-proof.ts — did a Cardano transaction burn USDCx under
 * exactly the withdrawal terms Circle prepared? (pure, read-only)
 *
 * EVIDENCE CHECK ONLY. No network, no polling, no builder call, no signing, no
 * submission, no Circle /withdraw. The caller supplies Circle's prepared terms
 * (already validated by `validatePreparedWithdrawal`) and the Cardano
 * transaction's CBOR for a transaction it has itself confirmed on chain at an
 * adequate depth. Anything malformed, incomplete or ambiguous is NOT verified.
 *
 * WHAT THIS RULESET IS, AND IS NOT. It is the shape every mainnet USDCx burn
 * measured on 2026-10-05 has (60 of 60 sampled from Koios `asset_history`, dated
 * 2026-09-25 to 2026-10-05; see docs/XRESERVE-BURN-INTERFACE-RESEARCH.md). It is
 * NOT an IOG/Midgard-published specification — none was found — and it is not
 * a rule set for BUILDING or SIGNING a burn: a transaction can satisfy every
 * check here and still have been constructed by a service this wallet has no
 * contract with. Use it to decide whether a burn that already happened matches
 * what was approved, never to approve one that has not.
 *
 * What counts as proof, all of it required:
 *
 *   1. The prepared terms are internally consistent: the encoded BurnIntent
 *      (Circle's BurnIntents.sol layout, magic 0x070afbc2) has
 *      `value + maxFee == burnAmountRaw`, and its hook data names the supplied
 *      `remoteDepositor` (the Cardano payment credential, `0x00000001` ‖ 28-byte
 *      key hash) and Cardano domain 10004.
 *   2. The transaction is valid (a phase-2-failed transaction burns nothing)
 *      and its mint field contains EXACTLY ONE entry: the pinned USDCx asset,
 *      in the quantity −burnAmountRaw. No other policy, no other asset name.
 *   3. The complete BurnIntent rides, byte for byte, as the single bytes field
 *      of a `Constr 1` REWARD redeemer for the transaction's ONLY withdrawal: a
 *      zero-lovelace withdrawal from the pinned burn-validator script stake
 *      credential. A match in a datum, metadata, another redeemer purpose or a
 *      raw CBOR substring is not evidence.
 *   4. A vkey witness in the transaction hashes (blake2b-224) to the intent's
 *      depositor credential, so the account Circle was told about is the account
 *      that authorized the burn. Signature validity is the ledger's job: a
 *      confirmed transaction already passed it.
 *
 * WHAT THIS DOES NOT PROVE: chain inclusion or depth (as for the mint proof,
 * the transaction id is recomputed from the CBOR, but a caller can hand over
 * CBOR for a transaction that never landed); that the burn validator would
 * accept it (the script is not audited here — it was accepted on chain, which
 * is the only reason a confirmed burn counts); that IOG/Midgard attested it;
 * that Circle accepted a withdrawal; or that any Ethereum USDC arrived. Those
 * are separate legs. IOG documents ~400 Cardano block confirmations before its
 * operators sign: treat a shallower burn as not yet final.
 */

import { blake2b } from '@noble/hashes/blake2b'
import { decodeCbor, CborMap } from './cardano-tx-inspect'
import { hexToBytesStrict, CardanoSwapValidationError } from './cardano-swap-validate'
import { REDEEMER_TAG, Stop, splitRoot, readRedeemers } from './xreserve-cardano-mint-proof'
import { xreserveNetworkById, type XReserveNetworkId } from './xreserve-network'

/**
 * Stake-credential hash of the script every sampled mainnet burn withdraws zero
 * from. Corroborated by the first field of the USDCXProtocolParameters datum
 * the same transactions reference. OBSERVED, not published. Mainnet only:
 * Preprod's is unmeasured, so Preprod burns are refused rather than guessed.
 */
export const BURN_WITHDRAWAL_SCRIPT: Readonly<Partial<Record<XReserveNetworkId, string>>> = Object.freeze({
  mainnet: 'd74de93a7e4940462c4509f59c712889422506f8b63dcfd0c266dc7b',
})

/** Circle Cardano remote domain, and the observed `remoteDepositor` credential tag. */
const CARDANO_DOMAIN = 10004
const DEPOSITOR_TAG = '00000001'
/** BurnIntentSet header (magic ‖ count 1) accepted by `validatePreparedWithdrawal`. */
const SET_OF_ONE = 'e999239b00000001'
const BURN_INTENT_MAGIC = '070afbc2'

/** BurnIntent offsets (BurnIntents.sol / TransferSpec.sol, big-endian). */
const BI = { maxFee: 36, specLength: 68, spec: 72, value: 72 + 16 + 8 * 32, hook: 72 + 16 + 10 * 32 + 4 } as const
const HOOK = { remoteDomain: 8, remoteToken: 12, remoteDepositor: 44 } as const

/**
 * The 32-byte `remoteDepositor` Circle must be told for a Cardano account:
 * `0x00000001` ‖ payment key hash, observed in 60 of 60 mainnet burns. This is
 * a measured encoding, not a documented one; a script-credential depositor has
 * not been observed at all, so it is not offered here.
 */
export function cardanoRemoteDepositor(paymentKeyHashHex: string): string {
  if (!/^[0-9a-f]{56}$/i.test(paymentKeyHashHex)) throw new Stop('invalid-terms', 'payment key hash must be 28 bytes of hex')
  return `0x${DEPOSITOR_TAG}${paymentKeyHashHex.toLowerCase()}`
}

export interface BurnTerms {
  network: XReserveNetworkId
  /** `PreparedWithdrawal.encoded`: a BurnIntent, or a one-element BurnIntentSet. */
  encoded: string
  /** `PreparedWithdrawal.burnAmountRaw` = value + maxFee, integer base units. */
  burnAmountRaw: string
  /** `PreparedWithdrawal.remoteDepositor`, 0x + 32 bytes. */
  remoteDepositor: string
}

export type BurnFailureCode =
  | 'invalid-terms' | 'unsupported-network'
  | 'evidence-unreadable' | 'failed-attempt' | 'unrelated'
  | 'burn-conflict'

export type BurnConflictDetail =
  | 'carrier-ambiguous' | 'wrong-withdrawal-script' | 'extra-mint'
  | 'burn-amount-mismatch' | 'depositor-not-witnessed'

export type BurnProof =
  | {
    verified: true
    cardanoTxHash: string
    /** Raw USDCx destroyed (always = value + maxFee of the intent). */
    burnedRaw: string
    /** Raw USDC the intent releases, excluding the burn fee. */
    valueRaw: string
    maxFeeRaw: string
    /** Payment-key hash that witnessed the transaction and is named in the intent. */
    depositorCredential: string
    withdrawalScriptHash: string
  }
  | { verified: false; code: BurnFailureCode; detail?: BurnConflictDetail; reason: string }

const stop = (code: string, why: string): never => { throw new Stop(code, why) }
const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

interface ParsedTerms { intent: string; value: bigint; maxFee: bigint; depositor: string; burn: bigint }

function parseTerms(t: BurnTerms): ParsedTerms {
  if (!t || typeof t !== 'object') return stop('invalid-terms', 'no prepared terms supplied')
  if (typeof t.encoded !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(t.encoded) || t.encoded.length > 4_000) return stop('invalid-terms', 'encoded burn intent is not bounded hex')
  let intent = t.encoded.slice(2).toLowerCase()
  if (intent.startsWith(SET_OF_ONE)) intent = intent.slice(SET_OF_ONE.length)
  if (typeof t.burnAmountRaw !== 'string' || !/^[1-9][0-9]{0,77}$/.test(t.burnAmountRaw)) return stop('invalid-terms', 'burn amount is not a positive integer')
  if (typeof t.remoteDepositor !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(t.remoteDepositor)) return stop('invalid-terms', 'remote depositor is not 32 bytes')
  const depositorWord = t.remoteDepositor.slice(2).toLowerCase()
  if (!depositorWord.startsWith(DEPOSITOR_TAG)) return stop('invalid-terms', 'remote depositor is not a Cardano payment-key credential')

  const b = intent.length / 2
  const f = (off: number, len: number) => intent.slice(off * 2, (off + len) * 2)
  if (b < BI.hook + 112 || f(0, 4) !== BURN_INTENT_MAGIC) return stop('invalid-terms', 'encoded intent is not a BurnIntent')
  if (parseInt(f(BI.specLength, 4), 16) !== b - BI.spec) return stop('invalid-terms', 'BurnIntent spec length does not match its bytes')
  const hookLength = parseInt(f(BI.hook - 4, 4), 16)
  if (BI.hook + hookLength !== b) return stop('invalid-terms', 'BurnIntent hook length does not match its bytes')
  if (parseInt(f(BI.hook + HOOK.remoteDomain, 4), 16) !== CARDANO_DOMAIN) return stop('invalid-terms', 'BurnIntent does not name the Cardano domain')
  if (f(BI.hook + HOOK.remoteDepositor, 32) !== depositorWord) return stop('invalid-terms', 'BurnIntent depositor differs from the supplied depositor')
  const value = BigInt(`0x${f(BI.value, 32)}`)
  const maxFee = BigInt(`0x${f(BI.maxFee, 32)}`)
  const burn = BigInt(t.burnAmountRaw)
  if (value <= 0n || value + maxFee !== burn) return stop('invalid-terms', 'burn amount is not value + maxFee of the intent')
  return { intent, value, maxFee, depositor: depositorWord.slice(DEPOSITOR_TAG.length), burn }
}

/**
 * Classify ONE Cardano transaction against the prepared terms. Never throws.
 * `unrelated` means the intent bytes are not carried by a qualifying redeemer;
 * once they are, every discrepancy is a `burn-conflict` needing review.
 */
export function verifyXReserveCardanoBurn(input: { terms: BurnTerms; cardanoTx: { txHash: string; cbor: string } }): BurnProof {
  try {
    const terms = parseTerms(input?.terms)
    const net = xreserveNetworkById(input.terms.network)
    const script = net ? BURN_WITHDRAWAL_SCRIPT[net.id] : undefined
    if (!net || !script) return { verified: false, code: 'unsupported-network', reason: 'the burn rules were measured on Cardano mainnet only' }
    const usdcx = net.cardano.usdcxUnit
    const claimed = String(input.cardanoTx?.txHash ?? '').toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(claimed)) return stop('evidence-unreadable', 'Cardano transaction hash is malformed')
    let bytes: Uint8Array
    try { bytes = hexToBytesStrict(String(input.cardanoTx?.cbor ?? '')) } catch (e) {
      return stop('evidence-unreadable', `malformed Cardano transaction: ${e instanceof Error ? e.message : 'unreadable'}`)
    }
    const parts = splitRoot(bytes)
    if (hex(blake2b(parts.body, { dkLen: 32 })) !== claimed) return stop('evidence-unreadable', 'the CBOR is not the claimed Cardano transaction')
    const body = decodeCbor(parts.body)
    if (!(body instanceof CborMap)) return stop('evidence-unreadable', 'transaction body is not a map')

    // Withdrawals and redeemers first: carrying the intent decides "unrelated".
    const wd = body.getInt(5)
    const rewards: Array<{ account: string; amount: bigint }> = []
    if (wd !== undefined) {
      if (!(wd instanceof CborMap)) return stop('evidence-unreadable', 'malformed withdrawals')
      for (const [acct, amt] of wd.entries) {
        if (!(acct instanceof Uint8Array) || typeof amt !== 'bigint') return stop('evidence-unreadable', 'malformed withdrawals')
        rewards.push({ account: hex(acct), amount: amt })
      }
    }
    const redeemers = readRedeemers(parts.witnessSet)
    const carriers = redeemers.filter(r => r.tag === REDEEMER_TAG.reward && r.data.kind === 'constr' && r.data.index === 1
      && r.data.fields.length === 1 && r.data.fields[0].kind === 'bytes' && hex(r.data.fields[0].value) === terms.intent)
    const anywhere = redeemers.some(r => r.data.kind !== 'int' && JSON.stringify(r.data, (_k, v) => typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? hex(v) : v).includes(terms.intent))
    if (carriers.length === 0) {
      return { verified: false, code: 'unrelated', reason: anywhere
        ? 'the intent appears only in a redeemer that is not the burn withdrawal redeemer'
        : 'no withdrawal redeemer carries the prepared burn intent' }
    }

    // It carries the intent. From here every discrepancy is a conflict.
    const conflict = (detail: BurnConflictDetail, reason: string): BurnProof => ({ verified: false, code: 'burn-conflict', detail, reason })
    if (parts.isValid.length !== 1 || parts.isValid[0] !== 0xf5) {
      return { verified: false, code: 'failed-attempt', reason: 'the transaction carrying the intent failed script validation, so it burned nothing' }
    }
    if (carriers.length !== 1 || rewards.length !== 1 || carriers[0].index !== 0) return conflict('carrier-ambiguous', 'the intent is not carried by the transaction\'s single withdrawal')
    const w = rewards[0]
    if (w.amount !== 0n || w.account !== `${(0xf0 | net.cardano.networkId).toString(16)}${script}`) {
      return conflict('wrong-withdrawal-script', 'the withdrawal is not a zero withdrawal from the pinned USDCx burn validator')
    }

    const mint = body.getInt(9)
    if (!(mint instanceof CborMap) || mint.size !== 1) return conflict('extra-mint', 'the mint field is not exactly the USDCx burn')
    const [pid, names] = mint.entries[0]
    if (!(pid instanceof Uint8Array) || !(names instanceof CborMap) || names.size !== 1) return conflict('extra-mint', 'the mint field is not exactly the USDCx burn')
    const [name, qty] = names.entries[0]
    if (!(name instanceof Uint8Array) || typeof qty !== 'bigint' || hex(pid) + hex(name) !== usdcx) return conflict('extra-mint', 'the mint field is not exactly the USDCx burn')
    if (qty !== -terms.burn) return conflict('burn-amount-mismatch', 'the transaction burns a different USDCx quantity than the prepared value plus fee')

    const ws = decodeCbor(parts.witnessSet)
    const vkeys = ws instanceof CborMap ? ws.getInt(0) : undefined
    const witnessed = Array.isArray(vkeys) && vkeys.some(k => Array.isArray(k) && k[0] instanceof Uint8Array
      && k[0].length === 32 && hex(blake2b(k[0], { dkLen: 28 })) === terms.depositor)
    if (!witnessed) return conflict('depositor-not-witnessed', 'no vkey witness belongs to the depositor credential named in the intent')

    return {
      verified: true, cardanoTxHash: claimed, burnedRaw: terms.burn.toString(), valueRaw: terms.value.toString(),
      maxFeeRaw: terms.maxFee.toString(), depositorCredential: terms.depositor, withdrawalScriptHash: script,
    }
  } catch (e) {
    if (e instanceof Stop) {
      const code = e.code === 'invalid-terms' || e.code === 'unsupported-network' ? e.code : 'evidence-unreadable'
      return { verified: false, code, reason: e.message }
    }
    if (e instanceof CardanoSwapValidationError) return { verified: false, code: 'evidence-unreadable', reason: `malformed Cardano transaction: ${e.message}` }
    return { verified: false, code: 'evidence-unreadable', reason: `evidence could not be read: ${e instanceof Error ? e.message : 'unknown error'}` }
  }
}
