import { describe, expect, it, vi } from 'vitest'
import { AgentExecutionCore, agentWei, validateLedger, type AgentExecutionLedger, type AgentExecutionPort } from './agent-execution-core'
import type { AgentExecutionAuth, AgentExecutionOwner, AgentPolicyInput, AgentTransaction } from '../shared/agent-execution'

const MAIN = '0x1111111111111111111111111111111111111111'
const ISOLATED = '0x2222222222222222222222222222222222222222'
const TO = '0x3333333333333333333333333333333333333333'
const HASH = `0x${'ab'.repeat(32)}`
function setup() {
  let now = 100_000, allowed = true
  let owner: AgentExecutionOwner | null = { context: 'owner-mainnet', accountIndex: 0, address: MAIN, chainId: 1 }
  let saved: AgentExecutionLedger = { version: 1, nextAccountIndex: 1000, policies: [], transactions: [] }
  const auth: AgentExecutionAuth = { id: 'agent1', name: 'Assistant', accountIndex: 0, context: 'owner-mainnet', environment: 'mainnet', expiresAt: now + 8 * 3600_000 }
  const port: AgentExecutionPort = {
    owner: () => owner, authorize: id => { if (!allowed || id !== auth.id) throw new Error('revoked'); return auth },
    load: () => structuredClone(saved), save: vi.fn(state => { saved = structuredClone(state) }),
    address: vi.fn(async () => ISOLATED), unused: vi.fn(async () => true),
    prepare: vi.fn(async tx => ({ chainId: tx.chainId, network: tx.network, from: tx.from, to: tx.recipient, valueRaw: tx.valueRaw,
      gas: '21000', gasPriceRaw: '1000000000', maxFeeRaw: '21000000000000', totalRaw: (BigInt(tx.valueRaw) + 21000000000000n).toString(),
      nonce: saved.transactions.filter(t => t.id !== tx.id && t.from === tx.from && t.txHash).length })),
    sign: vi.fn(async () => ({ hash: HASH, raw: '0xabcd' })),
    broadcast: vi.fn(async () => {
      expect(saved.transactions.at(-1)?.txHash).toBe(HASH)
      expect(saved.transactions.at(-1)?.state).toBe('unknown')
      return HASH
    }),
    receipt: vi.fn(async () => ({ state: 'confirmed' as const, confirmations: 2, finalized: false })),
  }
  const core = new AgentExecutionCore(port, () => now)
  const args = { requestId: 'r1', chain: 'ethereum', recipient: TO, amount: '0.001' }
  const input: AgentPolicyInput = { clientId: auth.id, recipients: [TO], perSend: '0.002', daily: '0.003', total: '0.004', maxFee: '0.0001', minutes: 60 }
  const approved = async () => core.prepare((await core.requestApproval(auth, args)).id)
  return { core, port, auth, args, input, approved, saved: () => saved, restart: () => new AgentExecutionCore(port, () => now),
    advance: (ms: number) => { now += ms }, revoke: () => { allowed = false }, lock: () => { owner = null }, switchAccount: () => { owner = { ...owner!, context: 'other' } } }
}

