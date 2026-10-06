/**
 * usdcx-burn-validate.ts — READ-ONLY pre-signing check of an IOG-built,
 * unsigned USDCx burn transaction against the journey's stored, approved
 * withdrawal terms (privileged layer).
 *
 * NOT WIRED. Nothing calls the IOG builder, signs, submits, records, or calls
 * Circle /withdraw. This only answers: "if the wallet were ever allowed to sign
 * this exact transaction, would it do what the user approved and nothing else?"
 * Any unresolved evidence fails closed.
 *
 * Every check states its BASIS:
 *   - 'transaction'  proven from the transaction bytes, the approved terms and
 *                    the resolved inputs alone;
 *   - 'iog-rule'     the transaction is consistent with what IOG builds today
 *                    (observed in public burns and one Portal build), but the
 *                    rule itself still needs IOG's confirmation before signing
 *                    can be enabled: which service key may pre-witness, the
 *                    collateral arrangement, reference inputs, validity policy.
 *
 * Shape source: 60/60 public mainnet burns and an unsigned Portal build for the
 * user's own wallet (2026-10-06; docs/USDCX-BURN-BUILD-PROBE.md). No input
 * hash from those transactions is a rule here.
 */

import { blake2b } from '@noble/hashes/blake2b'
import { ed25519 } from '@noble/curves/ed25519'
import { decodeTxBody, decodeCbor, CborMap, type DecodedTxBody } from './cardano-tx-inspect'
import { splitRoot } from './xreserve-cardano-mint-proof'
import { hexToBytesStrict } from './cardano-swap-validate'
import { verifyXReserveCardanoBurn, BURN_WITHDRAWAL_SCRIPT } from './xreserve-cardano-burn-proof'
import { xreserveNetworkById } from './xreserve-network'
import type { XReserveBurnTerms } from '../shared/stablecoin-journey'

export type CheckBasis = 'transaction' | 'iog-rule'
export interface BurnBuildCheck {
  id: string
  basis: CheckBasis
  ok: boolean
  detail: string
}

export interface ResolvedTxOutput {
  address: string
  lovelace: bigint
  /** unit (policy + name hex) -> quantity */
  assets: ReadonlyMap<string, bigint>
}

export interface BurnBuildValidationInput {
  /** The journey's stored, approved terms (authorizeXReserveBurn). */
  terms: XReserveBurnTerms
  /** The builder's unsigned transaction, hex CBOR. */
  unsignedTxCbor: string
  wallet: {
    /** Every address of this wallet account that may hold spent inputs or receive change (bech32). */
    ownAddresses: readonly string[]
    /** Payment key hash that will sign (28 bytes hex). */
    paymentKeyHash: string
  }
  /** Every spent input AND collateral input, read from the chain: "txHash#index" -> output. */
  resolved: ReadonlyMap<string, ResolvedTxOutput>
  policy: {
    /** Main-process policy only. Never populate these limits or keys from a dApp/renderer request. */
    maxFeeLovelace: bigint
    maxTotalCollateralLovelace: bigint
    /** Key hashes allowed to pre-witness (IOG's service key). Needs IOG confirmation. */
    serviceWitnessKeyHashes: readonly string[]
  }
}

export interface BurnBuildValidation {
  /** True only when EVERY check passed. */
  ok: boolean
  txHash: string | null
  checks: BurnBuildCheck[]
  /** 'iog-rule' checks: consistent with today's builds, not yet confirmed by IOG. */
  pendingIogConfirmation: string[]
  /** Always false: passing this check never makes a burn signable on its own. */
  signingEnabled: false
}

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
const ref = (r: { txHash: string; index: number }) => `${r.txHash}#${r.index}`

/** BurnIntent fields the terms must agree with (Circle BurnIntents.sol layout). */
function intentFields(encoded: string) {
  let h = encoded.replace(/^0x/, '').toLowerCase()
  if (h.startsWith('e999239b00000001')) h = h.slice(16)
  const f = (off: number, len: number) => h.slice(off * 2, (off + len) * 2)
  const word = (i: number) => f(72 + 16 + i * 32, 32)
  if (f(0, 4) !== '070afbc2' || h.length < (72 + 16 + 10 * 32 + 4 + 76) * 2) return null
  return { maxFee: BigInt('0x' + f(36, 32)), value: BigInt('0x' + word(8)), recipient: '0x' + word(5).slice(24) }
}

/** A malformed caller value must be a refusal, never an exception from a review path. */
export function validateUsdcxBurnBuild(input: BurnBuildValidationInput): BurnBuildValidation {
  try {
    return validateBuild(input)
  } catch {
    return {
      ok: false, txHash: null, signingEnabled: false, pendingIogConfirmation: [],
      checks: [{ id: 'unreadable', basis: 'transaction', ok: false, detail: 'The burn build or approved terms could not be verified.' }],
    }
  }
}

