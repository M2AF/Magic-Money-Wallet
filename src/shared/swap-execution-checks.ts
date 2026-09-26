/**
 * swap-execution-checks.ts — is this quote a well-formed, signable plan?
 *
 * Moved from src/main/swap-executor.ts so Magic Money and ChainLens refuse the
 * same malformed quotes: wrong native value, an approval to anything but the
 * sell token, a non-standard approve(), a Permit2 transaction aimed anywhere but
 * Permit2, an undecodable Solana transaction, an expired or far-future expiry.
 *
 * The one host-specific fact, which chains this host can sign EVM transactions
 * for, is passed in (`isEvmChain`), so an imported network can count on a host
 * that supports it without this module knowing any registry.
 */

import { parseSolanaTransaction } from './solana-transaction'
import type { NormalizedSwapQuote } from './swap-quote'

export const NATIVE_EVM_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
export const ZERO_EVM_ADDRESS = '0x0000000000000000000000000000000000000000'
export const MAX_QUOTE_TTL_MS = 10 * 60_000
export const APPROVE_SELECTOR = '0x095ea7b3'
// Canonical Permit2 contract (same address on every EVM chain) — the only allowed
// target for a Uniswap permitTx.
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'

export function validateSwapQuoteForExecution(
  quote: NormalizedSwapQuote, now: number, isEvmChain: (chain: string) => boolean,
): void {
  if (!quote || typeof quote !== 'object') throw new Error('Invalid swap quote.')
  if (!quote.provider) throw new Error('Swap quote is missing a provider.')
  if (!quote.fromChain || !quote.toChain) throw new Error('Swap quote is missing chain information.')
  if (!isPositiveIntegerString(quote.sellAmountRaw)) throw new Error('Swap quote has an invalid sell amount.')
  if (!isPositiveIntegerString(quote.buyAmountRaw)) throw new Error('Swap quote has an invalid buy amount.')
  if (!Number.isFinite(quote.expiresAt)) throw new Error('Swap quote is missing an expiry.')
  if (quote.expiresAt <= now) throw new Error('Swap quote has expired — refresh the quote and try again.')
  if (quote.expiresAt - now > MAX_QUOTE_TTL_MS) throw new Error('Swap quote expiry is unexpectedly far in the future.')

  const isCrossChain = quote.fromChain !== quote.toChain
  if (quote.isCrossChain === true && !isCrossChain) throw new Error('Swap quote route metadata does not match its chains.')
  if (isCrossChain && quote.toAddress && isEvmChain(quote.fromChain) && isEvmChain(quote.toChain) && !isEvmAddress(quote.toAddress)) {
    throw new Error('Swap quote has an invalid destination address.')
  }

  if (isEvmChain(quote.fromChain)) {
    validateEvmQuote(quote)
    return
  }
  if (quote.fromChain === 'solana') {
    validateSolanaQuote(quote)
    return
  }
  if (quote.fromChain === 'cardano') {
    validateCardanoQuote(quote)
    return
  }
  throw new Error(`Unsupported swap source chain: ${quote.fromChain}`)
}

/**
 * Structural checks only. What the CBOR actually does — inputs, outputs, the
 * order datum, fees — is verified by the privileged layer against the wallet's
 * live coins immediately before signing (src/main/cardano-swap-validate.ts).
 */
function validateCardanoQuote(quote: NormalizedSwapQuote): void {
  if (quote.provider !== 'minswap') throw new Error('Cardano swaps are only signed for Minswap orders.')
  if (quote.toChain !== 'cardano') throw new Error('Cardano swaps must stay on Cardano.')
  const cbor = quote.txData?.cbor
  if (!cbor || !/^([0-9a-f]{2})+$/.test(cbor)) throw new Error('Quote did not include a Cardano transaction to sign.')
  if (quote.txData.to || quote.txData.data || quote.txData.value || quote.txData.swapTransaction
      || quote.approvalTx || quote.permitTx) {
    throw new Error('Cardano swap quote contains EVM or Solana transaction fields.')
  }
  if (!quote.cardanoOrder) throw new Error('Cardano swap quote does not describe its order.')
}

