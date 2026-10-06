/**
 * cbada-ccip-execute.ts — GUARDED signing for Base -> Solana cbADA over CCIP
 * (privileged layer). Execution is DISABLED: CBADA_CCIP_EXECUTION_ENABLED is
 * false, nothing routes here from any UI or router, and both entry points
 * refuse before reading anything unless given an OPEN, ISSUED gate.
 *
 * THE GATE. Only this module issues gates. Production code can obtain only
 * productionGate(), which reflects the module constant (off). An enabled gate
 * exists only inside a Vitest run (testOnlyEnabledGate). A flag in an IPC
 * argument or renderer state is a plain object, never an issued gate, so it can
 * never open this path.
 *
 * THE TERMS come only from the journey's stored, immutable authorization
 * (authorizeCcipBridge): sender and account index, CCIP fee ceiling, and a
 * total network-gas ceiling per transaction. A caller cannot supply or raise
 * them; any change needs a new approval.
 *
 * Order of operations — every one a gate, all reads FRESH at call time:
 *   1. the gate; the journey step is approved and authorized, has no
 *      transaction yet (a step with a hash is never sent again), and the
 *      current signer is the authorized sender and account;
 *   2. live router fee (<= the authorized ceiling), lane, OnRamp, pool identity,
 *      allowance, cbADA balance, and ETH for the fee PLUS every remaining gas
 *      ceiling — anything unreadable stops the send;
 *   3. build -> strict validation -> eth_call simulation; gas estimate and fee
 *      rates must fit the authorized gas ceiling;
 *   4. sign locally, then from the SIGNED bytes: recompute the hash, recover the
 *      signer (must be the authorized sender), and check chain, destination,
 *      calldata, value, nonce and gas x max fee per gas;
 *   5. persist the hash to the journey BEFORE broadcast — a failed write means
 *      nothing is broadcast;
 *   6. broadcast ONCE. A failed, unanswered or mismatched broadcast is recorded
 *      as `uncertain` and never retried; it is checked by the saved hash.
 *
 * The Base pool's zero balance limits Solana -> Base RELEASES only. A Base ->
 * Solana send LOCKS cbADA into that pool, so it is not a gate here.
 */

import { keccak256, parseAbi, parseTransaction, recoverTransactionAddress, getAddress, type Hex, type PublicClient } from 'viem'
import { CBADA, svmTokenTransferExtraArgs } from './cbada-ccip'
import {
  buildCbAdaBaseToSolana, validateCbAdaSendTxs, simulateCbAdaSend, recordSignedBridgeSend,
  CBADA_CCIP_EXECUTION_ENABLED, CcipSendError, type CbAdaSendTerms, type EvmTx,
} from './cbada-ccip-send'
import { recordLegApprovalSent, recordLegOutcome, type StablecoinJourney, type CcipAuthorization } from '../shared/stablecoin-journey'
import type { JourneyStore } from './journey-store'

export const BASE_CHAIN_ID = 8453

export class CcipExecutionDisabled extends Error {
  constructor() { super('Sending cbADA over CCIP is not enabled in this wallet.') }
}

// ── The gate ────────────────────────────────────────────────────────────────

export interface ExecutionGate { readonly enabled: boolean }
const ISSUED = new WeakSet<object>()
const issue = (enabled: boolean): ExecutionGate => { const g = Object.freeze({ enabled }); ISSUED.add(g); return g }

/** The only gate production code can obtain. Off while the module constant is off. */
export function productionGate(): ExecutionGate { return issue(CBADA_CCIP_EXECUTION_ENABLED) }

/** Tests only: an open gate. Refuses to exist outside a Vitest run. */
export function testOnlyEnabledGate(): ExecutionGate {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  if (env?.VITEST !== 'true') throw new Error('An enabled execution gate exists only in tests.')
  return issue(true)
}

const gateOpen = (g: unknown): boolean => !!g && typeof g === 'object' && ISSUED.has(g) && (g as ExecutionGate).enabled === true

