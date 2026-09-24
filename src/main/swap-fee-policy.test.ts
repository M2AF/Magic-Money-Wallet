/**
 * swap-fee-policy.test.ts — the fee policy, and the guarantee that the Worker's
 * copy of it has not drifted.
 *
 * The parity block is the important one. The rate and the beneficiaries are
 * duplicated between TypeScript (client) and plain JS (Worker, which has no TS
 * build), following the same arrangement as tokens.js / swap-token-identity.ts.
 * Duplication is only safe while something fails when the copies disagree.
 */

import { describe, it, expect } from 'vitest'
import {
  APP_FEE_BPS, MAX_APP_FEE_BPS, SWAP_FEE_POLICY_VERSION, SWAP_FEE_BENEFICIARIES,
  SWAP_FEE_PROVIDERS, providerCanVerifyAppFee, feeAmountForBps, feeAmountMatches,
  effectiveBps, qualifiesAsFeePaying, checkAppFeeIntegrity, classifyFeeStatus,
  isEarnedAppFee, feeFreeRecord, describeAppFee,
  feeRecipientForChain, recipientMatchesPolicy,
  type AppFeeRecord,
} from '../shared/swap-fee-policy'

// The Worker module is plain JS with no type declarations; this test is the one
// place both copies are loaded together, so the import is deliberately untyped.
// @ts-expect-error -- untyped Worker mirror, imported only to prove parity
import * as worker from '../../cloudflare-worker/swap-fee.js'

const baseRecord = (over: Partial<AppFeeRecord> = {}): AppFeeRecord => ({
  policyVersion: SWAP_FEE_POLICY_VERSION,
  provider: 'lifi',
  requestedBps: APP_FEE_BPS,
  appliedBps: APP_FEE_BPS,
  base: 'input',
  chain: 'base',
  tokenAddress: '0x0000000000000000000000000000000000000000',
  tokenSymbol: 'ETH',
  tokenDecimals: 18,
  amountRaw: '1000000000000000',            // 1% of 0.1 ETH
  recipient: SWAP_FEE_BENEFICIARIES.lifiIntegrator,
  recipientKind: 'registered-integrator',
  collection: 'in-swap',
  providerSharePct: null,
  verification: 'applied-verified',
  evidence: ['measured'],
  ...over,
})

const expectedTerms = (over: Record<string, unknown> = {}) => ({
  policyVersion: SWAP_FEE_POLICY_VERSION,
  bps: APP_FEE_BPS,
  provider: 'lifi',
  chain: 'base',
  baseAmountRaw: '100000000000000000',      // 0.1 ETH
  ...over,
})

describe('fee policy constants', () => {
  it('charges 100 bps, replacing the former 90', () => {
    expect(APP_FEE_BPS).toBe(100)
  })

  it('caps any configured rate below something absurd', () => {
    expect(MAX_APP_FEE_BPS).toBeGreaterThanOrEqual(APP_FEE_BPS)
    expect(MAX_APP_FEE_BPS).toBeLessThanOrEqual(300)
  })
})

