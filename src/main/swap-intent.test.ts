import { describe, expect, it, beforeEach } from 'vitest'
import {
  bindSwapIntent, consumeSwapIntent, releaseSwapIntent, diffSubmittedQuote,
  markSwapIntentBroadcast, wasSwapIntentBroadcast, invalidateSwapIntents,
  buildSwapIdentity, sameSigningIdentity,
  SwapIntentError, __clearSwapIntents, type SwapSigningIdentity,
} from './swap-intent'
import type { NormalizedSwapQuote, SwapQuoteRequest } from './swap-proxy'
import { validAppFee, calldataWithFeeRecipient } from './swap-fixtures'

/**
 * These tests describe the trust boundary, not a data structure.
 *
 * Before this module, `swap:execute` signed whatever object the renderer sent.
 * Structural validation could not catch a substituted router or recipient —
 * `0xdead…beef` is a valid address. What follows asserts that the privileged
 * layer signs ITS OWN quote, that the quote cannot be mutated out from under it
 * through the in-process Capacitor seam, and that an intent belongs to one
 * wallet, account and environment.
 */

const ROUTER = '0x3333333333333333333333333333333333333333'
const ATTACKER = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
const EVM = '0x5555555555555555555555555555555555555555'
const SOL = 'So11111111111111111111111111111111111111112'

const addresses = { evm: EVM, solana: SOL, accountIndex: 0 }
const identity = (over: Partial<SwapSigningIdentity> = {}): SwapSigningIdentity => ({
  ...buildSwapIdentity(addresses, 'ethereum', 'ethereum', false), ...over,
})

function request(over: Partial<SwapQuoteRequest> = {}): SwapQuoteRequest {
  return {
    fromChain: 'ethereum', toChain: 'ethereum',
    fromToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    toToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    fromSymbol: 'ETH', toSymbol: 'USDC',
    sellAmountRaw: '1000000000000000000',
    slippageBps: 50, taker: EVM, toAddress: EVM,
    ...over,
  }
}

function quote(over: Partial<NormalizedSwapQuote> = {}): NormalizedSwapQuote {
  return {
    provider: '0x',
    fromChain: 'ethereum', toChain: 'ethereum',
    fromTokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    toTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    fromTokenSymbol: 'ETH', toTokenSymbol: 'USDC',
    sellAmountRaw: '1000000000000000000',
    buyAmountRaw: '1000000', minBuyAmountRaw: '995000', minReceivedSource: 'provider',
    estimatedGasRaw: '210000', slippageBps: 50,
    priceImpactPct: 0, rate: 1, expiresAt: Date.now() + 30_000,
    isCrossChain: false, toAddress: EVM,
    // Fee terms are now part of what an intent binds, so every fixture carries a
    // policy-valid record; the fee-specific cases build their own.
    appFee: validAppFee(over.provider ?? '0x', over.fromChain ?? 'ethereum', over.sellAmountRaw ?? '1000000000000000000'),
    txData: { to: ROUTER, data: calldataWithFeeRecipient(), value: '0' },
    ...over,
  }
}

beforeEach(() => __clearSwapIntents())

/**
 * REGRESSION — the stored quote was mutable through the Capacitor caller.
 *
 * `src/capacitor/wallet-local.ts` calls `handle()` in the same JS realm, with no
 * serialization. `bindSwapIntent` returned the exact object it stored, nested
 * `txData` included, so `issued.txData.to = attacker` rewrote the wallet's own
 * record and the submitted-vs-stored diff saw nothing because both sides were
 * one object. Reproduced before the fix as:
 *     held.quote === issued                  -> true
 *     held.quote.txData.to === attacker      -> true
 */
