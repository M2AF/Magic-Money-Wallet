/** Public, JSON-only desktop agent contract. Never include wallet config or key material. */
export interface AgentToken {
  chain: string
  address: string
  symbol: string
  name: string
  decimals: number
  isNative: boolean
  logoUri: null
}
export interface AgentSwapDraft {
  from: AgentToken
  to: AgentToken
  amount: string
  slippageBps: number
}
export type AgentDraft =
  | { kind: 'transfer'; chain: string; recipient: string; amount: string; symbol: string; network: string }
  | { kind: 'swap'; swap: AgentSwapDraft }
export interface AgentProposal {
  id: string
  clientId: string
  clientName: string
  createdAt: number
  expiresAt: number
  state: 'pending' | 'opened' | 'rejected' | 'expired'
  draft: AgentDraft
}
export interface AgentGrantView {
  id: string
  name: string
  proposals: boolean
  accountIndex: number
  environment: string
  expiresAt: number
}
export interface AgentActivity { at: number; client: string; action: string; outcome: string }
export interface AgentSnapshot {
  enabled: boolean
  available: boolean
  context: string | null
  grants: AgentGrantView[]
  proposals: AgentProposal[]
  activity: AgentActivity[]
}
export interface AgentAccessBridge {
  snapshot(): Promise<AgentSnapshot>
  enable(enabled: boolean): Promise<AgentSnapshot>
  pair(name: string, proposals: boolean): Promise<{ exported: boolean; command?: string; configPath?: string }>
  revoke(id: string): Promise<void>
  checkReview(id: string): Promise<void>
  review(id: string, decision: 'open' | 'reject'): Promise<{ proposal: AgentProposal; context: string; balance: string | null }>
}