describe('Worker mirror parity', () => {
  it('agrees on the rate, the cap and the policy version', () => {
    expect(worker.APP_FEE_BPS).toBe(APP_FEE_BPS)
    expect(worker.MAX_APP_FEE_BPS).toBe(MAX_APP_FEE_BPS)
    expect(worker.SWAP_FEE_POLICY_VERSION).toBe(SWAP_FEE_POLICY_VERSION)
  })

  it('agrees on every beneficiary', () => {
    expect(worker.SWAP_FEE_BENEFICIARIES).toEqual(SWAP_FEE_BENEFICIARIES)
  })

  it('agrees on every provider capability that governs eligibility', () => {
    expect(Object.keys(worker.SWAP_FEE_PROVIDERS).sort())
      .toEqual(Object.keys(SWAP_FEE_PROVIDERS).sort())
    for (const [name, cap] of Object.entries(SWAP_FEE_PROVIDERS)) {
      const mirror = worker.SWAP_FEE_PROVIDERS[name]
      expect(mirror.bases, name).toEqual(cap.bases)
      expect(mirror.collection, name).toBe(cap.collection)
      expect(mirror.recipientKind, name).toBe(cap.recipientKind)
      expect(mirror.maxVerification, name).toBe(cap.maxVerification)
      expect(mirror.quotedOutputIsNetOfAppFee, name).toBe(cap.quotedOutputIsNetOfAppFee)
      expect(mirror.providerSharePct, name).toBe(cap.providerSharePct)
    }
  })

  it('agrees on which providers can reach tier 1', () => {
    for (const name of Object.keys(SWAP_FEE_PROVIDERS)) {
      expect(worker.providerCanVerifyAppFee(name), name).toBe(providerCanVerifyAppFee(name))
    }
  })

  it('computes identical fee amounts on both sides', () => {
    for (const amount of ['100000000000000000', '1', '999999999999999999999', '12345678']) {
      expect(worker.feeAmountForBps(amount, APP_FEE_BPS)).toBe(feeAmountForBps(amount, APP_FEE_BPS))
    }
  })
})

describe('Worker env validation', () => {
  it('defaults to the policy rate when FEE_BPS is unset', () => {
    expect(worker.policyFeeBps({})).toBe(APP_FEE_BPS)
  })

  it('accepts a configured rate inside the cap', () => {
    expect(worker.policyFeeBps({ FEE_BPS: '100' })).toBe(100)
  })

  it('REFUSES a rate above the cap rather than clamping and serving', () => {
    expect(() => worker.policyFeeBps({ FEE_BPS: '900' })).toThrow(/FEE_BPS/)
  })

  it('REFUSES a nonsense rate instead of silently falling back', () => {
    expect(() => worker.policyFeeBps({ FEE_BPS: 'abc' })).toThrow(/FEE_BPS/)
    expect(() => worker.policyFeeBps({ FEE_BPS: '-5' })).toThrow(/FEE_BPS/)
    expect(() => worker.policyFeeBps({ FEE_BPS: '1.5' })).toThrow(/FEE_BPS/)
  })

  it('refuses a recipient that does not match the policy', () => {
    expect(() => worker.policyFeeRecipient({ FEE_EVM: '0xdead00000000000000000000000000000000beef' }, 'base'))
      .toThrow(/does not match the fee policy/)
  })

  it('accepts the policy recipient in any case for EVM, exactly for base58 chains', () => {
    expect(worker.policyFeeRecipient({ FEE_EVM: SWAP_FEE_BENEFICIARIES.evm.toLowerCase() }, 'base'))
      .toBe(SWAP_FEE_BENEFICIARIES.evm)
    expect(() => worker.policyFeeRecipient(
      { FEE_SOLANA: SWAP_FEE_BENEFICIARIES.solanaWallet.toLowerCase() }, 'solana',
    )).toThrow()
  })

  it('refuses a LI.FI integrator that is not ours', () => {
    expect(() => worker.policyLifiIntegrator({ LIFI_INTEGRATOR: 'SomeoneElse' })).toThrow(/integrator/)
    expect(worker.policyLifiIntegrator({})).toBe(SWAP_FEE_BENEFICIARIES.lifiIntegrator)
  })
})