describe('isolation from the in-process (Capacitor) caller', () => {
  it('does not hand back the stored object itself', () => {
    const issued = bindSwapIntent(request(), quote(), identity())
    const held = consumeSwapIntent(issued.intentId, identity())
    expect(held.quote).not.toBe(issued)
  })

  it('ignores mutation of the RETURNED quote — top level', () => {
    const issued = bindSwapIntent(request(), quote(), identity())
    issued.sellAmountRaw = '999000000000000000000'
    issued.toAddress = ATTACKER
    issued.minBuyAmountRaw = '1'
    const held = consumeSwapIntent(issued.intentId, identity())
    expect(held.quote.sellAmountRaw).toBe('1000000000000000000')
    expect(held.quote.toAddress).toBe(EVM)
    expect(held.quote.minBuyAmountRaw).toBe('995000')
  })

  it('ignores mutation of the RETURNED quote — nested txData / approval / permit', () => {
    const issued = bindSwapIntent(request(), quote({
      approvalTx: { to: '0x1111111111111111111111111111111111111111', data: '0x095ea7b3', value: '0x0' },
      permitTx: { to: '0x000000000022D473030F116dDEE9F6B43aC78BA3', data: '0xabcd', value: '0x0' },
    }), identity())
    issued.txData.to = ATTACKER
    issued.txData.data = '0xbadbad'
    issued.approvalTx!.to = ATTACKER
    issued.permitTx!.to = ATTACKER
    const held = consumeSwapIntent(issued.intentId, identity())
    expect(held.quote.txData.to).toBe(ROUTER)
    expect(held.quote.txData.data).toBe(calldataWithFeeRecipient())
    expect(held.quote.approvalTx!.to).toBe('0x1111111111111111111111111111111111111111')
    expect(held.quote.permitTx!.to).toBe('0x000000000022D473030F116dDEE9F6B43aC78BA3')
  })

  it('ignores mutation of the ORIGINAL input quote and request', () => {
    const original = quote()
    const originalRequest = request()
    const issued = bindSwapIntent(originalRequest, original, identity())
    original.txData.to = ATTACKER
    original.sellAmountRaw = '1'
    originalRequest.taker = ATTACKER
    const held = consumeSwapIntent(issued.intentId, identity())
    expect(held.quote.txData.to).toBe(ROUTER)
    expect(held.quote.sellAmountRaw).toBe('1000000000000000000')
    expect(held.request.taker).toBe(EVM)
  })

  it('hands each consumer its own copy, so async mutation cannot reach the store', () => {
    const issued = bindSwapIntent(request(), quote(), identity())
    const held = consumeSwapIntent(issued.intentId, identity())
    held.quote.txData.to = ATTACKER            // e.g. during async execution
    releaseSwapIntent(issued.intentId!)
    const again = consumeSwapIntent(issued.intentId, identity())
    expect(again.quote.txData.to).toBe(ROUTER)
  })
})

describe('provider response is validated against the canonical request', () => {
  it('refuses a quote that sells a different token than was asked for', () => {
    expect(() => bindSwapIntent(request(), quote({ fromTokenAddress: ATTACKER }), identity()))
      .toThrow(/sell token/i)
  })

  it('refuses a quote for a different amount, chain or buy token', () => {
    expect(() => bindSwapIntent(request(), quote({ sellAmountRaw: '1' }), identity())).toThrow(/sell amount/i)
    expect(() => bindSwapIntent(request(), quote({ toChain: 'base' }), identity())).toThrow(/destination network/i)
    expect(() => bindSwapIntent(request(), quote({ toTokenAddress: ATTACKER }), identity())).toThrow(/buy token/i)
  })

  it('refuses a quote that would deliver to someone else', () => {
    expect(() => bindSwapIntent(request(), quote({ toAddress: ATTACKER }), identity()))
      .toThrow(/recipient/i)
  })

  it('refuses a request whose taker is not this wallet\'s address', () => {
    // A forged taker must not become a signable intent.
    expect(() => bindSwapIntent(request({ taker: ATTACKER }), quote(), identity()))
      .toThrow(/source account/i)
  })
})

describe('identity binding', () => {
  it('distinguishes two wallets that both sit at account index 0', () => {
    const walletA = buildSwapIdentity({ evm: EVM, solana: SOL, accountIndex: 0 }, 'ethereum', 'ethereum', false)
    const walletB = buildSwapIdentity({ evm: ATTACKER, solana: SOL, accountIndex: 0 }, 'ethereum', 'ethereum', false)
    expect(walletA.accountIndex).toBe(walletB.accountIndex)
    expect(sameSigningIdentity(walletA, walletB)).toBe(false)
  })

  it('refuses an intent after the wallet is replaced at the same index', () => {
    const issued = bindSwapIntent(request(), quote(), identity())
    const replaced = buildSwapIdentity({ evm: ATTACKER, solana: SOL, accountIndex: 0 }, 'ethereum', 'ethereum', false)
    expect(() => consumeSwapIntent(issued.intentId, replaced)).toThrow(/different wallet or account/i)
  })

  it('refuses an intent after switching account index', () => {
    const issued = bindSwapIntent(request(), quote(), identity())
    const other = buildSwapIdentity({ ...addresses, accountIndex: 1 }, 'ethereum', 'ethereum', false)
    expect(() => consumeSwapIntent(issued.intentId, other)).toThrow(/different wallet or account/i)
  })

  it('refuses an intent after the environment flips to testnet', () => {
    const issued = bindSwapIntent(request(), quote(), identity())
    const testnet = buildSwapIdentity(addresses, 'ethereum', 'ethereum', true)
    expect(() => consumeSwapIntent(issued.intentId, testnet)).toThrow(/different wallet or account/i)
  })

  it('derives the source address per chain rather than trusting the caller', () => {
    const solIdentity = buildSwapIdentity(addresses, 'solana', 'ethereum', false)
    expect(solIdentity.sourceAddress).toBe(SOL)
    expect(solIdentity.destinationAddress).toBe(EVM)
  })

  it('stores no secret material', () => {
    const id = identity()
    expect(JSON.stringify(id)).not.toMatch(/mnemonic|private|seed|0x[0-9a-f]{64}/i)
  })
})

