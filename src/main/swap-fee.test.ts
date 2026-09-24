/**
 * swap-fee.test.ts — the wallet's own verification of an app fee, including the
 * two checks that a provider response cannot supply: the fee account actually
 * existing on Solana, and the beneficiary actually being inside the payload that
 * will be signed.
 *
 * The Solana cases are the ones that matter most. Measured 2026-09-19, Jupiter
 * accepts ANY pubkey as a fee account and embeds it in the transaction without
 * checking that it exists or matches the fee mint — so "the provider built a
 * transaction" is not evidence of anything, and these checks are what stands
 * between that and a swap that pays nobody.
 */

import { describe, it, expect } from 'vitest'
import { MessageV0, PublicKey, TransactionMessage, VersionedTransaction, Keypair } from '@solana/web3.js'
import {
  feeBaseAmountRaw, checkQuoteAppFee, checkFeeBoundInPayload, classifyQuoteFee,
  checkQuoteFeeIntegrity, quoteFeeStatus,
  deriveJupiterFeeAccount, resolveJupiterFeeAccount, expectedAppFeeAmountRaw,
  feeTermsFingerprint,
} from './swap-fee'
import { APP_FEE_BPS, SWAP_FEE_BENEFICIARIES, feeFreeRecord } from '../shared/swap-fee-policy'
import { validAppFee, calldataWithFeeRecipient } from './swap-fixtures'
import type { NormalizedSwapQuote } from './swap-proxy'

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const BONK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

function evmQuote(over: Partial<NormalizedSwapQuote> = {}): NormalizedSwapQuote {
  const provider = over.provider ?? '0x'
  return {
    provider,
    fromChain: 'ethereum', toChain: 'ethereum',
    fromTokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    toTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    fromTokenSymbol: 'ETH', toTokenSymbol: 'USDC',
    sellAmountRaw: '1000000000000000000',
    buyAmountRaw: '1000000',
    estimatedGasRaw: '210000', slippageBps: 50,
    priceImpactPct: 0, rate: 1, expiresAt: Date.now() + 30_000,
    isCrossChain: false,
    appFee: validAppFee(provider, 'ethereum', over.sellAmountRaw ?? '1000000000000000000'),
    txData: { to: '0x3333333333333333333333333333333333333333', data: calldataWithFeeRecipient(), value: '0' },
    ...over,
  }
}

/** A real serialized v0 transaction whose account keys include `extra`. */
function solanaTxWith(extra: string): string {
  const payer = Keypair.generate()
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [{
      programId: new PublicKey(TOKEN_PROGRAM),
      keys: [{ pubkey: new PublicKey(extra), isSigner: false, isWritable: true }],
      data: Buffer.from([1]),
    }],
  }).compileToV0Message()
  return Buffer.from(new VersionedTransaction(message as MessageV0).serialize()).toString('base64')
}

describe('feeBaseAmountRaw — which number the percentage is of', () => {
  it('uses the sell amount for an input-based fee', () => {
    expect(feeBaseAmountRaw(evmQuote())).toBe('1000000000000000000')
  })

  it('reconstructs the GROSS output for an output-based fee', () => {
    // buyAmountRaw is normalized to the NET receipt everywhere, so gross = net + fee.
    const q = evmQuote({
      buyAmountRaw: '1000000',
      appFee: validAppFee('0x', 'ethereum', '0', { base: 'output', amountRaw: '10101' }),
    })
    expect(feeBaseAmountRaw(q)).toBe('1010101')
  })

  it('returns null rather than guessing when amounts are missing', () => {
    const q = evmQuote({ appFee: validAppFee('0x', 'ethereum', '0', { base: 'output', amountRaw: null }) })
    expect(feeBaseAmountRaw(q)).toBeNull()
    expect(feeBaseAmountRaw(evmQuote({ appFee: null }))).toBeNull()
  })
})

describe('output-based fee reconciles at exactly 100 bps', () => {
  it('accepts a real Jupiter-shaped output fee', () => {
    // Measured live: outAmount 109079167 net, platformFee 1101809, gross 110180976.
    const q = evmQuote({
      provider: 'jupiter', fromChain: 'solana', toChain: 'solana',
      buyAmountRaw: '109079167',
      appFee: validAppFee('jupiter', 'solana', '0', {
        base: 'output', amountRaw: '1101809', tokenAddress: USDC_MINT,
      }),
    })
    expect(feeBaseAmountRaw(q)).toBe('110180976')
    expect(checkQuoteAppFee(q).ok).toBe(true)
  })

  it('refuses the same shape at the old 90 bps', () => {
    const q = evmQuote({
      provider: 'jupiter', fromChain: 'solana', toChain: 'solana',
      buyAmountRaw: '109079167',
      appFee: validAppFee('jupiter', 'solana', '0', {
        base: 'output', amountRaw: '991628', requestedBps: 90, appliedBps: 90,
      }),
    })
    expect(checkQuoteAppFee(q).ok).toBe(false)
  })
})