describe('fee arithmetic', () => {
  it('computes 100 bps exactly, in integer units', () => {
    // 0.1 ETH at 1% = 0.001 ETH -- the figure LI.FI actually returned on 19 Sep 2026.
    expect(feeAmountForBps('100000000000000000', 100)).toBe('1000000000000000')
    // 6-decimal token: 50 USDC at 1% = 0.5 USDC
    expect(feeAmountForBps('50000000', 100)).toBe('500000')
  })

  it('floors rather than rounding, so a fee is never overstated', () => {
    expect(feeAmountForBps('199', 100)).toBe('1')
    expect(feeAmountForBps('99', 100)).toBe('0')
  })

  it('accepts a couple of raw units of provider rounding, and nothing proportional', () => {
    expect(feeAmountMatches('1000000000000000', '100000000000000000', 100)).toBe(true)
    expect(feeAmountMatches('1000000000000002', '100000000000000000', 100)).toBe(true)
    // 90 bps presented against a 100 bps policy is a real difference, not rounding.
    expect(feeAmountMatches('900000000000000', '100000000000000000', 100)).toBe(false)
  })

  it('rejects non-integer inputs rather than coercing them', () => {
    expect(feeAmountForBps('1.5', 100)).toBeNull()
    expect(feeAmountForBps('-1', 100)).toBeNull()
    expect(feeAmountMatches(null, '1000', 100)).toBe(false)
  })

  it('reports the effective rate a reported amount really represents', () => {
    expect(effectiveBps('1000000000000000', '100000000000000000')).toBe(100)
    expect(effectiveBps('900000000000000', '100000000000000000')).toBe(90)
    expect(effectiveBps('1', '0')).toBeNull()
  })
})

describe('tier capability', () => {
  it('lets the measured providers reach tier 1', () => {
    expect(providerCanVerifyAppFee('lifi')).toBe(true)
    expect(providerCanVerifyAppFee('jupiter')).toBe(true)
    expect(providerCanVerifyAppFee('0x')).toBe(true)
    expect(providerCanVerifyAppFee('uniswap')).toBe(true)
  })

  it('keeps the unverifiable providers OUT OF TIER 1 but still eligible to serve', () => {
    // The policy change: these carry routes again. What they cannot do is carry
    // a fee we would have to describe without being able to account for it.
    for (const p of ['1inch', 'rango', 'swapkit'] as const) {
      expect(providerCanVerifyAppFee(p), p).toBe(false)
      expect(SWAP_FEE_PROVIDERS[p], p).toBeDefined()
    }
  })
})

describe('classifyFeeStatus - three states, never two', () => {
  it('calls a reconciled fee verified', () => {
    expect(classifyFeeStatus(baseRecord())).toBe('verified')
    expect(isEarnedAppFee(baseRecord())).toBe(true)
  })

  it('calls a deliberately fee-free route confirmed-none', () => {
    const rec = feeFreeRecord('1inch', 'ethereum', 'no applied-fee amount to reconcile')
    expect(classifyFeeStatus(rec)).toBe('confirmed-none')
    expect(isEarnedAppFee(rec)).toBe(false)
  })

  it('calls a requested-but-unconfirmed fee UNKNOWN, not zero', () => {
    const rec = baseRecord({ verification: 'requested-unverified' })
    expect(classifyFeeStatus(rec)).toBe('unknown')
    expect(isEarnedAppFee(rec)).toBe(false)
    expect(describeAppFee(rec)).toMatch(/not confirmed/i)
    expect(describeAppFee(rec)).not.toMatch(/no magic money fee/i)
  })

  it('does not accept a "fee-free" record that contradicts itself', () => {
    // Asked for nothing but reports an amount: that is not a confirmed zero.
    const rec = { ...feeFreeRecord('rango', 'base', 'x'), amountRaw: '500' }
    expect(classifyFeeStatus(rec)).toBe('unknown')
  })

  it('treats a missing record as unknown, never as none', () => {
    expect(classifyFeeStatus(null)).toBe('unknown')
    expect(describeAppFee(null)).toMatch(/not confirmed/i)
  })

  it('does not count a zero-amount "verified" fee as earned', () => {
    expect(classifyFeeStatus(baseRecord({ amountRaw: '0' }))).toBe('unknown')
  })
})