describe('single use and broadcast tracking', () => {
  it('refuses an execute that carries no intent at all', () => {
    expect(() => consumeSwapIntent(undefined, identity())).toThrow(SwapIntentError)
    expect(() => consumeSwapIntent('', identity())).toThrow(SwapIntentError)
    expect(() => consumeSwapIntent({ not: 'a string' }, identity())).toThrow(SwapIntentError)
  })

  it('refuses an unknown id', () => {
    expect(() => consumeSwapIntent('11111111-2222-3333-4444-555555555555', identity()))
      .toThrow(/no longer available/i)
  })

  it('is SINGLE-USE — a replayed execute cannot spend twice', () => {
    const issued = bindSwapIntent(request(), quote(), identity())
    consumeSwapIntent(issued.intentId, identity())
    expect(() => consumeSwapIntent(issued.intentId, identity())).toThrow(/already been submitted/i)
  })

  it('can be released after a preflight failure, then spent once', () => {
    const issued = bindSwapIntent(request(), quote(), identity())
    consumeSwapIntent(issued.intentId, identity())
    releaseSwapIntent(issued.intentId!)
    expect(() => consumeSwapIntent(issued.intentId, identity())).not.toThrow()
  })

  it('REFUSES to release once anything was broadcast', () => {
    // An approval that went out is a real on-chain event; re-authorizing the
    // intent after it would be the duplicate spend this module prevents.
    const issued = bindSwapIntent(request(), quote(), identity())
    consumeSwapIntent(issued.intentId, identity())
    markSwapIntentBroadcast(issued.intentId!)
    releaseSwapIntent(issued.intentId!)
    expect(wasSwapIntentBroadcast(issued.intentId!)).toBe(true)
    expect(() => consumeSwapIntent(issued.intentId, identity())).toThrow(/already been submitted/i)
  })

  it('invalidateSwapIntents drops pending authorizations (lock / wallet change)', () => {
    const issued = bindSwapIntent(request(), quote(), identity())
    invalidateSwapIntents()
    expect(() => consumeSwapIntent(issued.intentId, identity())).toThrow(/no longer available/i)
  })
})

describe('diffSubmittedQuote — what a tampered submission looks like', () => {
  it('reports nothing when the renderer echoes the quote faithfully', () => {
    const issued = bindSwapIntent(request(), quote(), identity())
    expect(diffSubmittedQuote(issued, issued)).toEqual([])
  })

  it('catches a substituted router, recipient, minimum and sell amount', () => {
    const issued = bindSwapIntent(request(), quote(), identity())
    const fields = diffSubmittedQuote(issued, {
      ...issued,
      txData: { ...issued.txData, to: ATTACKER },
      toAddress: ATTACKER,
      minBuyAmountRaw: '1',
      sellAmountRaw: '999000000000000000000',
    }).map(m => m.field)
    expect(fields).toEqual(expect.arrayContaining(['txData', 'toAddress', 'minBuyAmountRaw', 'sellAmountRaw']))
  })

  it('catches a swapped approval and permit', () => {
    const issued = bindSwapIntent(request(), quote({
      approvalTx: { to: '0x1111111111111111111111111111111111111111', data: '0x095ea7b3', value: '0x0' },
      permitTx: { to: '0x000000000022D473030F116dDEE9F6B43aC78BA3', data: '0xabcd', value: '0x0' },
    }), identity())
    const fields = diffSubmittedQuote(issued, {
      ...issued,
      approvalTx: { to: ATTACKER, data: '0x095ea7b3', value: '0x0' },
      permitTx: { to: ATTACKER, data: '0xabcd', value: '0x0' },
    }).map(m => m.field)
    expect(fields).toEqual(expect.arrayContaining(['approvalTx', 'permitTx']))
  })

  it('ignores fields the renderer did not echo, and does not choke on junk', () => {
    const issued = bindSwapIntent(request(), quote(), identity())
    expect(diffSubmittedQuote(issued, { intentId: issued.intentId })).toEqual([])
    expect(diffSubmittedQuote(issued, null)).toEqual([])
    expect(diffSubmittedQuote(issued, 'nope')).toEqual([])
  })
})
