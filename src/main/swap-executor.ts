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
const EVM_CHAIN_ID: Record<string, number> = {
  ethereum: 1, arbitrum: 42161, optimism: 10, base: 8453,
  polygon: 137, avalanche: 43114, bsc: 56, monad: 143,
}

const SOLSCAN = (sig: string) => `https://solscan.io/tx/${sig}`

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
  const chain = quote.fromChain

  if (chain in EVM_CHAIN_ID) return executeEvmSwap(quote, mnemonic, config, accountIndex)
  if (chain === 'solana') return executeSolanaSwap(quote, mnemonic, config, accountIndex)
  if (chain === 'cardano') {
    throw new Error('Cardano DEX execution is not enabled yet — use Cross-Chain mode for ADA.')
  }
  throw new Error(`Unsupported swap source chain: ${chain}`)
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

  const buf = Buffer.from(quote.txData.swapTransaction, 'base64')
  const tx = VersionedTransaction.deserialize(buf)
  tx.sign([keypair])

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 3,
  })
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')

  return { txHash: sig, explorerUrl: SOLSCAN(sig), approvalTxHash: null }
}
