/** JSON-only execution boundary. Amounts in records are exact wei strings. */
export interface AgentExecutionAuth {
  id: string; name: string; context: string; accountIndex: number; environment: string; expiresAt: number
}
export interface AgentExecutionOwner { context: string; accountIndex: number; address: string; chainId: number }
export interface AgentSendPlan {
  reviewId: string; expiresAt: number; chainId: number; network: string; from: string; to: string
  valueRaw: string; gas: string; gasPriceRaw: string; maxFeeRaw: string; totalRaw: string; nonce: number
  data?: string
}
export interface AgentContractCall { function: 'feed' | 'wash' | 'play' | 'sleep' | 'clean' | 'pet'; args: string[]; data: string }
export type AgentTxState = 'pending-approval' | 'prepared' | 'signing' | 'submitted' | 'unknown' | 'confirmed' | 'reverted' | 'rejected' | 'expired' | 'failed'
export interface AgentTransaction {
  id: string; requestId: string; clientId: string; clientName: string; context: string
  mode: 'approval' | 'autonomous' | 'recovery'; policyId: string | null
  accountIndex: number; chainId: number; network: string; from: string; recipient: string; valueRaw: string
  state: AgentTxState; createdAt: number; expiresAt: number; updatedAt: number
  plan: AgentSendPlan | null; txHash: string | null; explorerUrl: string | null
  confirmations: number; finalized: boolean; error: string | null; reservedAt: number | null
  call?: AgentContractCall
}
export interface AgentSpendingPolicy {
  id: string; clientId: string; clientName: string; context: string; ownerAddress: string
  accountIndex: number; address: string; chainId: number; network: string
  recipients: string[]; perSendRaw: string; dailyRaw: string; totalRaw: string; maxFeeRaw: string
  createdAt: number; expiresAt: number; active: boolean; stoppedReason: string | null
  emogotchiTokenIds?: string[]
}
export interface AgentPolicyInput {
  clientId: string; recipients: string[]; perSend: string; daily: string; total: string; maxFee: string; minutes: number
  chain?: 'ethereum' | 'monad'; emogotchiTokenIds?: string[]
}

export const AGENT_NETWORKS: Readonly<Record<number, string>> = { 1: 'Ethereum', 11155111: 'Sepolia', 143: 'Monad' }
export const agentNativeSymbol = (chainId: number) => chainId === 143 ? 'MON' : 'ETH'
export function agentChainAllowed(ownerChainId: number, chainId: number): boolean {
  return (ownerChainId === 1 && (chainId === 1 || chainId === 143)) || (ownerChainId === 11155111 && chainId === 11155111)
}
export interface AgentExecutionSnapshot {
  supported: boolean; network: string; chainId: number; policies: AgentSpendingPolicy[]; transactions: AgentTransaction[]
}
export interface AgentExecutionBridge {
  snapshot(): Promise<AgentExecutionSnapshot>
  prepare(id: string): Promise<AgentTransaction>
  approve(id: string, reviewId: string): Promise<AgentTransaction>
  reject(id: string): Promise<void>
  status(id: string): Promise<AgentTransaction>
  createPolicy(input: AgentPolicyInput, password: string): Promise<AgentSpendingPolicy>
  kill(id?: string): Promise<void>
  recovery(id: string, recipient: string, amount: string, password: string): Promise<AgentTransaction>
}
