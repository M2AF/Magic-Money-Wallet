/**
 * Reads right after the wallet's own transaction, against a load-balanced RPC
 * whose backends can be a block apart. Replays the Base cbADA -> Solana (Relay)
 * failures of 2026-10-05, measured read-only afterwards:
 *
 *   1. approve 2.0 cbADA (nonce 35) confirmed; the swap simulation then saw no
 *      allowance ("transfer amount exceeds allowance") and nothing was sent.
 *   2. the allowance (2.0) was short of 2.5: zero-reset (nonce 36) confirmed;
 *      the next approval was given nonce 36 again -> "replacement transaction
 *      underpriced". Pending nonce was 37 on chain throughout.
 *
 * The chain layer is mocked; nothing here reaches a network.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { encodeFunctionData, parseAbi } from 'viem'

const SIGNER = '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13'

const chain = vi.hoisted(() => ({
  readEvmSellBalance: vi.fn(),
  readErc20Allowance: vi.fn(),
  simulateRawEvmTransaction: vi.fn(),
  sendRawEvmTransaction: vi.fn(),
  waitForEvmReceipt: vi.fn(),
  getEvmPendingNonce: vi.fn(),
}))
vi.mock('./tx-sender', () => chain)
vi.mock('./wallet-core', () => ({
  getEvmPrivateKey: vi.fn(async () => '0x' + '11'.repeat(32)),
  getSolanaKeypair: vi.fn(),
}))
vi.mock('viem/accounts', () => ({ privateKeyToAccount: () => ({ address: SIGNER }) }))
const sessions = vi.hoisted(() => ({
  openSession: vi.fn(async () => {}), noteApprovalTx: vi.fn(async () => {}), noteSwapBroadcast: vi.fn(async () => {}),
  noteUncertainBroadcast: vi.fn(async () => {}), noteSourceReceipt: vi.fn(async () => {}), noteSwapNotSent: vi.fn(async () => {}),
  prepareCardanoSwapBroadcast: vi.fn(), reserveCardanoSwapInputs: vi.fn(),
}))
vi.mock('./swap-sessions', () => sessions)

import { executeSwap, READ_AFTER_WRITE } from './swap-executor'
import type { NormalizedSwapQuote } from './swap-proxy'
import type { WalletConfig } from './secure-store'
import { validAppFee, calldataWithFeeRecipient } from './swap-fixtures'

const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const SPENDER = '0xccc88a9d1b4ed6b0eaba998850414b24f1c315be'
const SELL = 2_500_000n

const approveData = (amount: bigint) =>
  encodeFunctionData({ abi: parseAbi(['function approve(address,uint256) returns (bool)']), functionName: 'approve', args: [SPENDER, amount] })

function quote(): NormalizedSwapQuote {
  return {
    provider: '0x', fromChain: 'ethereum', toChain: 'ethereum',
    fromTokenAddress: USDC_ETH, toTokenAddress: NATIVE, fromTokenSymbol: 'USDC', toTokenSymbol: 'ETH',
    sellAmountRaw: SELL.toString(), buyAmountRaw: '1000000000000000', minBuyAmountRaw: '995000000000000', minReceivedSource: 'provider',
    estimatedGasRaw: '210000', slippageBps: 50, priceImpactPct: 0, rate: 1,
    expiresAt: Date.now() + 60_000, isCrossChain: false,
    appFee: validAppFee('0x', 'ethereum', SELL.toString()),
    txData: { to: '0x3333333333333333333333333333333333333333', data: calldataWithFeeRecipient(), value: '0' },
    approvalTx: { to: USDC_ETH, data: approveData(SELL), value: '0' },
  } as NormalizedSwapQuote
}
const cfg = {} as WalletConfig
let hash = 0
const nextHash = () => '0x' + (++hash).toString(16).padStart(64, '0')

beforeEach(() => {
  for (const f of Object.values(chain)) f.mockReset()
  READ_AFTER_WRITE.delayMs = 0
  chain.readEvmSellBalance.mockResolvedValue(SELL)
  chain.waitForEvmReceipt.mockResolvedValue(undefined)
  chain.sendRawEvmTransaction.mockImplementation(async () => ({ txHash: nextHash(), explorerUrl: 'x' }))
})

const sentNonces = () => chain.sendRawEvmTransaction.mock.calls.map(c => (c[1] as { nonce?: number }).nonce)

describe('nonces after our own confirmed transaction', () => {
  it('a lagging node that still reports the used nonce never gets it reused (reset -> approve -> swap)', async () => {
    // Existing 2.0 allowance -> zero-reset first. The node keeps answering 36.
    chain.readErc20Allowance.mockResolvedValueOnce(2_000_000n).mockResolvedValueOnce(2_000_000n)
      .mockResolvedValueOnce(0n).mockResolvedValue(SELL)
    chain.getEvmPendingNonce.mockResolvedValue(36)
    chain.simulateRawEvmTransaction.mockResolvedValue({ status: 'pass' })
    await executeSwap(quote(), 'm', cfg, 0)
    expect(sentNonces()).toEqual([36, 37, 38])
    expect((chain.sendRawEvmTransaction.mock.calls[0][1] as { data: string }).data).toBe(approveData(0n))
  })

  it('a node AHEAD of our count is followed', async () => {
    chain.readErc20Allowance.mockResolvedValueOnce(0n).mockResolvedValue(SELL)
    chain.getEvmPendingNonce.mockResolvedValueOnce(10).mockResolvedValue(15)
    chain.simulateRawEvmTransaction.mockResolvedValue({ status: 'pass' })
    await executeSwap(quote(), 'm', cfg, 0)
    expect(sentNonces()).toEqual([10, 15])
  })

  it('after a zero-reset, a stale nonzero allowance stops before the new approval', async () => {
    chain.readErc20Allowance.mockResolvedValue(2_000_000n)
    chain.getEvmPendingNonce.mockResolvedValue(36)
    await expect(executeSwap(quote(), 'm', cfg, 0)).rejects.toThrow(/reset.*network has not caught up/)
    expect(chain.sendRawEvmTransaction).toHaveBeenCalledTimes(1)
    expect(sentNonces()).toEqual([36])
  })

  it('an unreadable nonce later still pins from our own last transaction', async () => {
    chain.readErc20Allowance.mockResolvedValueOnce(0n).mockResolvedValue(SELL)
    chain.getEvmPendingNonce.mockResolvedValueOnce(40).mockResolvedValue(null)
    chain.simulateRawEvmTransaction.mockResolvedValue({ status: 'pass' })
    await executeSwap(quote(), 'm', cfg, 0)
    expect(sentNonces()).toEqual([40, 41])
  })

  it('an unreadable first nonce stops before any approval is signed or sent', async () => {
    chain.readErc20Allowance.mockResolvedValue(0n)
    chain.getEvmPendingNonce.mockResolvedValue(null)
    await expect(executeSwap(quote(), 'm', cfg, 0)).rejects.toThrow(/nonce.*not sent/)
    expect(chain.sendRawEvmTransaction).not.toHaveBeenCalled()
  })
})

describe('simulation after our own approval', () => {
  it('waits until the approval is visible before simulating the swap', async () => {
    // Before: 0. After the receipt: two stale reads, then the allowance appears.
    chain.readErc20Allowance.mockResolvedValueOnce(0n).mockResolvedValueOnce(0n).mockResolvedValueOnce(0n).mockResolvedValue(SELL)
    chain.getEvmPendingNonce.mockResolvedValue(35)
    chain.simulateRawEvmTransaction.mockResolvedValue({ status: 'pass' })
    await executeSwap(quote(), 'm', cfg, 0)
    expect(chain.readErc20Allowance).toHaveBeenCalledTimes(4)
    expect(chain.sendRawEvmTransaction).toHaveBeenCalledTimes(2)
  })

  it('an approval that never becomes visible stops before the swap, saying the approval stays', async () => {
    chain.readErc20Allowance.mockResolvedValue(0n)
    chain.getEvmPendingNonce.mockResolvedValue(35)
    await expect(executeSwap(quote(), 'm', cfg, 0)).rejects.toThrow(/confirmed, but the network has not caught up/)
    expect(chain.readErc20Allowance).toHaveBeenCalledTimes(1 + READ_AFTER_WRITE.attempts)
    expect(chain.simulateRawEvmTransaction).not.toHaveBeenCalled()
    expect(chain.sendRawEvmTransaction).toHaveBeenCalledTimes(1)   // the approval only
  })

  it('one stale revert right after the approval is re-checked; a persistent revert still refuses', async () => {
    chain.readErc20Allowance.mockResolvedValueOnce(0n).mockResolvedValue(SELL)
    chain.getEvmPendingNonce.mockResolvedValue(35)
    chain.simulateRawEvmTransaction
      .mockResolvedValueOnce({ status: 'revert', reason: 'ERC20: transfer amount exceeds allowance' })
      .mockResolvedValue({ status: 'pass' })
    await executeSwap(quote(), 'm', cfg, 0)
    expect(chain.sendRawEvmTransaction).toHaveBeenCalledTimes(2)

    chain.sendRawEvmTransaction.mockClear(); chain.simulateRawEvmTransaction.mockReset()
    chain.readErc20Allowance.mockReset(); chain.readErc20Allowance.mockResolvedValueOnce(0n).mockResolvedValue(SELL)
    chain.simulateRawEvmTransaction.mockResolvedValue({ status: 'revert', reason: 'really reverts' })
    await expect(executeSwap(quote(), 'm', cfg, 0)).rejects.toThrow(/would fail on-chain \(really reverts\)/)
    expect(chain.simulateRawEvmTransaction).toHaveBeenCalledTimes(1 + READ_AFTER_WRITE.simulationRetries)
    expect(chain.sendRawEvmTransaction).toHaveBeenCalledTimes(1)   // the approval only, never the swap
  })

  it('with no approval sent, a revert is not retried', async () => {
    chain.readErc20Allowance.mockResolvedValue(SELL)
    chain.getEvmPendingNonce.mockResolvedValue(35)
    chain.simulateRawEvmTransaction.mockResolvedValue({ status: 'revert', reason: 'x' })
    await expect(executeSwap(quote(), 'm', cfg, 0)).rejects.toThrow(/would fail on-chain/)
    expect(chain.simulateRawEvmTransaction).toHaveBeenCalledTimes(1)
    expect(chain.sendRawEvmTransaction).not.toHaveBeenCalled()
  })
})

describe('the settlement record', () => {
  it('records the real token decimals, not a fixed 18 (cbADA has 6)', async () => {
    chain.readErc20Allowance.mockResolvedValueOnce(0n).mockResolvedValue(SELL)
    chain.getEvmPendingNonce.mockResolvedValue(35)
    chain.simulateRawEvmTransaction.mockResolvedValue({ status: 'pass' })
    const identity = { walletId: 'w', accountIndex: 0, environment: 'mainnet' as const, sourceAddress: SIGNER, destinationAddress: SIGNER }
    await executeSwap(quote(), 'm', cfg, 0, 'intent-1', identity, { from: 6, to: 6 })
    expect(sessions.openSession).toHaveBeenCalled()
    expect((sessions.openSession.mock.calls[0] as unknown[])[3]).toEqual({ from: 6, to: 6 })
  })
})