describe('qualifiesAsFeePaying - tier 1 admission, NOT a safety gate', () => {
  it('accepts a fully verified record', () => {
    expect(qualifiesAsFeePaying(baseRecord(), expectedTerms())).toEqual({ ok: true, reason: null })
  })

  it('sends a missing record to tier 2 rather than refusing it', () => {
    expect(qualifiesAsFeePaying(null, expectedTerms()).ok).toBe(false)
  })

  it('sends a deliberately fee-free record to tier 2', () => {
    const r = qualifiesAsFeePaying(feeFreeRecord('lifi', 'base', 'fallback'), expectedTerms())
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/fee-free/)
  })

  it('sends a merely requested fee to tier 2', () => {
    expect(qualifiesAsFeePaying(baseRecord({ verification: 'requested-unverified' }), expectedTerms()).ok).toBe(false)
  })

  it('sends the old 90 bps rate to tier 2', () => {
    expect(qualifiesAsFeePaying(baseRecord({ requestedBps: 90, appliedBps: 90 }), expectedTerms()).ok).toBe(false)
  })

  it('sends a fee that does not reconcile to tier 2', () => {
    expect(qualifiesAsFeePaying(baseRecord({ amountRaw: '900000000000000' }), expectedTerms()).ok).toBe(false)
  })

  it('sends a dust-sized zero fee to tier 2', () => {
    expect(qualifiesAsFeePaying(baseRecord({ amountRaw: '0' }), expectedTerms({ baseAmountRaw: '50' })).ok).toBe(false)
  })
})

describe('checkAppFeeIntegrity - the ONLY fee condition that blocks signing', () => {
  it('passes a verified fee', () => {
    expect(checkAppFeeIntegrity(baseRecord(), expectedTerms())).toEqual({ ok: true, reason: null })
  })

  it('passes a missing record - nothing is claimed, so nothing can be misdirected', () => {
    expect(checkAppFeeIntegrity(null, expectedTerms()).ok).toBe(true)
  })

  it('passes a fee-free record', () => {
    expect(checkAppFeeIntegrity(feeFreeRecord('rango', 'base', 'fallback'), expectedTerms({ provider: 'rango' })).ok).toBe(true)
  })

  it('passes an UNCONFIRMED fee - not being paid is not a safety problem', () => {
    expect(checkAppFeeIntegrity(baseRecord({ verification: 'requested-unverified' }), expectedTerms()).ok).toBe(true)
  })

  it('REFUSES a fee pointed at someone else', () => {
    const r = checkAppFeeIntegrity(
      baseRecord({ provider: '0x', recipientKind: 'onchain-address', recipient: '0xdead00000000000000000000000000000000beef' }),
      expectedTerms({ provider: '0x' }),
    )
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/not the configured Magic Money recipient/)
  })

  it('REFUSES terms from a policy version the user never saw', () => {
    const r = checkAppFeeIntegrity(baseRecord({ policyVersion: '2020-01-01.old' }), expectedTerms())
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/different fee policy/)
  })

  it('REFUSES a rate that is neither the policy rate nor zero', () => {
    expect(checkAppFeeIntegrity(baseRecord({ requestedBps: 90 }), expectedTerms()).ok).toBe(false)
    expect(checkAppFeeIntegrity(baseRecord({ requestedBps: 5000 }), expectedTerms()).ok).toBe(false)
  })

  it('REFUSES a record belonging to a different route', () => {
    expect(checkAppFeeIntegrity(baseRecord({ provider: 'jupiter' }), expectedTerms()).ok).toBe(false)
  })
})

describe('recipient identity', () => {
  it('compares EVM addresses case-insensitively', () => {
    const rec = baseRecord({
      provider: '0x', recipientKind: 'onchain-address', chain: 'base',
      recipient: SWAP_FEE_BENEFICIARIES.evm.toUpperCase().replace('0X', '0x'),
    })
    expect(recipientMatchesPolicy(rec)).toBe(true)
  })

  it('compares base58 recipients EXACTLY -- case is identity there', () => {
    const rec = baseRecord({
      provider: 'rango', recipientKind: 'onchain-address', chain: 'solana',
      recipient: SWAP_FEE_BENEFICIARIES.solanaWallet.toLowerCase(),
    })
    expect(recipientMatchesPolicy(rec)).toBe(false)
  })

  it('maps each chain to its own beneficiary', () => {
    expect(feeRecipientForChain('base')).toBe(SWAP_FEE_BENEFICIARIES.evm)
    expect(feeRecipientForChain('arbitrum')).toBe(SWAP_FEE_BENEFICIARIES.evm)
    expect(feeRecipientForChain('solana')).toBe(SWAP_FEE_BENEFICIARIES.solanaWallet)
    expect(feeRecipientForChain('bitcoin')).toBe(SWAP_FEE_BENEFICIARIES.bitcoin)
  })
})