describe('checkFeeBoundInPayload — is the beneficiary in the bytes being signed?', () => {
  it('accepts EVM calldata containing the recipient', () => {
    expect(checkFeeBoundInPayload(evmQuote()).ok).toBe(true)
  })

  it('REFUSES EVM calldata that never mentions the recipient', () => {
    const r = checkFeeBoundInPayload(evmQuote({
      txData: { to: '0x3333333333333333333333333333333333333333', data: '0xdeadbeef', value: '0' },
    }))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/does not reference/)
  })

  it('accepts a registered integrator without looking for an address', () => {
    // LI.FI settles to portal-configured wallets; there is nothing address-shaped
    // in the payload to find, and inventing a pass for the others would be worse.
    expect(checkFeeBoundInPayload(evmQuote({
      provider: 'lifi', appFee: validAppFee('lifi', 'ethereum', '1000000000000000000'),
    })).ok).toBe(true)
  })

  it('accepts a Solana transaction that carries our fee account', () => {
    const feeAccount = deriveJupiterFeeAccount(SWAP_FEE_BENEFICIARIES.solanaReferralAccount, USDC_MINT)!
    const q = evmQuote({
      provider: 'jupiter', fromChain: 'solana', toChain: 'solana',
      appFee: validAppFee('jupiter', 'solana', '1000000000', { recipient: feeAccount }),
      txData: { swapTransaction: solanaTxWith(feeAccount) },
    })
    expect(checkFeeBoundInPayload(q).ok).toBe(true)
  })

  it('REFUSES a Solana transaction built WITHOUT our fee account', () => {
    // The exact failure Jupiter permits: it embeds whatever pubkey it is given,
    // so a substituted fee account produces a perfectly valid transaction that
    // pays someone else.
    const ours = deriveJupiterFeeAccount(SWAP_FEE_BENEFICIARIES.solanaReferralAccount, USDC_MINT)!
    const theirs = Keypair.generate().publicKey.toBase58()
    const q = evmQuote({
      provider: 'jupiter', fromChain: 'solana', toChain: 'solana',
      appFee: validAppFee('jupiter', 'solana', '1000000000', { recipient: ours }),
      txData: { swapTransaction: solanaTxWith(theirs) },
    })
    const r = checkFeeBoundInPayload(q)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/does not include the Magic Money fee account/)
  })

  it('refuses rather than passing when a Solana payload cannot be decoded', () => {
    const q = evmQuote({
      provider: 'jupiter', fromChain: 'solana', toChain: 'solana',
      appFee: validAppFee('jupiter', 'solana', '1000000000', { recipient: 'x'.repeat(32) }),
      txData: { swapTransaction: 'not-base64-at-all!!' },
    })
    expect(checkFeeBoundInPayload(q).ok).toBe(false)
  })
})

describe('classifyQuoteFee - routing tier, never availability', () => {
  it('puts a fully verified EVM quote in tier 1', () => {
    expect(classifyQuoteFee(evmQuote())).toMatchObject({ tier: 'fee-paying', status: 'verified' })
  })

  it('puts an unconfirmed fee in tier 2 and reports the TERMS problem', () => {
    const r = classifyQuoteFee(evmQuote({
      appFee: validAppFee('0x', 'ethereum', '1000000000000000000', { verification: 'requested-unverified' }),
    }))
    expect(r.tier).toBe('fee-free')
    expect(r.status).toBe('unknown')
    expect(r.reason).toMatch(/did not confirm/)
  })

  it('puts a quote whose recipient is missing from the calldata in tier 2', () => {
    const r = classifyQuoteFee(evmQuote({
      txData: { to: '0x3333333333333333333333333333333333333333', data: '0xdeadbeef', value: '0' },
    }))
    expect(r.tier).toBe('fee-free')
    expect(r.reason).toMatch(/does not reference/)
  })

  it('puts a deliberately fee-free route in tier 2 with a CONFIRMED-NONE status', () => {
    const r = classifyQuoteFee(evmQuote({
      provider: '1inch',
      appFee: feeFreeRecord('1inch', 'ethereum', 'no applied-fee amount to reconcile'),
    }))
    expect(r.tier).toBe('fee-free')
    expect(r.status).toBe('confirmed-none')
  })
})

