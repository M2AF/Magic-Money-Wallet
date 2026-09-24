/**
 * swap-signing-checks.ts — the last check before a wallet is asked to sign.
 *
 * Magic Money binds a quote to an intent in its privileged layer and signs its
 * own stored copy (src/main/swap-intent.ts). A connected-wallet host such as
 * ChainLens has no privileged layer: the page composes the transaction and the
 * user's wallet signs it. This module gives that host the same guarantees,
 * run immediately before EVERY signature, against what the user approved:
 *
 *   structure  the plan is well formed and unexpired (swap-execution-checks)
 *   request    same chains, same token identities (by address, never symbol),
 *              same sell amount and slippage the user entered
 *   accounts   the connected signer is the source; the output goes to the
 *              chosen destination, which may be a different wallet/ecosystem
 *   network    the EVM chain id the wallet will sign on is the source chain's
 *   fees       integrity (never pointed at a stranger) and unchanged terms
 *   minimum    the policy gate, and for broad tokens the exact minimum bound;
 *              the minimum never drops below the one shown
 *   plan       the exact transactions (targets, calldata, value, spender,
 *              Solana bytes) are the ones approved
 *   Solana     the signer pays the fee and is the only required signer
 *
 * Every refusal throws `SwapSigningRefusal` with a reason a user can act on.
 */

import { validateSwapQuoteForExecution, approvalSpender } from './swap-execution-checks'
import { decideSwapPolicy, checkMinReceived, type SwapPolicyDecision } from './swap-policy-checks'
import { checkQuoteFeeIntegrity, feeTermsFingerprint } from './swap-fee-checks'
import { swapAssetKey, isSolanaSwapChain } from './swap-token-identity'
import { parseSolanaTransaction } from './solana-transaction'
import type { NormalizedSwapQuote } from './swap-quote'

export class SwapSigningRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SwapSigningRefusal'
  }
}

/** What the user approved on screen, frozen when they pressed "Swap". */
export interface ApprovedSwap {
  sourceAccount: string
  destinationAccount: string
  fromChain: string
  toChain: string
  fromTokenAddress: string
  toTokenAddress: string
  sellAmountRaw: string
  slippageBps: number
  /** EVM source only: the numeric chain id the host resolved for `fromChain`. */
  evmChainId: number | null
  /** The minimum received that was displayed. */
  minBuyAmountRaw: string
  /** `feeTermsFingerprint` of the displayed quote's fee terms. */
  feeFingerprint: string
  /** `swapPlanFingerprint` of the displayed quote. */
  planFingerprint: string
}

export interface SigningCheckContext {
  now: number
  /** Chains the host can sign EVM transactions for. */
  isEvmChain: (chain: string) => boolean
  /** The host's numeric id for an EVM chain, or null. */
  evmChainIdOf: (chain: string) => number | null
}

const ecosystem = (chain: string): 'solana' | 'evm' => (isSolanaSwapChain(chain) ? 'solana' : 'evm')

