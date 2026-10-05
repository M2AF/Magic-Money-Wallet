/**
 * Read-only destination evidence for a Cardano USDCx withdrawal to Ethereum.
 *
 * The Circle status reader binds a withdrawal ID to a burn hash, transfer-spec
 * hash and forwarded transaction hash. This module additionally checks that
 * the forwarded transaction succeeded and that its USDC Transfer logs give
 * the approved recipient exactly the prepared value at the required depth.
 * It does not prove the Cardano burn, Circle attester signatures, or that the
 * recipient has kept the USDC since this transaction.
 *
 * Evidence must come from readXReserveEthereumEvidence for the status hash,
 * using a single trusted endpoint per snapshot. Never accept page-provided
 * receipts or treat Circle's `finalized` label alone as delivery proof.
 */
import { decodeEventLog, toEventSelector, type Hex } from 'viem'
import type { CircleWithdrawalStatus } from '../shared/xreserve-testnet-wire'
import type { EthereumDepositEvidence } from './xreserve-ethereum-deposit-proof'
import type { PreparedWithdrawal } from './xreserve-withdrawal-prepare'
import { xreserveNetwork, type XReserveNetwork } from './xreserve-network'

const HASH = /^0x[0-9a-f]{64}$/i
const ADDRESS = /^0x[0-9a-f]{40}$/i
const QUANTITY = /^0x(0|[1-9a-f][0-9a-f]*)$/i
const DECIMAL = /^(0|[1-9][0-9]*)$/
const TRANSFER_EVENT = [{ type: 'event', name: 'Transfer', inputs: [
  { name: 'from', type: 'address', indexed: true },
  { name: 'to', type: 'address', indexed: true },
  { name: 'value', type: 'uint256', indexed: false },
] }] as const
export const USDC_TRANSFER_TOPIC = toEventSelector('Transfer(address,address,uint256)')

export type WithdrawalCreditState = 'verified' | 'pending' | 'failed' | 'needs-review' | 'evidence-inconsistent' | 'invalid-input'
export type WithdrawalCreditCode = 'verified' | 'circle-pending' | 'transaction-missing' | 'receipt-missing'
  | 'insufficient-confirmations' | 'reverted' | 'circle-failed-or-expired' | 'amount-mismatch'
  | 'reference-mismatch' | 'transaction-mismatch' | 'receipt-mismatch' | 'block-mismatch'
  | 'tip-behind' | 'malformed' | 'invalid-input'
export interface WithdrawalCreditResult {
  state: WithdrawalCreditState
  code: WithdrawalCreditCode
  retryable: boolean
  transactionHash: string | null
  confirmations: bigint | null
  netCreditRaw: string | null
}
export interface VerifyWithdrawalCreditInput {
  /** Validated by validatePreparedWithdrawal; this is the user's approved value. */
  prepared: PreparedWithdrawal
  /** Fetched and validated by fetchCircleWithdrawalStatus. */
  status: CircleWithdrawalStatus
  /** One-endpoint Ethereum snapshot for status.transactionHash. */
  evidence: EthereumDepositEvidence
  minConfirmations: number
  network?: XReserveNetwork
}

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const result = (state: WithdrawalCreditState, code: WithdrawalCreditCode,
  hash: string | null, confirmations: bigint | null = null, netCredit: bigint | null = null): WithdrawalCreditResult => ({
  state, code, retryable: state === 'pending' || state === 'evidence-inconsistent',
  transactionHash: hash, confirmations, netCreditRaw: netCredit?.toString() ?? null,
})
const qty = (v: unknown): bigint | null => typeof v === 'string' && QUANTITY.test(v) ? BigInt(v) : null
const hash = (v: unknown): string | null => typeof v === 'string' && HASH.test(v) ? v.toLowerCase() : null
const address = (v: unknown): string | null => typeof v === 'string' && ADDRESS.test(v) ? v.toLowerCase() : null