// ── Dependencies ────────────────────────────────────────────────────────────

export interface UnsignedBaseTx extends EvmTx {
  nonce: number
  chainId: number
  gas: string
  maxFeePerGas: string
  maxPriorityFeePerGas: string
}

export interface CbAdaExecuteDeps {
  gate: ExecutionGate
  client: PublicClient
  /** The signer this wallet would use now (address + account index). */
  currentSigner(): Promise<{ address: string; accountIndex: number }>
  /** The signer's next nonce on Base (pending), read fresh. */
  nonce(): Promise<number>
  /** Sign locally WITHOUT broadcasting, using exactly these gas terms. */
  sign(tx: UnsignedBaseTx): Promise<{ serialized: Hex; txHash: string }>
  /** Broadcast an already-signed transaction; returns the node's hash. */
  broadcast(serialized: Hex): Promise<string>
  store: JourneyStore
  now(): number
}

export type CbAdaSendOutcome =
  | { state: 'not-needed' }
  | { state: 'submitted'; txHash: string }
  /** Broadcast outcome unknown: check by the saved hash; never sent again. */
  | { state: 'uncertain'; txHash: string; reason: string }

const ROUTER = parseAbi([
  'function getFee(uint64 destinationChainSelector, (bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) view returns (uint256)',
])
const ERC20 = parseAbi(['function allowance(address owner, address spender) view returns (uint256)'])
const fail = (why: string): never => { throw new CcipSendError(why) }
const lower = (s: string) => s.toLowerCase()
/** Headroom on the node's gas estimate; the total must still fit the authorized ceiling. */
const GAS_HEADROOM_PCT = 120n

async function authorized(journey: StablecoinJourney, deps: CbAdaExecuteDeps): Promise<CcipAuthorization> {
  if (journey.bridge !== 'ccip-cbada' || journey.status !== 'active') fail('This journey is not an active cbADA transfer.')
  const leg = journey.legs[1]
  if (leg.txHash) fail('This step already has a transaction. It is checked on chain, never sent again.')
  if (leg.state !== 'approved' || !leg.approvedInputRaw) fail('This step has not been approved.')
  const auth = journey.authorization
  if (!auth) return fail('This transfer\'s terms were never authorized.')
  if (leg.input.chain !== 'base' || lower(leg.input.address) !== lower(CBADA.base.token)
      || leg.output.chain !== 'solana' || leg.output.address !== CBADA.solana.token) fail('This step is not Base -> Solana cbADA.')
  const signer = await deps.currentSigner()
  if (lower(signer.address) !== auth.sender || signer.accountIndex !== auth.accountIndex) {
    fail('The current signer is not the account that authorized this transfer.')
  }
  return auth
}

const termsOf = (journey: StablecoinJourney, auth: CcipAuthorization, feeWei: bigint): CbAdaSendTerms =>
  ({ sender: getAddress(auth.sender), solanaRecipient: journey.recipient, amountRaw: journey.legs[1].approvedInputRaw as string, feeWei: feeWei.toString() })

async function freshFee(client: PublicClient, journey: StablecoinJourney, auth: CcipAuthorization): Promise<bigint> {
  const fee = await client.readContract({
    address: getAddress(CBADA.base.router), abi: ROUTER, functionName: 'getFee',
    args: [CBADA.solana.selector, {
      receiver: ('0x' + '00'.repeat(32)) as Hex, data: '0x',
      tokenAmounts: [{ token: getAddress(CBADA.base.token), amount: BigInt(journey.legs[1].approvedInputRaw as string) }],
      feeToken: '0x0000000000000000000000000000000000000000', extraArgs: svmTokenTransferExtraArgs(journey.recipient),
    }],
  }).catch(() => null)
  if (fee === null || fee <= 0n) return fail('The live CCIP fee could not be read.')
  if (fee > BigInt(auth.maxCcipFeeWei)) fail('The CCIP fee has risen above the authorized ceiling. Review and approve again.')
  return fee
}

