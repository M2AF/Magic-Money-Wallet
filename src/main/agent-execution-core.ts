import { randomUUID } from 'node:crypto'
import { getAddress, isAddress, parseEther } from 'viem'
import type { AgentExecutionAuth, AgentExecutionOwner, AgentExecutionSnapshot, AgentPolicyInput, AgentSendPlan, AgentSpendingPolicy, AgentTransaction } from '../shared/agent-execution'
import { AGENT_NETWORKS as networks, agentChainAllowed } from '../shared/agent-execution'
import { agentTokenId, emogotchiCall, EMOGOTCHI, MAX_AGENT_CALL_GAS, validateAgentCall } from './agent-emogotchi'

export interface AgentExecutionLedger { version: 1; nextAccountIndex: number; policies: AgentSpendingPolicy[]; transactions: AgentTransaction[] }
export interface AgentExecutionPort {
  owner(): AgentExecutionOwner | null
  authorize(id: string): AgentExecutionAuth
  load(): AgentExecutionLedger
  save(state: AgentExecutionLedger): void
  address(accountIndex: number): Promise<string>
  unused(address: string, chainId: number): Promise<boolean>
  prepare(tx: AgentTransaction): Promise<Omit<AgentSendPlan, 'reviewId' | 'expiresAt'>>
  sign(tx: AgentTransaction, plan: AgentSendPlan): Promise<{ hash: string; raw: string }>
  broadcast(raw: string, chainId: number): Promise<string>
  receipt(tx: AgentTransaction): Promise<{ state: 'confirmed' | 'reverted' | 'submitted' | 'unknown'; confirmations: number; finalized: boolean }>
}
const DAY = 24 * 60 * 60_000
const copy = <T>(value: T): T => structuredClone(value)
function text(value: unknown, name: string, max = 80): string {
  if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value)) throw new Error(`Invalid ${name}.`)
  return value
}
export function agentWei(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,40})(\.[0-9]{1,18})?$/.test(value)) throw new Error('Use a decimal native amount with at most 18 decimal places.')
  const raw = parseEther(value)
  if (raw <= 0n || raw >= 2n ** 256n) throw new Error('Amount must be positive and within the native currency range.')
  return raw.toString()
}
function recipient(value: unknown): string {
  if (typeof value !== 'string' || !isAddress(value, { strict: true }) || /^0x0{40}$/i.test(value)) throw new Error('Use a valid nonzero EVM recipient address.')
  return getAddress(value)
}
const terminal = new Set(['confirmed', 'reverted', 'rejected', 'expired', 'failed'])