describe('checkQuoteFeeIntegrity - what still blocks signing', () => {
  it('passes a verified fee', () => {
    expect(checkQuoteFeeIntegrity(evmQuote()).ok).toBe(true)
  })

  it('passes a fee-free route - losing revenue is not a safety failure', () => {
    expect(checkQuoteFeeIntegrity(evmQuote({
      provider: 'rango',
      appFee: feeFreeRecord('rango', 'ethereum', 'tier-2 fallback'),
    })).ok).toBe(true)
  })

  it('passes a quote with no fee record at all', () => {
    expect(checkQuoteFeeIntegrity(evmQuote({ appFee: null })).ok).toBe(true)
  })

  it('REFUSES a fee that would go to a stranger', () => {
    const r = checkQuoteFeeIntegrity(evmQuote({
      appFee: validAppFee('0x', 'ethereum', '1000000000000000000', {
        recipient: '0xdead00000000000000000000000000000000beef',
      }),
    }))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/not the configured Magic Money recipient/)
  })

  it('REFUSES a CHARGED fee that the transaction does not actually pay', () => {
    // The user is told they are paying 1%; the calldata names nobody. That is a
    // disclosure failure, so it blocks even though it costs us nothing.
    const r = checkQuoteFeeIntegrity(evmQuote({
      txData: { to: '0x3333333333333333333333333333333333333333', data: '0xdeadbeef', value: '0' },
    }))
    expect(r.ok).toBe(false)
  })

  it('reports the fee status for display', () => {
    expect(quoteFeeStatus(evmQuote())).toBe('verified')
    expect(quoteFeeStatus(evmQuote({ appFee: feeFreeRecord('1inch', 'ethereum', 'x') }))).toBe('confirmed-none')
    expect(quoteFeeStatus(evmQuote({ appFee: null }))).toBe('unknown')
  })
})

describe('Jupiter fee account resolution', () => {
  const cfg = { swapProxyUrl: '', heliusKey: 'test' } as never

  const rpc = (value: unknown) => async () =>
    new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value } }), { status: 200 })

  it('derives the real referral ATA for USDC', () => {
    // Confirmed on mainnet 2026-09-19: this account exists and holds USDC.
    expect(deriveJupiterFeeAccount(SWAP_FEE_BENEFICIARIES.solanaReferralAccount, USDC_MINT))
      .toBe('DN8Mb7gyodGADTFQDDqrLLueeJs5tFPchkSALMETrea2')
  })

  it('accepts an initialized token account holding the right mint', async () => {
    const r = await resolveJupiterFeeAccount(USDC_MINT, cfg, rpc({
      owner: TOKEN_PROGRAM,
      data: { parsed: { type: 'account', info: { mint: USDC_MINT } } },
    }))
    expect(r.feeAccount).toBe('DN8Mb7gyodGADTFQDDqrLLueeJs5tFPchkSALMETrea2')
    expect(r.reason).toBeNull()
  })

  it('REFUSES a mint whose fee account has never been created', async () => {
    // The real BONK case: the PDA derives fine, the account does not exist, and
    // Jupiter would have built the swap anyway.
    const r = await resolveJupiterFeeAccount(BONK_MINT, cfg, rpc(null))
    expect(r.feeAccount).toBeNull()
    expect(r.reason).toMatch(/no fee account for this token/)
  })

  it('REFUSES an account owned by something that is not a token program', async () => {
    const r = await resolveJupiterFeeAccount(USDC_MINT, cfg, rpc({
      owner: '11111111111111111111111111111111', data: { parsed: null },
    }))
    expect(r.feeAccount).toBeNull()
    expect(r.reason).toMatch(/not a token account/)
  })

  it('REFUSES an account holding a DIFFERENT mint', async () => {
    const r = await resolveJupiterFeeAccount(USDC_MINT, cfg, rpc({
      owner: TOKEN_PROGRAM,
      data: { parsed: { type: 'account', info: { mint: BONK_MINT } } },
    }))
    expect(r.feeAccount).toBeNull()
    expect(r.reason).toMatch(/different mint/)
  })

  it('does NOT claim the account is missing when the RPC simply failed', async () => {
    const r = await resolveJupiterFeeAccount(USDC_MINT, cfg, async () => { throw new Error('offline') })
    expect(r.feeAccount).toBeNull()
    // Fails closed, but says why honestly — an unreachable RPC is not evidence.
    expect(r.reason).toMatch(/Could not confirm/)
    expect(r.reason).not.toMatch(/has no fee account/)
  })

  it('returns null for an unparseable mint instead of throwing into the quote path', () => {
    expect(deriveJupiterFeeAccount(SWAP_FEE_BENEFICIARIES.solanaReferralAccount, 'not-a-mint')).toBeNull()
  })
})

describe('helpers used for display and binding', () => {
  it('computes the expected fee for a quote', () => {
    expect(expectedAppFeeAmountRaw(evmQuote())).toBe('10000000000000000')   // 1% of 1 ETH
  })

  it('fingerprints fee terms so a rewritten recipient or amount is caught', () => {
    const a = validAppFee('0x', 'ethereum', '1000000000000000000')
    const b = { ...a, recipient: '0xdead00000000000000000000000000000000beef' }
    const c = { ...a, amountRaw: '1' }
    expect(feeTermsFingerprint(a)).toBe(feeTermsFingerprint({ ...a }))
    expect(feeTermsFingerprint(a)).not.toBe(feeTermsFingerprint(b))
    expect(feeTermsFingerprint(a)).not.toBe(feeTermsFingerprint(c))
    expect(feeTermsFingerprint(null)).toBe('none')
  })

  it('uses the policy rate, so a policy change moves every expectation at once', () => {
    expect(APP_FEE_BPS).toBe(100)
    expect(expectedAppFeeAmountRaw(evmQuote({ sellAmountRaw: '500' }))).toBe('5')
  })
})