async function freshAllowance(client: PublicClient, auth: CcipAuthorization): Promise<bigint> {
  const a = await client.readContract({ address: getAddress(CBADA.base.token), abi: ERC20, functionName: 'allowance',
    args: [getAddress(auth.sender), getAddress(CBADA.base.router)] }).catch(() => null)
  return a === null ? fail('The current allowance could not be read.') : a
}

/** Fresh gas terms that must fit the authorized ceiling for this transaction. */
async function gasTerms(client: PublicClient, auth: CcipAuthorization, tx: EvmTx, ceilingWei: bigint) {
  const [estimate, fees] = await Promise.all([
    client.estimateGas({ account: getAddress(auth.sender), to: tx.to as Hex, data: tx.data as Hex, value: BigInt(tx.value) }).catch(() => null),
    client.estimateFeesPerGas().catch(() => null),
  ])
  if (estimate === null || !fees || fees.maxFeePerGas === undefined || fees.maxPriorityFeePerGas === undefined) {
    return fail('Network gas could not be estimated.')
  }
  const gas = (estimate * GAS_HEADROOM_PCT) / 100n
  if (gas * fees.maxFeePerGas > ceilingWei) fail('Network gas would exceed the authorized ceiling. Review and approve again.')
  return { gas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas }
}

/** From the SIGNED bytes: hash, signer, and every field, before anything is saved or sent. */
async function checkSigned(signed: { serialized: Hex; txHash: string }, tx: UnsignedBaseTx, auth: CcipAuthorization, ceilingWei: bigint): Promise<string> {
  const hash = keccak256(signed.serialized)
  if (lower(signed.txHash) !== lower(hash)) fail('The signer reported a hash that does not match the signed transaction.')
  let parsed
  try { parsed = parseTransaction(signed.serialized) } catch { return fail('The signed transaction could not be read back.') }
  let from: string
  try { from = await recoverTransactionAddress({ serializedTransaction: signed.serialized as never }) } catch { return fail('The transaction is not validly signed.') }
  if (lower(from) !== auth.sender) fail('The transaction was signed by an account other than the authorized sender.')
  if (parsed.chainId !== BASE_CHAIN_ID) fail('The signed transaction is not for Base.')
  if (!parsed.to || lower(parsed.to) !== lower(tx.to)) fail('The signed transaction has a different destination.')
  if (lower(parsed.data ?? '0x') !== lower(tx.data)) fail('The signed transaction has different calldata.')
  if ((parsed.value ?? 0n) !== BigInt(tx.value)) fail('The signed transaction sends a different value.')
  if (parsed.nonce !== tx.nonce) fail('The signed transaction has a different nonce.')
  const perGas = parsed.maxFeePerGas ?? parsed.gasPrice
  if (parsed.gas === undefined || perGas === undefined) fail('The signed transaction does not state its gas terms.')
  if ((parsed.gas as bigint) * (perGas as bigint) > ceilingWei) fail('The signed transaction allows more network gas than authorized.')
  return hash
}

async function signPersistBroadcast(
  tx: EvmTx, auth: CcipAuthorization, ceilingWei: bigint, deps: CbAdaExecuteDeps,
  persist: (txHash: string) => Promise<StablecoinJourney>, onUncertain: (j: StablecoinJourney) => Promise<void>,
): Promise<CbAdaSendOutcome> {
  const gas = await gasTerms(deps.client, auth, tx, ceilingWei)
  const unsigned: UnsignedBaseTx = {
    ...tx, nonce: await deps.nonce(), chainId: BASE_CHAIN_ID,
    gas: gas.gas.toString(), maxFeePerGas: gas.maxFeePerGas.toString(), maxPriorityFeePerGas: gas.maxPriorityFeePerGas.toString(),
  }
  const signed = await deps.sign(unsigned)
  const hash = await checkSigned(signed, unsigned, auth, ceilingWei)
  // Persist BEFORE broadcast. A failed write throws here: nothing is sent.
  const saved = await persist(hash)
  try {
    const accepted = await deps.broadcast(signed.serialized)
    if (lower(accepted) !== lower(hash)) {
      await onUncertain(saved).catch(() => { /* the saved hash still identifies it */ })
      return { state: 'uncertain', txHash: hash, reason: 'The node answered with a different transaction hash.' }
    }
    return { state: 'submitted', txHash: hash }
  } catch (e) {
    await onUncertain(saved).catch(() => { /* the saved hash still identifies it */ })
    return { state: 'uncertain', txHash: hash, reason: e instanceof Error ? e.message : 'broadcast failed' }
  }
}