describe('agent native execution authority and durable sending', () => {
  it('keeps amounts exact and rejects ambiguous or over-precise amounts', () => {
    expect(agentWei('0.000000000000000001')).toBe('1')
    for (const input of ['0', '-1', '1e2', ' 1', '.1', '01', '0.0000000000000000001', 1]) expect(() => agentWei(input)).toThrow()
  })
  it('requests do not sign; a bound reviewed approval submits once and returns the precomputed hash', async () => {
    const s = setup(), request = await s.core.requestApproval(s.auth, s.args)
    expect(request.state).toBe('pending-approval'); expect(s.port.sign).not.toHaveBeenCalled()
    const prepared = await s.core.prepare(request.id)
    await expect(s.core.approve(request.id, 'forged-review')).rejects.toThrow()
    const sent = await s.core.approve(request.id, prepared.plan!.reviewId)
    expect(sent.state).toBe('submitted'); expect(sent.txHash).toBe(HASH)
    await s.core.approve(request.id, prepared.plan!.reviewId)
    expect(s.port.sign).toHaveBeenCalledTimes(1); expect(s.port.broadcast).toHaveBeenCalledTimes(1)
    const status = await s.core.status(request.id, s.auth)
    expect(status.state).toBe('confirmed'); expect(status.confirmations).toBe(2); expect(status.finalized).toBe(false)
  })
  it('reuses exact request IDs and rejects changed identities', async () => {
    const s = setup(), first = await s.core.requestApproval(s.auth, s.args)
    expect((await s.core.requestApproval(s.auth, s.args)).id).toBe(first.id)
    await expect(s.core.requestApproval(s.auth, { ...s.args, amount: '0.002' })).rejects.toThrow('different')
    await expect(s.core.requestApproval(s.auth, { ...s.args, chain: 'base' })).rejects.toThrow('Ethereum')
  })
  it('rejects expired review without signing', async () => {
    const s = setup(), tx = await s.approved(); s.advance(60_001)
    await expect(s.core.approve(tx.id, tx.plan!.reviewId)).rejects.toThrow('expired')
    expect(s.port.sign).not.toHaveBeenCalled()
  })
  it.each(['revoke', 'lock', 'switchAccount'] as const)('stops %s during signing before broadcast', async action => {
    const s = setup(), tx = await s.approved()
    s.port.sign = vi.fn(async () => { s[action](); return { hash: HASH, raw: '0xabcd' } })
    expect((await s.core.approve(tx.id, tx.plan!.reviewId)).state).toBe('failed')
    expect(s.port.broadcast).not.toHaveBeenCalled()
    expect(s.saved().transactions[0].reservedAt).toBeGreaterThan(0)
  })
  it('expires the review during a slow signing operation', async () => {
    const s = setup(), tx = await s.approved()
    s.port.sign = vi.fn(async () => { s.advance(61_000); return { hash: HASH, raw: '0xabcd' } })
    expect((await s.core.approve(tx.id, tx.plan!.reviewId)).state).toBe('failed')
    expect(s.port.broadcast).not.toHaveBeenCalled()
  })
  it('retains the hash on RPC timeout and never re-signs a consumed request', async () => {
    const s = setup(), tx = await s.approved()
    s.port.broadcast = vi.fn(async () => { throw new Error('timeout') })
    const uncertain = await s.core.approve(tx.id, tx.plan!.reviewId)
    expect(uncertain.state).toBe('unknown'); expect(uncertain.txHash).toBe(HASH)
    await s.core.approve(tx.id, tx.plan!.reviewId)
    expect(s.port.sign).toHaveBeenCalledTimes(1)
    const next = await s.core.requestApproval(s.auth, { ...s.args, requestId: 'r2' })
    await expect(s.core.prepare(next.id)).rejects.toThrow('previous transaction')
  })
  it('rejects a stale nonce after confirmation instead of recycling an old payment for a new request', async () => {
    const s = setup(), tx = await s.approved()
    await s.core.approve(tx.id, tx.plan!.reviewId); await s.core.status(tx.id, s.auth)
    const prepare = s.port.prepare
    s.port.prepare = async item => ({ ...await prepare(item), nonce: 0 })
    const next = await s.core.requestApproval(s.auth, { ...s.args, requestId: 'new-payment' })
    await expect(s.core.prepare(next.id)).rejects.toThrow('nonce is behind')
    expect(s.port.broadcast).toHaveBeenCalledTimes(1)
  })
  it('never attaches an existing transaction hash to a different payment request', async () => {
    const s = setup(), tx = await s.approved()
    await s.core.approve(tx.id, tx.plan!.reviewId); await s.core.status(tx.id, s.auth)
    const next = await s.core.prepare((await s.core.requestApproval(s.auth, { ...s.args, requestId: 'new-payment' })).id)
    expect(next.plan!.nonce).toBe(1)
    // Deliberately faulty signer port returns the previous hash; native signing
    // additionally verifies the decoded nonce and the keccak hash of its bytes.
    const result = await s.core.approve(next.id, next.plan!.reviewId)
    expect(result.state).toBe('failed'); expect(result.txHash).toBeNull()
    expect(s.port.broadcast).toHaveBeenCalledTimes(1)
  })
  it('fails closed before broadcast when the durable hash cannot be saved', async () => {
    const s = setup(), tx = await s.approved(), save = s.port.save
    s.port.save = state => { if (state.transactions.some(t => t.txHash)) throw new Error('disk full'); save(state) }
    expect((await s.core.approve(tx.id, tx.plan!.reviewId)).state).toBe('failed')
    expect(s.port.broadcast).not.toHaveBeenCalled()
  })
  it('refuses a changed source or fee plan from preparation', async () => {
    const s = setup(), request = await s.core.requestApproval(s.auth, s.args), prepare = s.port.prepare
    s.port.prepare = async tx => ({ ...await prepare(tx), to: MAIN })
    await expect(s.core.prepare(request.id)).rejects.toThrow('changed transaction')
  })
  it('blocks simultaneous sends and does not reconcile a signing record concurrently', async () => {
    const s = setup(), tx = await s.approved()
    let finish!: () => void
    s.port.broadcast = vi.fn(() => new Promise<string>(resolve => { finish = () => resolve(HASH) }))
    const sent = s.core.approve(tx.id, tx.plan!.reviewId)
    await vi.waitFor(() => expect(s.port.broadcast).toHaveBeenCalled())
    expect((await s.core.status(tx.id, s.auth)).state).toBe('unknown')
    expect(s.port.receipt).not.toHaveBeenCalled()
    await expect(s.core.approve(tx.id, tx.plan!.reviewId)).rejects.toThrow('already')
    finish(); expect((await sent).state).toBe('submitted')
  })
  it('validates a corrupted journal without overwriting it', () => {
    const s = setup(); s.port.load = () => ({ version: 9 } as unknown as AgentExecutionLedger)
    expect(() => s.core.snapshot()).toThrow('journal'); expect(s.port.save).not.toHaveBeenCalled()
    expect(() => validateLedger(null)).toThrow()
  })
})

