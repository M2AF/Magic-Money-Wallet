import { randomBytes, randomUUID } from 'node:crypto'
import { parseUnits } from 'viem'
import { NATIVE_NETWORKS, nativeNetwork, type NativeAuth, type NativeOwner, type NativePolicy, type NativePolicyInput, type NativePlan, type NativeSnapshot, type NativeTransaction, type NativeX402Limit, type NativeX402LimitInput } from '../shared/agent-native'
import { nativeAddress, nativeObject, nativeText, validateNativeX402, SVM_USDC } from './x402-native-validation'
import { x402ResourceUrl } from './x402-validation'

export interface NativeLedger { version: 1; nextIndex: number; policies: NativePolicy[]; transactions: { view: NativeTransaction; payment: string | null }[]; limits: NativeX402Limit[] }
export interface NativePort {
  owner(): NativeOwner | null
  authorize(id: string): NativeAuth
  x402Enabled(): boolean
  pendingProposals?(): number
  address(index: number, network: NativeTransaction['network']): Promise<string>
  load(): NativeLedger
  save(state: NativeLedger): void
  audit(client: string, action: string, outcome: string): void
  build(tx: NativeTransaction, locked: string[]): Promise<NativePlan>
  check(tx: NativeTransaction): Promise<void>
  sign(tx: NativeTransaction): Promise<{ raw: string; hash: string | null }>
  broadcast(tx: NativeTransaction, raw: string): Promise<string>
  receipt(tx: NativeTransaction): Promise<{ confirmations: number; finalized: boolean; reverted: boolean } | null>
}
const copy = <T>(v: T): T => structuredClone(v)
const stable = (v: unknown): string => Array.isArray(v) ? `[${v.map(stable)}]` : v && typeof v === 'object' ? `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, val]) => `${JSON.stringify(k)}:${stable(val)}`).join(',')}}` : JSON.stringify(v)
export function nativeAmount(value: unknown, decimals: number): string {
  if (typeof value !== 'string' || !new RegExp(`^(0|[1-9][0-9]{0,19})(\\.[0-9]{1,${decimals}})?$`).test(value)) throw new Error('Use an exact decimal native amount.')
  const n = parseUnits(value, decimals)
  if (n <= 0n || n >= 2n ** 64n) throw new Error('Amount must be positive and within uint64.')
  return n.toString()
}
export class AgentNativeCore {
  private state: NativeLedger | null = null
  private busy = false
  private stopped = new Set<string>()
  constructor(private port: NativePort, private now = Date.now) {}
  private ledger(): NativeLedger {
    if (!this.state) {
      const state = this.port.load(); validateNativeLedger(state)
      state.policies.forEach(p => { p.active = false; p.stoppedReason = 'Wallet restarted. Recover funds or create a new policy.' })
      state.transactions.forEach(t => {
        if (t.view.state === 'signing') { t.view.state = 'unknown'; t.view.error = 'Interrupted signing; do not replace this request.' }
        if (['pending-approval', 'prepared'].includes(t.view.state)) t.view.state = 'expired'
      })
      this.port.save(state); this.state = copy(state)
    }
    return this.state
  }
  private commit(fn: (s: NativeLedger) => void) { const state = copy(this.ledger()); fn(state); validateNativeLedger(state); this.port.save(state); this.state = state }
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('Native execution busy. Retry the same requestId.')
    this.busy = true; try { return await fn() } finally { this.busy = false }
  }
  private owner() { const o = this.port.owner(); if (!o) throw new Error('Unlock the paired wallet outside Privacy Mode.'); return o }
  private auth(auth: NativeAuth) {
    const a = this.port.authorize(auth.id), o = this.owner()
    if (a.context !== auth.context || o.context !== auth.context || o.environment !== a.environment) throw new Error('Native account or mode changed.')
    return a
  }
  private item(id: string) { const t = this.ledger().transactions.find(t => t.view.id === id); if (!t || t.view.context !== this.owner().context) throw new Error('Native transaction unavailable.'); return t }
  accounts(auth: NativeAuth) { this.auth(auth); return this.snapshot().policies.filter(p => p.clientId === auth.id) }
  pendingCount() { return this.state?.transactions.filter(t => ['pending-approval', 'prepared'].includes(t.view.state) && t.view.expiresAt > this.now()).length ?? 0 }
  list(auth: NativeAuth) { this.auth(auth); return this.snapshot().transactions.filter(t => t.clientId === auth.id) }
  snapshot(): NativeSnapshot {
    const owner = this.owner(), state = this.ledger()
    return copy({ policies: state.policies.filter(p => p.context === owner.context && !!p.address).map(p => ({ ...p, active: p.active && !this.stopped.has(p.id) && p.expiresAt > this.now() })),
      transactions: state.transactions.filter(t => t.view.context === owner.context).map(t => t.view).reverse(),
      x402Available: this.port.x402Enabled(), limits: state.limits.filter(l => state.policies.some(p => p.id === l.policyId && p.context === owner.context)) })
  }
  authority(auth: NativeAuth, id: string): NativePolicy {
    this.auth(auth)
    const p = this.ledger().policies.find(p => p.id === id)
    if (!p || p.clientId !== auth.id || p.context !== auth.context || !p.active || this.stopped.has(p.id) || p.expiresAt <= this.now()) throw new Error('Native spending account stopped or expired.')
    return copy(p)
  }
  createPolicy(auth: NativeAuth, input: NativePolicyInput) {
    return this.exclusive(async () => {
      const current = this.auth(auth)
      if (!['solana', 'cardano'].includes(input.chain) || input.clientId !== auth.id || !Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 480) throw new Error('Invalid native policy.')
      const network = nativeNetwork(input.chain, current.environment), decimals = NATIVE_NETWORKS[network].decimals
      if (!Array.isArray(input.recipients) || input.recipients.length < 1 || input.recipients.length > 50) throw new Error('Allow 1 to 50 recipients.')
      if (this.ledger().policies.length >= 100) throw new Error('Native policy journal full.')
      const p: NativePolicy = { id: `native-${randomUUID()}`, clientId: auth.id, clientName: auth.name, context: auth.context, accountIndex: this.ledger().nextIndex,
        address: '', network, recipients: [...new Set(input.recipients.map(r => nativeAddress(r, network)))],
        perSendRaw: nativeAmount(input.perSend, decimals), dailyRaw: nativeAmount(input.daily, decimals), totalRaw: nativeAmount(input.total, decimals), maxFeeRaw: nativeAmount(input.maxFee, decimals),
        createdAt: this.now(), expiresAt: Math.min(this.now() + input.minutes * 60000, current.expiresAt), active: true, stoppedReason: null }
      if (BigInt(p.perSendRaw) > BigInt(p.dailyRaw) || BigInt(p.dailyRaw) > BigInt(p.totalRaw) || p.expiresAt <= this.now()) throw new Error('Invalid native budget hierarchy or expiry.')
      // Persist allocation before asynchronous derivation; Stop during derivation cannot activate this policy.
      this.commit(s => { s.nextIndex++ ; s.policies.push({ ...p, active: false, stoppedReason: 'Creation pending' }) })
      p.address = nativeAddress(await this.port.address(p.accountIndex, network), network); this.auth(auth)
      if (this.stopped.has(p.id) || this.ledger().policies.find(v => v.id === p.id)?.stoppedReason !== 'Creation pending') throw new Error('Policy creation interrupted by Stop.')
      this.port.audit(auth.name, 'native-policy', 'authorized'); this.commit(s => { s.policies[s.policies.findIndex(v => v.id === p.id)] = p })
      return copy(p)
    })
  }
  kill(id?: string) {
    if (!this.state && !id) { this.ledger(); return }
    this.ledger().policies.filter(p => !id || p.id === id).forEach(p => this.stopped.add(p.id))
    this.commit(s => { s.policies.filter(p => !id || p.id === id).forEach(p => { p.active = false; p.stoppedReason = 'Stopped by owner.' }) })
  }
  stopClient(id: string) {
    this.ledger().policies.filter(p => p.clientId === id).forEach(p => this.stopped.add(p.id))
    this.commit(s => { s.policies.filter(p => p.clientId === id).forEach(p => { p.active = false; p.stoppedReason = 'Pairing revoked.' }) })
  }
  private checkAuthority(tx: NativeTransaction) {
    const o = this.owner()
    if (o.context !== tx.context || NATIVE_NETWORKS[tx.network].environment !== o.environment || this.now() >= tx.expiresAt) throw new Error('Native context or expiry changed.')
    if (tx.mode === 'recovery') return
    const auth = this.auth(this.port.authorize(tx.clientId))
    if (auth.expiresAt < tx.expiresAt) throw new Error('Grant lifetime changed.')
    if (tx.policyId) {
      const p = this.authority(auth, tx.policyId)
      if (p.address !== tx.from || p.accountIndex !== tx.accountIndex || p.network !== tx.network || p.expiresAt < tx.expiresAt) throw new Error('Native policy binding changed.')
    } else if (tx.from !== o[NATIVE_NETWORKS[tx.network].chain] || tx.accountIndex !== o.accountIndex) throw new Error('Owner account changed.')
    if (tx.x402 && !this.port.x402Enabled()) throw new Error('x402 disabled.')
  }
  /** Main-process signer guard; never exposed through IPC/MCP. Recheck after provider/key awaits. */
  assertSigningAuthority(tx: NativeTransaction) {
    this.checkAuthority(tx)
    const stored = this.item(tx.id).view
    if (stored.state !== 'signing' || stored.reservedAt === null || !tx.plan || this.now() >= tx.plan.expiresAt
      || stable([stored.from, stored.network, stored.asset, stored.amountRaw, stored.recipient, stored.plan]) !== stable([tx.from, tx.network, tx.asset, tx.amountRaw, tx.recipient, tx.plan])) throw new Error('Native signing authority changed.')
  }
  private budget(tx: NativeTransaction): string[] {
    if (!tx.policyId || tx.mode === 'recovery') return []
    const p = this.ledger().policies.find(p => p.id === tx.policyId)!, reasons: string[] = []
    if (!p.recipients.includes(tx.recipient)) reasons.push('Recipient outside account allowlist.')
    const charged = this.ledger().transactions.map(t => t.view).filter(t => t.policyId === p.id && t.reservedAt !== null && t.id !== tx.id)
    const nativeCost = (t: NativeTransaction) => BigInt(t.plan?.totalRaw ?? '0')
    const cost = nativeCost(tx)
    if (BigInt(tx.plan?.feeRaw ?? '0') > BigInt(p.maxFeeRaw)) reasons.push('Maximum network fee exceeded.')
    if (cost > BigInt(p.perSendRaw)) reasons.push('Native per-send cap exceeded.')
    if (cost + charged.filter(t => t.reservedAt! > this.now() - 86400000).reduce((n, t) => n + nativeCost(t), 0n) > BigInt(p.dailyRaw)) reasons.push('Native daily budget exceeded.')
    if (cost + charged.reduce((n, t) => n + nativeCost(t), 0n) > BigInt(p.totalRaw)) reasons.push('Native total budget exceeded.')
    if (tx.x402) {
      const l = this.ledger().limits.find(l => l.policyId === p.id && l.network === tx.network && l.asset === tx.asset)
      if (!l) reasons.push('x402 automatic asset budget has not been authorized.')
      else {
        if (!l.resourceUrls.includes(tx.x402.resourceUrl)) reasons.push('Resource URL outside allowlist.')
        const tokens = charged.filter(t => t.x402 && t.asset === tx.asset && t.network === tx.network)
        if (BigInt(tx.amountRaw) > BigInt(l.perPaymentRaw)) reasons.push('x402 per-payment cap exceeded.')
        if (BigInt(tx.amountRaw) + tokens.filter(t => t.reservedAt! > this.now() - 86400000).reduce((n, t) => n + BigInt(t.amountRaw), 0n) > BigInt(l.dailyRaw)) reasons.push('x402 daily budget exceeded.')
        if (BigInt(tx.amountRaw) + tokens.reduce((n, t) => n + BigInt(t.amountRaw), 0n) > BigInt(l.totalRaw)) reasons.push('x402 total budget exceeded.')
      }
    }
    return reasons
  }
  private locked(tx: NativeTransaction) {
    return this.ledger().transactions.map(t => t.view).filter(t => t.id !== tx.id && t.from === tx.from && t.network === tx.network && t.reservedAt !== null)
      .flatMap(t => t.plan?.locks ?? []) // Conservative: never unlock uncertain or released Cardano payments on local time alone.
  }
  private existing(auth: NativeAuth, next: NativeTransaction) {
    const old = this.ledger().transactions.find(t => t.view.clientId === auth.id && t.view.requestId === next.requestId)?.view
    if (old && stable([old.context, old.policyId, old.mode, old.network, old.recipient, old.asset, old.amountRaw, old.x402?.required, old.x402?.resourceUrl]) !== stable([next.context, next.policyId, next.mode, next.network, next.recipient, next.asset, next.amountRaw, next.x402?.required, next.x402?.resourceUrl])) throw new Error('requestId already binds a different native request.')
    return old
  }
  request(auth: NativeAuth, raw: unknown, autonomous: boolean) {
    return this.exclusive(async () => {
      const keys = ['requestId', 'chain', 'recipient', 'amount', ...(autonomous ? ['policyId'] : [])], a = nativeObject(raw, keys)
      const current = this.auth(auth), chain = a.chain
      if (chain !== 'solana' && chain !== 'cardano') throw new Error('Unsupported native chain.')
      const network = nativeNetwork(chain, current.environment), p = autonomous ? this.authority(current, nativeText(a.policyId, 80)) : null
      if (p && p.network !== network) throw new Error('Native policy network mismatch.')
      const tx = this.newTx(current, network, nativeText(a.requestId, 80), nativeAddress(a.recipient, network), nativeAmount(a.amount, NATIVE_NETWORKS[network].decimals), p, autonomous ? 'autonomous' : 'approval')
      const old = this.existing(auth, tx); if (old) return copy(old)
      this.add(tx)
      if (autonomous) { await this.build(tx.id); return this.issue(tx.id, true) }
      return copy(tx)
    })
  }
  private newTx(auth: NativeAuth, network: NativeTransaction['network'], requestId: string, recipient: string, amountRaw: string, p: NativePolicy | null, mode: NativeTransaction['mode']): NativeTransaction {
    const o = this.owner()
    return { id: `native-${randomUUID()}`, requestId, clientId: auth.id, clientName: auth.name, context: auth.context, accountIndex: p?.accountIndex ?? o.accountIndex,
      mode, policyId: p?.id ?? null, network, from: p?.address ?? o[NATIVE_NETWORKS[network].chain], recipient, asset: 'native', amountRaw,
      createdAt: this.now(), expiresAt: Math.min(this.now() + 300000, auth.expiresAt, mode === 'recovery' ? Infinity : p?.expiresAt ?? Infinity), state: 'pending-approval', plan: null, reservedAt: null,
      txHash: null, confirmations: 0, finalized: false, error: null }
  }
  private add(tx: NativeTransaction) {
    if (this.ledger().transactions.length >= 1000 || this.pendingCount() + (this.port.pendingProposals?.() ?? 0) >= 20) throw new Error('Native journal or inbox full.')
    this.port.audit(tx.clientName, 'native-request', 'validated'); this.commit(s => { s.transactions.push({ view: tx, payment: null }) })
  }
  private async build(id: string) {
    const tx = copy(this.item(id).view)
    if (!['pending-approval', 'prepared'].includes(tx.state)) throw new Error('Request cannot be prepared.')
    this.checkAuthority(tx)
    const plan = await this.port.build(tx, this.locked(tx)); this.checkAuthority(tx)
    if (plan.expiresAt > tx.expiresAt || plan.expiresAt <= this.now() || !/^(0|[1-9][0-9]*)$/.test(plan.feeRaw) || !/^(0|[1-9][0-9]*)$/.test(plan.totalRaw)) throw new Error('Invalid native plan.')
    if (!['pending-approval', 'prepared'].includes(this.item(id).view.state)) throw new Error('Request changed during preparation.')
    tx.plan = { ...plan, reviewId: randomUUID() }; tx.state = 'prepared'
    if (tx.x402) tx.x402.reasons = this.budget(tx)
    this.port.audit(tx.clientName, 'native-review', 'prepared'); this.commit(s => { s.transactions.find(t => t.view.id === id)!.view = tx })
    return copy(tx)
  }
  prepare(id: string) { return this.exclusive(() => this.build(id)) }
  approve(id: string, reviewId: string) { return this.exclusive(async () => { const tx = this.item(id).view; if (!reviewId || tx.plan?.reviewId !== reviewId || tx.mode === 'autonomous') throw new Error('Review stored transaction first.'); return this.issue(id, false) }) }
  reject(id: string) { const tx = this.item(id).view; if (!['pending-approval', 'prepared'].includes(tx.state)) throw new Error('Issued transactions cannot be recalled.'); this.port.audit(tx.clientName, 'native-reject', 'rejected'); this.commit(s => { s.transactions.find(t => t.view.id === id)!.view.state = 'rejected' }) }
  private async issue(id: string, automatic: boolean) {
    const tx = copy(this.item(id).view)
    if (tx.state !== 'prepared' || !tx.plan || this.now() >= tx.plan.expiresAt) throw new Error('Native review expired.')
    this.checkAuthority(tx)
    const reasons = this.budget(tx)
    if (automatic && reasons.length) throw new Error(reasons.join(' '))
    if (!automatic && tx.mode === 'x402' && stable(tx.x402!.reasons) !== stable(reasons)) throw new Error('Policy changed. Review exception again.')
    await this.port.check(tx); this.checkAuthority(tx)
    if (this.item(id).view.state !== 'prepared' || this.now() >= tx.plan.expiresAt) throw new Error('Native request changed or expired.')
    if (this.locked(tx).some(l => tx.plan!.locks.includes(l))) throw new Error('Transaction inputs already reserved.')
    this.port.audit(tx.clientName, 'native-authorize', automatic ? 'automatic' : 'owner-approved')
    this.commit(s => { const v = s.transactions.find(t => t.view.id === id)!.view; v.state = 'signing'; v.reservedAt = this.now(); if (v.x402) v.x402.automatic = automatic })
    try {
      this.checkAuthority(tx)
      const signed = await this.port.sign(tx); this.checkAuthority(tx)
      if (this.now() >= tx.plan.expiresAt || !signed.raw || (!tx.x402 && !signed.hash)) throw new Error('Invalid or expired signed transaction.')
      if (tx.x402) {
        const payload = { x402Version: 2, resource: tx.x402.required.resource, accepted: tx.x402.required.accepts[0], payload: {
          transaction: signed.raw, ...(NATIVE_NETWORKS[tx.network].chain === 'cardano' ? { nonce: tx.plan.locks[0] } : {}) } }
        this.commit(s => { const t = s.transactions.find(t => t.view.id === id)!; t.payment = Buffer.from(JSON.stringify(payload)).toString('base64'); t.view.state = 'authorized'; t.view.txHash = signed.hash })
      } else {
        // Store identity before any spendable bytes leave the wallet.
        this.commit(s => { const t = s.transactions.find(t => t.view.id === id)!; t.view.txHash = signed.hash; t.view.state = 'unknown' })
        this.checkAuthority(tx)
        if (await this.port.broadcast({ ...tx, txHash: signed.hash }, signed.raw) !== signed.hash) throw new Error('Broadcast identity mismatch.')
        this.commit(s => { s.transactions.find(t => t.view.id === id)!.view.state = 'submitted' })
      }
      this.port.audit(tx.clientName, tx.x402 ? 'native-x402' : 'native-submit', tx.x402 ? 'authorized-not-settled' : 'submitted')
    } catch {
      this.commit(s => { const item = s.transactions.find(t => t.view.id === id)!; item.payment = null; const v = item.view; v.state = 'unknown'; v.error = 'Signing/submission interrupted. Budget remains reserved; retry only this requestId.' })
    }
    return copy(this.item(id).view)
  }
  recovery(id: string, recipient: unknown, amount: unknown) {
    return this.exclusive(async () => {
      const o = this.owner(), p = this.ledger().policies.find(p => p.id === id && p.context === o.context)
      if (!p) throw new Error('Native recovery account unavailable.')
      this.kill(id)
      const auth: NativeAuth = { id: p.clientId, name: 'Owner recovery', context: o.context, accountIndex: o.accountIndex, environment: o.environment, expiresAt: this.now() + 300000 }
      const tx = this.newTx(auth, p.network, `recovery-${randomUUID()}`, nativeAddress(recipient, p.network), nativeAmount(amount, NATIVE_NETWORKS[p.network].decimals), p, 'recovery')
      this.add(tx); return this.build(tx.id)
    })
  }
  status(id: string, auth?: NativeAuth) {
    return this.exclusive(async () => {
      const tx = copy(this.item(id).view)
      if (auth) { this.auth(auth); if (tx.clientId !== auth.id) throw new Error('Native transaction belongs to another grant.') }
      if (!tx.txHash || !tx.plan) return tx
      const receipt = await this.port.receipt(tx)
      if (auth) this.auth(auth)
      if (receipt) this.commit(s => { const v = s.transactions.find(t => t.view.id === id)!.view; v.confirmations = receipt.confirmations; v.finalized = receipt.finalized; v.state = receipt.reverted ? 'reverted' : 'confirmed' })
      return copy(this.item(id).view)
    })
  }
  configureX402(auth: NativeAuth, input: NativeX402LimitInput) {
    return this.exclusive(async () => {
      if (!this.port.x402Enabled()) throw new Error('x402 disabled.')
      const p = this.authority(auth, input.policyId), network = p.network
      if (this.ledger().limits.some(l => l.policyId === p.id)) throw new Error('x402 limits are immutable.')
      if (!Array.isArray(input.resourceUrls) || input.resourceUrls.length < 1 || input.resourceUrls.length > 20) throw new Error('Allow 1 to 20 resource URLs.')
      const limit: NativeX402Limit = { policyId: p.id, network, asset: NATIVE_NETWORKS[network].chain === 'solana' ? SVM_USDC[network as keyof typeof SVM_USDC] : 'lovelace',
        resourceUrls: [...new Set(input.resourceUrls.map(x402ResourceUrl))], perPaymentRaw: nativeAmount(input.perPayment, 6), dailyRaw: nativeAmount(input.daily, 6), totalRaw: nativeAmount(input.total, 6) }
      if (BigInt(limit.perPaymentRaw) > BigInt(limit.dailyRaw) || BigInt(limit.dailyRaw) > BigInt(limit.totalRaw)) throw new Error('Invalid x402 budget hierarchy.')
      this.port.audit(auth.name, 'native-x402-configure', 'authorized'); this.commit(s => { s.limits.push(limit) }); return copy(limit)
    })
  }
  proposeX402(auth: NativeAuth, policyId: string, raw: unknown) {
    return this.exclusive(async () => {
      if (!this.port.x402Enabled()) throw new Error('x402 disabled.')
      const current = this.auth(auth), p = this.authority(auth, policyId), validated = validateNativeX402(raw, current.environment)
      if (validated.network !== p.network) throw new Error('x402 native account network mismatch.')
      const tx = this.newTx(current, p.network, validated.requestId, validated.recipient, validated.amountRaw, p, 'x402')
      tx.asset = validated.asset; tx.expiresAt = Math.min(tx.expiresAt, this.now() + validated.required.accepts[0].maxTimeoutSeconds * 1000)
      tx.x402 = { required: validated.required, resourceUrl: validated.resourceUrl, nonce: randomBytes(32).toString('hex'), automatic: false, reasons: [] }
      const old = this.existing(auth, tx); if (old) return copy(old)
      this.add(tx); const prepared = await this.build(tx.id)
      if (!prepared.x402!.reasons.length) return this.issue(tx.id, true)
      return prepared
    })
  }
  retrieve(auth: NativeAuth, id: string, requestId: string, url: string) {
    const item = this.item(id), tx = item.view; this.auth(auth); this.checkAuthority(tx)
    if (!tx.x402 || tx.clientId !== auth.id || requestId !== tx.requestId || x402ResourceUrl(url) !== tx.x402.resourceUrl || !item.payment || !['authorized', 'released'].includes(tx.state)
      || !tx.plan || this.now() >= tx.plan.expiresAt) throw new Error('No bound native x402 authorization available.')
    this.port.audit(auth.name, 'native-x402-release', 'authorized-not-settled')
    this.commit(s => { s.transactions.find(t => t.view.id === id)!.view.state = 'released' })
    return { headerName: 'PAYMENT-SIGNATURE', headerValue: item.payment, expiresAt: tx.plan.expiresAt }
  }
}

