/**
 * The pre-signing SOL check: refuses BEFORE signing or simulating, with the same
 * message the quote screen shows; an unreadable cost is not a verdict.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Keypair, TransactionMessage, VersionedTransaction, SystemProgram } from '@solana/web3.js'

const kp = Keypair.generate()
const cost = vi.hoisted(() => ({ estimateSolanaSwapCost: vi.fn() }))
vi.mock('./solana-swap-cost', async (orig) => ({ ...(await orig<typeof import('./solana-swap-cost')>()), ...cost }))
vi.mock('./wallet-core', () => ({ getSolanaKeypair: vi.fn(async () => kp), getEvmPrivateKey: vi.fn() }))
const simulate = vi.fn()
vi.mock('@solana/web3.js', async (orig) => {
  const real = await orig<typeof import('@solana/web3.js')>()
  class Conn { simulateTransaction = simulate; constructor() {} }
  return { ...real, Connection: Conn }
})

import { executeSwap } from './swap-executor'
import { solanaShortfallMessage } from '../shared/solana-upfront-cost'
import type { NormalizedSwapQuote } from './swap-proxy'
import { feeFreeRecord } from '../shared/swap-fee-policy'

function solQuote(): NormalizedSwapQuote {
  const msg = new TransactionMessage({
    payerKey: kp.publicKey, recentBlockhash: '11111111111111111111111111111111',
    instructions: [SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })],
  }).compileToV0Message()
  return {
    provider: 'jupiter', fromChain: 'solana', toChain: 'solana',
    fromTokenAddress: 'So11111111111111111111111111111111111111112',
    toTokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    fromTokenSymbol: 'SOL', toTokenSymbol: 'USDC', sellAmountRaw: '10000000', buyAmountRaw: '1000000',
    minBuyAmountRaw: '995000', minReceivedSource: 'provider', estimatedGasRaw: '0', slippageBps: 50,
    priceImpactPct: 0, rate: 1, expiresAt: Date.now() + 30_000, isCrossChain: false,
    appFee: feeFreeRecord('jupiter', 'solana', 'test'),
    txData: { swapTransaction: Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64') },
  }
}
const shortCost = {
  baseFeeLamports: '5000', priorityFeeLamports: '71', newAccounts: [{ address: 'a', kind: 'token-account' as const, mint: 'So1', tokenProgram: 'T', size: 165, rentLamports: '1488440', refundedInTx: true }],
  rentLamports: '1488440', otherTransferLamports: '0', saleLamports: '0', requiredLamports: '1493511', costLamports: '1493511',
  balanceLamports: '1470621', complete: false, incompleteReason: 'router', measuredLamports: null, simulationError: null,
}

beforeEach(() => { cost.estimateSolanaSwapCost.mockReset(); simulate.mockReset() })

describe('Solana pre-signing SOL check', () => {
  it('refuses before signing or simulating, with the SAME text the quote screen shows', async () => {
    cost.estimateSolanaSwapCost.mockResolvedValue(shortCost)
    const err = await executeSwap(solQuote(), 'm', {} as never).then(() => new Error('expected a refusal'), (e: Error) => e)
    expect(err.message).toContain(solanaShortfallMessage(shortCost)!)
    expect(err.message).toMatch(/Nothing was sent/)
    expect(simulate).not.toHaveBeenCalled()
    // Re-read at signing time, for the fee payer of THIS transaction.
    expect(cost.estimateSolanaSwapCost.mock.calls[0][1]).toBe(kp.publicKey.toBase58())
  })

  it('an unreadable cost is not a verdict: simulation still runs and decides', async () => {
    cost.estimateSolanaSwapCost.mockRejectedValue(new Error('rpc down'))
    simulate.mockResolvedValue({ value: { err: { InstructionError: [0, { Custom: 1 }] }, logs: [] } })
    await expect(executeSwap(solQuote(), 'm', {} as never)).rejects.toThrow(/would fail on-chain/)
    expect(simulate).toHaveBeenCalledOnce()
  })

  it('a covered requirement passes straight on to simulation', async () => {
    cost.estimateSolanaSwapCost.mockResolvedValue({ ...shortCost, balanceLamports: '67157259' })
    simulate.mockResolvedValue({ value: { err: { InstructionError: [0, 'x'] }, logs: [] } })
    await expect(executeSwap(solQuote(), 'm', {} as never)).rejects.toThrow(/would fail on-chain/)
    expect(simulate).toHaveBeenCalledOnce()
  })
})