/** Send the exact-amount approval, only when the live allowance is short. */
export async function sendCbAdaApproval(journey: StablecoinJourney, deps: CbAdaExecuteDeps): Promise<CbAdaSendOutcome> {
  if (!gateOpen(deps?.gate)) throw new CcipExecutionDisabled()
  const auth = await authorized(journey, deps)
  const amount = BigInt(journey.legs[1].approvedInputRaw as string)
  const allowance = await freshAllowance(deps.client, auth)
  if (allowance >= amount) return { state: 'not-needed' }
  // An approval already sent is checked by its saved hash and the allowance — never sent again.
  if (journey.legs[1].approvalTxHash) fail('An approval was already sent for this step; its outcome is read from the chain, not re-sent.')
  const feeWei = await freshFee(deps.client, journey, auth)
  const terms = termsOf(journey, auth, feeWei)
  const txs = buildCbAdaBaseToSolana(terms, allowance)
  validateCbAdaSendTxs(txs, terms, BigInt(auth.maxCcipFeeWei))
  // ETH must cover the fee plus BOTH remaining gas ceilings (approval and send).
  const sim = await simulateCbAdaSend(deps.client, txs, terms, BigInt(auth.maxApprovalGasWei) + BigInt(auth.maxSendGasWei))
  if (sim.problems.length || sim.approveSimulated !== 'ok') fail(`The approval cannot be sent safely: ${sim.problems.join(' ') || 'its simulation failed.'}`)
  return signPersistBroadcast(txs.approve as EvmTx, auth, BigInt(auth.maxApprovalGasWei), deps, async (hash) => {
    const next = recordLegApprovalSent(journey, 'bridge', hash, deps.now())
    await deps.store.put(next)
    return next
  }, async () => { /* approval outcome is read from its receipt and the allowance; the step stays approved */ })
}

/** Send the ccipSend. Requires the allowance to be in place already. */
export async function sendCbAdaBridge(journey: StablecoinJourney, deps: CbAdaExecuteDeps): Promise<CbAdaSendOutcome> {
  if (!gateOpen(deps?.gate)) throw new CcipExecutionDisabled()
  const auth = await authorized(journey, deps)
  const feeWei = await freshFee(deps.client, journey, auth)
  const terms = termsOf(journey, auth, feeWei)
  const allowance = await freshAllowance(deps.client, auth)
  if (allowance < BigInt(terms.amountRaw)) fail('The router is not yet approved for this amount.')
  const txs = buildCbAdaBaseToSolana(terms, allowance)
  validateCbAdaSendTxs(txs, terms, BigInt(auth.maxCcipFeeWei))
  const sim = await simulateCbAdaSend(deps.client, txs, terms, BigInt(auth.maxSendGasWei))
  if (sim.problems.length || sim.sendSimulated !== 'ok') fail(`The transfer cannot be sent safely: ${sim.problems.join(' ') || 'its simulation failed.'}`)
  return signPersistBroadcast(txs.send, auth, BigInt(auth.maxSendGasWei), deps,
    (hash) => recordSignedBridgeSend(deps.store, journey, hash, deps.now()),
    async (saved) => { await deps.store.put(recordLegOutcome(saved, 'bridge', { state: 'uncertain' }, deps.now())) })
}
