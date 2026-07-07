/**
 * swap-executor.ts — MagicMoney Wallet
 *
 * Layer 4 of the Phantom-style DEX swap: take a NormalizedSwapQuote (fetched via
 * the proxy) and sign+broadcast it locally. The wallet is a dumb signer — it
 * never holds liquidity; it only signs the calldata/transaction the aggregator
 * compiled.
 *
 *   EVM     — ERC-20 approval (if needed) → swap calldata, via tx-sender.
 *   Solana  — deserialize Jupiter VersionedTransaction, sign, send.
 *   Cardano — stub (CBOR witness signing not yet wired).
 *
 * Private keys are derived inside this process and never leave it.
 */

import { VersionedTransaction, Connection } from '@solana/web3.js'
import { sendRawEvmTransaction, waitForEvmReceipt } from './tx-sender'
import { getSolanaKeypair } from './wallet-core'
import type { NormalizedSwapQuote } from './swap-proxy'
import type { WalletConfig } from './secure-store'
import { heliusRpcUrl } from './api-proxy'

// Wallet chain id → numeric EVM chainId (matches tx-sender's supported set).
// These double as the source chains the executor can locally sign for a swap —
// for cross-chain routes (LI.FI/Rango) the source tx is still EVM calldata here.
// Exported for chain-parity tests (M-8).
export const EVM_CHAIN_ID: Record<string, number> = {
  ethereum: 1, arbitrum: 42161, optimism: 10, base: 8453,
  polygon: 137, avalanche: 43114, bsc: 56, monad: 143,
}

const SOLSCAN = (sig: string) => `https://solscan.io/tx/${sig}`
const NATIVE_EVM_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const ZERO_EVM_ADDRESS = '0x0000000000000000000000000000000000000000'
const MAX_QUOTE_TTL_MS = 10 * 60_000
const APPROVE_SELECTOR = '0x095ea7b3'
// Canonical Permit2 contract (same address on every EVM chain) — the only allowed
// target for a Uniswap permitTx.
const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'

export interface SwapExecuteResult {
  txHash: string
  explorerUrl: string
  approvalTxHash: string | null
}

export async function executeSwap(
  quote: NormalizedSwapQuote,
  mnemonic: string,
  config: WalletConfig,
  accountIndex = 0
): Promise<SwapExecuteResult> {
  validateSwapQuoteForExecution(quote)
  const chain = quote.fromChain

  if (isSupportedEvmChain(chain)) return executeEvmSwap(quote, mnemonic, config, accountIndex)
  if (chain === 'solana') return executeSolanaSwap(quote, mnemonic, config, accountIndex)
  if (chain === 'cardano') {
    throw new Error('Cardano DEX execution is not enabled yet — use Cross-Chain mode for ADA.')
  }
  throw new Error(`Unsupported swap source chain: ${chain}`)
}

export function validateSwapQuoteForExecution(quote: NormalizedSwapQuote, now = Date.now()): void {
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
  if (isCrossChain && quote.toAddress && isSupportedEvmChain(quote.fromChain) && isSupportedEvmChain(quote.toChain) && !isEvmAddress(quote.toAddress)) {
    throw new Error('Swap quote has an invalid destination address.')
  }

  if (isSupportedEvmChain(quote.fromChain)) {
    validateEvmQuote(quote)
    return
  }
  if (quote.fromChain === 'solana') {
    validateSolanaQuote(quote)
    return
  }
  if (quote.fromChain === 'cardano') {
    throw new Error('Cardano DEX execution is not enabled yet — use Cross-Chain mode for ADA.')
  }
  throw new Error(`Unsupported swap source chain: ${quote.fromChain}`)
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
    VersionedTransaction.deserialize(Buffer.from(quote.txData.swapTransaction, 'base64'))
  } catch {
    throw new Error('Solana swap transaction is not a valid versioned transaction.')
  }
}

function isPositiveIntegerString(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9]+$/.test(v) && BigInt(v) > 0n
}

function isUintLike(v: string): boolean {
  try {
    parseUintLike(v)
    return true
  } catch {
    return false
  }
}

function parseUintLike(v: string): bigint {
  if (/^0x[0-9a-fA-F]+$/.test(v)) return BigInt(v)
  if (/^[0-9]+$/.test(v)) return BigInt(v)
  throw new Error('Invalid unsigned integer.')
}

function isZeroValue(v: string): boolean {
  return parseUintLike(v || '0') === 0n
}

function isHexData(v: string): boolean {
  return /^0x([0-9a-fA-F]{2})*$/.test(v)
}

function isEvmAddress(v: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(v)
}

