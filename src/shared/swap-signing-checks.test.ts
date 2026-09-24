/**
 * The checks a connected-wallet host (ChainLens) runs immediately before EVERY
 * signature: account, chain, recipient, token identities, fees, minimum output,
 * spender and the exact transaction plan.
 */
import { describe, it, expect } from 'vitest'
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction, SystemProgram } from '@solana/web3.js'
import {
  approveSwap, checkQuoteBeforeSigning, swapPlanFingerprint, quoteApprovalSpender, SwapSigningRefusal,
  type SigningCheckContext,
} from './swap-signing-checks'
import { validAppFee, calldataWithFeeRecipient } from '../main/swap-fixtures'
import { setSettlementTrackingActive } from './swap-policy-checks'
import type { NormalizedSwapQuote } from './swap-quote'

const NOW = 1_800_000_000_000
const EOA = '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13'
const OTHER = '0x2222222222222222222222222222222222222222'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const SPENDER = '0x0000000000001fF3684f28c67538d4D072C22734'
const ctx: SigningCheckContext = {
  now: NOW,
  isEvmChain: c => ['ethereum', 'base', 'monad'].includes(c),
  evmChainIdOf: c => ({ ethereum: 1, base: 8453, monad: 143 } as Record<string, number>)[c] ?? null,
}
const approveData = (spender: string, amount: bigint) =>
  '0x095ea7b3' + spender.slice(2).toLowerCase().padStart(64, '0') + amount.toString(16).padStart(64, '0')

function ethToUsdc(over: Partial<NormalizedSwapQuote> = {}): NormalizedSwapQuote {
  return {
    provider: '0x', fromChain: 'ethereum', toChain: 'ethereum',
    fromTokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', toTokenAddress: USDC,
    fromTokenSymbol: 'ETH', toTokenSymbol: 'USDC',
    sellAmountRaw: '1000000000000000000', buyAmountRaw: '1000000', minBuyAmountRaw: '995000', minReceivedSource: 'provider',
    estimatedGasRaw: '210000', slippageBps: 50, priceImpactPct: 0, rate: 1, expiresAt: NOW + 30_000, isCrossChain: false,
    appFee: validAppFee('0x', 'ethereum', '1000000000000000000'),
    txData: { to: '0x3333333333333333333333333333333333333333', data: calldataWithFeeRecipient(), value: '1000000000000000000' },
    ...over,
  }
}
function usdcToEth(over: Partial<NormalizedSwapQuote> = {}): NormalizedSwapQuote {
  return ethToUsdc({
    fromTokenAddress: USDC, toTokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', fromTokenSymbol: 'USDC', toTokenSymbol: 'ETH',
    sellAmountRaw: '5000000', buyAmountRaw: '2000000000000000', minBuyAmountRaw: '1990000000000000',
    appFee: validAppFee('0x', 'ethereum', '5000000'),
    txData: { to: SPENDER, data: calldataWithFeeRecipient(), value: '0' },
    approvalTx: { to: USDC, data: approveData(SPENDER, 5000000n), value: '0' },
    ...over,
  })
}
const approvedFor = (q: NormalizedSwapQuote, source = EOA, dest = EOA, id: number | null = 1) =>
  approveSwap(q, { sourceAccount: source, destinationAccount: dest }, id)
const refusal = (fn: () => unknown) => {
  try { fn() } catch (e) { expect(e).toBeInstanceOf(SwapSigningRefusal); return (e as Error).message }
  throw new Error('expected a refusal')
}

