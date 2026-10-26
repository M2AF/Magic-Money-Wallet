import { describe, expect, it, vi } from 'vitest'
import { X402Core, x402Usdc, type X402Ledger, type X402Port } from './x402-core'
import { x402Fixture } from './x402-fixtures'
import type { AgentExecutionAuth, AgentSpendingPolicy } from '../shared/agent-execution'
import type { X402PaymentView } from '../shared/x402'

const FROM = '0x2222222222222222222222222222222222222222', TO = '0x3333333333333333333333333333333333333333'
function setup() {
  let now = 1_000_000, active = true, flag = true, context: string | null = 'owner-testnet'
  let stored: X402Ledger = { version: 1, limits: [], payments: [] }
  const auth: AgentExecutionAuth = { id: 'agent', name: 'Assistant', context: 'owner-testnet', accountIndex: 0, environment: 'testnet', expiresAt: now + 3600_000 }
  const account: AgentSpendingPolicy = { id: 'isolated', clientId: auth.id, clientName: auth.name, context: auth.context, ownerAddress: '0x1111111111111111111111111111111111111111',
    accountIndex: 1000, address: FROM, chainId: 11155111, network: 'Sepolia', recipients: [TO], perSendRaw: '1000000000000000', dailyRaw: '2000000000000000', totalRaw: '3000000000000000', maxFeeRaw: '100000000000', createdAt: now, expiresAt: auth.expiresAt, active: true, stoppedReason: null }
  const port: X402Port = {
    enabled: () => flag, context: () => context,
    authorize: id => { if (!active || id !== auth.id || context !== auth.context || now >= auth.expiresAt) throw new Error('permission denied'); return auth },
    account: (_auth, id) => { if (!active || id !== account.id || !account.active || now >= account.expiresAt) throw new Error('account stopped'); return account },
    load: () => structuredClone(stored), save: vi.fn(state => { stored = structuredClone(state) }), audit: vi.fn(),
    check: vi.fn(async () => {}),
    sign: vi.fn(async view => ({ x402Version: 2 as const, resource: view.paymentRequired.resource, accepted: view.paymentRequired.accepts[0],
      payload: { signature: `0x${'aa'.repeat(65)}`, authorization: view.authorization } })),
  }
  const core = new X402Core(port, () => now), args = x402Fixture()
  const configure = (overrides = {}) => core.configure(auth, { policyId: account.id, resourceUrls: [args.resourceUrl], perPayment: '0.1', daily: '0.2', total: '0.3', ...overrides })
  return { core, port, auth, account, args, configure, stored: () => stored, restart: () => new X402Core(port, () => now),
    advance: (ms: number) => { now += ms }, revoke: () => { active = false }, stop: () => { account.active = false }, lock: () => { context = null }, flagOff: () => { flag = false },
    switchContext: () => { context = 'another-owner' } }
}

