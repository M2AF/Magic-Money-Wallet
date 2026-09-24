import { describe, expect, it } from 'vitest'
import { validateSwapQuoteForExecution, executeSwap, executeBoundSwap, EVM_CHAIN_ID } from './swap-executor'
import { bindSwapIntent, buildSwapIdentity, __clearSwapIntents } from './swap-intent'
import type { NormalizedSwapQuote } from './swap-proxy'
import type { WalletConfig } from './secure-store'
import { validAppFee, calldataWithFeeRecipient } from './swap-fixtures'
import { feeFreeRecord } from '../shared/swap-fee-policy'

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
    // The app-fee gate runs before the tier rules, so a fixture without valid fee
    // terms would be refused for the wrong reason. The fee cases have their own
    // describe block below and in swap-fee.test.ts.
    appFee: validAppFee(
      overrides.provider ?? '0x',
      overrides.fromChain ?? 'ethereum',
      overrides.sellAmountRaw ?? '1000000000000000000',
    ),
    txData: { to: ROUTER, data: calldataWithFeeRecipient('0x12345678'), value: '0' },
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

/**
 * The execution GATE, exercised through the real entry points.
 *
 * swap-policy.test.ts checks the decision in isolation; these assert that the
 * decision is actually ENFORCED where the keys are. Every case below fails
 * before any network access or key derivation, which is why they need no
 * mnemonic, no RPC and no mocks — and is also the point: a rejected swap must
 * cost nothing and touch nothing.
 */
describe('swap execution gate (privileged layer)', () => {
  const CURATED_ETH = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  const CURATED_USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
  const CURATED_USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
  const DISCOVERED = '0x4ed4e862860bed51a9570b96d89af5e1b0efefed'   // DEGEN — findable, not curated
  const cfg = {} as never

  const curatedPair = (over: Partial<NormalizedSwapQuote> = {}) => evmQuote({
    fromTokenAddress: CURATED_ETH, toTokenAddress: CURATED_USDC,
    approvalTx: null,
    txData: { to: ROUTER, data: calldataWithFeeRecipient('0x12345678'), value: '1000000000000000000' },
    minBuyAmountRaw: '1990000000000000000', minReceivedSource: 'provider',
    expiresAt: Date.now() + 30_000,
    ...over,
  })

  it('REFUSES a discovered token cross-chain on a provider whose lifecycle is unverified', async () => {
    await expect(executeSwap(curatedPair({
      toChain: 'base', toTokenAddress: DISCOVERED, isCrossChain: true,
      toAddress: RECIPIENT,
    }), 'unused', cfg, 0)).rejects.toThrow(/cross-chain/i)
  })

  it('still permits a CURATED cross-chain pair past the gate (existing behaviour)', async () => {
    // Reaches execution and fails later for want of a real key/RPC — the point
    // is that it is not the policy that stopped it.
    await expect(executeSwap(curatedPair({
      toChain: 'base', toTokenAddress: CURATED_USDC_BASE, isCrossChain: true,
      toAddress: RECIPIENT,
    }), 'unused', cfg, 0)).rejects.not.toThrow(/cross-chain swaps are limited/i)
  })

  it('REFUSES a discovered token whose quote carries no minimum received', async () => {
    await expect(executeSwap(curatedPair({
      toTokenAddress: DISCOVERED, minBuyAmountRaw: undefined,
    }), 'unused', cfg, 0)).rejects.toThrow(/minimum received/i)
  })

  it('REFUSES a discovered token whose minimum received is secretly far below the quote', async () => {
    await expect(executeSwap(curatedPair({
      toTokenAddress: DISCOVERED,
      buyAmountRaw: '1000000', minBuyAmountRaw: '500000', slippageBps: 50,
    }), 'unused', cfg, 0)).rejects.toThrow(/below its expected output/i)
  })

  it('REFUSES a discovered token priced on a DERIVED minimum (nothing enforces it)', async () => {
    await expect(executeSwap(curatedPair({
      toTokenAddress: DISCOVERED, minReceivedSource: 'derived',
    }), 'unused', cfg, 0)).rejects.toThrow(/estimate/i)
  })

  it('REFUSES a discovered token routed through an adapter with unverified floor semantics', async () => {
    // Uniswap CAN carry the app fee but its minimum-received field has not been
    // exercised against a live response, so a broad token may not ride it.
    await expect(executeSwap(curatedPair({
      toTokenAddress: DISCOVERED, provider: 'uniswap', minReceivedSource: 'provider',
      appFee: validAppFee('uniswap', 'ethereum', '1000000000000000000'),
    }), 'unused', cfg, 0)).rejects.toThrow(/has not been verified/i)
  })

  it('still refuses 1inch for a BROAD token - on its floor semantics, not its fee', async () => {
    // Under the two-tier fee policy 1inch serves routes again. What did NOT
    // change is why it was refused for broad tokens in the first place: v6
    // returns no minimum-received floor, so nothing enforces the number the user
    // is shown. Restoring fee eligibility must not quietly restore this too.
    await expect(executeSwap(curatedPair({
      toTokenAddress: DISCOVERED, provider: '1inch', minReceivedSource: 'provider',
      appFee: feeFreeRecord('1inch', 'ethereum', 'no applied-fee amount to reconcile'),
    }), 'unused', cfg, 0)).rejects.toThrow(/has not been verified/i)
  })

  it('lets a CURATED pair through on a fee-free route', async () => {
    await expect(executeSwap(curatedPair({
      provider: '1inch',
      appFee: feeFreeRecord('1inch', 'ethereum', 'no applied-fee amount to reconcile'),
    }), 'unused', cfg, 0)).rejects.not.toThrow(/fee/i)
  })

  it('does not impose the minimum-received gate on curated pairs', async () => {
    await expect(executeSwap(curatedPair({ minBuyAmountRaw: undefined }), 'unused', cfg, 0))
      .rejects.not.toThrow(/minimum received/i)
  })
})

