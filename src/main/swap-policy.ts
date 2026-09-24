/**
 * swap-policy.ts — what the wallet is willing to SIGN, decided in the privileged
 * layer.
 *
 * The policy itself lives in src/shared/swap-policy-checks.ts so ChainLens
 * applies exactly the same rules; this module is the privileged layer's entry
 * point and re-exports it unchanged. The design notes are kept with the code.
 */

export {
  classifySwapTier, setSettlementTrackingActive, isSettlementTrackingActive,
  checkBroadCrossChain, checkEnforceableMinimum, checkChainCapability, decideSwapPolicy,
  isValidSlippageBps, checkMinReceived, deriveMinBuyAmountRaw,
  type SwapTier, type SwapPolicyDecision, type BroadMinCheck, type MinReceivedCheck,
} from '../shared/swap-policy-checks'