export function verifyXReserveEthereumWithdrawalCredit(input: VerifyWithdrawalCreditInput): WithdrawalCreditResult {
  let network: XReserveNetwork
  try { network = xreserveNetwork(input?.network) } catch { return result('invalid-input', 'invalid-input', null) }
  const p = input?.prepared, s = input?.status
  if (!obj(p) || !obj(s) || !obj(input?.evidence)
      || p.network !== network.id || p.destinationDomain !== 0
      || !address(p.recipient) || !hash(p.transferSpecHash)
      || typeof p.amountRaw !== 'string' || p.amountRaw.length > 78
      || !DECIMAL.test(p.amountRaw) || BigInt(p.amountRaw) === 0n
      || !Number.isSafeInteger(input.minConfirmations) || input.minConfirmations < 1) {
    return result('invalid-input', 'invalid-input', null)
  }
  const txHash = hash(s.transactionHash)
  if ((s.transactionHash !== null && !txHash)
      || !['created', 'verified', 'confirmed', 'finalized', 'expired', 'failed'].includes(s.state)) {
    return result('invalid-input', 'invalid-input', null)
  }
  if (s.transferSpecHash?.toLowerCase() !== p.transferSpecHash.toLowerCase()
      || !/^[0-9a-f]{64}$/i.test(s.burnTxHash ?? '')
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.withdrawalId ?? '')) {
    return result('needs-review', 'reference-mismatch', txHash)
  }
  if (s.state === 'failed' || s.state === 'expired') return result('needs-review', 'circle-failed-or-expired', txHash)
  if (s.state !== 'finalized') return result('pending', 'circle-pending', txHash)
  if (!txHash) return result('pending', 'transaction-missing', null)

  const { transaction: tx, receipt, block, tipBlockNumber } = input.evidence
  if (tx === null) return result('pending', 'transaction-missing', txHash)
  if (!obj(tx) || hash(tx.hash) !== txHash) return result('evidence-inconsistent', 'transaction-mismatch', txHash)
  if (tx.chainId != null && qty(tx.chainId) !== BigInt(network.ethereum.chainId)) {
    return result('evidence-inconsistent', 'transaction-mismatch', txHash)
  }
  if (receipt === null) return result('pending', 'receipt-missing', txHash)
  if (!obj(receipt) || hash(receipt.transactionHash) !== txHash || !Array.isArray(receipt.logs)) {
    return result('evidence-inconsistent', 'receipt-mismatch', txHash)
  }
  const height = qty(receipt.blockNumber), txHeight = qty(tx.blockNumber)
  const blockHash = hash(receipt.blockHash), txBlockHash = hash(tx.blockHash)
  const index = qty(receipt.transactionIndex), txIndex = qty(tx.transactionIndex)
  if (height === null || txHeight !== height || !blockHash || txBlockHash !== blockHash
      || index === null || txIndex !== index) return result('evidence-inconsistent', 'receipt-mismatch', txHash)
  if (!obj(block) || qty(block.number) !== height || hash(block.hash) !== blockHash) {
    return result('evidence-inconsistent', 'block-mismatch', txHash)
  }
  const tip = qty(tipBlockNumber)
  if (tip === null) return result('evidence-inconsistent', 'malformed', txHash)
  if (tip < height) return result('evidence-inconsistent', 'tip-behind', txHash)
  const confirmations = tip - height + 1n
  if (receipt.status !== '0x1' && receipt.status !== '0x0') {
    return result('evidence-inconsistent', 'malformed', txHash, confirmations)
  }
  if (receipt.status === '0x0') return result('failed', 'reverted', txHash, confirmations)
  if (confirmations < BigInt(input.minConfirmations)) {
    return result('pending', 'insufficient-confirmations', txHash, confirmations)
  }

  const recipient = p.recipient.toLowerCase(), usdc = network.ethereum.usdc.toLowerCase()
  let netCredit = 0n
  for (const raw of receipt.logs) {
    if (!obj(raw) || typeof raw.address !== 'string' || !address(raw.address)
        || !Array.isArray(raw.topics) || raw.topics.some(t => !hash(t))
        || typeof raw.data !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(raw.data)
        || (raw.transactionHash != null && hash(raw.transactionHash) !== txHash)) {
      return result('evidence-inconsistent', 'malformed', txHash, confirmations)
    }
    if (raw.removed === true) return result('evidence-inconsistent', 'malformed', txHash, confirmations)
    if (raw.address.toLowerCase() !== usdc || raw.topics[0]?.toLowerCase() !== USDC_TRANSFER_TOPIC.toLowerCase()) continue
    try {
      const transfer = decodeEventLog({ abi: TRANSFER_EVENT, topics: raw.topics as [Hex, ...Hex[]],
        data: raw.data as Hex, strict: true })
      if (transfer.args.to.toLowerCase() === recipient) netCredit += transfer.args.value
      if (transfer.args.from.toLowerCase() === recipient) netCredit -= transfer.args.value
    } catch { return result('evidence-inconsistent', 'malformed', txHash, confirmations) }
  }
  if (netCredit !== BigInt(p.amountRaw)) return result('needs-review', 'amount-mismatch', txHash, confirmations, netCredit)
  return result('verified', 'verified', txHash, confirmations, netCredit)
}