/** Serialized, durable execution. No signing/broadcasting is reachable without a stored plan and authorization. */
export class AgentExecutionCore {
  private state: AgentExecutionLedger | null = null
  private busy = false
  private stopped = new Set<string>()
  private stopEpoch = 0
  constructor(private port: AgentExecutionPort, private now: () => number = Date.now) {}
  private ledger(): AgentExecutionLedger {
    if (this.state) return this.state
    const state = this.port.load()
    validateLedger(state)
    // Pairings are session-only. Nothing silently resumes after a process restart.
    for (const p of state.policies) { p.active = false; p.stoppedReason = 'Restarted; recovery remains available.' }
    for (const tx of state.transactions) {
      if (tx.state === 'pending-approval' || tx.state === 'prepared') { tx.state = 'expired'; tx.plan = null }
      if (tx.state === 'signing') { tx.state = tx.txHash ? 'unknown' : 'failed'; tx.error = 'Interrupted; check the recorded hash. Never resend an uncertain transaction.' }
    }
    this.port.save(state)
    this.state = copy(state)
    return this.state
  }
  private commit(change: (next: AgentExecutionLedger) => void): void {
    const next = copy(this.ledger()); change(next); validateLedger(next); this.port.save(next); this.state = next
  }
  private owner(): AgentExecutionOwner {
    const owner = this.port.owner()
    if (!owner || ![1, 11155111].includes(owner.chainId)) throw new Error('Execution requires the unlocked paired account in mainnet or Testnet Mode, outside Privacy Mode.')
    return owner
  }
  private auth(auth: AgentExecutionAuth): AgentExecutionOwner {
    const current = this.port.authorize(auth.id)
    const owner = this.owner()
    if (current.context !== auth.context || owner.context !== auth.context || auth.expiresAt <= this.now()) throw new Error('Agent permission changed.')
    return owner
  }
  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('An agent transaction is already being prepared or sent. Retry the same requestId.')
    this.busy = true
    try { return await operation() } finally { this.busy = false }
  }
  private tx(id: string): AgentTransaction {
    const tx = this.ledger().transactions.find(t => t.id === id)
    if (!tx || tx.context !== this.owner().context) throw new Error('Transaction unavailable for this account.')
    return tx
  }
  private policy(id: string): AgentSpendingPolicy {
    const policy = this.ledger().policies.find(p => p.id === id)
    if (!policy || policy.context !== this.owner().context) throw new Error('Spending account unavailable for this owner.')
    return policy
  }
  private checkTx(tx: AgentTransaction): void {
    const owner = this.owner()
    if (owner.context !== tx.context || !agentChainAllowed(owner.chainId, tx.chainId)) throw new Error('Account or network changed.')
    if (tx.expiresAt <= this.now()) throw new Error('Transaction request expired.')
    if (tx.mode !== 'recovery') this.auth(this.port.authorize(tx.clientId))
    if (tx.mode === 'autonomous') {
      const policy = this.policy(tx.policyId!)
      if (!policy.active || this.stopped.has(policy.id) || policy.clientId !== tx.clientId || policy.expiresAt <= this.now()
        || policy.chainId !== tx.chainId || policy.address !== tx.from || policy.accountIndex !== tx.accountIndex
        || (!tx.call && !policy.recipients.includes(tx.recipient))) throw new Error('Autonomous policy is stopped, expired or does not allow this recipient.')
      validateAgentCall(tx, policy)
    }
  }
  snapshot(): AgentExecutionSnapshot {
    const owner = this.port.owner()
    const state = this.ledger()
    return copy({ supported: !!owner && !!networks[owner.chainId], chainId: owner?.chainId ?? 0,
      network: owner ? networks[owner.chainId] ?? 'Unsupported network' : 'Locked',
      policies: state.policies.filter(p => p.context === owner?.context).map(p => ({ ...p, active: p.active && !this.stopped.has(p.id) && p.expiresAt > this.now() })),
      transactions: state.transactions.filter(t => t.context === owner?.context).slice().reverse() })
  }
  list(auth: AgentExecutionAuth): AgentTransaction[] { this.auth(auth); return this.snapshot().transactions.filter(t => t.clientId === auth.id) }
  accounts(auth: AgentExecutionAuth): AgentSpendingPolicy[] { this.auth(auth); return this.snapshot().policies.filter(p => p.clientId === auth.id) }
  /** Shared isolated-account authority for bounded asset capabilities such as x402. */
  spendingAuthority(auth: AgentExecutionAuth, id: string): AgentSpendingPolicy {
    this.auth(auth)
    const policy = this.policy(id)
    if (policy.clientId !== auth.id || !policy.active || this.stopped.has(id) || policy.expiresAt <= this.now()) throw new Error('Spending account is stopped, expired or belongs to another agent.')
    return copy(policy)
  }

  private chain(owner: AgentExecutionOwner, chain: unknown): number {
    if (chain === 'ethereum') return owner.chainId
    if (chain === 'monad' && agentChainAllowed(owner.chainId, 143)) return 143
    throw new Error('Native execution supports Ethereum/Sepolia and Monad mainnet. Monad is unavailable in Testnet Mode.')
  }
  private async request(auth: AgentExecutionAuth, raw: Record<string, unknown>, policy?: AgentSpendingPolicy, call?: AgentTransaction['call']): Promise<AgentTransaction> {
    const owner = this.auth(auth)
    const requestId = text(raw.requestId, 'requestId')
    const to = recipient(raw.recipient), valueRaw = call ? (call.function === 'pet' ? '0' : '1000000000000000000') : agentWei(raw.amount)
    const chainId = this.chain(owner, raw.chain)
    const prior = this.ledger().transactions.find(t => t.clientId === auth.id && t.requestId === requestId)
    if (prior) {
      if (prior.recipient !== to || prior.valueRaw !== valueRaw || prior.chainId !== chainId || prior.policyId !== (policy?.id ?? null)
        || JSON.stringify(prior.call) !== JSON.stringify(call)) throw new Error('requestId already describes a different transaction.')
      return copy(prior)
    }
    if (policy && (!policy.active || this.stopped.has(policy.id) || policy.expiresAt <= this.now()
      || policy.chainId !== chainId || (!call && !policy.recipients.includes(to)))) throw new Error('Autonomous policy is stopped, expired or does not allow this recipient.')
    if (this.ledger().transactions.length >= 1000) throw new Error('Execution journal is full. Preserve it and review recovery before creating more transactions.')
    if (this.ledger().transactions.filter(t => t.expiresAt > this.now() && (t.state === 'pending-approval' || t.state === 'prepared')).length >= 20) throw new Error('Transaction inbox is full.')
    const tx: AgentTransaction = { id: randomUUID(), requestId, clientId: auth.id, clientName: auth.name, context: owner.context,
      mode: policy ? 'autonomous' : 'approval', policyId: policy?.id ?? null, accountIndex: policy?.accountIndex ?? owner.accountIndex,
      chainId, network: networks[chainId], from: policy?.address ?? owner.address, recipient: to, valueRaw, ...(call ? { call } : {}),
      state: 'pending-approval', createdAt: this.now(), expiresAt: Math.min(auth.expiresAt, this.now() + 10 * 60_000), updatedAt: this.now(),
      plan: null, txHash: null, explorerUrl: null, confirmations: 0, finalized: false, error: null, reservedAt: null }
    validateAgentCall(tx, policy)
    this.commit(state => { state.transactions.push(tx) })
    return copy(tx)
  }
  requestApproval(auth: AgentExecutionAuth, raw: Record<string, unknown>): Promise<AgentTransaction> {
    return this.exclusive(() => this.request(auth, raw))
  }
  async createPolicy(auth: AgentExecutionAuth, input: AgentPolicyInput): Promise<AgentSpendingPolicy> {
    return this.exclusive(async () => {
      const owner = this.auth(auth)
      const epoch = this.stopEpoch
      const chainId = this.chain(owner, input.chain ?? 'ethereum')
      let emogotchiTokenIds: string[] | undefined
      if (input.emogotchiTokenIds !== undefined) {
        if (chainId !== 143 || !Array.isArray(input.emogotchiTokenIds) || !input.emogotchiTokenIds.length || input.emogotchiTokenIds.length > 100) throw new Error('Emogotchi requires Monad and 1 to 100 allowed token IDs.')
        emogotchiTokenIds = [...new Set(input.emogotchiTokenIds.map(agentTokenId))]
      }
      if (!Array.isArray(input.recipients) || input.recipients.length < (emogotchiTokenIds ? 0 : 1) || input.recipients.length > 20) throw new Error('Allow 1 to 20 recipient addresses, or none for a contract-only policy.')
      const recipients = [...new Set(input.recipients.map(recipient))]
      const perSendRaw = agentWei(input.perSend), dailyRaw = agentWei(input.daily), totalRaw = agentWei(input.total), maxFeeRaw = agentWei(input.maxFee)
      if (BigInt(perSendRaw) > BigInt(dailyRaw) || BigInt(dailyRaw) > BigInt(totalRaw) || BigInt(maxFeeRaw) >= BigInt(perSendRaw)) throw new Error('Limits must satisfy max fee < per-send <= rolling 24-hour <= total budget.')
      if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 480) throw new Error('Authorization must last 1 to 480 minutes.')
      if (this.ledger().policies.length >= 100) throw new Error('Maximum isolated accounts reached.')
      // Persist allocation first. An interrupted creation can never reuse a derived account.
      const index = this.ledger().nextAccountIndex
      this.commit(state => { state.nextAccountIndex++ })
      const address = recipient(await this.port.address(index))
      if (!await this.port.unused(address, chainId)) throw new Error('This derived account was previously used or funded. Its index was reserved; create a fresh policy.')
      this.auth(auth)
      if (epoch !== this.stopEpoch) throw new Error('Authorization interrupted by the kill switch.')
      if (address === getAddress(owner.address)) throw new Error('The isolated account must differ from the main account.')
      const policy: AgentSpendingPolicy = { id: randomUUID(), clientId: auth.id, clientName: auth.name, context: owner.context,
        ownerAddress: owner.address, accountIndex: index, address, chainId, network: networks[chainId], recipients,
        ...(emogotchiTokenIds ? { emogotchiTokenIds } : {}),
        perSendRaw, dailyRaw, totalRaw, maxFeeRaw, createdAt: this.now(), expiresAt: Math.min(auth.expiresAt, this.now() + input.minutes * 60_000), active: true, stoppedReason: null }
      this.commit(state => { state.policies.push(policy) })
      return copy(policy)
    })
  }
  kill(id?: string): void {
    if (!id) this.stopEpoch++
    // No policy can run before this process has loaded its ledger. Loading a
    // previous process's journal always disables every old policy first.
    if (!this.state) return
    const owner = this.port.owner()
    // Set the in-memory stop BEFORE disk IO; even a full disk must stop signing/broadcast.
    const policies = this.ledger().policies.filter(p => (!id || p.id === id) && (!id || !owner || p.context === owner.context))
    for (const p of policies) this.stopped.add(p.id)
    this.commit(state => { for (const p of state.policies) if (this.stopped.has(p.id)) { p.active = false; p.stoppedReason = 'Stopped by wallet owner.' } })
  }
  stopClient(id: string): void {
    if (!this.state) return
    for (const p of this.ledger().policies.filter(p => p.clientId === id)) this.stopped.add(p.id)
    this.commit(state => { for (const p of state.policies) if (p.clientId === id) { p.active = false; p.stoppedReason = 'Agent revoked or access disabled.' } })
  }
  private checkNonceSlot(tx: AgentTransaction): void {
    if (this.ledger().transactions.some(t => t.id !== tx.id && t.from === tx.from && t.chainId === tx.chainId && ['signing', 'submitted', 'unknown'].includes(t.state))) throw new Error('A previous transaction from this account needs confirmation or reconciliation before another send.')
  }
  private async prepareTx(id: string): Promise<AgentTransaction> {
    const tx = this.tx(id)
    if (!['pending-approval', 'prepared'].includes(tx.state)) throw new Error('This request cannot be prepared again.')
    this.checkTx(tx); this.checkNonceSlot(tx)
    const data = await this.port.prepare(copy(tx))
    this.checkTx(tx)
    if (!['pending-approval', 'prepared'].includes(this.tx(id).state)) throw new Error('Request was rejected during preparation.')
    if (data.chainId !== tx.chainId || data.from !== tx.from || data.to !== tx.recipient || data.valueRaw !== tx.valueRaw
      || !/^[1-9][0-9]*$/.test(data.gas) || (tx.call ? BigInt(data.gas) < 21000n || BigInt(data.gas) > MAX_AGENT_CALL_GAS : data.gas !== '21000')
      || (data.data ?? '0x') !== (tx.call?.data ?? '0x')
      || !/^[1-9][0-9]*$/.test(data.gasPriceRaw) || BigInt(data.maxFeeRaw) !== BigInt(data.gas) * BigInt(data.gasPriceRaw)
      || BigInt(data.totalRaw) !== BigInt(tx.valueRaw) + BigInt(data.maxFeeRaw) || !Number.isSafeInteger(data.nonce) || data.nonce < 0) throw new Error('Invalid or changed transaction preparation.')
    if (this.ledger().transactions.some(t => t.id !== id && t.from === tx.from && t.chainId === tx.chainId && t.txHash
      && t.plan && t.plan.nonce >= data.nonce)) throw new Error('RPC nonce is behind the recorded transaction history. Wait for a fresh pending nonce.')
    const plan: AgentSendPlan = { ...data, reviewId: randomUUID(), expiresAt: Math.min(tx.expiresAt, this.now() + 60_000) }
    this.commit(state => { const item = state.transactions.find(t => t.id === id)!; item.plan = plan; item.state = 'prepared'; item.updatedAt = this.now() })
    return copy(this.tx(id))
  }
  prepare(id: string): Promise<AgentTransaction> { return this.exclusive(() => this.prepareTx(id)) }
  private reserve(tx: AgentTransaction, plan: AgentSendPlan): void {
    if (tx.mode === 'autonomous') {
      const policy = this.policy(tx.policyId!)
      const committed = this.ledger().transactions.filter(t => t.policyId === policy.id && t.plan && !['pending-approval', 'prepared', 'rejected', 'expired'].includes(t.state))
      const sum = (recent: boolean) => committed.filter(t => !recent || (t.reservedAt ?? t.createdAt) > this.now() - DAY).reduce((total, t) => total + BigInt(t.plan!.totalRaw), 0n)
      const cost = BigInt(plan.totalRaw)
      if (cost > BigInt(policy.perSendRaw) || BigInt(plan.maxFeeRaw) > BigInt(policy.maxFeeRaw) || cost + sum(true) > BigInt(policy.dailyRaw)
        || cost + sum(false) > BigInt(policy.totalRaw)) throw new Error('Spending limit exceeded (amount plus maximum network fee).')
    }
    // A reservation is durable before signing and remains charged on ambiguous or failed sends.
    this.commit(state => { const item = state.transactions.find(t => t.id === tx.id)!; item.state = 'signing'; item.updatedAt = this.now(); item.reservedAt = this.now() })
  }
  private async send(id: string, reviewId: string, autonomous: boolean): Promise<AgentTransaction> {
    let tx = this.tx(id)
    if (tx.txHash || !['prepared'].includes(tx.state)) return copy(tx) // never re-sign or resubmit a consumed request
    if ((tx.mode === 'autonomous') !== autonomous) throw new Error('Approval mode mismatch.')
    const plan = tx.plan
    if (!plan || plan.reviewId !== reviewId || plan.expiresAt <= this.now()) throw new Error('Review expired. Prepare and review a fresh fee estimate.')
    this.checkTx(tx); this.checkNonceSlot(tx)
    this.reserve(tx, plan)
    try {
      this.checkTx(tx)
      const signed = await this.port.sign(copy(tx), copy(plan))
      this.checkTx(tx)
      if (plan.expiresAt <= this.now()) throw new Error('Review expired during signing.')
      if (!/^0x[0-9a-f]{64}$/i.test(signed.hash) || !/^0x[0-9a-f]+$/i.test(signed.raw)) throw new Error('Invalid signed transaction.')
      if (this.ledger().transactions.some(t => t.id !== id && t.txHash?.toLowerCase() === signed.hash.toLowerCase())) throw new Error('A different request already owns this transaction hash.')
      // Save identity, nonce and precomputed hash BEFORE any broadcast call.
      this.commit(state => { const item = state.transactions.find(t => t.id === id)!; item.txHash = signed.hash; item.state = 'unknown'; item.updatedAt = this.now(); item.explorerUrl = `${tx.chainId === 143 ? 'https://monadscan.com' : tx.chainId === 1 ? 'https://etherscan.io' : 'https://sepolia.etherscan.io'}/tx/${signed.hash}` })
      this.checkTx(tx)
      const returnedHash = await this.port.broadcast(signed.raw, tx.chainId)
      if (returnedHash.toLowerCase() !== signed.hash.toLowerCase()) throw new Error('Broadcast response hash mismatch.')
      this.commit(state => { const item = state.transactions.find(t => t.id === id)!; item.state = 'submitted'; item.updatedAt = this.now() })
    } catch {
      // Keep the reservation and hash. An error is never permission to send again.
      this.commit(state => { const item = state.transactions.find(t => t.id === id)!; item.state = item.txHash ? 'unknown' : 'failed';
        item.error = item.txHash ? 'Submission uncertain. Check this hash; do not resend.' : 'Send stopped before broadcast. Reserved budget remains charged.'; item.updatedAt = this.now() })
    }
    return copy(this.ledger().transactions.find(t => t.id === id)!)
  }
  approve(id: string, reviewId: string): Promise<AgentTransaction> { return this.exclusive(() => this.send(id, reviewId, false)) }
  autonomous(auth: AgentExecutionAuth, args: Record<string, unknown>): Promise<AgentTransaction> {
    return this.exclusive(async () => {
      this.auth(auth)
      const policy = this.policy(text(args.policyId, 'policyId'))
      if (policy.clientId !== auth.id || policy.context !== auth.context) throw new Error('Policy belongs to a different agent.')
      const tx = await this.request(auth, args, policy)
      if (!['pending-approval', 'prepared'].includes(tx.state)) return tx
      this.checkTx(tx)
      const prepared = await this.prepareTx(tx.id)
      return this.send(tx.id, prepared.plan!.reviewId, true)
    })
  }
  autonomousCall(auth: AgentExecutionAuth, args: Record<string, unknown>): Promise<AgentTransaction> {
    return this.exclusive(async () => {
      this.auth(auth)
      const policy = this.spendingAuthority(auth, text(args.policyId, 'policyId'))
      if (args.chain !== 'monad') throw new Error('Allowlisted contract calls require Monad mainnet.')
      const checked = emogotchiCall(args.contract, args.function, args.args, args.value)
      const tx = await this.request(auth, { requestId: args.requestId, chain: args.chain, recipient: EMOGOTCHI }, policy, checked.call)
      if (!['pending-approval', 'prepared'].includes(tx.state)) return tx
      this.checkTx(tx)
      const prepared = await this.prepareTx(tx.id)
      return this.send(tx.id, prepared.plan!.reviewId, true)
    })
  }
  reject(id: string): void {
    const tx = this.tx(id)
    if (!['pending-approval', 'prepared'].includes(tx.state)) throw new Error('A submitted or uncertain transaction cannot be cancelled here.')
    this.commit(state => { const item = state.transactions.find(t => t.id === id)!; item.state = 'rejected'; item.plan = null; item.updatedAt = this.now() })
  }
  async status(id: string, auth?: AgentExecutionAuth): Promise<AgentTransaction> {
    let tx = this.tx(id)
    if (auth) { this.auth(auth); if (tx.clientId !== auth.id) throw new Error('Transaction belongs to a different agent.') }
    if (!tx.txHash || this.busy) return copy(tx)
    const outcome = await this.port.receipt(copy(tx))
    const owner = this.owner()
    if (owner.context !== tx.context) throw new Error('Account changed during reconciliation.')
    this.commit(state => { const item = state.transactions.find(t => t.id === id)!; item.state = outcome.state;
      item.confirmations = outcome.confirmations; item.finalized = outcome.finalized; item.updatedAt = this.now(); item.error = outcome.state === 'unknown' ? 'No verified receipt yet. Do not resend.' : null })
    return copy(this.tx(id))
  }
  recovery(policyId: string, to: unknown, amount: unknown): Promise<AgentTransaction> {
    return this.exclusive(async () => {
      const policy = this.policy(policyId), owner = this.owner()
      if (!agentChainAllowed(owner.chainId, policy.chainId)) throw new Error('Switch to the spending account mode to recover funds.')
      this.stopped.add(policy.id)
      this.commit(state => { const p = state.policies.find(p => p.id === policy.id)!; p.active = false; p.stoppedReason = 'Recovery requested.' })
      const tx: AgentTransaction = { id: randomUUID(), requestId: randomUUID(), clientId: 'wallet-owner', clientName: 'Wallet recovery', context: owner.context,
        mode: 'recovery', policyId, accountIndex: policy.accountIndex, chainId: policy.chainId, network: policy.network, from: policy.address,
        recipient: recipient(to), valueRaw: agentWei(amount), state: 'pending-approval', createdAt: this.now(), expiresAt: this.now() + 10 * 60_000,
        updatedAt: this.now(), plan: null, txHash: null, explorerUrl: null, confirmations: 0, finalized: false, error: null, reservedAt: null }
      if (this.ledger().transactions.length >= 1000) throw new Error('Execution journal is full.')
      this.commit(state => { state.transactions.push(tx) })
      return this.prepareTx(tx.id)
    })
  }
}

