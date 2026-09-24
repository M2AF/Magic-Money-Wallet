/**
 * swap-core-browser.ts — the entry point of the shared swap bundle for hosts
 * that are not this app (ChainLens today).
 *
 * `npm run build:swap-core` bundles this file as a dependency-free IIFE that
 * sets `globalThis.MagicMoneySwapCore`, written to ChainLens with a manifest of
 * source hashes. A drift test in each repo fails when the committed bundle no
 * longer matches these sources. Nothing here touches keys, storage or network.
 */

export {
  swapAssetKey, normalizeSwapAddress, isNativeSwapAddress, isValidSwapAddress, looksLikeSwapAddress,
  isEvmSwapChain, isSolanaSwapChain, sanitizeDiscoveredToken, mergeDiscoveredTokens, rankDiscoveredTokens,
  NATIVE_EVM_SENTINEL, SOL_NATIVE_MINT,
} from './swap-token-identity'
export { CURATED_SWAP_TOKENS, curatedTokensForChain, isCuratedSwapToken } from './swap-curated-tokens'
export {
  SWAP_NETWORKS, swapCapability, swappableSourceChains, swappableDestinationChains, swapUnavailableReason,
} from './swap-networks'
export {
  withMinReceived, unsignableReason, outdatedWorkerReason, selectSafeRoute, selectFromCandidates,
} from './swap-candidates'
export {
  decideSwapPolicy, checkMinReceived, classifySwapTier, setSettlementTrackingActive, isSettlementTrackingActive,
} from './swap-policy-checks'
export { classifyQuoteFee, quoteFeeStatus, checkQuoteFeeIntegrity, feeTermsFingerprint } from './swap-fee-checks'
export { APP_FEE_BPS, SWAP_FEE_POLICY_VERSION, SWAP_FEE_BENEFICIARIES } from './swap-fee-policy'
export { validateSwapQuoteForExecution } from './swap-execution-checks'
export {
  SwapSigningRefusal, approveSwap, checkQuoteBeforeSigning, swapPlanFingerprint, quoteApprovalSpender,
} from './swap-signing-checks'
export { describeMinReceivedScope } from './swap-destination'
export { mapStatusForProvider, sameAsset, isTerminalSwapState, isSwapSuccess } from './swap-lifecycle'
export {
  openSwapSession, recordPreSwapTx, recordSwapBroadcast, recordSwapNotSent, recordUncertainBroadcast,
  recordSourceReceipt, applyStatusReport, applyShortfallToReport, applyPaidAppFees, pruneSettled,
  sessionsNeedingReconcile, sessionsLeftUnsent, summarizeFeeRevenue,
} from './swap-settlement'
export { sanitizeSwapSessions, isSwapSessionActive } from './swap-session'
export { parseSolanaTransaction } from './solana-transaction'
export { solanaShortfallMessage, solanaRequiredLamports } from './solana-upfront-cost'