function isZeroEvmAddress(v: string): boolean {
  return v.toLowerCase() === ZERO_EVM_ADDRESS
}

function isSameEvmAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function isNativeEvmAddress(v: string): boolean {
  const lower = v.toLowerCase()
  return lower === NATIVE_EVM_SENTINEL || lower === ZERO_EVM_ADDRESS
}

function isSupportedEvmChain(chain: string): boolean {
  return Object.prototype.hasOwnProperty.call(EVM_CHAIN_ID, chain)
}

async function executeEvmSwap(
  quote: NormalizedSwapQuote,
  mnemonic: string,
  config: WalletConfig,
  accountIndex: number
): Promise<SwapExecuteResult> {
  const chainId = EVM_CHAIN_ID[quote.fromChain]
  if (!chainId) throw new Error(`Could not resolve EVM network for ${quote.fromChain}.`)
  if (!quote.txData.to || !quote.txData.data) {
    throw new Error('Quote did not include signable EVM calldata.')
  }

  // Step A — ERC-20 approval first (native assets skip this).
  let approvalTxHash: string | null = null
  if (quote.approvalTx?.to) {
    const appr = await sendRawEvmTransaction(mnemonic, {
      to: quote.approvalTx.to,
      data: quote.approvalTx.data,
      value: quote.approvalTx.value || '0x0',
      chainId,
    }, config, accountIndex)
    approvalTxHash = appr.txHash
    await waitForEvmReceipt(chainId, appr.txHash, config)
  }

  // Step A2 — Uniswap Permit2.approve (after the token→Permit2 allowance, before the
  // swap). Only present for Uniswap's generatePermitAsTransaction path.
  if (quote.permitTx?.to) {
    const permit = await sendRawEvmTransaction(mnemonic, {
      to: quote.permitTx.to,
      data: quote.permitTx.data,
      value: quote.permitTx.value || '0x0',
      chainId,
    }, config, accountIndex)
    await waitForEvmReceipt(chainId, permit.txHash, config)
  }

  // Step B — fire the compiled swap calldata.
  const main = await sendRawEvmTransaction(mnemonic, {
    to: quote.txData.to,
    data: quote.txData.data,
    value: quote.txData.value || '0x0',
    gas: quote.estimatedGasRaw && quote.estimatedGasRaw !== '0' ? quote.estimatedGasRaw : undefined,
    chainId,
  }, config, accountIndex)

  return { txHash: main.txHash, explorerUrl: main.explorerUrl, approvalTxHash }
}

async function executeSolanaSwap(
  quote: NormalizedSwapQuote,
  mnemonic: string,
  config: WalletConfig,
  accountIndex: number
): Promise<SwapExecuteResult> {
  if (!quote.txData.swapTransaction) {
    throw new Error('Quote did not include a Solana transaction to sign.')
  }
  const keypair = await getSolanaKeypair(mnemonic, accountIndex)
  const connection = new Connection(heliusRpcUrl(config), 'confirmed')

  const tx = VersionedTransaction.deserialize(Buffer.from(quote.txData.swapTransaction, 'base64'))
  tx.sign([keypair])
  const raw = tx.serialize()
  const blockhash = tx.message.recentBlockhash

  // Send + KEEP re-broadcasting while polling status. Solana RPCs routinely drop
  // a tx from the mempool before it lands, which is what surfaces as
  // "TransactionExpiredBlockheightExceeded". Re-sending every couple of seconds
  // until the tx's OWN blockhash is no longer valid is the reliable pattern
  // (skipPreflight so a stale-state simulation doesn't reject a valid aggregator tx).
  const send = () => connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 })
  const sig = await send()

  const confirmed = (s?: { err: unknown; confirmationStatus?: string } | null) =>
    !!s && !s.err && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')

  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const st = (await connection.getSignatureStatuses([sig])).value[0]
    if (st?.err) throw new Error('Swap transaction failed on-chain.')
    if (confirmed(st)) return { txHash: sig, explorerUrl: SOLSCAN(sig), approvalTxHash: null }

    const stillValid = await connection.isBlockhashValid(blockhash, { commitment: 'confirmed' })
      .then(r => r.value).catch(() => true)
    if (!stillValid) break
    await send().catch(() => { /* keep polling; a re-broadcast may transiently fail */ })
    await new Promise(r => setTimeout(r, 2_000))
  }

  // One last check — it may have landed right at the edge of expiry.
  const final = (await connection.getSignatureStatuses([sig])).value[0]
  if (confirmed(final)) return { txHash: sig, explorerUrl: SOLSCAN(sig), approvalTxHash: null }
  throw new Error('Solana transaction expired before it could land (network congestion) — please try again.')
}
