/** JSON-only x402 v2 subset. No keys or general typed-data signing contract. */
export type X402EvmNetwork = 'eip155:1' | 'eip155:11155111' | 'eip155:143' | 'eip155:8453' | 'eip155:84532'
export const X402_EVM_NETWORKS: Readonly<Record<X402EvmNetwork, { name: string; environment: 'mainnet' | 'testnet' }>> = {
  'eip155:1': { name: 'Ethereum', environment: 'mainnet' },
  'eip155:11155111': { name: 'Sepolia', environment: 'testnet' },
  'eip155:143': { name: 'Monad', environment: 'mainnet' },
  'eip155:8453': { name: 'Base', environment: 'mainnet' },
  'eip155:84532': { name: 'Base Sepolia', environment: 'testnet' },
}
export interface X402Requirements {
  scheme: 'exact'; network: X402EvmNetwork; amount: string; asset: string; payTo: string
  maxTimeoutSeconds: number
  extra: { name: string; version: '2'; assetTransferMethod?: 'eip3009'; paymentFlow?: 'authorization' }
}
export interface X402PaymentRequired {
  x402Version: 2
  resource: { url: string; description?: string; mimeType?: string }
  accepts: [X402Requirements]
  error?: string
  extensions?: Record<string, never>
}
export interface X402Validated {
  requestId: string; resourceUrl: string; paymentRequired: X402PaymentRequired
  chainId: 1 | 11155111 | 143 | 8453 | 84532; networkName: string; asset: string; recipient: string
  amountRaw: string; domainName: string; environment: 'mainnet' | 'testnet'
}
export interface X402Limits {
  /** Missing only in legacy journals: Base in the paired environment. Never all networks. */
  network?: X402EvmNetwork
  policyId: string; context: string; clientId: string; resourceUrls: string[]; perPaymentRaw: string; dailyRaw: string; totalRaw: string
}
export interface X402LimitsInput { policyId: string; network?: X402EvmNetwork; resourceUrls: string[]; perPayment: string; daily: string; total: string }
export interface X402Authorization { from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string }
export interface X402PaymentPayload {
  x402Version: 2; resource: X402PaymentRequired['resource']; accepted: X402Requirements
  payload: { signature: string; authorization: X402Authorization }; extensions?: Record<string, never>
}
export interface X402PaymentView extends X402Validated {
  id: string; policyId: string; clientId: string; clientName: string; context: string; from: string; accountIndex: number
  createdAt: number; expiresAt: number; reservedAt: number | null; authorization: X402Authorization
  state: 'pending-approval' | 'prepared' | 'reserved' | 'authorized' | 'released' | 'failed' | 'rejected' | 'expired'
  automatic: boolean; reasons: string[]; reviewId: string | null; error: string | null
}
export interface X402Snapshot { available: boolean; payments: X402PaymentView[]; limits: X402Limits[] }
export interface X402Bridge {
  snapshot(): Promise<X402Snapshot>
  configure(input: X402LimitsInput, password: string): Promise<X402Limits>
  prepare(id: string): Promise<X402PaymentView>
  approve(id: string, reviewId: string): Promise<X402PaymentView>
  reject(id: string): Promise<void>
}
