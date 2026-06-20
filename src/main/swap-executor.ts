/**
 * swap-executor.ts — MagicMoney Wallet
 *
 * Stage 2: execute a SwapKit route the user picked, signing with the wallet's
 * own keys. Bridges swap-fetcher (POST /v3/swap) and tx-sender (raw EVM signing).
 *
 * Scope: EVM-source swaps only. The wallet can sign arbitrary EVM calldata
 * (ETH, AVAX, and other EVM chains it supports), so those execute end-to-end.
 * Non-EVM source assets (BTC/DOGE/LTC/BCH PSBT, Cosmos, …) can be *quoted* but
 * not signed here yet — they return a clear, actionable error.
 */

import { fetchSwapTx, type SwapBuildParams } from './swap-fetcher'
import { sendRawEvmTransaction, waitForEvmReceipt } from './tx-sender'
import type { WalletConfig } from './secure-store'

// SwapKit chain prefix → numeric EVM chainId (fallback if tx.chainId is absent)
const SK_EVM_CHAIN_ID: Record<string, number> = {
  ETH: 1, AVAX: 43114, ARB: 42161, OP: 10, BASE: 8453,
  MATIC: 137, POLYGON: 137, BSC: 56, BLAST: 81457, GNOSIS: 100,
}

export interface SwapExecuteParams extends SwapBuildParams {
  sellAsset: string   // "ETH.ETH" — used for chainId fallback + error messaging
}

export interface SwapExecuteResult {
  txHash: string
  explorerUrl: string
  chainId: number
  approvalTxHash: string | null
}

export async function executeEvmSwap(
  params: SwapExecuteParams,
  mnemonic: string,
  config: WalletConfig,
  accountIndex = 0
): Promise<SwapExecuteResult> {
  const built = await fetchSwapTx(
    { routeId: params.routeId, sourceAddress: params.sourceAddress, destinationAddress: params.destinationAddress },
    config
  )
  if (built.error) throw new Error(built.error)

  const sellChain = params.sellAsset.split('.')[0]
  if (built.txType && built.txType !== 'EVM') {
    throw new Error(`Signing from ${sellChain} isn't supported in-wallet yet — only EVM-source swaps (e.g. ETH, AVAX) can be executed. The quote is still valid; complete it from an EVM asset.`)
  }

  const tx = built.tx
  if (!tx || typeof tx === 'string' || !tx.to) {
    throw new Error('SwapKit did not return a signable EVM transaction for this route.')
  }

  const chainId = tx.chainId ?? SK_EVM_CHAIN_ID[sellChain]
  if (!chainId) throw new Error(`Could not resolve the EVM network for ${sellChain}.`)

  // 1) ERC-20 approval first (if the route requires spending a token allowance)
  let approvalTxHash: string | null = null
  if (built.approvalTx?.to) {
    const apprChainId = built.approvalTx.chainId ?? chainId
    const appr = await sendRawEvmTransaction(mnemonic, {
      to: built.approvalTx.to,
      data: built.approvalTx.data,
      value: built.approvalTx.value,
      gas: built.approvalTx.gas,
      chainId: apprChainId,
    }, config, accountIndex)
    approvalTxHash = appr.txHash
    await waitForEvmReceipt(apprChainId, appr.txHash, config)
  }

  // 2) Main swap transaction
  const main = await sendRawEvmTransaction(mnemonic, {
    to: tx.to,
    data: tx.data,
    value: tx.value,
    gas: tx.gas,
    chainId,
  }, config, accountIndex)

  return { txHash: main.txHash, explorerUrl: main.explorerUrl, chainId, approvalTxHash }
}