describe('checkQuoteBeforeSigning', () => {
  it('passes the quote the user approved, and returns the policy', () => {
    const q = ethToUsdc()
    expect(checkQuoteBeforeSigning(q, approvedFor(q), ctx).allowed).toBe(true)
  })

  it('token identity is by address, never symbol', () => {
    const q = ethToUsdc()
    const fake = ethToUsdc({ toTokenAddress: '0x4444444444444444444444444444444444444444' })
    expect(refusal(() => checkQuoteBeforeSigning(fake, approvedFor(q), ctx))).toMatch(/buys a different token/)
    // Case differences in an EVM address are the same token.
    expect(() => checkQuoteBeforeSigning(ethToUsdc({ toTokenAddress: USDC.toLowerCase() }), approvedFor(q), ctx)).not.toThrow()
  })

  it('amount, slippage and chains must be the ones approved', () => {
    const q = ethToUsdc()
    expect(refusal(() => checkQuoteBeforeSigning({ ...q, sellAmountRaw: '2000000000000000000', txData: { ...q.txData, value: '2000000000000000000' } }, approvedFor(q), ctx))).toMatch(/different amount/)
    expect(refusal(() => checkQuoteBeforeSigning({ ...q, slippageBps: 300 }, approvedFor(q), ctx))).toMatch(/different slippage/)
    expect(refusal(() => checkQuoteBeforeSigning({ ...q, fromChain: 'base', toChain: 'base' }, approvedFor(q, EOA, EOA, 8453), ctx))).toMatch(/different networks/)
  })

  it('recipient: a quote paying someone else, or paying the signer when another account was chosen', () => {
    const toOther = ethToUsdc({ toAddress: OTHER })
    expect(() => checkQuoteBeforeSigning(toOther, approvedFor(toOther, EOA, OTHER), ctx)).not.toThrow()
    expect(refusal(() => checkQuoteBeforeSigning(toOther, approvedFor(toOther, EOA, EOA), ctx))).toMatch(/pays a different account/)
    const noRecipient = ethToUsdc()
    expect(refusal(() => checkQuoteBeforeSigning(noRecipient, approvedFor(noRecipient, EOA, OTHER), ctx))).toMatch(/pays the signing account/)
  })

  it('network: the chain id the host resolves must be the one approved', () => {
    const q = ethToUsdc()
    expect(refusal(() => checkQuoteBeforeSigning(q, approvedFor(q, EOA, EOA, 8453), ctx))).toMatch(/source network/)
  })

  it('fees: terms may not change after approval, and may never pay a stranger', () => {
    const q = ethToUsdc()
    const changed = { ...q, appFee: validAppFee('0x', 'ethereum', '1000000000000000000', { appliedBps: 50, amountRaw: '5000000000000000' }) }
    expect(refusal(() => checkQuoteBeforeSigning(changed, approvedFor(q), ctx))).toMatch(/fee/i)
    const stranger = { ...q, appFee: validAppFee('0x', 'ethereum', '1000000000000000000', { recipient: OTHER }) }
    expect(refusal(() => checkQuoteBeforeSigning(stranger, approvedFor(stranger), ctx))).toMatch(/fee|recipient|Magic Money/i)
  })

  it('minimum received: never lower than the one shown', () => {
    const q = ethToUsdc()
    expect(refusal(() => checkQuoteBeforeSigning({ ...q, minBuyAmountRaw: '994000' }, approvedFor(q), ctx))).toMatch(/lower than the one you approved/)
  })

  it('spender and plan: a different approval spender or calldata is refused', () => {
    const q = usdcToEth()
    expect(quoteApprovalSpender(q)).toBe(SPENDER.toLowerCase())
    expect(() => checkQuoteBeforeSigning(q, approvedFor(q), ctx)).not.toThrow()
    const otherSpender = { ...q, approvalTx: { to: USDC, data: approveData(OTHER, 5000000n), value: '0' } }
    expect(refusal(() => checkQuoteBeforeSigning(otherSpender, approvedFor(q), ctx))).toMatch(/transactions to sign changed/)
    const otherCalldata = { ...q, txData: { ...q.txData, data: calldataWithFeeRecipient('0xdead') } }
    expect(refusal(() => checkQuoteBeforeSigning(otherCalldata, approvedFor(q), ctx))).toMatch(/transactions to sign changed/)
    expect(swapPlanFingerprint(q)).not.toBe(swapPlanFingerprint(otherSpender))
  })

  it('structure: an approval that is not to the sell token, or an expired quote', () => {
    const q = usdcToEth({ approvalTx: { to: OTHER, data: approveData(SPENDER, 5000000n), value: '0' } })
    expect(refusal(() => checkQuoteBeforeSigning(q, approvedFor(q), ctx))).toMatch(/Approval target/)
    const fresh = ethToUsdc()
    expect(refusal(() => checkQuoteBeforeSigning(fresh, approvedFor(fresh), { ...ctx, now: NOW + 60_000 }))).toMatch(/expired/)
  })

  it('Solana: the signer must pay the fee and be the only signer', () => {
    setSettlementTrackingActive(true)
    const payer = Keypair.generate()
    const build = (signers: Keypair[]) => {
      const msg = new TransactionMessage({
        payerKey: signers[0].publicKey, recentBlockhash: PublicKey.default.toBase58(),
        instructions: signers.map(s => SystemProgram.transfer({ fromPubkey: s.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })),
      }).compileToV0Message()
      return Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64')
    }
    const sol = (tx: string): NormalizedSwapQuote => ({
      ...ethToUsdc(), provider: 'jupiter', fromChain: 'solana', toChain: 'solana',
      fromTokenAddress: 'So11111111111111111111111111111111111111112', toTokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      sellAmountRaw: '10000000', buyAmountRaw: '1500000', minBuyAmountRaw: '1492500',
      appFee: null, txData: { swapTransaction: tx },
    })
    const mine = sol(build([payer]))
    const src = payer.publicKey.toBase58()
    const approved = approveSwap(mine, { sourceAccount: src, destinationAccount: src }, null)
    expect(() => checkQuoteBeforeSigning(mine, approved, ctx)).not.toThrow()
    const other = Keypair.generate().publicKey.toBase58()
    expect(refusal(() => checkQuoteBeforeSigning(mine, approveSwap(mine, { sourceAccount: other, destinationAccount: other }, null), ctx)))
      .toMatch(/paid for by a different account/)
    const twoSigners = sol(build([payer, Keypair.generate()]))
    expect(refusal(() => checkQuoteBeforeSigning(twoSigners, approveSwap(twoSigners, { sourceAccount: src, destinationAccount: src }, null), ctx)))
      .toMatch(/2 signatures/)
    setSettlementTrackingActive(false)
  })
})
