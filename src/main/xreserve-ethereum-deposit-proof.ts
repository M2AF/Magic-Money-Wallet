/**
 * xreserve-ethereum-deposit-proof.ts — is this confirmed Ethereum transaction
 * EXACTLY the xReserve deposit the user approved? (pure, read-only)
 *
 * Only once this says `verified` may the transaction's hash be used to fetch
 * Circle's attestation and to track the Cardano mint (xreserve-cardano-mint-*).
 *
 * TRUST BOUNDARY. This module checks the CONSISTENCY of the evidence it is
 * handed; it cannot establish chain inclusion by itself. The eventual online
 * caller must fetch the transaction, its receipt, the receipt's block header
 * and the tip from Ethereum MAINNET itself (a node or provider it trusts), for
 * the known source hash — never accept a receipt supplied by a user or a page as
 * proof — and must re-run this after any reorg: a `verified` result is only as
 * final as the confirmation depth the caller requires.
 *
 * What is checked, in order (every rule must hold):
 *   • the transaction IS the requested hash, on chain 1, sent by the approved
 *     account, to the pinned xReserve contract, with zero ETH, and calldata
 *     BYTE-IDENTICAL to the approved deposit (buildCardanoDepositRequest,
 *     re-checked with validateCardanoDepositRequest);
 *   • the receipt, the transaction and the block header agree on the
 *     transaction hash, block number, block hash and transaction index;
 *   • the receipt succeeded;
 *   • exactly ONE `DepositedToRemote` log from the pinned xReserve contract,
 *     not removed, decoded by Circle's published event
 *     (circlefin/evm-xreserve-contracts DepositToRemote.sol), whose local token,
 *     amount, depositor, remote domain, remote recipient, max fee and hookData
 *     all equal the approved call;
 *   • the block is at least `minConfirmations` deep under the supplied tip.
 *
 * NETWORKS. `input.network` selects the xReserve profile (xreserve-network.ts);
 * omitted, it is Ethereum mainnet. The chain id, contract and USDC checked
 * above all come from that pinned profile.
 *
 * Callers branch on `state` and `code`; `reason` is for people.
 */

import {
  decodeEventLog, toEventSelector, getAddress, isAddress, type Hex,
} from 'viem'
import {
  buildCardanoDepositRequest, validateCardanoDepositRequest,
  XReserveCardanoError, type CardanoDepositInput, type DepositToRemoteParams,
} from './xreserve-cardano-deposit'
import { xreserveNetwork, type XReserveNetwork } from './xreserve-network'

/** Circle's event, exactly as DepositToRemote.sol declares it. */
export const DEPOSITED_TO_REMOTE_EVENT = [{
  type: 'event',
  name: 'DepositedToRemote',
  inputs: [
    { name: 'localToken', type: 'address', indexed: true },
    { name: 'value', type: 'uint256', indexed: false },
    { name: 'localDepositor', type: 'address', indexed: true },
    { name: 'remoteRecipient', type: 'bytes32', indexed: true },
    { name: 'remoteDomain', type: 'uint32', indexed: false },
    { name: 'remoteToken', type: 'bytes32', indexed: false },
    { name: 'maxFee', type: 'uint256', indexed: false },
    { name: 'hookData', type: 'bytes', indexed: false },
  ],
}] as const

export const DEPOSITED_TO_REMOTE_TOPIC = toEventSelector(
  'DepositedToRemote(address,uint256,address,bytes32,uint32,bytes32,uint256,bytes)')

export type SourceDepositState =
  /** Confirmed, exactly the approved deposit, deep enough. */
  | 'verified'
  /** Not found, not mined, or mined but shallower than required. Poll again. */
  | 'pending'
  /** Mined and reverted: no deposit happened. Terminal. */
  | 'failed'
  /** A confirmed transaction that is not the approved deposit. Needs review. */
  | 'not-approved'
  /** The evidence contradicts itself (provider trouble or a reorg in progress). Fetch again. */
  | 'evidence-inconsistent'
  /** The caller's own arguments are unusable. */
  | 'invalid-input'

