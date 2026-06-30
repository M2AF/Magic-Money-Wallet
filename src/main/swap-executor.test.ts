import { describe, expect, it } from 'vitest'
import { validateSwapQuoteForExecution } from './swap-executor'
import type { NormalizedSwapQuote } from './swap-proxy'

const NOW = 1_800_000_000_000
const SELL_TOKEN = '0x1111111111111111111111111111111111111111'
const BUY_TOKEN = '0x2222222222222222222222222222222222222222'
const ROUTER = '0x3333333333333333333333333333333333333333'
const SPENDER = '0x4444444444444444444444444444444444444444'
const RECIPIENT = '0x5555555555555555555555555555555555555555'
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

function approveData(spender = SPENDER, amount = 1_000_000_000_000_000_000n): string {
  return `0x095ea7b3${spender.toLowerCase().replace(/^0x/, '').padStart(64, '0')}${amount.toString(16).padStart(64, '0')}`
}

function evmQuote(overrides: Partial<NormalizedSwapQuote> = {}): NormalizedSwapQuote {
  return {
    provider: '0x',
    fromChain: 'ethereum',
    toChain: 'ethereum',
    fromTokenAddress: SELL_TOKEN,
    toTokenAddress: BUY_TOKEN,
    fromTokenSymbol: 'SELL',
    toTokenSymbol: 'BUY',
    sellAmountRaw: '1000000000000000000',
    buyAmountRaw: '2000000000000000000',
    estimatedGasRaw: '21000',
    slippageBps: 50,
    priceImpactPct: 0,
    rate: 2,
    expiresAt: NOW + 30_000,
    isCrossChain: false,
    txData: { to: ROUTER, data: '0x12345678', value: '0' },
    approvalTx: { to: SELL_TOKEN, data: approveData(), value: '0x0' },
    ...overrides,
  }
}

describe('swap-executor quote validation', () => {
  it('accepts a well-formed ERC-20 EVM quote with a standard approval', () => {
    expect(() => validateSwapQuoteForExecution(evmQuote(), NOW)).not.toThrow()
  })

  it('rejects stale quotes before signing', () => {
    expect(() => validateSwapQuoteForExecution(evmQuote({ expiresAt: NOW - 1 }), NOW))
      .toThrow(/expired/i)
  })

  it('rejects approval transactions that target a token other than the sell token', () => {
    expect(() => validateSwapQuoteForExecution(evmQuote({
      approvalTx: { to: BUY_TOKEN, data: approveData(), value: '0x0' },
    }), NOW)).toThrow(/sell token/i)
  })

  it('rejects approval amounts below the quoted sell amount', () => {
    expect(() => validateSwapQuoteForExecution(evmQuote({
      approvalTx: { to: SELL_TOKEN, data: approveData(SPENDER, 1n), value: '0x0' },
    }), NOW)).toThrow(/lower than/i)
  })

  it('rejects native value on ERC-20 source-token swaps', () => {
    expect(() => validateSwapQuoteForExecution(evmQuote({
      txData: { to: ROUTER, data: '0x12345678', value: '1' },
    }), NOW)).toThrow(/must not include native/i)
  })

  it('rejects native-source swaps that include an approval', () => {
    expect(() => validateSwapQuoteForExecution(evmQuote({
      fromTokenAddress: NATIVE,
      txData: { to: ROUTER, data: '0x12345678', value: '1000000000000000000' },
      approvalTx: { to: SELL_TOKEN, data: approveData(), value: '0x0' },
    }), NOW)).toThrow(/must not include an approval/i)
  })

  it('requires native-source transaction value to match the quoted sell amount', () => {
    expect(() => validateSwapQuoteForExecution(evmQuote({
      fromTokenAddress: NATIVE,
      txData: { to: ROUTER, data: '0x12345678', value: '999' },
      approvalTx: null,
    }), NOW)).toThrow(/does not match/i)
  })

  it('validates EVM cross-chain destination addresses when both sides are EVM', () => {
    expect(() => validateSwapQuoteForExecution(evmQuote({
      provider: 'lifi',
      toChain: 'base',
      isCrossChain: true,
      toAddress: RECIPIENT,
    }), NOW)).not.toThrow()

    expect(() => validateSwapQuoteForExecution(evmQuote({
      provider: 'lifi',
      toChain: 'base',
      isCrossChain: true,
      toAddress: 'not-an-address',
    }), NOW)).toThrow(/destination address/i)
  })

  it('rejects malformed Solana transactions before signing', () => {
    expect(() => validateSwapQuoteForExecution({
      ...evmQuote({
        provider: 'jupiter',
        fromChain: 'solana',
        toChain: 'solana',
        fromTokenAddress: 'So11111111111111111111111111111111111111112',
        toTokenAddress: '11111111111111111111111111111111',
        txData: { swapTransaction: 'not-base64' },
        approvalTx: null,
      }),
    }, NOW)).toThrow(/Solana swap transaction/i)
  })
})
