/**
 * swap-fee-checks.ts — does a quote actually carry the disclosed app fee?
 *
 * Moved from src/main/swap-fee.ts so Magic Money and ChainLens run the SAME
 * fee checks (that module re-exports these). The reasoning is unchanged:
 *
 * Under the two-tier policy, failing to verify a fee is NOT a reason to refuse a
 * swap; it moves the quote to tier 2. The only fee condition that blocks
 * signing is integrity: a fee pointed at an address that is not ours, or terms
 * from a policy version the user never saw.
 *
 * None of these checks proves the money ARRIVED. That is a settlement question
 * answered by a reconciled session (swap-settlement.ts), never by this module.
 */

import {
  APP_FEE_BPS, SWAP_FEE_POLICY_VERSION, SWAP_FEE_PROVIDERS,
  checkAppFeeIntegrity, qualifiesAsFeePaying, classifyFeeStatus, feeAmountForBps,
  type AppFeeRecord, type FeePolicyCheck, type SwapFeeStatus, type SwapFeeTier,
} from './swap-fee-policy'
import { parseSolanaTransaction } from './solana-transaction'
import type { NormalizedSwapQuote } from './swap-quote'

/**
 * The gross amount a provider's percentage was applied to.
 *
 * Providers differ on which side they charge and on whether the output they
 * quote is already net. Both facts live in the capability table, so this is the
 * single place that turns "a quote" into "the number the percentage is of" —
 * getting it wrong here would make a correct fee look wrong, or the reverse.
 */
export function feeBaseAmountRaw(quote: NormalizedSwapQuote): string | null {
  const record = quote.appFee
  if (!record) return null
  if (record.base === 'input') return quote.sellAmountRaw ?? null

  // Output-based: buyAmountRaw is normalized to the NET receipt everywhere in
  // this codebase, so the gross the provider charged against is net + fee.
  const net = quote.buyAmountRaw
  const fee = record.amountRaw
  if (!net || !/^[0-9]+$/.test(net)) return null
  if (!fee || !/^[0-9]+$/.test(fee)) return null
  try {
    return (BigInt(net) + BigInt(fee)).toString()
  } catch {
    return null
  }
}

function expectedTerms(quote: NormalizedSwapQuote) {
  return {
    policyVersion: SWAP_FEE_POLICY_VERSION,
    bps: APP_FEE_BPS,
    provider: quote.provider,
    chain: quote.fromChain,
    baseAmountRaw: feeBaseAmountRaw(quote),
  }
}

/**
 * Does this quote qualify for TIER 1 (a verified app fee)?
 *
 * A "no" routes the quote to tier 2; it is NOT a refusal to execute. This is the
 * function that used to be the signing gate, and the rename is the whole point
 * of the policy change — the old name made "we are not being paid" and "this is
 * unsafe" read as the same condition.
 */
export function checkQuoteAppFee(quote: NormalizedSwapQuote): FeePolicyCheck {
  return qualifiesAsFeePaying(quote.appFee, expectedTerms(quote))
}

/** What we can truthfully say about this route's app fee. */
export function quoteFeeStatus(quote: NormalizedSwapQuote): SwapFeeStatus {
  return classifyFeeStatus(quote.appFee)
}

/**
 * Is the beneficiary actually inside the payload the user is about to sign?
 *
 * EVM: the recipient's 20 address bytes must appear in the swap calldata. This
 * is not proof of a transfer — an address can be in calldata for other reasons —
 * but its ABSENCE is proof that whatever the response claimed, this particular
 * transaction does not name us.
 *
 * Solana: the fee account must be among the transaction's account keys. Jupiter
 * embeds exactly the pubkey it was given (measured), so a transaction that does
 * not carry ours cannot pay us regardless of what the quote said.
 *
 * Providers whose fee is a registered integrator rather than an address (LI.FI)
 * have nothing to look for in the payload; their evidence is the named recipient
 * in the fee split, and this check reports that honestly instead of inventing a
 * pass.
 */
