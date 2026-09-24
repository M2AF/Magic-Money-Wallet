/**
 * Pre-signing checks that turn opaque simulation failures into their real cause.
 * Each case is a failure a user hit on 2026-09-22, measured read-only:
 *
 *   Abstract PENGU -> ETH: "Execution reverted for an unknown reason". The
 *   swap balance shown (13,500.848872 PENGU) was the Abstract Global Wallet's;
 *   the EOA that signs held 0 PENGU. Relay itself reported userBalance 0.
 *
 *   Solana Tilcayo -> SOL (Jupiter) and Tilcayo -> CHOG (LI.FI): System Program
 *   custom error 0x1 inside the Associated Token Program. The wallet held
 *   0.001470621 SOL; one token account's rent is 0.00148844 SOL.
 *
 * The chain layer is mocked; nothing here reaches a network.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

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
  // The key for SIGNER (a well-known test vector is not needed: only the
  // derived ADDRESS is used, via viem, and it is stubbed through the account).
  getEvmPrivateKey: vi.fn(async () => '0x' + '11'.repeat(32)),
  getSolanaKeypair: vi.fn(),
}))
vi.mock('viem/accounts', () => ({
  privateKeyToAccount: () => ({ address: SIGNER }),
}))

import { executeSwap, describeSolanaSimulationFailure } from './swap-executor'
import type { NormalizedSwapQuote } from './swap-proxy'
import type { WalletConfig } from './secure-store'
import type { SwapSigningIdentity } from './swap-intent'
import { validAppFee, calldataWithFeeRecipient } from './swap-fixtures'

const PENGU = '0x9ebe3a824ca958e4b3da772d2065518f009cba62'
const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

function quote(over: Partial<NormalizedSwapQuote> = {}): NormalizedSwapQuote {
  const fromChain = over.fromChain ?? 'ethereum'
  return {
    provider: '0x', fromChain, toChain: fromChain,
    fromTokenAddress: USDC_ETH, toTokenAddress: NATIVE,
    fromTokenSymbol: 'USDC', toTokenSymbol: 'ETH',
    sellAmountRaw: '3000000', buyAmountRaw: '1000000000000000',
    minBuyAmountRaw: '995000000000000', minReceivedSource: 'provider',
    estimatedGasRaw: '210000', slippageBps: 50, priceImpactPct: 0, rate: 1,
    expiresAt: Date.now() + 30_000, isCrossChain: false,
    appFee: validAppFee('0x', fromChain, '3000000'),
    txData: { to: '0x3333333333333333333333333333333333333333', data: calldataWithFeeRecipient(), value: '0' },
    approvalTx: null,
    ...over,
  }
}
const identity = (source = SIGNER): SwapSigningIdentity => ({
  walletId: 'w', accountIndex: 0, environment: 'mainnet',
  sourceAddress: source, destinationAddress: source,
})
const cfg = {} as WalletConfig

beforeEach(() => {
  for (const f of Object.values(chain)) f.mockReset()
  chain.simulateRawEvmTransaction.mockResolvedValue({ status: 'revert', reason: 'Execution reverted for an unknown reason.' })
})

describe('EVM: the signer must hold what it is selling', () => {
  it('refuses BEFORE simulation when the signer holds less than the sell amount — and says why', async () => {
    chain.readEvmSellBalance.mockResolvedValue(0n)
    await expect(executeSwap(quote(), 'm', cfg, 0, 'intent-1', identity()))
      .rejects.toThrow(/does not hold enough USDC/i)
    expect(chain.simulateRawEvmTransaction).not.toHaveBeenCalled()
    expect(chain.sendRawEvmTransaction).not.toHaveBeenCalled()
  })

  it('on Abstract, points at the Abstract Global Wallet as the likely cause', async () => {
    chain.readEvmSellBalance.mockResolvedValue(0n)
    const q = quote({
      fromChain: 'abstract', toChain: 'abstract', provider: 'relay',
      fromTokenAddress: PENGU, fromTokenSymbol: 'PENGU', sellAmountRaw: '3000000000000000000000',
      appFee: validAppFee('relay', 'abstract', '3000000000000000000000'),
      requestId: '0x' + 'ab'.repeat(32),   // a fee-bearing Relay route must carry its request id
    })
    await expect(executeSwap(q, 'm', cfg, 0, 'intent-2', identity()))
      .rejects.toThrow(/Abstract Global Wallet/)
    expect(chain.sendRawEvmTransaction).not.toHaveBeenCalled()
  })

  it('checks the NATIVE balance when selling the native asset', async () => {
    chain.readEvmSellBalance.mockResolvedValue(1n)
    const q = quote({
      fromTokenAddress: NATIVE, fromTokenSymbol: 'ETH', toTokenAddress: USDC_ETH, toTokenSymbol: 'USDC',
      sellAmountRaw: '1000000000000000',
      txData: { to: '0x3333333333333333333333333333333333333333', data: calldataWithFeeRecipient(), value: '1000000000000000' },
    })
    await expect(executeSwap(q, 'm', cfg, 0, 'intent-3', identity())).rejects.toThrow(/does not hold enough ETH/)
    expect(chain.readEvmSellBalance.mock.calls[0][0]).toBeNull()   // native, not balanceOf
  })

  it('does NOT refuse on an unreadable balance — simulation still decides', async () => {
    chain.readEvmSellBalance.mockResolvedValue(null)
    await expect(executeSwap(quote(), 'm', cfg, 0, 'intent-4', identity()))
      .rejects.toThrow(/would fail on-chain/i)
    expect(chain.simulateRawEvmTransaction).toHaveBeenCalledOnce()
    expect(chain.sendRawEvmTransaction).not.toHaveBeenCalled()
  })

  it('proceeds to simulation when the balance is sufficient', async () => {
    chain.readEvmSellBalance.mockResolvedValue(3_000_000n)
    await expect(executeSwap(quote(), 'm', cfg, 0, 'intent-5', identity())).rejects.toThrow(/would fail on-chain/i)
    expect(chain.simulateRawEvmTransaction).toHaveBeenCalledOnce()
  })
})

describe('EVM: the signer must be the address the quote was built for', () => {
  it('refuses when the derived signer differs from the intent source address', async () => {
    chain.readEvmSellBalance.mockResolvedValue(10n ** 30n)
    await expect(executeSwap(quote(), 'm', cfg, 0, 'intent-6', identity('0x9999999999999999999999999999999999999999')))
      .rejects.toThrow(/quoted for a different address/i)
    expect(chain.readEvmSellBalance).not.toHaveBeenCalled()
    expect(chain.sendRawEvmTransaction).not.toHaveBeenCalled()
  })
})

describe('Solana: rent shortfall is named, not dumped as program logs', () => {
  // Verbatim shape of the Jupiter route's failure in the screenshot.
  const jupiterLogs = [
    'Program ComputeBudget111111111111111111111111111111 invoke [1]',
    'Program ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL invoke [1]',
    'Program 11111111111111111111111111111111 invoke [2]',
    'Transfer: insufficient lamports 1465621, need 2039280',
    'Program 11111111111111111111111111111111 failed: custom program error: 0x1',
    'Program ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL consumed 8475 of 1399700 compute units',
    'Program ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL failed: custom program error: 0x1',
  ]
  const err = { InstructionError: [2, { Custom: 1 }] }

  it('names the SOL shortfall for the Jupiter route', () => {
    expect(describeSolanaSimulationFailure(err, jupiterLogs)).toMatch(/needs more SOL to create a required token account/)
  })

  it('still names it when later log lines push the System Program line out of the tail', () => {
    const longer = [...jupiterLogs, 'Program log: extra 1', 'Program log: extra 2', 'Program log: extra 3']
    expect(describeSolanaSimulationFailure({ InstructionError: [5, { Custom: 1 }] }, longer))
      .toMatch(/needs more SOL/)
  })

  it('does not claim a SOL shortfall for an unrelated custom error 0x1', () => {
    const other = ['Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed: custom program error: 0x1']
    expect(describeSolanaSimulationFailure({ InstructionError: [3, { Custom: 1 }] }, other))
      .toMatch(/^\{"InstructionError"/)
  })
})