describe('x402 capability layered on the isolated account', () => {
  it('keeps USDC limits exact and never interprets ETH wei limits as USDC', async () => {
    const s = setup(), limits = await s.configure()
    expect(limits.perPaymentRaw).toBe('100000'); expect(x402Usdc('0.000001')).toBe('1')
    for (const value of ['0', '1e6', '0.0000001', '-1', 1]) expect(() => x402Usdc(value)).toThrow()
    expect(s.port.sign).not.toHaveBeenCalled()
  })
  it('automatically signs in-policy requests from account1000 and delivers only to their bound grant/URL', async () => {
    const s = setup(); await s.configure()
    const view = await s.core.propose(s.auth, s.account.id, s.args)
    expect(view.state).toBe('authorized'); expect(view.automatic).toBe(true); expect(view.from).toBe(FROM); expect(view.accountIndex).toBe(1000)
    expect(s.stored().payments[0].view.reservedAt).not.toBeNull()
    expect(JSON.stringify(s.core.snapshot())).not.toContain('signature')
    expect(JSON.stringify(view)).not.toContain('signature')
    const delivery = s.core.retrieve(s.auth, view.id, s.args.requestId, s.args.resourceUrl)
    expect(delivery.headerName).toBe('PAYMENT-SIGNATURE')
    const payload = JSON.parse(Buffer.from(delivery.headerValue, 'base64').toString())
    expect(payload.payload.authorization).toEqual(view.authorization)
    expect(s.core.retrieve(s.auth, view.id, s.args.requestId, s.args.resourceUrl).headerValue).toBe(delivery.headerValue)
    expect(() => s.core.retrieve({ ...s.auth, id: 'other' }, view.id, s.args.requestId, s.args.resourceUrl)).toThrow('binding')
    expect(() => s.core.retrieve(s.auth, view.id, 'different-request', s.args.resourceUrl)).toThrow('binding')
    expect(() => s.core.retrieve(s.auth, view.id, s.args.requestId, s.args.resourceUrl + '&another=1')).toThrow('binding')
    expect(s.port.sign).toHaveBeenCalledTimes(1)
  })
  it('retries return the same nonce and signature; changed arguments are rejected', async () => {
    const s = setup(); await s.configure()
    const view = await s.core.propose(s.auth, s.account.id, s.args)
    expect((await s.core.propose(s.auth, s.account.id, structuredClone(s.args))).authorization.nonce).toBe(view.authorization.nonce)
    // Top-level key order is irrelevant; preserve nested JSON while reordering it.
    expect((await s.core.propose(s.auth, s.account.id, { paymentRequired: s.args.paymentRequired, resourceUrl: s.args.resourceUrl, requestId: s.args.requestId })).id).toBe(view.id)
    const changed = structuredClone(s.args); changed.paymentRequired.accepts[0].amount = '10001'
    await expect(s.core.propose(s.auth, s.account.id, changed)).rejects.toThrow('different')
    expect(s.port.sign).toHaveBeenCalledTimes(1)
  })
  it.each(['url', 'recipient', 'per-payment', 'daily', 'total'] as const)('queues a %s policy exception without signing', async reason => {
    const s = setup()
    if (reason === 'per-payment') await s.configure({ perPayment: '0.005' })
    else if (reason === 'daily' || reason === 'total') await s.configure({ perPayment: '0.01', daily: '0.015', total: '0.015' })
    else await s.configure()
    if (reason === 'daily' || reason === 'total') await s.core.propose(s.auth, s.account.id, { ...s.args, requestId: 'first' })
    const count = vi.mocked(s.port.sign).mock.calls.length
    if (reason === 'url') { s.args.resourceUrl += '&different=1'; s.args.paymentRequired.resource.url = s.args.resourceUrl }
    if (reason === 'recipient') s.args.paymentRequired.accepts[0].payTo = s.account.ownerAddress
    const view = await s.core.propose(s.auth, s.account.id, s.args)
    expect(view.state).toBe('pending-approval'); expect(view.reasons.length).toBeGreaterThan(0)
    expect(s.port.sign).toHaveBeenCalledTimes(count)
  })
  it('approves one exception after a bound native review and charges its full amount', async () => {
    const s = setup(); await s.configure({ perPayment: '0.005' })
    const pending = await s.core.propose(s.auth, s.account.id, s.args)
    await expect(s.core.approve(pending.id, 'forged')).rejects.toThrow('Review')
    const prepared = await s.core.prepare(pending.id)
    const approved = await s.core.approve(prepared.id, prepared.reviewId!)
    expect(approved.state).toBe('authorized'); expect(approved.automatic).toBe(false)
    expect(s.stored().payments[0].view.reservedAt).not.toBeNull()
  })
  it('does not sign without any USDC policy until the owner explicitly approves the request', async () => {
    const s = setup(), view = await s.core.propose(s.auth, s.account.id, s.args)
    expect(view.state).toBe('pending-approval'); expect(s.port.sign).not.toHaveBeenCalled()
    s.core.reject(view.id); await expect(s.core.prepare(view.id)).rejects.toThrow()
  })
  it.each(['stop', 'revoke', 'lock', 'switchContext', 'flagOff'] as const)('blocks %s during signing before any payload release', async action => {
    const s = setup(); await s.configure()
    const sign = s.port.sign
    s.port.sign = async view => { s[action](); return sign(view) }
    const view = await s.core.propose(s.auth, s.account.id, s.args)
    expect(view.state).toBe('failed'); expect(s.stored().payments[0].payload).toBeNull()
  })
  it('expires after at most 5 minutes and never extends authorization on retry', async () => {
    const s = setup(); await s.configure(); s.args.paymentRequired.accepts[0].maxTimeoutSeconds = 300
    const view = await s.core.propose(s.auth, s.account.id, s.args)
    expect(view.expiresAt - view.createdAt).toBeLessThanOrEqual(300_000)
    s.advance(300_001)
    expect(() => s.core.retrieve(s.auth, view.id, view.requestId, view.resourceUrl)).toThrow('expiry')
    expect(s.core.snapshot().payments[0].state).toBe('expired')
    expect((await s.core.propose(s.auth, s.account.id, s.args)).authorization.validBefore).toBe(view.authorization.validBefore)
    expect(s.port.sign).toHaveBeenCalledTimes(1)
  })
  it('keeps reserved authority charged after failed signing or restart', async () => {
    const s = setup(); await s.configure({ perPayment: '0.01', daily: '0.01', total: '0.01' })
    s.port.sign = vi.fn(async () => { throw new Error('signing failed') })
    expect((await s.core.propose(s.auth, s.account.id, s.args)).state).toBe('failed')
    expect(s.restart().snapshot().payments[0].reservedAt).not.toBeNull()
    const second = await s.core.propose(s.auth, s.account.id, { ...s.args, requestId: 'second' })
    expect(second.state).toBe('pending-approval'); expect(second.reasons.some(r => r.includes('budget'))).toBe(true)
  })
  it('audit failures prevent signing and payload release', async () => {
    const s = setup(); await s.configure()
    s.port.audit = () => { throw new Error('audit full') }
    await expect(s.core.propose(s.auth, s.account.id, s.args)).rejects.toThrow('audit')
    expect(s.port.sign).not.toHaveBeenCalled()
  })
  it('refuses release if its audit or durable release state cannot be saved', async () => {
    const s = setup(); await s.configure(); const view = await s.core.propose(s.auth, s.account.id, s.args)
    const audit = s.port.audit
    s.port.audit = () => { throw new Error('audit full') }
    expect(() => s.core.retrieve(s.auth, view.id, view.requestId, view.resourceUrl)).toThrow('audit')
    s.port.audit = audit; s.port.save = () => { throw new Error('disk full') }
    expect(() => s.core.retrieve(s.auth, view.id, view.requestId, view.resourceUrl)).toThrow('disk')
  })
  it('serializes automatic requests so budgets cannot race', async () => {
    const s = setup(); await s.configure()
    let finish!: () => void
    s.port.check = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    const first = s.core.propose(s.auth, s.account.id, s.args)
    await vi.waitFor(() => expect(s.port.check).toHaveBeenCalled())
    await expect(s.core.propose(s.auth, s.account.id, { ...s.args, requestId: 'concurrent' })).rejects.toThrow('in progress')
    finish(); await first
  })
  it('never signs if reservation cannot be persisted', async () => {
    const s = setup(); await s.configure()
    const save = s.port.save
    s.port.save = state => { if (state.payments.some(p => p.view.state === 'reserved')) throw new Error('disk full'); save(state) }
    await expect(s.core.propose(s.auth, s.account.id, s.args)).rejects.toThrow('disk')
    expect(s.port.sign).not.toHaveBeenCalled()
  })
  it('blocks expired grant/account and authority changes during unsigned checks', async () => {
    for (const action of ['stop', 'revoke', 'lock', 'switchContext', 'flagOff'] as const) {
      const s = setup(); await s.configure(); s.port.check = async () => { s[action]() }
      await expect(s.core.propose(s.auth, s.account.id, s.args)).rejects.toThrow()
      expect(s.port.sign).not.toHaveBeenCalled()
    }
    const s = setup(); await s.configure(); s.account.expiresAt = 1_005_000
    await expect(s.core.propose(s.auth, s.account.id, s.args)).rejects.toThrow('lifetime')
  })
  it('allows rejection while a review is checking and cannot subsequently sign it', async () => {
    const s = setup(), pending = await s.core.propose(s.auth, s.account.id, s.args)
    let finish!: () => void
    s.port.check = () => new Promise<void>(resolve => { finish = resolve })
    const prepared = s.core.prepare(pending.id)
    s.core.reject(pending.id); finish()
    await expect(prepared).rejects.toThrow('changed')
    expect(s.port.sign).not.toHaveBeenCalled()
  })
  it('expires pending reviews on restart and rejects colliding wallet nonces', async () => {
    const s = setup(), nonce = () => `0x${'42'.repeat(32)}`
    const core = new X402Core(s.port, () => 1_000_000, nonce)
    const pending = await core.propose(s.auth, s.account.id, s.args)
    expect(s.restart().snapshot().payments[0].state).toBe('expired')
    await expect(core.propose(s.auth, s.account.id, { ...s.args, requestId: 'collision' })).rejects.toThrow('unique')
    expect(pending.authorization.nonce).toBe(nonce()); expect(s.port.sign).not.toHaveBeenCalled()
  })
  it('rejects damaged policy bindings and changed sealed payloads rather than resetting the journal', async () => {
    const s = setup(); await s.configure(); await s.core.propose(s.auth, s.account.id, s.args)
    const original = structuredClone(s.stored())
    for (const change of [
      (state: X402Ledger) => { state.limits[0].clientId = 'different' },
      (state: X402Ledger) => { state.limits.push(structuredClone(state.limits[0])) },
      (state: X402Ledger) => { state.payments[0].payload!.payload.authorization.value = '999999' },
      (state: X402Ledger) => { state.payments[0].payload = null },
    ]) {
      const corrupted = structuredClone(original); change(corrupted); s.port.load = () => corrupted
      expect(() => s.restart().snapshot()).toThrow()
    }
  })
})
