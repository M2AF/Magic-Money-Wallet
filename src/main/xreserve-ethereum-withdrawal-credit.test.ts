import { describe, expect, it } from 'vitest'
import type { CircleWithdrawalStatus } from '../shared/xreserve-testnet-wire'
import type { PreparedWithdrawal } from './xreserve-withdrawal-prepare'
import type { EthereumDepositEvidence } from './xreserve-ethereum-deposit-proof'
import { XRESERVE_MAINNET, XRESERVE_SEPOLIA_PREPROD } from './xreserve-network'
import { USDC_TRANSFER_TOPIC, verifyXReserveEthereumWithdrawalCredit } from './xreserve-ethereum-withdrawal-credit'

const TX = '0x' + 'ab'.repeat(32)
const BLOCK = '0x' + 'cd'.repeat(32)
const BURN = 'ef'.repeat(32)
const SPEC = '0x' + '12'.repeat(32)
const RECIPIENT = '0x' + '34'.repeat(20)
const SENDER = '0x' + '56'.repeat(20)
const word = (address: string) => '0x' + '0'.repeat(24) + address.slice(2)
const amount = (n: bigint) => '0x' + n.toString(16).padStart(64, '0')
const transfer = (from: string, to: string, n: bigint, token = XRESERVE_MAINNET.ethereum.usdc) => ({
  address: token, topics: [USDC_TRANSFER_TOPIC, word(from), word(to)], data: amount(n), transactionHash: TX, removed: false,
})
const prepared = (): PreparedWithdrawal => ({
  network: 'mainnet', recipient: RECIPIENT, remoteDepositor: '0x' + '78'.repeat(32),
  destinationDomain: 0, amountRaw: '10000000', maxFeeRaw: '1000000', burnAmountRaw: '11000000',
  maxBlockHeight: '12345', encoded: '0x', transferSpecHash: SPEC, executable: false,
})
const status = (): CircleWithdrawalStatus => ({
  withdrawalId: '12345678-1234-1234-1234-123456789abc', burnTxHash: BURN,
  transferSpecHash: SPEC, state: 'finalized', transactionHash: TX, deliveryVerified: false,
})
const evidence = (): EthereumDepositEvidence => ({
  transaction: { hash: TX, chainId: '0x1', blockNumber: '0x64', blockHash: BLOCK, transactionIndex: '0x0' },
  receipt: { transactionHash: TX, blockNumber: '0x64', blockHash: BLOCK, transactionIndex: '0x0',
    status: '0x1', logs: [transfer(SENDER, RECIPIENT, 10_000_000n)] },
  block: { number: '0x64', hash: BLOCK }, tipBlockNumber: '0x70',
})
const check = (over: Partial<Parameters<typeof verifyXReserveEthereumWithdrawalCredit>[0]> = {}) =>
  verifyXReserveEthereumWithdrawalCredit({ prepared: prepared(), status: status(), evidence: evidence(), minConfirmations: 12, ...over })