export function checkFeeBoundInPayload(quote: NormalizedSwapQuote): FeePolicyCheck {
  const record = quote.appFee
  if (!record) return { ok: false, reason: 'This route reported no fee terms to verify.' }

  if (record.recipientKind === 'none' || record.requestedBps === 0) {
    // A deliberately fee-free route has no beneficiary to find, and looking for
    // one would report a failure that is actually the intended state.
    return { ok: true, reason: null }
  }

  if (record.recipientKind === 'registered-integrator') {
    // Nothing address-shaped to find; the provider settles to portal-configured
    // wallets. Verified upstream by the named recipient in the fee split.
    return { ok: true, reason: null }
  }

  if (record.recipientKind === 'provider-intent') {
    // Relay does not put the recipient in the signed bytes at all, so there is
    // nothing in the payload to find and looking would always fail. What CAN be
    // required is the handle the fee was requested against: without a requestId
    // there is no record to reconcile `paidAppFees[]` against later, and an
    // unreconcilable fee must not be presented as a verified one.
    if (!quote.requestId) {
      return {
        ok: false,
        reason: 'This route carries a fee but no request id, so whether the fee reached Magic Money could '
          + 'never be checked. Another route will be tried.',
      }
    }
    return { ok: true, reason: null }
  }

  if (record.recipientKind === 'referral-token-account') {
    const serialized = quote.txData?.swapTransaction
    if (!serialized) return { ok: false, reason: 'Solana route carried no transaction to verify the fee against.' }
    if (!record.recipient) return { ok: false, reason: 'Solana route named no fee account.' }
    try {
      const keys = parseSolanaTransaction(serialized).staticAccountKeys
      if (!keys.includes(record.recipient)) {
        return {
          ok: false,
          reason: 'The Solana transaction does not include the Magic Money fee account, so this route would not ' +
            'pay the disclosed fee. Another route will be tried.',
        }
      }
      return { ok: true, reason: null }
    } catch {
      return { ok: false, reason: 'The Solana transaction could not be decoded to verify the fee account.' }
    }
  }

  const calldata = quote.txData?.data
  if (!calldata || !record.recipient) {
    return { ok: false, reason: 'This route carried no calldata to verify the fee recipient against.' }
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(record.recipient)) {
    return { ok: false, reason: 'This route named an invalid fee recipient.' }
  }
  const found = calldata.toLowerCase().includes(record.recipient.slice(2).toLowerCase())
  return found
    ? { ok: true, reason: null }
    : {
      ok: false,
      reason: 'The swap transaction does not reference the Magic Money fee recipient, so this route would not pay ' +
        'the disclosed fee. Another route will be tried.',
    }
}

/**
 * Which tier this quote actually belongs to, with both halves of the evidence.
 *
 * A route only counts as fee-paying when the terms reconcile AND the beneficiary
 * is bound into the payload that will be signed. Failing either drops it to
 * `fee-free` for accounting and display purposes — never to unavailable.
 */
export function classifyQuoteFee(quote: NormalizedSwapQuote): {
  tier: SwapFeeTier
  status: SwapFeeStatus
  reason: string | null
} {
  const status = quoteFeeStatus(quote)
  const terms = checkQuoteAppFee(quote)
  if (!terms.ok) return { tier: 'fee-free', status, reason: terms.reason }
  const bound = checkFeeBoundInPayload(quote)
  if (!bound.ok) return { tier: 'fee-free', status: 'unknown', reason: bound.reason }
  return { tier: 'fee-paying', status: 'verified', reason: null }
}

/**
 * The only fee condition that still BLOCKS signing.
 *
 * Not being paid is acceptable. Being pointed at someone else's address, or
 * carrying terms from a policy the user never saw, is not — those mean the quote
 * in hand is not the quote that was described.
 */
export function checkQuoteFeeIntegrity(quote: NormalizedSwapQuote): FeePolicyCheck {
  const integrity = checkAppFeeIntegrity(quote.appFee, expectedTerms(quote))
  if (!integrity.ok) return integrity
  // A fee the user IS being charged must also be bound into the payload. If it
  // is not, the quote is describing a charge the transaction does not make —
  // which is a disclosure failure, not a revenue one.
  const record = quote.appFee
  if (record && record.requestedBps > 0 && classifyFeeStatus(record) === 'verified') {
    const bound = checkFeeBoundInPayload(quote)
    if (!bound.ok) return bound
  }
  return { ok: true, reason: null }
}

/**
 * Expected fee amount for a quote under the current policy — for display and for
 * reconciliation, never as a substitute for what the provider reported.
 */
export function expectedAppFeeAmountRaw(quote: NormalizedSwapQuote): string | null {
  const base = feeBaseAmountRaw(quote)
  return base ? feeAmountForBps(base, APP_FEE_BPS) : null
}

/** Stable, comparable summary of the fee terms, for intent binding and diffing. */
export function feeTermsFingerprint(record: AppFeeRecord | null | undefined): string {
  if (!record) return 'none'
  return [
    record.policyVersion, record.provider, record.requestedBps, record.appliedBps ?? '',
    record.base, record.chain, (record.tokenAddress ?? '').toLowerCase(), record.amountRaw ?? '',
    record.recipient ?? '', record.recipientKind, record.collection, record.verification,
  ].join('|')
}

/** Providers that can reach TIER 1. Every other provider still serves routes. */
export function feeCapableProviders(): string[] {
  return Object.keys(SWAP_FEE_PROVIDERS)
    .filter(p => SWAP_FEE_PROVIDERS[p].maxVerification === 'applied-verified')
}
