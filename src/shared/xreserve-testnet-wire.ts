/**
 * xreserve-testnet-wire.ts — the JSON shapes the Testnet Mode xReserve
 * Sepolia → Preprod test sends to the UI (platform-neutral: no node, no
 * electron). Amounts are base-unit decimal strings; nothing here is signable.
 */

export type XReserveTestnetEnvelope<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string; submitted: string[] }

/** Read-only Circle outbound status applies to both network profiles. */
export type CircleWithdrawalState = 'created' | 'verified' | 'confirmed' | 'finalized' | 'expired' | 'failed'
export interface WithdrawalReference {
  withdrawalId: string
  burnTxHash: string
  /** keccak256 of the prepared encoded TransferSpec (not the BurnIntent). */
  transferSpecHash: string
}
export interface CircleWithdrawalStatus extends WithdrawalReference {
  state: CircleWithdrawalState
  transactionHash: string | null
  /** Provider status alone never proves recipient delivery. */
  deliveryVerified: false
}

export interface TestnetRecordSummary {
  sourceTxHash: string
  explorerUrl: string
  sender: string
  recipient: string
  amountRaw: string
  maxFeeRaw: string
  cardanoTipAtSubmission: number
}

export type TestnetCardanoSource = 'koios' | 'blockfrost'

export interface TestnetDepositState {
  testnet: boolean
  preprodKeySet: boolean
  /** Where Cardano Preprod is read from: keyless Koios, or Blockfrost with the user's Preprod project id. */
  cardanoSource: TestnetCardanoSource
  /** Whether that source can be used now (Koios always; Blockfrost only with a project id). */
  cardanoSourceReady: boolean
  network: {
    source: string; destination: string; xReserve: string; usdc: string; usdcxUnit: string; cardanoDomain: number
  }
  sender: string | null
  recipient: string | null
  deposits: TestnetRecordSummary[]
  /** Deposits signed and recorded before broadcast whose outcome is not yet resolved (see recovery). */
  pendingSends: TestnetPendingSend[]
}

/** A deposit recorded just before broadcast, not yet resolved. `corrupt` entries are kept and block new deposits. */
export interface TestnetPendingSend {
  key: string
  corrupt: boolean
  nonce: number | null
  txHash: string | null
  explorerUrl: string | null
  amountRaw: string | null
  maxFeeRaw: string | null
  createdAt: number | null
}

export interface TestnetRecoveryResult {
  entries: Array<{
    nonce: number | null
    txHash: string | null
    /** found → tracked; not-sent → provably never landed (cleared); mismatch / unresolved / corrupt → kept. */
    verdict: 'found' | 'not-sent' | 'mismatch' | 'unresolved' | 'corrupt'
    tracking: 'started' | 'already-tracking' | 'save-failed' | null
    reason: string
  }>
}

export interface TestnetDepositPreview {
  intentId: string
  expiresAt: number
  sourceChain: string
  destinationChain: string
  sender: string
  recipient: string
  recipientKind: 'base' | 'enterprise'
  xReserve: string
  usdc: string
  amountRaw: string
  maxFeeRaw: string
  amount: string
  maxFee: string
  usdcBalanceRaw: string | null
  ethBalanceRaw: string | null
  allowanceRaw: string | null
  /** null when the allowance could not be read (execute re-reads it). */
  needsApproval: boolean | null
  /** Earlier deposits pending recovery; while any exist, the deposit action refuses. */
  pendingRecovery?: number
}

export interface TestnetDepositResult {
  sourceTxHash: string
  explorerUrl: string
  approvalTxHash: string | null
  /** Whether the tracking record was saved. `save-failed` means: keep the hash yourself. */
  tracking: 'started' | 'already-tracking' | 'save-failed'
  trackingReason: string | null
  record: TestnetRecordSummary | null
}

export interface TestnetStatusSummary {
  /** The coordinator's typed state (xreserve-inbound-status.ts InboundState). */
  state: string
  retryable: boolean
  reason: string | null
  sourceCode: string | null
  sourceConfirmations: string | null
  linkCode: string | null
  trackingError: string | null
  providerFailure: { provider: string; kind: string } | null
  conflict: string | null
  mint: { txHash: string; blockHeight: number; confirmations: number } | null
  creditedRaw: string | null
  locatorState: string | null
  auditState: string | null
}

export type TestnetCheckResult =
  | { kind: 'checked'; persisted: 'saved' | 'unchanged'; status: TestnetStatusSummary }
  | { kind: 'save-failed'; reason: string; status: TestnetStatusSummary }
  | { kind: 'tracking-error'; code: string; reason: string }

/** Result of the approval action, and of the read-only approval check. */
export interface TestnetApprovalResult {
  intentId: string
  /**
   * submitted — the approval is out, confirmation not yet read;
   * pending — not confirmed yet (check again);
   * confirmed — mined and the allowance covers the deposit;
   * already-sufficient — no approval needed (the allowance already covers it);
   * failed — the approval reverted (approving again is safe).
   */
  state: 'submitted' | 'pending' | 'confirmed' | 'already-sufficient' | 'failed'
  approvalTxHash: string | null
  explorerUrl: string | null
  /** The deposit terms again, for a fresh confirmation — only once the allowance covers the deposit. */
  terms: TestnetDepositPreview | null
}