describe('executeBoundSwap — the renderer cannot supply its own quote', () => {
  const cfg = {} as never
  const addrs = { evm: RECIPIENT, solana: 'So11111111111111111111111111111111111111112', accountIndex: 0 }

  const issueCurated = () => bindSwapIntent({
    fromChain: 'ethereum', toChain: 'ethereum',
    fromToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    toToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    fromSymbol: 'ETH', toSymbol: 'USDC', sellAmountRaw: '1000000000000000000',
    slippageBps: 50, taker: RECIPIENT, toAddress: RECIPIENT,
  }, evmQuote({
    fromTokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    toTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    approvalTx: null, toAddress: RECIPIENT,
    minBuyAmountRaw: '1990000000000000000', minReceivedSource: 'provider',
    txData: { to: ROUTER, data: '0x12345678', value: '1000000000000000000' },
    expiresAt: Date.now() + 30_000,
  }), buildSwapIdentity(addrs, 'ethereum', 'ethereum', false))

  it('refuses a quote that was never issued by the wallet', async () => {
    // The pre-Stage-2 attack: hand swap:execute a hand-built object.
    await expect(executeBoundSwap(evmQuote(), 'unused', cfg, addrs, false))
      .rejects.toThrow(/not requested through the wallet/i)
  })

  it('refuses an unknown intent id', async () => {
    await expect(executeBoundSwap({ ...evmQuote(), intentId: 'made-up' }, 'unused', cfg, addrs, false))
      .rejects.toThrow(/no longer available/i)
  })

  it('refuses an intent when the wallet was replaced at the same account index', async () => {
    __clearSwapIntents()
    const issued = issueCurated()
    const replaced = { ...addrs, evm: '0x9999999999999999999999999999999999999999' }
    await expect(executeBoundSwap(issued, 'unused', cfg, replaced, false))
      .rejects.toThrow(/different wallet or account/i)
  })

  it('refuses an intent after the environment flips to testnet', async () => {
    __clearSwapIntents()
    const issued = issueCurated()
    await expect(executeBoundSwap(issued, 'unused', cfg, addrs, true))
      .rejects.toThrow(/different wallet or account/i)
  })

  it('signs the STORED quote, not the submitted one', async () => {
    __clearSwapIntents()
    const issued = issueCurated()
    const tampered = {
      ...issued,
      toChain: 'base',
      toTokenAddress: '0x4ed4e862860bed51a9570b96d89af5e1b0efefed',
      isCrossChain: true,
    }
    // The tampered copy describes a swap the gate would REFUSE. It gets past the
    // gate precisely because the tampered copy is never consulted.
    await expect(executeBoundSwap(tampered, 'unused', cfg, addrs, false))
      .rejects.not.toThrow(/cross-chain swaps are limited/i)
  })
})

describe('EVM chain-id resolution (2026-09-21 executor gap)', () => {
  // Until this pass EVM_CHAIN_ID listed only 8 chains, though the coverage
  // matrix (swap-networks.ts) already marked Robinhood, Arc, Abstract,
  // HyperEVM, Zora, Soneium, Ronin, Gnosis, Blast and ApeChain 'verified' or
  // 'implemented-unverified' for routing. A quote on any of them would pass
  // decideSwapPolicy and then throw at the signing step ("Could not resolve
  // EVM network") — the BSC-regression class chain-parity.test.ts guards
  // against. This pins that every one of those chains now validates.
  const expanded = ['blast', 'gnosis', 'abstract', 'apechain', 'robinhood', 'arc', 'ronin', 'soneium', 'worldchain', 'zora', 'hyperevm']

  it.each(expanded)('validates an EVM quote on %s without throwing "Could not resolve"', (chain) => {
    expect(() => validateSwapQuoteForExecution(evmQuote({ fromChain: chain, toChain: chain }), NOW))
      .not.toThrow(/Could not resolve/i)
  })

  it('every expanded chain has a numeric id (chain-parity.test.ts checks it matches tx-sender)', () => {
    for (const chain of expanded) expect(EVM_CHAIN_ID[chain], chain).toBeGreaterThan(0)
  })

  it('resolves an IMPORTED chain by its registry id, given config', () => {
    const cfg = {
      customChains: [{
        id: 'custom-1', name: 'My Network', chainId: 90909,
        nativeSymbol: 'ETH', rpcUrl: 'https://rpc.example/custom', explorerUrl: '',
      }],
    } as unknown as WalletConfig
    // fromChain 'custom-1' has no entry in the static EVM_CHAIN_ID map at all —
    // the only way this can validate is via the wallet's own registry.
    expect(() => validateSwapQuoteForExecution(
      evmQuote({ fromChain: 'custom-1', toChain: 'custom-1' }), NOW, cfg,
    )).not.toThrow(/Unsupported swap source chain/i)
  })

  it('refuses an imported chain with NO config as unsupported (never guesses)', () => {
    expect(() => validateSwapQuoteForExecution(
      evmQuote({ fromChain: 'custom-1', toChain: 'custom-1' }), NOW,
    )).toThrow(/Unsupported swap source chain/i)
  })
})