describe('Worker tier selection', () => {
  const quote = (over: Record<string, unknown> = {}) => ({
    provider: 'lifi',
    buyAmountRaw: '1000',
    appFee: baseRecord(),
    ...over,
  })

  it('puts a verified route in tier 1', () => {
    expect(worker.feeTierOf(quote(), APP_FEE_BPS).tier).toBe('fee-paying')
  })

  it('puts an unverifiable provider in tier 2 rather than dropping it', () => {
    const r = worker.feeTierOf(
      quote({ provider: '1inch', appFee: worker.feeFreeRecord('1inch', 'base', 'no applied-fee amount') }),
      APP_FEE_BPS,
    )
    expect(r.tier).toBe('fee-free')
    expect(r.reason).toMatch(/fee-free/)
  })

  it('puts a route with no fee record in tier 2', () => {
    expect(worker.feeTierOf(quote({ appFee: null }), APP_FEE_BPS).tier).toBe('fee-free')
  })

  it('puts a dust-sized zero fee in tier 2', () => {
    expect(worker.feeTierOf(quote({ appFee: baseRecord({ amountRaw: '0' }) }), APP_FEE_BPS).tier).toBe('fee-free')
  })

  it('puts a route quoted at the old rate in tier 2', () => {
    expect(worker.feeTierOf(
      quote({ appFee: baseRecord({ requestedBps: 90, appliedBps: 90 }) }), APP_FEE_BPS,
    ).tier).toBe('fee-free')
  })

  it('ranks by real net output, with no hypothetical fee penalty', () => {
    const a = { buyAmountRaw: '1000' }, b = { buyAmountRaw: '1200' }
    expect([a, b].sort(worker.byNetOutputDesc)[0]).toBe(b)
    // A fee-free quote is NOT penalised for the fee it did not charge; the old
    // ranking discounted it by the gap and then served it undiscounted anyway.
    const feeFree = { buyAmountRaw: '1100', appFee: worker.feeFreeRecord('1inch', 'base', 'x') }
    const feePaying = { buyAmountRaw: '1000', appFee: baseRecord() }
    expect([feePaying, feeFree].sort(worker.byNetOutputDesc)[0]).toBe(feeFree)
  })

  it('agrees with the TypeScript classifier on every status', () => {
    for (const rec of [baseRecord(), baseRecord({ verification: 'requested-unverified' }),
      worker.feeFreeRecord('rango', 'base', 'x'), null]) {
      expect(worker.classifyFeeStatus(rec)).toBe(classifyFeeStatus(rec as AppFeeRecord | null))
    }
  })
})

describe('calldata binding helper', () => {
  const recipient = SWAP_FEE_BENEFICIARIES.evm

  it('finds the recipient bytes in calldata', () => {
    const calldata = `0x1234${recipient.slice(2).toLowerCase()}0000`
    expect(worker.recipientBoundInCalldata(calldata, recipient)).toBe(true)
  })

  it('is case-insensitive about the calldata itself', () => {
    const calldata = `0x1234${recipient.slice(2).toUpperCase()}0000`
    expect(worker.recipientBoundInCalldata(calldata, recipient)).toBe(true)
  })

  it('reports absence rather than guessing', () => {
    expect(worker.recipientBoundInCalldata('0xdeadbeef', recipient)).toBe(false)
    expect(worker.recipientBoundInCalldata('', recipient)).toBe(false)
    expect(worker.recipientBoundInCalldata('0xdeadbeef', 'not-an-address')).toBe(false)
  })
})
