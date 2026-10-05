import type { TestnetRecordSummary, TestnetStatusSummary } from '../../shared/xreserve-testnet-wire'

export type RouteStepState = 'verified' | 'pending' | 'review'
export function xreserveRouteProgress(status?: TestnetStatusSummary) {
  const source = status?.sourceCode === 'verified'
  const attestation = source && status?.linkCode === 'linked'
  const credit = attestation && status?.state === 'minted' && !!status.mint
    && /^[1-9][0-9]*$/.test(status.creditedRaw ?? '')
  const sourceReview = ['source-failed', 'source-not-approved'].includes(status?.state ?? '')
  const attestationReview = status?.state === 'attestation-mismatch'
  const creditReview = ['mint-conflict', 'mint-evidence-inconsistent', 'tracking-error'].includes(status?.state ?? '')
  return [
    { label: 'Sepolia USDC deposit', state: (source ? 'verified' : sourceReview ? 'review' : 'pending') as RouteStepState },
    { label: 'Circle attestation', state: (attestation ? 'verified' : attestationReview ? 'review' : 'pending') as RouteStepState },
    { label: 'Cardano USDCx credit', state: (credit ? 'verified' : creditReview ? 'review' : 'pending') as RouteStepState },
  ]
}

/** Pick by submission block, not map insertion order. Never change a stored record. */
export function latestXreserveRoute(records: TestnetRecordSummary[]): TestnetRecordSummary | undefined {
  return records.reduce<TestnetRecordSummary | undefined>((latest, r) =>
    !latest || r.cardanoTipAtSubmission > latest.cardanoTipAtSubmission ? r : latest, undefined)
}