describe('xReserve Ethereum withdrawal credit proof', () => {
  it('verifies exact USDC net credit in a deep, successful Circle-linked transaction', () => {
    expect(check()).toMatchObject({ state: 'verified', code: 'verified', transactionHash: TX,
      confirmations: 13n, netCreditRaw: '10000000' })
  })

  it('does not call Circle finalized proof of delivery without a transaction hash or receipt', () => {
    expect(check({ status: { ...status(), transactionHash: null } })).toMatchObject({ state: 'pending', code: 'transaction-missing' })
    expect(check({ evidence: { ...evidence(), receipt: null } })).toMatchObject({ state: 'pending', code: 'receipt-missing' })
  })

  it('waits for exactly the required depth and rechecks the same receipt', () => {
    expect(check({ evidence: { ...evidence(), tipBlockNumber: '0x6e' } })).toMatchObject({ state: 'pending', code: 'insufficient-confirmations', confirmations: 11n })
    expect(check({ evidence: { ...evidence(), tipBlockNumber: '0x6f' } })).toMatchObject({ state: 'verified', confirmations: 12n })
  })

  it('holds while Circle is pending and sends failed/expired states to review', () => {
    expect(check({ status: { ...status(), state: 'confirmed' } })).toMatchObject({ state: 'pending', code: 'circle-pending' })
    expect(check({ status: { ...status(), state: 'failed' } })).toMatchObject({ state: 'needs-review', code: 'circle-failed-or-expired' })
    expect(check({ status: { ...status(), state: 'expired' } })).toMatchObject({ state: 'needs-review', code: 'circle-failed-or-expired' })
  })

  it('refuses a status for another transfer specification', () => {
    expect(check({ status: { ...status(), transferSpecHash: '0x' + '99'.repeat(32) } }))
      .toMatchObject({ state: 'needs-review', code: 'reference-mismatch' })
  })

  it('rejects mismatched transaction, receipt, block and chain identities', () => {
    const e = evidence()
    expect(check({ evidence: { ...e, transaction: { ...(e.transaction as object), hash: '0x' + '11'.repeat(32) } } }))
      .toMatchObject({ state: 'evidence-inconsistent', code: 'transaction-mismatch' })
    expect(check({ evidence: { ...e, transaction: { ...(e.transaction as object), chainId: '0xaa36a7' } } }))
      .toMatchObject({ state: 'evidence-inconsistent', code: 'transaction-mismatch' })
    expect(check({ evidence: { ...e, receipt: { ...(e.receipt as object), blockHash: '0x' + '11'.repeat(32) } } }))
      .toMatchObject({ state: 'evidence-inconsistent', code: 'receipt-mismatch' })
    expect(check({ evidence: { ...e, block: { number: '0x65', hash: BLOCK } } }))
      .toMatchObject({ state: 'evidence-inconsistent', code: 'block-mismatch' })
    expect(check({ evidence: { ...e, tipBlockNumber: '0x63' } }))
      .toMatchObject({ state: 'evidence-inconsistent', code: 'tip-behind' })
  })

  it('reports a reverted destination transaction, never delivery', () => {
    const e = evidence()
    expect(check({ evidence: { ...e, receipt: { ...(e.receipt as object), status: '0x0' } } }))
      .toMatchObject({ state: 'failed', code: 'reverted' })
  })

  it('measures exact net credit; ignores another token and subtracts outgoing USDC', () => {
    const e = evidence(), r = e.receipt as Record<string, unknown>
    const logs = [transfer(SENDER, RECIPIENT, 11_000_000n),
      transfer(RECIPIENT, SENDER, 1_000_000n),
      transfer(SENDER, RECIPIENT, 5_000_000n, '0x' + '99'.repeat(20))]
    expect(check({ evidence: { ...e, receipt: { ...r, logs } } })).toMatchObject({ state: 'verified', netCreditRaw: '10000000' })
    expect(check({ evidence: { ...e, receipt: { ...r, logs: [transfer(SENDER, RECIPIENT, 9_999_999n)] } } }))
      .toMatchObject({ state: 'needs-review', code: 'amount-mismatch', netCreditRaw: '9999999' })
    expect(check({ evidence: { ...e, receipt: { ...r, logs: [transfer(SENDER, RECIPIENT, 10_000_001n)] } } }))
      .toMatchObject({ state: 'needs-review', code: 'amount-mismatch', netCreditRaw: '10000001' })
  })

  it('refuses a transfer to another recipient or a lookalike USDC contract', () => {
    const e = evidence(), r = e.receipt as Record<string, unknown>
    expect(check({ evidence: { ...e, receipt: { ...r, logs: [transfer(SENDER, '0x' + '77'.repeat(20), 10_000_000n)] } } }))
      .toMatchObject({ state: 'needs-review', code: 'amount-mismatch', netCreditRaw: '0' })
    expect(check({ evidence: { ...e, receipt: { ...r, logs: [transfer(SENDER, RECIPIENT, 10_000_000n, '0x' + '99'.repeat(20))] } } }))
      .toMatchObject({ state: 'needs-review', code: 'amount-mismatch', netCreditRaw: '0' })
  })

  it('does not skip malformed or removed USDC logs', () => {
    const e = evidence(), r = e.receipt as Record<string, unknown>
    expect(check({ evidence: { ...e, receipt: { ...r, logs: [{ ...transfer(SENDER, RECIPIENT, 10_000_000n), data: '0x12' }] } } }))
      .toMatchObject({ state: 'evidence-inconsistent', code: 'malformed' })
    expect(check({ evidence: { ...e, receipt: { ...r, logs: [{ ...transfer(SENDER, RECIPIENT, 10_000_000n), removed: true }] } } }))
      .toMatchObject({ state: 'evidence-inconsistent', code: 'malformed' })
  })

  it('refuses an unapproved network profile before reading evidence', () => {
    expect(check({ network: XRESERVE_SEPOLIA_PREPROD })).toMatchObject({ state: 'invalid-input' })
    expect(check({ minConfirmations: 0 })).toMatchObject({ state: 'invalid-input' })
    expect(verifyXReserveEthereumWithdrawalCredit(null as never)).toMatchObject({ state: 'invalid-input' })
    expect(check({ status: { ...status(), transactionHash: '0x12' } })).toMatchObject({ state: 'invalid-input' })
  })

  it('uses the pinned Sepolia USDC contract under the testnet profile', () => {
    const e = evidence(), r = e.receipt as Record<string, unknown>
    expect(check({ network: XRESERVE_SEPOLIA_PREPROD,
      prepared: { ...prepared(), network: 'sepolia-preprod' },
      evidence: { ...e, transaction: { ...(e.transaction as object), chainId: '0xaa36a7' },
        receipt: { ...r, logs: [transfer(SENDER, RECIPIENT, 10_000_000n, XRESERVE_SEPOLIA_PREPROD.ethereum.usdc)] } },
    })).toMatchObject({ state: 'verified', code: 'verified' })
  })
})