function validateBuild(input: BurnBuildValidationInput): BurnBuildValidation {
  const checks: BurnBuildCheck[] = []
  const add = (id: string, basis: CheckBasis, ok: boolean, detail: string) => { checks.push({ id, basis, ok, detail }) }
  const done = (txHash: string | null): BurnBuildValidation => ({
    ok: checks.length > 0 && checks.every(c => c.ok), txHash, checks,
    pendingIogConfirmation: checks.filter(c => c.basis === 'iog-rule').map(c => c.id), signingEnabled: false,
  })
  const { terms, wallet, resolved, policy } = input

  // ── Approved terms are internally consistent ─────────────────────────────
  const net = xreserveNetworkById(terms?.network)
  const script = net ? BURN_WITHDRAWAL_SCRIPT[net.id] : undefined
  const fields = typeof terms?.encoded === 'string' ? intentFields(terms.encoded) : null
  if (!net || !script || !fields) {
    add('terms', 'transaction', false, 'The approved terms are missing, unreadable or for an unsupported network.')
    return done(null)
  }
  add('terms', 'transaction',
    fields.value.toString() === terms.releaseAmountRaw && (fields.value + fields.maxFee).toString() === terms.burnAmountRaw
      && fields.recipient === terms.releaseRecipient.toLowerCase()
      && terms.remoteDepositor.toLowerCase() === `0x00000001${wallet.paymentKeyHash.toLowerCase()}`,
    'The intent releases exactly the approved amount to the approved recipient, burns value + fee cap, and names this wallet as depositor.')

  // ── Decode ────────────────────────────────────────────────────────────────
  let parts: ReturnType<typeof splitRoot>
  let body: DecodedTxBody
  let witnesses: CborMap
  try {
    parts = splitRoot(hexToBytesStrict(input.unsignedTxCbor))
    body = decodeTxBody(parts.body)
    const ws = decodeCbor(parts.witnessSet)
    if (!(ws instanceof CborMap)) throw new Error('witness set is not a map')
    witnesses = ws
  } catch (e) {
    add('decode', 'transaction', false, `The transaction could not be read: ${e instanceof Error ? e.message : 'malformed'}.`)
    return done(null)
  }
  const txHashBytes = blake2b(parts.body, { dkLen: 32 })
  const txHash = hex(txHashBytes)
  add('decode', 'transaction', parts.isValid.length === 1 && parts.isValid[0] === 0xf5, 'A complete transaction marked valid.')

  // ── Network and body contents ────────────────────────────────────────────
  const mainnetAddr = (b: Uint8Array) => (b[0] & 0x0f) === net.cardano.networkId
  add('network', 'transaction',
    (body.networkId === undefined || body.networkId === net.cardano.networkId) && body.outputs.every(o => mainnetAddr(o.addressBytes))
      && (!body.collateralReturn || mainnetAddr(body.collateralReturn.addressBytes)),
    'Every address and the stated network are Cardano mainnet.')
  add('no-extras', 'transaction',
    body.unknownFields.length === 0 && body.certificates.length === 0 && body.votingProcedureCount === 0
      && body.proposalProcedureCount === 0 && body.donation === undefined && body.auxDataHash === undefined
      && parts.auxData.length === 1 && parts.auxData[0] === 0xf6,
    'No certificates, governance actions, donations, metadata or undecoded body fields.')

  // ── Spent inputs: all resolved, all this wallet's ────────────────────────
  const own = new Set(wallet.ownAddresses)
  const spent = body.inputs.map(i => resolved.get(ref(i)))
  const allResolved = spent.every(Boolean)
  add('inputs', 'transaction', body.inputs.length > 0 && allResolved && spent.every(o => own.has(o!.address)),
    allResolved ? 'Every spent input belongs to this wallet.' : 'Some spent inputs could not be resolved: refusing.')

  // ── Mint: exactly the approved USDCx burn ────────────────────────────────
  add('mint', 'transaction',
    body.mint.length === 1 && body.mint[0].unit === net.cardano.usdcxUnit && body.mint[0].quantity === -BigInt(terms.burnAmountRaw),
    `Mints nothing; burns exactly ${terms.burnAmountRaw} base units of the pinned USDCx and no other asset.`)

  // ── Burn commitment: intent bytes in the burn-validator withdrawal redeemer ─
  const proof = verifyXReserveCardanoBurn({ terms, cardanoTx: { txHash, cbor: input.unsignedTxCbor } })
  const carried = proof.verified || (proof.code === 'burn-conflict' && proof.detail === 'depositor-not-witnessed')
  add('commitment', 'transaction', carried && body.withdrawals.length === 1 && body.withdrawals[0].lovelace === 0n
      && hex(body.withdrawals[0].rewardAddressBytes) === `${(0xf0 | net.cardano.networkId).toString(16)}${script}`,
    carried ? 'One zero withdrawal from the pinned burn validator, its redeemer carrying exactly the approved intent.'
      : `The approved intent is not committed as the burn: ${proof.verified ? '' : proof.reason}.`)

  // ── Outputs: only this wallet receives; value balances exactly ───────────
  const outputsOwn = body.outputs.length > 0 && body.outputs.every(o => own.has(o.address) && !o.hasDatum && !o.hasScriptRef)
  let balanced = false
  if (allResolved) {
    const sum = new Map<string, bigint>()
    const put = (unit: string, q: bigint) => sum.set(unit, (sum.get(unit) ?? 0n) + q)
    for (const o of spent) { put('lovelace', o!.lovelace); for (const [u, q] of o!.assets) put(u, q) }
    put('lovelace', -body.fee)
    for (const m of body.mint) put(m.unit, m.quantity)
    for (const o of body.outputs) { put('lovelace', -o.value.lovelace); for (const a of o.value.assets) put(a.unit, -a.quantity) }
    balanced = [...sum.values()].every(v => v === 0n)
  }
  add('outputs', 'transaction', outputsOwn && balanced,
    'All outputs go to this wallet with no datum or script; inputs − fee − burn equal outputs for every asset (nothing else leaves).')

  // ── Fee ───────────────────────────────────────────────────────────────────
  add('fee', 'transaction', body.fee > 0n && body.fee <= policy.maxFeeLovelace,
    `Network fee ${body.fee} lovelace is within the approved ceiling of ${policy.maxFeeLovelace}.`)

  // ── Signers and witnesses ────────────────────────────────────────────────
  const pkh = wallet.paymentKeyHash.toLowerCase()
  add('required-signers', 'transaction', body.requiredSigners.length === 1 && hex(body.requiredSigners[0]) === pkh,
    'The only required signer is this wallet\'s payment key.')
  const vkeys = witnesses.getInt(0)
  const preHashes = Array.isArray(vkeys) ? vkeys.map(k => {
    if (!Array.isArray(k) || k.length !== 2 || !(k[0] instanceof Uint8Array) || k[0].length !== 32
      || !(k[1] instanceof Uint8Array) || k[1].length !== 64) return 'malformed'
    try {
      return ed25519.verify(k[1], txHashBytes, k[0]) ? hex(blake2b(k[0], { dkLen: 28 })) : 'invalid-signature'
    } catch { return 'invalid-signature' }
  }) : []
  const serviceKeys = new Set(policy.serviceWitnessKeyHashes.map(k => k.toLowerCase()))
  const keysOnlyServiceOrUser = preHashes.length > 0 && preHashes.every(h => serviceKeys.has(h) || h === pkh)
  const noOtherWitnessKinds = witnesses.entries.every(([k]) => k === 0n || k === 5n)
  add('witnesses', 'iog-rule', keysOnlyServiceOrUser && noOtherWitnessKinds && preHashes.some(h => serviceKeys.has(h)),
    'Pre-attached signatures verify for this transaction and come only from allowed keys; only vkeys and redeemers are present.')

  // ── Collateral: never this wallet's coins ────────────────────────────────
  const coll = body.collateral.map(c => resolved.get(ref(c)))
  const collResolved = coll.every(Boolean)
  add('collateral', 'transaction', body.collateral.length > 0 && collResolved && coll.every(o => !own.has(o!.address))
      && body.totalCollateral !== undefined && body.totalCollateral > 0n && body.totalCollateral <= policy.maxTotalCollateralLovelace,
    collResolved ? 'Collateral is another party\'s, with a bounded total; this wallet\'s coins are never at risk as collateral.'
      : 'Collateral inputs could not be resolved: refusing.')
  add('collateral-arrangement', 'iog-rule', collResolved && body.collateralReturn !== undefined,
    'The service supplies collateral and a collateral return; the arrangement itself awaits IOG confirmation.')

  // ── Reference inputs and validity: consistent today, rules unconfirmed ──
  add('reference-inputs', 'iog-rule', body.referenceInputs.length > 0,
    'Reference inputs are present; their canonical identities still need IOG confirmation.')
  add('validity', 'iog-rule', true,
    body.ttl === undefined && body.validityStart === undefined
      ? 'No ledger validity interval; Circle intent expiry must be handled separately under an IOG-confirmed policy.'
      : `Validity interval ${body.validityStart ?? '-'}..${body.ttl ?? '-'} (slot).`)

  return done(txHash)
}