/** Fail closed on a damaged journal. Sealed storage supplies integrity at the desktop boundary. */
export function validateLedger(raw: unknown): asserts raw is AgentExecutionLedger {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid execution journal.')
  const state = raw as AgentExecutionLedger
  if (state.version !== 1 || !Number.isInteger(state.nextAccountIndex) || state.nextAccountIndex < 1000 || state.nextAccountIndex > 1_000_000
    || !Array.isArray(state.policies) || state.policies.length > 100 || !Array.isArray(state.transactions) || state.transactions.length > 1000) throw new Error('Invalid execution journal.')
  const rawAmount = (v: unknown) => typeof v === 'string' && /^[0-9]{1,78}$/.test(v)
  const ids = new Set<string>()
  for (const p of state.policies) {
    if (!p || typeof p.id !== 'string' || ids.has(p.id) || !isAddress(p.address) || !isAddress(p.ownerAddress)
      || !Number.isInteger(p.accountIndex) || p.accountIndex < 1000 || p.accountIndex >= state.nextAccountIndex
      || !networks[p.chainId] || !Array.isArray(p.recipients) || (!p.recipients.length && !p.emogotchiTokenIds?.length) || p.recipients.length > 20 || p.recipients.some(a => !isAddress(a))
      || ![p.perSendRaw, p.dailyRaw, p.totalRaw, p.maxFeeRaw].every(rawAmount) || !Number.isFinite(p.expiresAt) || typeof p.active !== 'boolean') throw new Error('Invalid spending policy in journal.')
    ids.add(p.id)
    if (p.emogotchiTokenIds !== undefined && (p.chainId !== 143 || !Array.isArray(p.emogotchiTokenIds) || !p.emogotchiTokenIds.length || p.emogotchiTokenIds.length > 100)) throw new Error('Invalid contract policy in journal.')
    p.emogotchiTokenIds?.forEach(agentTokenId)
  }
  ids.clear()
  for (const tx of state.transactions) {
    if (!tx || typeof tx.id !== 'string' || ids.has(tx.id) || !networks[tx.chainId] || !isAddress(tx.from) || !isAddress(tx.recipient)
      || !rawAmount(tx.valueRaw) || !Number.isInteger(tx.accountIndex) || tx.accountIndex < 0 || !Number.isFinite(tx.createdAt)
      || !Number.isFinite(tx.expiresAt) || !['pending-approval', 'prepared', 'signing', 'submitted', 'unknown', ...terminal].includes(tx.state)
      || (tx.txHash !== null && !/^0x[0-9a-f]{64}$/i.test(tx.txHash))) throw new Error('Invalid transaction in journal.')
    if (tx.plan && (![tx.plan.gas, tx.plan.gasPriceRaw, tx.plan.totalRaw, tx.plan.maxFeeRaw].every(rawAmount) || !Number.isSafeInteger(tx.plan.nonce))) throw new Error('Invalid transaction plan in journal.')
    validateAgentCall(tx)
    if (tx.plan && (tx.plan.data ?? '0x') !== (tx.call?.data ?? '0x')) throw new Error('Changed calldata in journal.')
    ids.add(tx.id)
  }
}