function validateEvmQuote(quote: NormalizedSwapQuote): void {
  const { txData } = quote
  if (!txData?.to || !txData.data) throw new Error('Quote did not include signable EVM calldata.')
  if (!isEvmAddress(txData.to)) throw new Error('Swap transaction target is not a valid EVM address.')
  if (isZeroEvmAddress(txData.to)) throw new Error('Swap transaction target cannot be the zero address.')
  if (!isHexData(txData.data)) throw new Error('Swap transaction calldata is invalid.')
  if (txData.swapTransaction || txData.cbor) throw new Error('EVM swap quote contains non-EVM transaction data.')
  if (txData.value != null && !isUintLike(txData.value)) throw new Error('Swap transaction value is invalid.')
  if (quote.estimatedGasRaw && quote.estimatedGasRaw !== '0' && !isUintLike(quote.estimatedGasRaw)) {
    throw new Error('Swap gas estimate is invalid.')
  }

  const nativeSell = isNativeEvmAddress(quote.fromTokenAddress)
  const txValue = parseUintLike(txData.value ?? '0')
  if (nativeSell) {
    const sell = BigInt(quote.sellAmountRaw)
    if (txValue !== sell) throw new Error('Native swap value does not match the quoted sell amount.')
    if (quote.approvalTx) throw new Error('Native swaps must not include an approval transaction.')
    if (quote.permitTx) throw new Error('Native swaps must not include a permit transaction.')
  } else {
    if (!isEvmAddress(quote.fromTokenAddress)) throw new Error('ERC-20 sell token address is invalid.')
    if (txValue !== 0n) throw new Error('ERC-20 swaps must not include native transaction value.')
    if (quote.approvalTx) validateApprovalTx(quote)
    if (quote.permitTx) validatePermitTx(quote)
  }
}

// Uniswap Permit2 approval tx (sent between the ERC-20→Permit2 approval and the swap).
// It may only ever target the canonical Permit2 contract and carry no native value.
function validatePermitTx(quote: NormalizedSwapQuote): void {
  const permit = quote.permitTx
  if (!permit) return
  if (!isSameEvmAddress(permit.to, PERMIT2_ADDRESS)) throw new Error('Permit transaction target must be the Permit2 contract.')
  if (!isZeroValue(permit.value)) throw new Error('Permit transactions must not send native value.')
  if (!isHexData(permit.data)) throw new Error('Permit calldata is invalid.')
}

function validateApprovalTx(quote: NormalizedSwapQuote): void {
  const approval = quote.approvalTx
  if (!approval) return
  if (!isSameEvmAddress(approval.to, quote.fromTokenAddress)) throw new Error('Approval target must be the sell token contract.')
  if (!isZeroValue(approval.value)) throw new Error('Approval transactions must not send native value.')
  if (!isHexData(approval.data)) throw new Error('Approval calldata is invalid.')
  const lower = approval.data.toLowerCase()
  if (!lower.startsWith(APPROVE_SELECTOR) || lower.length !== 138) {
    throw new Error('Approval calldata must be a standard ERC-20 approve(spender,amount).')
  }

  const spender = `0x${lower.slice(34, 74)}`
  const amountHex = `0x${lower.slice(74, 138)}`
  if (!isEvmAddress(spender) || isZeroEvmAddress(spender)) throw new Error('Approval spender is invalid.')
  if (isSameEvmAddress(spender, quote.fromTokenAddress)) throw new Error('Approval spender cannot be the token contract.')
  const approvalAmount = BigInt(amountHex)
  if (approvalAmount < BigInt(quote.sellAmountRaw)) {
    throw new Error('Approval amount is lower than the quoted sell amount.')
  }
}

function validateSolanaQuote(quote: NormalizedSwapQuote): void {
  if (!quote.txData?.swapTransaction) throw new Error('Quote did not include a Solana transaction to sign.')
  if (quote.txData.to || quote.txData.data || quote.txData.value || quote.approvalTx) {
    throw new Error('Solana swap quote contains EVM transaction fields.')
  }
  try {
    parseSolanaTransaction(quote.txData.swapTransaction)
  } catch {
    throw new Error('Solana swap transaction is not a valid versioned transaction.')
  }
}

export function isPositiveIntegerString(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9]+$/.test(v) && BigInt(v) > 0n
}

export function isUintLike(v: string): boolean {
  try {
    parseUintLike(v)
    return true
  } catch {
    return false
  }
}

export function parseUintLike(v: string): bigint {
  if (/^0x[0-9a-fA-F]+$/.test(v)) return BigInt(v)
  if (/^[0-9]+$/.test(v)) return BigInt(v)
  throw new Error('Invalid unsigned integer.')
}

export function isZeroValue(v: string): boolean {
  return parseUintLike(v || '0') === 0n
}

export function isHexData(v: string): boolean {
  return /^0x([0-9a-fA-F]{2})*$/.test(v)
}

export function isEvmAddress(v: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(v)
}

export function isZeroEvmAddress(v: string): boolean {
  return v.toLowerCase() === ZERO_EVM_ADDRESS
}

export function isSameEvmAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

export function isNativeEvmAddress(v: string): boolean {
  const lower = v.toLowerCase()
  return lower === NATIVE_EVM_SENTINEL || lower === ZERO_EVM_ADDRESS
}


/** Spender encoded in an approve(spender,amount) calldata blob. */
export function approvalSpender(data: string): string {
  return `0x${data.toLowerCase().slice(34, 74)}`
}