export type SourceDepositCode =
  | 'verified'
  | 'not-found' | 'not-mined' | 'insufficient-confirmations'
  | 'reverted'
  | 'wrong-chain' | 'wrong-sender' | 'wrong-destination' | 'nonzero-value' | 'calldata-mismatch'
  | 'hash-mismatch' | 'receipt-missing' | 'receipt-mismatch' | 'block-missing' | 'block-mismatch'
  | 'event-missing' | 'event-ambiguous' | 'event-mismatch' | 'log-removed' | 'tip-behind' | 'malformed'
  | 'invalid-input'

export interface DecodedDepositEvent {
  localToken: string
  value: bigint
  localDepositor: string
  remoteRecipient: string
  remoteDomain: number
  remoteToken: string
  maxFee: bigint
  hookData: string
  logIndex: number
}

export interface SourceDepositResult {
  state: SourceDepositState
  code: SourceDepositCode
  retryable: boolean
  reason: string | null
  blockNumber: bigint | null
  blockHash: string | null
  confirmations: bigint | null
  /** The approved call's parameters, once the transaction matched them. */
  deposit: DepositToRemoteParams | null
  event: DecodedDepositEvent | null
}

export interface EthereumDepositEvidence {
  /** `eth_getTransactionByHash` result (null when the node does not know the hash). */
  transaction: unknown
  /** `eth_getTransactionReceipt` result (null until mined). */
  receipt: unknown
  /** `eth_getBlockByNumber(receipt.blockNumber, false)` result. */
  block: unknown
  /** `eth_blockNumber` result: the tip height (hex quantity or bigint). */
  tipBlockNumber: unknown
}

export interface VerifyEthereumDepositInput {
  sourceTxHash: string
  approved: CardanoDepositInput
  /** The account the user approved sending from. */
  approvedSender: string
  evidence: EthereumDepositEvidence
  /** Blocks on top of (and including) the deposit's block before it counts. Positive integer. */
  minConfirmations: number
  /** xReserve network profile; mainnet when omitted. */
  network?: XReserveNetwork
}

const RETRYABLE: Record<SourceDepositState, boolean> = {
  'verified': false, 'pending': true, 'failed': false, 'not-approved': false,
  'evidence-inconsistent': true, 'invalid-input': false,
}

class Stop extends Error {
  constructor(readonly state: SourceDepositState, readonly code: SourceDepositCode, message: string) { super(message) }
}
const stop = (state: SourceDepositState, code: SourceDepositCode, why: string): never => { throw new Stop(state, code, why) }
const bad = (why: string): never => stop('evidence-inconsistent', 'malformed', why)

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const HASH = /^0x[0-9a-fA-F]{64}$/

