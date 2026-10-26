import type { TokenDetailData, TokenRestrictionFacts } from './token-details'

export interface Cip113Credential { type: 'key' | 'script'; hash: string }
export interface Cip113OwnerAddress { address: string; credentialSource: 'payment-key' | 'stake-key'; credentialHash: string }
export interface Cip113RegistryProof {
  outputReference: string
  policyId: string
  minting: Cip113Credential
  transfer: Cip113Credential
  thirdParty: Cip113Credential
  unfracking: Cip113Credential
  globalStatePolicy: string | null
}
export interface Cip113ProtocolState {
  outputReference: string
  dispatcher: Cip113Credential
  issuance: Cip113Credential
  transferDelegate: Cip113Credential
  thirdPartyDelegate: Cip113Credential
  upgradeAuthority: Cip113Credential
  pendingUpgradeAuthority: Cip113Credential | null
  /** False means the live wiring differs from the published release; never enable execution. */
  matchesPublishedWiring: boolean
}
export interface Cip113HistoryEvent {
  txHash: string
  blockHeight: number
  timestamp: number
  netRawQuantity: string
  change: 'increase' | 'decrease' | 'unchanged'
  /** Balance evidence alone does not identify the signer or issuer action. */
  trigger: 'unknown'
}
export interface Cip113ProgrammableDetails {
  deploymentId: string
  network: 'mainnet'
  checkedAt: number
  holdingAddresses: Cip113OwnerAddress[]
  registry: Cip113RegistryProof
  protocol: Cip113ProtocolState
  restrictions: TokenDetailData<TokenRestrictionFacts>
  availableRawBalance: null
  history: TokenDetailData<{ scope: 'token'; coverage: 'recent'; events: Cip113HistoryEvent[] }>
}