function sameAccount(chain: string, a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return ecosystem(chain) === 'evm' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/**
 * Everything that will be signed, in one comparable string: swap target,
 * calldata and value, the approval (its spender is inside its calldata), the
 * Permit2 transaction, and the Solana transaction bytes.
 */
export function swapPlanFingerprint(quote: NormalizedSwapQuote): string {
  const tx = quote.txData ?? {}
  const step = (t: { to: string; data: string; value: string } | null | undefined) =>
    t ? `${t.to.toLowerCase()}:${t.data.toLowerCase()}:${t.value ?? '0'}` : '-'
  return [
    quote.fromChain, quote.toChain,
    tx.to ? tx.to.toLowerCase() : '-', (tx.data ?? '-').toLowerCase(), tx.value ?? '0',
    tx.swapTransaction ?? '-',
    step(quote.approvalTx), step(quote.permitTx),
  ].join('|')
}

/** Freeze what the user is approving, for the checks before each signature. */
export function approveSwap(
  quote: NormalizedSwapQuote,
  accounts: { sourceAccount: string; destinationAccount: string },
  evmChainId: number | null,
): ApprovedSwap {
  return Object.freeze({
    sourceAccount: accounts.sourceAccount,
    destinationAccount: accounts.destinationAccount,
    fromChain: quote.fromChain,
    toChain: quote.toChain,
    fromTokenAddress: quote.fromTokenAddress,
    toTokenAddress: quote.toTokenAddress,
    sellAmountRaw: quote.sellAmountRaw,
    slippageBps: quote.slippageBps,
    evmChainId,
    minBuyAmountRaw: quote.minBuyAmountRaw ?? '',
    feeFingerprint: feeTermsFingerprint(quote.appFee),
    planFingerprint: swapPlanFingerprint(quote),
  })
}

/**
 * Throw unless `quote` may be signed now, for exactly what was approved.
 * Returns the policy decision so the host knows whether simulation must pass.
 */
export function checkQuoteBeforeSigning(
  quote: NormalizedSwapQuote, approved: ApprovedSwap, ctx: SigningCheckContext,
): SwapPolicyDecision {
  const refuse = (why: string): never => { throw new SwapSigningRefusal(why) }

  // Structure and expiry first: nothing below should read a malformed plan.
  try {
    validateSwapQuoteForExecution(quote, ctx.now, ctx.isEvmChain)
  } catch (err) {
    refuse(err instanceof Error ? err.message : String(err))
  }

  // ---- The request the user made ------------------------------------------
  if (quote.fromChain !== approved.fromChain || quote.toChain !== approved.toChain) {
    refuse('This quote is for different networks than the swap you approved.')
  }
  if (swapAssetKey(quote.fromChain, quote.fromTokenAddress) !== swapAssetKey(approved.fromChain, approved.fromTokenAddress)) {
    refuse('This quote sells a different token than the one you chose.')
  }
  if (swapAssetKey(quote.toChain, quote.toTokenAddress) !== swapAssetKey(approved.toChain, approved.toTokenAddress)) {
    refuse('This quote buys a different token than the one you chose.')
  }
  if (quote.sellAmountRaw !== approved.sellAmountRaw) refuse('This quote sells a different amount than you entered.')
  if (quote.slippageBps !== approved.slippageBps) refuse('This quote uses a different slippage than you approved.')

  // ---- Accounts --------------------------------------------------------------
  if (quote.toAddress) {
    if (!sameAccount(quote.toChain, quote.toAddress, approved.destinationAccount)) {
      refuse('This quote pays a different account than the one you chose.')
    }
  } else if (ecosystem(quote.fromChain) !== ecosystem(quote.toChain)
    || !sameAccount(quote.fromChain, approved.sourceAccount, approved.destinationAccount)) {
    refuse('This quote pays the signing account, not the account you chose to receive it.')
  }

  // ---- Network ---------------------------------------------------------------
  if (ecosystem(quote.fromChain) === 'evm') {
    const id = ctx.evmChainIdOf(quote.fromChain)
    if (id == null || id !== approved.evmChainId) refuse('The source network for this quote could not be confirmed.')
  } else {
    // Solana: the signer must be the fee payer and the only required signature.
    let view
    try {
      view = parseSolanaTransaction(quote.txData.swapTransaction ?? '')
    } catch {
      return refuse('The Solana transaction could not be read.')
    }
    if (view.staticAccountKeys[0] !== approved.sourceAccount) {
      refuse('This Solana transaction is paid for by a different account than the one signing it.')
    }
    if (view.header.numRequiredSignatures !== 1) {
      refuse(`This Solana transaction needs ${view.header.numRequiredSignatures} signatures; only single-signer swaps are supported.`)
    }
  }

  // ---- Fees ------------------------------------------------------------------
  const integrity = checkQuoteFeeIntegrity(quote)
  if (!integrity.ok) refuse(integrity.reason ?? 'The fee terms on this quote could not be verified.')
  if (feeTermsFingerprint(quote.appFee) !== approved.feeFingerprint) refuse('The fee terms changed after you approved this swap.')

  // ---- Policy and minimum received --------------------------------------------
  const policy = decideSwapPolicy(quote)
  if (!policy.allowed) refuse(policy.reason ?? 'This swap is not enabled.')
  if (policy.requireMinReceived) {
    const min = checkMinReceived(quote)
    if (!min.ok) refuse(min.reason ?? 'The minimum received could not be confirmed.')
  }
  const min = quote.minBuyAmountRaw ?? ''
  if (!/^[0-9]+$/.test(min) || !/^[0-9]+$/.test(approved.minBuyAmountRaw)
    || BigInt(min) < BigInt(approved.minBuyAmountRaw)) {
    refuse('The minimum you would receive is lower than the one you approved.')
  }

  // ---- The exact transactions ------------------------------------------------
  if (swapPlanFingerprint(quote) !== approved.planFingerprint) {
    refuse('The transactions to sign changed after you approved this swap.')
  }
  return policy
}

/** The approve(spender, amount) spender of a quote's approval step, if any. */
export function quoteApprovalSpender(quote: NormalizedSwapQuote): string | null {
  return quote.approvalTx?.data ? approvalSpender(quote.approvalTx.data) : null
}
