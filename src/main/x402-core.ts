import { randomBytes, randomUUID } from 'node:crypto'
import { isAddress, parseUnits } from 'viem'
import type { AgentExecutionAuth, AgentSpendingPolicy } from '../shared/agent-execution'
import type { X402Authorization, X402Limits, X402LimitsInput, X402PaymentPayload, X402PaymentView, X402Snapshot } from '../shared/x402'
import { validateX402Proposal, x402ResourceUrl, X402_ASSETS } from './x402-validation'

export interface X402StoredPayment { view: X402PaymentView; payload: X402PaymentPayload | null }
export interface X402Ledger { version: 1; limits: X402Limits[]; payments: X402StoredPayment[] }
export interface X402Port {
  enabled(): boolean
  context(): string | null
  authorize(id: string): AgentExecutionAuth
  account(auth: AgentExecutionAuth, policyId: string): AgentSpendingPolicy
  load(): X402Ledger
  save(value: X402Ledger): void
  audit(client: string, action: string, outcome: string): void
  check(view: X402PaymentView): Promise<void>
  sign(view: X402PaymentView): Promise<X402PaymentPayload>
  pendingProposals?(): number
}
const copy = <T>(v: T): T => structuredClone(v)
const DAY = 86400_000
function canonical(raw: unknown): string {
  if (Array.isArray(raw)) return `[${raw.map(canonical).join(',')}]`
  if (raw && typeof raw === 'object') return `{${Object.entries(raw).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(raw)
}
export function x402Usdc(raw: unknown): string {
  if (typeof raw !== 'string' || !/^(0|[1-9][0-9]{0,60})(\.[0-9]{1,6})?$/.test(raw)) throw new Error('Use a decimal USDC amount with at most 6 decimal places.')
  const value = parseUnits(raw, 6)
  if (value <= 0n || value >= 2n ** 256n) throw new Error('USDC limits must be positive and within uint256.')
  return value.toString()
}
export class X402Core {
  private state: X402Ledger | null = null
  private busy = false
  constructor(private port: X402Port, private now: () => number = Date.now, private nonce = () => `0x${randomBytes(32).toString('hex')}`) {}
  private enabled() { if (!this.port.enabled()) throw new Error('x402 is disabled by the desktop feature flag.') }
  private ledger(): X402Ledger {
    if (this.state) return this.state // internal fail-closed cleanup may run after flag/authority changes
    this.enabled()
    if (!this.state) {
      const loaded = this.port.load(); validateX402Ledger(loaded)
      for (const item of loaded.payments) {
        if (['pending-approval', 'prepared'].includes(item.view.state)) item.view.state = 'expired'
        if (item.view.state === 'reserved') { item.view.state = 'failed'; item.view.error = 'Signing interrupted. No automatic replacement authorization.' }
      }
      this.port.save(loaded); this.state = copy(loaded)
    }
    return this.state
  }
  private commit(change: (state: X402Ledger) => void) { const next = copy(this.ledger()); change(next); validateX402Ledger(next); this.port.save(next); this.state = next }
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    this.enabled(); if (this.busy) throw new Error('An x402 operation is in progress. Retry the same requestId.')
    this.busy = true; try { return await fn() } finally { this.busy = false }
  }
  private authority(view: X402PaymentView): AgentSpendingPolicy {
    this.enabled()
    const auth = this.port.authorize(view.clientId), account = this.port.account(auth, view.policyId)
    if (auth.context !== view.context || this.port.context() !== view.context || account.address !== view.from || account.accountIndex !== view.accountIndex
      || auth.environment !== view.environment || this.now() >= view.expiresAt || auth.expiresAt < view.expiresAt || account.expiresAt < view.expiresAt) throw new Error('x402 account, mode, grant or expiry changed.')
    return account
  }
  private item(id: string): X402StoredPayment {
    const item = this.ledger().payments.find(p => p.view.id === id)
    if (!item || item.view.context !== this.port.context()) throw new Error('x402 request unavailable for this account.')
    return item
  }
  snapshot(): X402Snapshot {
    if (!this.port.enabled()) return { available: false, payments: [], limits: [] }
    const context = this.port.context(), state = this.ledger()
    const payments = state.payments.filter(p => p.view.context === context).map(p => ({ ...p.view,
      state: this.now() >= p.view.expiresAt && ['pending-approval', 'prepared', 'authorized', 'released'].includes(p.view.state) ? 'expired' as const : p.view.state })).reverse()
    return copy({ available: true, payments, limits: state.limits.filter(l => l.context === context) })
  }
  pendingCount(): number { return this.state?.payments.filter(p => p.view.expiresAt > this.now() && ['pending-approval', 'prepared'].includes(p.view.state)).length ?? 0 }
  list(auth: AgentExecutionAuth): X402PaymentView[] {
    const current = this.port.authorize(auth.id)
    if (current.context !== auth.context) throw new Error('Agent changed.')
    return this.snapshot().payments.filter(p => p.clientId === auth.id)
  }
  configure(auth: AgentExecutionAuth, input: X402LimitsInput): Promise<X402Limits> {
    return this.exclusive(async () => {
      this.port.account(this.port.authorize(auth.id), input.policyId)
      const network = input.network ?? (auth.environment === 'testnet' ? 'eip155:84532' : 'eip155:8453')
      if (typeof network !== 'string' || !Object.hasOwn(X402_ASSETS, network) || X402_ASSETS[network].environment !== auth.environment) throw new Error('x402 limit network does not match the paired mode.')
      // A legacy network-less limit remains immutable and Base-only. Never expand it by migration.
      if (this.ledger().limits.some(l => l.policyId === input.policyId && (!l.network || l.network === network))) throw new Error('USDC limits are immutable. Stop this account and authorize a new account to change them.')
      if (!Array.isArray(input.resourceUrls) || input.resourceUrls.length < 1 || input.resourceUrls.length > 20) throw new Error('Allow 1 to 20 exact resource URLs.')
      const limit: X402Limits = { network, policyId: input.policyId, context: auth.context, clientId: auth.id, resourceUrls: [...new Set(input.resourceUrls.map(x402ResourceUrl))],
        perPaymentRaw: x402Usdc(input.perPayment), dailyRaw: x402Usdc(input.daily), totalRaw: x402Usdc(input.total) }
      if (BigInt(limit.perPaymentRaw) > BigInt(limit.dailyRaw) || BigInt(limit.dailyRaw) > BigInt(limit.totalRaw)) throw new Error('USDC limits must satisfy per-payment <= 24-hour <= total.')
      this.port.audit(auth.name, 'x402-configure', 'authorized')
      this.commit(state => { state.limits.push(limit) })
      return copy(limit)
    })
  }
  private reasons(view: X402PaymentView, account: AgentSpendingPolicy): string[] {
    const network = view.paymentRequired.accepts[0].network
    const limit = this.ledger().limits.find(l => l.policyId === view.policyId && (l.network ?? (view.environment === 'testnet' ? 'eip155:84532' : 'eip155:8453')) === network)
    if (!limit) return ['USDC automatic spending has not been authorized for this account and payment network.']
    const reasons: string[] = []
    if (!limit.resourceUrls.includes(view.resourceUrl)) reasons.push('Resource URL is outside the authorized list.')
    if (!account.recipients.includes(view.recipient)) reasons.push('Recipient is outside the account allowlist.')
    const charged = this.ledger().payments.filter(p => p.view.policyId === view.policyId && p.view.paymentRequired.accepts[0].network === network && p.view.reservedAt !== null)
    const total = charged.reduce((v, p) => v + BigInt(p.view.amountRaw), 0n)
    const recent = charged.filter(p => p.view.reservedAt! > this.now() - DAY).reduce((v, p) => v + BigInt(p.view.amountRaw), 0n)
    if (BigInt(view.amountRaw) > BigInt(limit.perPaymentRaw)) reasons.push('Per-payment USDC cap exceeded.')
    if (recent + BigInt(view.amountRaw) > BigInt(limit.dailyRaw)) reasons.push('Rolling 24-hour USDC cap exceeded.')
    if (total + BigInt(view.amountRaw) > BigInt(limit.totalRaw)) reasons.push('Total USDC budget exceeded.')
    return reasons
  }
  propose(auth: AgentExecutionAuth, policyId: string, raw: unknown): Promise<X402PaymentView> {
    return this.exclusive(async () => {
      const current = this.port.authorize(auth.id), account = this.port.account(current, policyId)
      const validated = validateX402Proposal(raw, current.environment)
      const existing = this.ledger().payments.find(p => p.view.clientId === auth.id && p.view.requestId === validated.requestId)
      if (existing) {
        if (existing.view.policyId !== policyId || canonical(existing.view.paymentRequired) !== canonical(validated.paymentRequired)
          || existing.view.resourceUrl !== validated.resourceUrl) throw new Error('requestId already describes a different x402 payment.')
        return copy(existing.view)
      }
      if (this.ledger().payments.length >= 1000 || this.pendingCount() + (this.port.pendingProposals?.() ?? 0) >= 20) throw new Error('x402 inbox or journal is full.')
      const nonce = this.nonce().toLowerCase()
      if (!/^0x[0-9a-f]{64}$/i.test(nonce) || this.ledger().payments.some(p => p.view.authorization.nonce === nonce)) throw new Error('Cannot allocate a unique x402 nonce.')
      const expiresAt = Math.floor(Math.min(this.now() + Math.min(300, validated.paymentRequired.accepts[0].maxTimeoutSeconds) * 1000, current.expiresAt, account.expiresAt) / 1000) * 1000
      if (expiresAt - this.now() < 10_000) throw new Error('Not enough permission lifetime for this payment.')
      const authorization: X402Authorization = { from: account.address, to: validated.recipient, value: validated.amountRaw,
        validAfter: Math.max(0, Math.floor(this.now() / 1000) - 5).toString(), validBefore: (expiresAt / 1000).toString(), nonce }
      const view: X402PaymentView = { ...validated, id: randomUUID(), policyId, clientId: auth.id, clientName: auth.name, context: current.context,
        from: account.address, accountIndex: account.accountIndex, createdAt: this.now(), expiresAt, reservedAt: null, authorization,
        state: 'pending-approval', automatic: false, reasons: [], reviewId: null, error: null }
      view.reasons = this.reasons(view, account)
      this.port.audit(auth.name, 'x402-request', 'validated')
      this.commit(state => { state.payments.push({ view, payload: null }) })
      if (!view.reasons.length) return this.issue(view.id, true)
      return copy(view)
    })
  }
  prepare(id: string): Promise<X402PaymentView> {
    return this.exclusive(async () => {
      const view = copy(this.item(id).view)
      if (!['pending-approval', 'prepared'].includes(view.state)) throw new Error('This x402 request cannot be prepared.')
      this.authority(view); await this.port.check(view); const account = this.authority(view)
      if (!['pending-approval', 'prepared'].includes(this.item(id).view.state)) throw new Error('Request changed during review.')
      this.port.audit(view.clientName, 'x402-review', 'prepared')
      this.commit(state => { const next = state.payments.find(p => p.view.id === id)!.view; next.state = 'prepared'; next.reviewId = randomUUID(); next.reasons = this.reasons(view, account) })
      return copy(this.item(id).view)
    })
  }
  private async issue(id: string, automatic: boolean): Promise<X402PaymentView> {
    const view = copy(this.item(id).view)
    if (!['pending-approval', 'prepared'].includes(view.state)) return view
    const account = this.authority(view)
    if (automatic && this.reasons(view, account).length) throw new Error('USDC policy changed.')
    if (!automatic && canonical(view.reasons) !== canonical(this.reasons(view, account))) throw new Error('Budget changed. Review the current policy exception again.')
    await this.port.check(view); this.authority(view)
    if (!['pending-approval', 'prepared'].includes(this.item(id).view.state)) throw new Error('Request changed before signing.')
    this.port.audit(view.clientName, 'x402-authorize', automatic ? 'automatic' : 'owner-approved-exception')
    // Charge authority, not reported settlement. Failures/expiry never reset budgets.
    this.commit(state => { const next = state.payments.find(p => p.view.id === id)!.view; next.state = 'reserved'; next.reservedAt = this.now(); next.automatic = automatic })
    try {
      this.authority(view)
      const payload = await this.port.sign(view)
      this.authority(view)
      if (payload.x402Version !== 2 || canonical(payload.payload.authorization) !== canonical(view.authorization)
        || canonical(payload.accepted) !== canonical(view.paymentRequired.accepts[0]) || canonical(payload.resource) !== canonical(view.paymentRequired.resource)
        || !/^0x[0-9a-f]{130}$/i.test(payload.payload.signature)) throw new Error('x402 signer returned a changed payload.')
      this.commit(state => { const next = state.payments.find(p => p.view.id === id)!; next.payload = payload; next.view.state = 'authorized' })
      this.port.audit(view.clientName, 'x402-signed', 'authorized-not-settled')
    } catch {
      this.commit(state => { const next = state.payments.find(p => p.view.id === id)!; next.payload = null; next.view.state = 'failed'; next.view.error = 'Authorization stopped before release. Reserved USDC budget remains charged.' })
    }
    return copy(this.ledger().payments.find(p => p.view.id === id)!.view)
  }
  approve(id: string, reviewId: string): Promise<X402PaymentView> {
    return this.exclusive(async () => {
      const view = this.item(id).view
      if (view.state !== 'prepared' || !reviewId || view.reviewId !== reviewId) throw new Error('Review this stored payment before approving.')
      return this.issue(id, false)
    })
  }
  reject(id: string): void {
    this.enabled()
    const view = this.item(id).view
    if (!['pending-approval', 'prepared'].includes(view.state)) throw new Error('Issued authorizations cannot be recalled by local rejection.')
    this.port.audit(view.clientName, 'x402-reject', 'rejected')
    this.commit(state => { state.payments.find(p => p.view.id === id)!.view.state = 'rejected' })
  }
  retrieve(auth: AgentExecutionAuth, id: string, requestId: string, resourceUrl: string): { headerName: 'PAYMENT-SIGNATURE'; headerValue: string; expiresAt: number } {
    const item = this.item(id), view = item.view
    this.authority(view)
    if (auth.id !== view.clientId || auth.context !== view.context || requestId !== view.requestId || x402ResourceUrl(resourceUrl) !== view.resourceUrl) throw new Error('x402 retrieval binding mismatch.')
    if (!item.payload || !['authorized', 'released'].includes(view.state)) throw new Error('No approved x402 authorization is available.')
    this.port.audit(view.clientName, 'x402-release', 'issued-not-settled')
    const headerValue = Buffer.from(JSON.stringify(item.payload), 'utf8').toString('base64')
    this.commit(state => { state.payments.find(p => p.view.id === id)!.view.state = 'released' })
    return { headerName: 'PAYMENT-SIGNATURE', headerValue, expiresAt: view.expiresAt }
  }
}
export function validateX402Ledger(raw: unknown): asserts raw is X402Ledger {
  const state = raw as X402Ledger
  if (!state || state.version !== 1 || !Array.isArray(state.limits) || state.limits.length > 100 || !Array.isArray(state.payments) || state.payments.length > 1000) throw new Error('Invalid x402 journal.')
  const policies = new Set<string>()
  const binding = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 512
  for (const l of state.limits) {
    const key = `${l?.policyId}:${l?.network ?? 'legacy-base'}`
    if (!l || !binding(l.policyId) || !binding(l.context) || !binding(l.clientId) || policies.has(key) || (l.network !== undefined && (typeof l.network !== 'string' || !Object.hasOwn(X402_ASSETS, l.network))) || !Array.isArray(l.resourceUrls) || l.resourceUrls.length < 1 || l.resourceUrls.length > 20
      || ![l.perPaymentRaw, l.dailyRaw, l.totalRaw].every(v => typeof v === 'string' && /^[1-9][0-9]{0,77}$/.test(v))) throw new Error('Invalid x402 limits.')
    if (BigInt(l.perPaymentRaw) > BigInt(l.dailyRaw) || BigInt(l.dailyRaw) > BigInt(l.totalRaw) || BigInt(l.totalRaw) >= 2n ** 256n) throw new Error('Invalid x402 limit hierarchy.')
    l.resourceUrls.forEach(x402ResourceUrl)
    // Mixing legacy and explicit limits on the same account is ambiguous; preserve the old journal unchanged.
    if (state.limits.some(other => other !== l && other.policyId === l.policyId && (!other.network || !l.network))) throw new Error('Ambiguous legacy x402 limits.')
    policies.add(key)
  }
  const ids = new Set<string>(), nonces = new Set<string>()
  for (const p of state.payments) {
    const v = p?.view
    if (!v || !binding(v.id) || !binding(v.policyId) || !binding(v.context) || !binding(v.clientId) || ids.has(v.id) || !Number.isInteger(v.accountIndex) || v.accountIndex < 1000
      || !isAddress(v.from, { strict: true }) || typeof v.automatic !== 'boolean' || !Array.isArray(v.reasons) || !v.reasons.every(r => typeof r === 'string')
      || !Number.isFinite(v.expiresAt) || !Number.isFinite(v.createdAt) || (v.reservedAt !== null && !Number.isFinite(v.reservedAt))
      || !['pending-approval', 'prepared', 'reserved', 'authorized', 'released', 'failed', 'rejected', 'expired'].includes(v.state)
      || !v.authorization || !/^0x[0-9a-f]{64}$/i.test(v.authorization.nonce) || nonces.has(v.authorization.nonce)) throw new Error('Invalid x402 payment journal.')
    const parsed = validateX402Proposal({ requestId: v.requestId, resourceUrl: v.resourceUrl, paymentRequired: v.paymentRequired }, v.environment)
    if (parsed.amountRaw !== v.amountRaw || parsed.asset !== v.asset || parsed.chainId !== v.chainId || parsed.recipient !== v.recipient
      || v.authorization.from !== v.from || v.authorization.to !== v.recipient || v.authorization.value !== v.amountRaw
      || !/^[0-9]+$/.test(v.authorization.validAfter) || !/^[0-9]+$/.test(v.authorization.validBefore)
      || Number(v.authorization.validBefore) * 1000 !== v.expiresAt || Number(v.authorization.validAfter) >= Number(v.authorization.validBefore)
      || v.expiresAt <= v.createdAt || v.expiresAt > v.createdAt + 300_000) throw new Error('Changed x402 authorization in journal.')
    if (state.limits.some(l => l.policyId === v.policyId && (l.context !== v.context || l.clientId !== v.clientId))) throw new Error('Changed x402 policy binding in journal.')
    if (['authorized', 'released'].includes(v.state) && (!p.payload || v.reservedAt === null)) throw new Error('Missing x402 authorization reservation.')
    if (p.payload && (p.payload.x402Version !== 2 || canonical(p.payload.payload?.authorization) !== canonical(v.authorization)
      || canonical(p.payload.accepted) !== canonical(v.paymentRequired.accepts[0]) || canonical(p.payload.resource) !== canonical(v.paymentRequired.resource)
      || !/^0x[0-9a-f]{130}$/i.test(p.payload.payload?.signature))) throw new Error('Changed x402 payload in journal.')
    ids.add(v.id); nonces.add(v.authorization.nonce)
  }
}