export function validateNativeLedger(raw: unknown): asserts raw is NativeLedger {
  const s = raw as NativeLedger
  const text = (v: unknown, max = 512): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
  const units = (v: unknown, zero = false): v is string => typeof v === 'string' && (zero ? /^(0|[1-9][0-9]{0,19})$/ : /^[1-9][0-9]{0,19}$/).test(v) && BigInt(v) < 2n ** 64n
  const time = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
  if (!s || s.version !== 1 || !Number.isInteger(s.nextIndex) || s.nextIndex < 1000 || s.nextIndex > 1100 || !Array.isArray(s.policies) || s.policies.length > 100 || !Array.isArray(s.transactions) || s.transactions.length > 1000 || !Array.isArray(s.limits) || s.limits.length > 100) throw new Error('Invalid native execution journal. Preserve it for recovery.')
  const ids = new Set<string>(), indexes = new Set<number>(), requests = new Set<string>()
  for (const p of s.policies) {
    if (!p || !text(p.id, 80) || !p.id.startsWith('native-') || ids.has(p.id) || !text(p.clientId, 80) || !text(p.clientName) || !text(p.context)
      || !Object.hasOwn(NATIVE_NETWORKS, p.network) || p.accountIndex < 1000 || p.accountIndex >= s.nextIndex || !Number.isInteger(p.accountIndex) || indexes.has(p.accountIndex)
      || ![p.perSendRaw, p.dailyRaw, p.totalRaw, p.maxFeeRaw].every(v => units(v)) || !time(p.expiresAt) || !time(p.createdAt) || p.expiresAt <= p.createdAt || p.expiresAt > p.createdAt + 480 * 60000
      || typeof p.active !== 'boolean' || !Array.isArray(p.recipients) || !p.recipients.length || p.recipients.length > 50
      || BigInt(p.perSendRaw) > BigInt(p.dailyRaw) || BigInt(p.dailyRaw) > BigInt(p.totalRaw) || (!p.address && p.active)) throw new Error('Invalid native policy journal.')
    if (p.address) nativeAddress(p.address, p.network)
    p.recipients.forEach(r => nativeAddress(r, p.network)); ids.add(p.id); indexes.add(p.accountIndex)
  }
  const limits = new Set<string>()
  for (const l of s.limits) {
    const p = s.policies.find(p => p.id === l?.policyId)
    if (!p || l.network !== p.network || limits.has(p.id) || l.asset !== (NATIVE_NETWORKS[p.network].chain === 'cardano' ? 'lovelace' : SVM_USDC[p.network as keyof typeof SVM_USDC])
      || ![l.perPaymentRaw, l.dailyRaw, l.totalRaw].every(v => units(v)) || BigInt(l.perPaymentRaw) > BigInt(l.dailyRaw) || BigInt(l.dailyRaw) > BigInt(l.totalRaw)
      || !Array.isArray(l.resourceUrls) || !l.resourceUrls.length || l.resourceUrls.length > 20) throw new Error('Invalid native x402 limits journal.')
    l.resourceUrls.forEach(x402ResourceUrl); limits.add(p.id)
  }
  for (const t of s.transactions) {
    const v = t?.view
    if (!v || !text(v.id, 80) || !v.id.startsWith('native-') || ids.has(v.id) || !text(v.requestId, 80) || !text(v.clientId, 80) || !text(v.clientName) || !text(v.context)
      || !Object.hasOwn(NATIVE_NETWORKS, v.network) || !units(v.amountRaw) || !time(v.expiresAt) || !time(v.createdAt) || v.expiresAt <= v.createdAt || v.expiresAt > v.createdAt + 300000
      || !Number.isInteger(v.accountIndex) || v.accountIndex < 0 || typeof v.finalized !== 'boolean' || !Number.isSafeInteger(v.confirmations) || v.confirmations < 0
      || !['approval', 'autonomous', 'recovery', 'x402'].includes(v.mode) || !['pending-approval', 'prepared', 'signing', 'submitted', 'unknown', 'confirmed', 'reverted', 'rejected', 'expired', 'failed', 'authorized', 'released'].includes(v.state)
      || (v.reservedAt !== null && !time(v.reservedAt)) || (v.txHash !== null && !text(v.txHash)) || requests.has(`${v.clientId}:${v.requestId}`)) throw new Error('Invalid native transaction journal.')
    nativeAddress(v.from, v.network); nativeAddress(v.recipient, v.network)
    if (v.x402) {
      const checked = validateNativeX402({ requestId: v.requestId, resourceUrl: v.x402.resourceUrl, paymentRequired: v.x402.required }, NATIVE_NETWORKS[v.network].environment)
      if (v.mode !== 'x402' || checked.network !== v.network || checked.asset !== v.asset || checked.amountRaw !== v.amountRaw || checked.recipient !== v.recipient || !/^[0-9a-f]{64}$/.test(v.x402.nonce)
        || typeof v.x402.automatic !== 'boolean' || !Array.isArray(v.x402.reasons) || !v.x402.reasons.every(r => text(r))) throw new Error('Changed native x402 binding.')
    } else if (v.asset !== 'native' || v.mode === 'x402' || ['authorized', 'released'].includes(v.state) || t.payment !== null) throw new Error('Invalid native asset or payment state.')
    if (v.policyId && !s.policies.some(p => p.id === v.policyId && p.clientId === v.clientId && p.context === v.context && p.address === v.from && p.network === v.network && p.accountIndex === v.accountIndex)) throw new Error('Changed native policy binding.')
    if (['autonomous', 'x402', 'recovery'].includes(v.mode) && !v.policyId) throw new Error('Missing isolated native account.')
    const plan = v.plan
    if (plan) {
      if (!text(plan.reviewId, 80) || !text(plan.unsigned, 24000) || !time(plan.expiresAt) || plan.expiresAt > v.expiresAt || plan.expiresAt <= v.createdAt || !units(plan.feeRaw, true) || !units(plan.totalRaw, true)
        || !Array.isArray(plan.locks) || !plan.locks.length || plan.locks.length > 10 || !plan.locks.every(l => text(l)) || new Set(plan.locks).size !== plan.locks.length
        || plan.totalRaw !== (v.x402 && NATIVE_NETWORKS[v.network].chain === 'solana' ? '0' : (BigInt(v.amountRaw) + BigInt(plan.feeRaw)).toString())) throw new Error('Invalid native transaction plan.')
    }
    if (v.reservedAt !== null && !plan) throw new Error('Missing reserved native plan.')
    if (['authorized', 'released'].includes(v.state) && (!t.payment || v.reservedAt === null || !v.x402)) throw new Error('Missing native payment reservation.')
    if (t.payment !== null) {
      if (!text(t.payment, 40000) || !v.x402 || v.reservedAt === null) throw new Error('Invalid native payment credential.')
      const payload = JSON.parse(Buffer.from(t.payment, 'base64').toString('utf8'))
      if (payload.x402Version !== 2 || stable(payload.accepted) !== stable(v.x402.required.accepts[0]) || stable(payload.resource) !== stable(v.x402.required.resource)
        || typeof payload.payload?.transaction !== 'string' || (NATIVE_NETWORKS[v.network].chain === 'cardano' && payload.payload.nonce !== plan?.locks[0])) throw new Error('Changed native signed payment binding.')
    }
    ids.add(v.id); requests.add(`${v.clientId}:${v.requestId}`)
  }
}