function quantity(v: unknown, what: string): bigint {
  if (typeof v === 'bigint' && v >= 0n) return v
  if (typeof v === 'string' && /^0x(0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(v)) return BigInt(v)
  return bad(`${what} is not a quantity`)
}
function hash32(v: unknown, what: string): string {
  if (typeof v !== 'string' || !HASH.test(v)) return bad(`${what} is not a 32-byte hash`)
  return v.toLowerCase()
}
function address(v: unknown, what: string): string {
  if (typeof v !== 'string' || !isAddress(v, { strict: false })) return bad(`${what} is not an address`)
  return v.toLowerCase()
}
function hexData(v: unknown, what: string): Hex {
  if (typeof v !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(v)) return bad(`${what} is not hex data`)
  return v.toLowerCase() as Hex
}

/** Decode one log as Circle's DepositedToRemote event; throws on anything else. */
export function decodeDepositedToRemoteLog(log: { topics: string[]; data: string }): Omit<DecodedDepositEvent, 'logIndex'> {
  const decoded = decodeEventLog({
    abi: DEPOSITED_TO_REMOTE_EVENT, topics: log.topics as [Hex, ...Hex[]], data: log.data as Hex, strict: true,
  })
  const a = decoded.args
  return {
    localToken: getAddress(a.localToken).toLowerCase(),
    value: a.value,
    localDepositor: getAddress(a.localDepositor).toLowerCase(),
    remoteRecipient: a.remoteRecipient.toLowerCase(),
    remoteDomain: a.remoteDomain,
    remoteToken: a.remoteToken.toLowerCase(),
    maxFee: a.maxFee,
    hookData: a.hookData.toLowerCase(),
  }
}

export function verifyXReserveEthereumDeposit(input: VerifyEthereumDepositInput): SourceDepositResult {
  let blockNumber: bigint | null = null
  let blockHash: string | null = null
  let deposit: DepositToRemoteParams | null = null
  let event: DecodedDepositEvent | null = null
  const result = (state: SourceDepositState, code: SourceDepositCode, reason: string | null, confirmations: bigint | null = null): SourceDepositResult =>
    ({ state, code, retryable: RETRYABLE[state], reason, blockNumber, blockHash, confirmations, deposit, event })

  try {
    // ── The caller's own arguments ─────────────────────────────────────────
    if (!input || typeof input !== 'object') stop('invalid-input', 'invalid-input', 'no input')
    if (typeof input.sourceTxHash !== 'string' || !HASH.test(input.sourceTxHash)) stop('invalid-input', 'invalid-input', 'source transaction hash is malformed')
    const source = input.sourceTxHash.toLowerCase()
    if (typeof input.approvedSender !== 'string' || !isAddress(input.approvedSender, { strict: false })) {
      stop('invalid-input', 'invalid-input', 'approved sender is not an address')
    }
    const sender = input.approvedSender.toLowerCase()
    if (!Number.isSafeInteger(input.minConfirmations) || input.minConfirmations < 1) stop('invalid-input', 'invalid-input', 'minConfirmations must be a positive integer')
    let net: XReserveNetwork
    try { net = xreserveNetwork(input.network) } catch { return result('invalid-input', 'invalid-input', 'unknown xReserve network') }
    const xReserve = net.ethereum.xReserve.toLowerCase()
    let approvedCall
    try { approvedCall = buildCardanoDepositRequest(input.approved, net) } catch (e) {
      return result('invalid-input', 'invalid-input', `approved deposit: ${e instanceof XReserveCardanoError ? e.message : 'invalid'}`)
    }
    const ev = input.evidence
    if (!isObj(ev)) stop('invalid-input', 'invalid-input', 'no evidence')

    // ── The transaction ────────────────────────────────────────────────────
    const tx = ev.transaction
    if (tx == null) stop('pending', 'not-found', 'Ethereum does not know this transaction yet')
    if (!isObj(tx)) return bad('transaction is malformed')
    if (hash32(tx.hash, 'transaction hash') !== source) stop('evidence-inconsistent', 'hash-mismatch', 'the provider returned a different transaction')
    if (tx.chainId === undefined || quantity(tx.chainId, 'chainId') !== BigInt(net.ethereum.chainId)) {
      stop('not-approved', 'wrong-chain', `the transaction is not an ${net.ethereum.name} transaction`)
    }
    if (address(tx.from, 'sender') !== sender) stop('not-approved', 'wrong-sender', 'the transaction was not sent by the approved account')
    if (tx.to == null || address(tx.to, 'destination') !== xReserve) {
      stop('not-approved', 'wrong-destination', 'the transaction is not addressed to Circle\'s xReserve contract')
    }
    if (quantity(tx.value, 'value') !== 0n) stop('not-approved', 'nonzero-value', 'the transaction sends ETH')
    const calldata = hexData(tx.input, 'calldata')
    if (calldata !== approvedCall.data.toLowerCase()) stop('not-approved', 'calldata-mismatch', 'the calldata is not byte-identical to the approved deposit')
    try {
      deposit = validateCardanoDepositRequest({ chainId: net.ethereum.chainId, to: tx.to as string, value: 0n, data: calldata }, input.approved, net)
    } catch {
      return result('not-approved', 'calldata-mismatch', 'the calldata does not validate as the approved deposit')
    }

    // ── Mined? Receipt, transaction and block agree? ───────────────────────
    if (tx.blockNumber == null || tx.blockHash == null) stop('pending', 'not-mined', 'the transaction is not in a block yet')
    const txBlockNumber = quantity(tx.blockNumber, 'transaction block number')
    const txBlockHash = hash32(tx.blockHash, 'transaction block hash')
    const txIndex = quantity(tx.transactionIndex, 'transaction index')
    const receipt = ev.receipt
    if (receipt == null) stop('evidence-inconsistent', 'receipt-missing', 'the transaction is mined but its receipt was not supplied')
    if (!isObj(receipt)) return bad('receipt is malformed')
    if (hash32(receipt.transactionHash, 'receipt transaction hash') !== source) stop('evidence-inconsistent', 'receipt-mismatch', 'the receipt belongs to another transaction')
    blockNumber = quantity(receipt.blockNumber, 'receipt block number')
    blockHash = hash32(receipt.blockHash, 'receipt block hash')
    if (blockNumber !== txBlockNumber || blockHash !== txBlockHash || quantity(receipt.transactionIndex, 'receipt index') !== txIndex) {
      stop('evidence-inconsistent', 'receipt-mismatch', 'the receipt and the transaction disagree on their block')
    }
    const block = ev.block
    if (block == null) stop('evidence-inconsistent', 'block-missing', 'the receipt\'s block header was not supplied')
    if (!isObj(block)) return bad('block is malformed')
    if (quantity(block.number, 'block number') !== blockNumber || hash32(block.hash, 'block hash') !== blockHash) {
      stop('evidence-inconsistent', 'block-mismatch', 'the block header is not the receipt\'s block (possible reorg)')
    }

    // ── Outcome ────────────────────────────────────────────────────────────
    const status = quantity(receipt.status, 'receipt status')
    if (status === 0n) stop('failed', 'reverted', 'the transaction reverted, so no deposit was made')
    if (status !== 1n) return bad('receipt status is neither success nor failure')

    // ── Exactly one DepositedToRemote from the pinned contract ─────────────
    if (!Array.isArray(receipt.logs)) return bad('receipt has no log list')
    const matches: Array<Record<string, unknown>> = []
    for (const l of receipt.logs as unknown[]) {
      if (!isObj(l) || !Array.isArray(l.topics)) return bad('receipt log is malformed')
      if (address(l.address, 'log address') !== xReserve) continue
      if (typeof l.topics[0] !== 'string' || l.topics[0].toLowerCase() !== DEPOSITED_TO_REMOTE_TOPIC) continue
      matches.push(l)
    }
    if (matches.length === 0) stop('evidence-inconsistent', 'event-missing', 'no DepositedToRemote event from the xReserve contract')
    if (matches.length > 1) stop('evidence-inconsistent', 'event-ambiguous', 'more than one DepositedToRemote event from the xReserve contract')
    const log = matches[0]
    if (log.removed === true) stop('evidence-inconsistent', 'log-removed', 'the deposit event was removed (reorg)')
    if (log.transactionHash !== undefined && hash32(log.transactionHash, 'log transaction hash') !== source) {
      stop('evidence-inconsistent', 'receipt-mismatch', 'the deposit event belongs to another transaction')
    }
    if (log.blockHash !== undefined && hash32(log.blockHash, 'log block hash') !== blockHash) {
      stop('evidence-inconsistent', 'receipt-mismatch', 'the deposit event is from another block')
    }
    let decoded
    try {
      decoded = decodeDepositedToRemoteLog({ topics: log.topics as string[], data: hexData(log.data, 'log data') })
    } catch (e) {
      if (e instanceof Stop) throw e
      return bad('the deposit event does not decode as DepositedToRemote')
    }
    event = { ...decoded, logIndex: Number(quantity(log.logIndex, 'log index')) }
    const d = deposit as DepositToRemoteParams
    const eventMatches = event.localToken === d.localToken.toLowerCase()
      && event.value === d.value
      && event.localDepositor === sender
      && event.remoteDomain === d.remoteDomain
      && event.remoteRecipient === d.remoteRecipient.toLowerCase()
      && event.maxFee === d.maxFee
      && event.hookData === d.hookData.toLowerCase()
    // The calldata already matched, so a differing event contradicts it.
    if (!eventMatches) stop('evidence-inconsistent', 'event-mismatch', 'the deposit event does not match the approved call')

    // ── Depth ──────────────────────────────────────────────────────────────
    const tip = quantity(ev.tipBlockNumber, 'tip block number')
    if (tip < blockNumber) stop('evidence-inconsistent', 'tip-behind', 'the tip is behind the deposit\'s block')
    const confirmations = tip - blockNumber + 1n
    if (confirmations < BigInt(input.minConfirmations)) {
      return result('pending', 'insufficient-confirmations', 'the deposit is confirmed but not yet deep enough', confirmations)
    }
    return result('verified', 'verified', null, confirmations)
  } catch (e) {
    if (e instanceof Stop) return result(e.state, e.code, e.message)
    return result('evidence-inconsistent', 'malformed', 'the evidence could not be read')
  }
}
