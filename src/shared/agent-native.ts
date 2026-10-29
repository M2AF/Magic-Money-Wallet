import type { AgentExecutionAuth, AgentPolicyInput, AgentTxState } from './agent-execution'

export type AgentNativeChain = 'solana' | 'cardano'
export const NATIVE_NETWORKS = {
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': { chain: 'solana', name: 'Solana', environment: 'mainnet', symbol: 'SOL', decimals: 9 },
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1': { chain: 'solana', name: 'Solana Devnet', environment: 'testnet', symbol: 'SOL', decimals: 9 },
  'cardano:mainnet': { chain: 'cardano', name: 'Cardano', environment: 'mainnet', symbol: 'ADA', decimals: 6 },
  'cardano:preprod': { chain: 'cardano', name: 'Cardano Preprod', environment: 'testnet', symbol: 'ADA', decimals: 6 },
} as const
export type AgentNativeNetwork = keyof typeof NATIVE_NETWORKS
export const nativeNetwork = (chain: AgentNativeChain, environment: string): AgentNativeNetwork =>
  (Object.keys(NATIVE_NETWORKS) as AgentNativeNetwork[]).find(n => NATIVE_NETWORKS[n].chain === chain && NATIVE_NETWORKS[n].environment === environment)!
export type NativePolicyInput = Omit<AgentPolicyInput, 'chain' | 'emogotchiTokenIds'> & { chain: AgentNativeChain }
export interface NativeOwner { context: string; accountIndex: number; environment: string; solana: string; cardano: string }
export interface NativePolicy {
  id: string; clientId: string; clientName: string; context: string; accountIndex: number; address: string
  network: AgentNativeNetwork; recipients: string[]; perSendRaw: string; dailyRaw: string; totalRaw: string; maxFeeRaw: string
  createdAt: number; expiresAt: number; active: boolean; stoppedReason: string | null
}
export interface NativePlan {
  reviewId: string; expiresAt: number; unsigned: string; feeRaw: string; totalRaw: string
  /** Blockhash/UTXO locks; durable reservation prevents simultaneous authorizations using the same inputs. */
  locks: string[]; lastValidBlockHeight?: number; ttl?: number; txHash?: string
}
export interface NativeX402Requirements {
  scheme: 'exact'; network: AgentNativeNetwork; amount: string; asset: string; payTo: string; maxTimeoutSeconds: number
  extra: { feePayer?: string; memo?: string; transactionVersions?: number[]; ataCreationRequired?: false; areFeesSponsored?: false; confirmationPolicy?: { l1Confirmations: number } }
}
export interface NativeX402Required {
  x402Version: 2; resource: { url: string; description?: string; mimeType?: string }; accepts: [NativeX402Requirements]
  error?: string; extensions?: Record<string, never>
}
export interface NativeX402Limit {
  policyId: string; network: AgentNativeNetwork; asset: string; resourceUrls: string[]; perPaymentRaw: string; dailyRaw: string; totalRaw: string
}
export interface NativeX402LimitInput { policyId: string; resourceUrls: string[]; perPayment: string; daily: string; total: string }
export interface NativeTransaction {
  id: string; requestId: string; clientId: string; clientName: string; context: string; accountIndex: number
  mode: 'approval' | 'autonomous' | 'recovery' | 'x402'; policyId: string | null; network: AgentNativeNetwork
  from: string; recipient: string; asset: string; amountRaw: string; createdAt: number; expiresAt: number
  state: AgentTxState | 'authorized' | 'released'; plan: NativePlan | null; reservedAt: number | null
  txHash: string | null; confirmations: number; finalized: boolean; error: string | null
  x402?: { required: NativeX402Required; resourceUrl: string; nonce: string; automatic: boolean; reasons: string[] }
}
export interface NativeSnapshot { policies: NativePolicy[]; transactions: NativeTransaction[]; x402Available: boolean; limits: NativeX402Limit[] }
export interface AgentNativeBridge {
  snapshot(): Promise<NativeSnapshot>
  createPolicy(input: NativePolicyInput, password: string): Promise<NativePolicy>
  prepare(id: string): Promise<NativeTransaction>
  approve(id: string, reviewId: string): Promise<NativeTransaction>
  reject(id: string): Promise<void>
  status(id: string): Promise<NativeTransaction>
  kill(id?: string): Promise<void>
  recovery(id: string, recipient: string, amount: string, password: string): Promise<NativeTransaction>
  configureX402(input: NativeX402LimitInput, password: string): Promise<NativeX402Limit>
}
export type NativeAuth = AgentExecutionAuth