describe('isolated autonomous spending policies', () => {
  it('allocates a separate backed-up account, with no signing or automatic funding', async () => {
    const s = setup(), policy = await s.core.createPolicy(s.auth, s.input)
    expect(policy.accountIndex).toBe(1000); expect(policy.address).toBe(ISOLATED); expect(policy.address).not.toBe(MAIN)
    expect(s.port.unused).toHaveBeenCalledWith(ISOLATED, 1)
    expect(s.port.sign).not.toHaveBeenCalled(); expect(s.port.broadcast).not.toHaveBeenCalled()
  })
  it('never reuses an interrupted or previously funded account allocation', async () => {
    const s = setup(); s.port.unused = vi.fn(async () => false)
    await expect(s.core.createPolicy(s.auth, s.input)).rejects.toThrow('previously used')
    expect(s.saved().nextAccountIndex).toBe(1001)
    s.port.unused = vi.fn(async () => true)
    expect((await s.core.createPolicy(s.auth, s.input)).accountIndex).toBe(1001)
  })
  it('allows only the authorizing agent and exact recipients', async () => {
    const s = setup(), policy = await s.core.createPolicy(s.auth, s.input)
    await expect(s.core.autonomous(s.auth, { ...s.args, policyId: policy.id, recipient: MAIN })).rejects.toThrow('recipient')
    expect(s.port.sign).not.toHaveBeenCalled()
    s.revoke(); await expect(s.core.autonomous(s.auth, { ...s.args, policyId: policy.id })).rejects.toThrow('revoked')
  })
  it('executes from the isolated account and makes retries idempotent', async () => {
    const s = setup(), policy = await s.core.createPolicy(s.auth, s.input)
    const args = { ...s.args, policyId: policy.id }
    const result = await s.core.autonomous(s.auth, args)
    expect(result.from).toBe(ISOLATED); expect(result.accountIndex).toBe(1000); expect(result.txHash).toBe(HASH)
    expect((await s.core.autonomous(s.auth, args)).id).toBe(result.id)
    expect(s.port.broadcast).toHaveBeenCalledTimes(1)
    expect(s.core.accounts(s.auth)[0].id).toBe(policy.id)
  })
  it.each(['perSend', 'maxFee', 'daily', 'total'] as const)('enforces %s including the maximum fee before signing', async limit => {
    const s = setup()
    if (limit === 'maxFee') s.input.maxFee = '0.000001'
    else if (limit === 'perSend') s.input.perSend = '0.001'
    else { s.input.perSend = '0.0015'; s.input.daily = '0.002'; s.input.total = limit === 'total' ? '0.002' : '0.004' }
    const policy = await s.core.createPolicy(s.auth, s.input)
    if (limit === 'daily' || limit === 'total') {
      const first = await s.core.autonomous(s.auth, { ...s.args, policyId: policy.id })
      await s.core.status(first.id, s.auth)
    }
    const count = vi.mocked(s.port.sign).mock.calls.length
    await expect(s.core.autonomous(s.auth, { ...s.args, requestId: 'limit', policyId: policy.id })).rejects.toThrow('Spending limit')
    expect(s.port.sign).toHaveBeenCalledTimes(count)
  })
  it('kill switch interrupts signing and cannot be reversed by the agent', async () => {
    const s = setup(), policy = await s.core.createPolicy(s.auth, s.input)
    s.port.sign = vi.fn(async () => { s.core.kill(policy.id); return { hash: HASH, raw: '0xabcd' } })
    expect((await s.core.autonomous(s.auth, { ...s.args, policyId: policy.id })).state).toBe('failed')
    expect(s.port.broadcast).not.toHaveBeenCalled()
    await expect(s.core.autonomous(s.auth, { ...s.args, requestId: 'after-stop', policyId: policy.id })).rejects.toThrow('stopped')
  })
  it('kill-all cancels a policy authorization still checking its isolated account', async () => {
    const s = setup()
    s.port.unused = async () => { s.core.kill(); return true }
    await expect(s.core.createPolicy(s.auth, s.input)).rejects.toThrow('kill switch')
    expect(s.core.snapshot().policies).toHaveLength(0)
  })
  it('cannot restore a request rejected while its preview was being prepared', async () => {
    const s = setup(), tx = await s.core.requestApproval(s.auth, s.args), prepare = s.port.prepare
    s.port.prepare = async item => { s.core.reject(item.id); return prepare(item) }
    await expect(s.core.prepare(tx.id)).rejects.toThrow('rejected')
    expect(s.core.snapshot().transactions[0].state).toBe('rejected')
  })
  it('keeps the in-memory stop even if disk writes fail', async () => {
    const s = setup(), policy = await s.core.createPolicy(s.auth, s.input), save = s.port.save
    s.port.save = () => { throw new Error('disk full') }
    expect(() => s.core.kill(policy.id)).toThrow('disk full')
    s.port.save = save
    expect(s.core.snapshot().policies[0].active).toBe(false)
    await expect(s.core.autonomous(s.auth, { ...s.args, policyId: policy.id })).rejects.toThrow('stopped')
  })
  it('stop-all covers policies from other wallet contexts, not just the selected account', async () => {
    const s = setup()
    await s.core.createPolicy(s.auth, s.input)
    s.switchAccount(); s.core.kill();
    expect(s.saved().policies.every(p => !p.active)).toBe(true)
  })
  it('revocation stops policies and restart preserves hashes while disabling policies', async () => {
    const s = setup(), policy = await s.core.createPolicy(s.auth, s.input)
    await s.core.autonomous(s.auth, { ...s.args, policyId: policy.id })
    const restarted = s.restart().snapshot()
    expect(restarted.policies[0].active).toBe(false); expect(restarted.transactions[0].txHash).toBe(HASH)
    s.core.stopClient(s.auth.id)
    expect(s.core.snapshot().policies[0].active).toBe(false)
  })
  it('expires policies and permits owner recovery after agent revocation', async () => {
    const s = setup(), policy = await s.core.createPolicy(s.auth, { ...s.input, minutes: 1 })
    s.advance(60_001)
    await expect(s.core.autonomous(s.auth, { ...s.args, policyId: policy.id })).rejects.toThrow('expired')
    s.revoke()
    const recovery = await s.core.recovery(policy.id, MAIN, '0.001')
    expect(recovery.mode).toBe('recovery'); expect(recovery.from).toBe(ISOLATED)
    const result = await s.core.approve(recovery.id, recovery.plan!.reviewId)
    expect(result.state).toBe('submitted')
  })
})
