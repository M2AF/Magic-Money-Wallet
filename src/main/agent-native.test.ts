import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Keypair } from '@solana/web3.js'
import { AgentNativeCore, nativeAmount, type NativeLedger, type NativePort } from './agent-native-core'
import { nativeAddress, SVM_USDC, validateNativeX402 } from './x402-native-validation'
import { deriveCardanoAddress } from './cardano-pure'
import type { NativeAuth, NativeTransaction } from '../shared/agent-native'

const SOL = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' as const, ADA = 'cardano:preprod' as const
const from = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey.toBase58(), to = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey.toBase58(), sponsor = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey.toBase58()
let adaFrom: string, adaTo: string
beforeAll(() => { adaFrom = deriveCardanoAddress(new Uint8Array(16).fill(1), 1000, true); adaTo = deriveCardanoAddress(new Uint8Array(16).fill(2), 0, true) })
const url = 'https://merchant.example.com/data?account=1'
function fixture(cardano = false) {
  return { requestId: 'pay-1', resourceUrl: url, paymentRequired: { x402Version: 2, resource: { url }, accepts: [{ scheme: 'exact', network: cardano ? ADA : SOL, asset: cardano ? 'lovelace' : SVM_USDC[SOL],
    amount: cardano ? '2000000' : '10000', payTo: cardano ? adaTo : to, maxTimeoutSeconds: 60, extra: cardano ? {} : { feePayer: sponsor } }] } }
}
function setup(cardano = false) {
  let now = 1000000, enabled = true, unlocked = true, granted = true
  let stored: NativeLedger = { version: 1, nextIndex: 1000, policies: [], transactions: [], limits: [] }
  const auth: NativeAuth = { id: 'agent', name: 'Assistant', accountIndex: 0, context: 'owner-testnet', environment: 'testnet', expiresAt: now + 3600000 }
  const port: NativePort = {
    owner: () => unlocked ? { context: auth.context, accountIndex: 0, environment: 'testnet', solana: from, cardano: adaFrom } : null,
    authorize: () => { if (!granted || now >= auth.expiresAt) throw new Error('revoked'); return auth }, x402Enabled: () => enabled,
    address: async () => cardano ? adaFrom : from, load: () => structuredClone(stored), save: vi.fn(s => { stored = structuredClone(s) }), audit: vi.fn(),
    build: vi.fn(async tx => ({ reviewId: '', expiresAt: Math.min(tx.expiresAt, now + 60000), unsigned: 'unsigned', feeRaw: tx.x402 && !cardano ? '0' : '10000', totalRaw: tx.x402 && !cardano ? '0' : (BigInt(tx.amountRaw) + 10000n).toString(), locks: cardano ? [`${'aa'.repeat(32)}#0`] : [tx.requestId] })),
    check: vi.fn(async () => {}), sign: vi.fn(async () => ({ raw: 'signed', hash: cardano ? 'aa'.repeat(32) : 'sol-signature' })),
    broadcast: vi.fn(async tx => tx.txHash!), receipt: vi.fn(async () => ({ confirmations: 2, finalized: false, reverted: false })),
  }
  const core = new AgentNativeCore(port, () => now)
  const create = () => core.createPolicy(auth, { clientId: auth.id, chain: cardano ? 'cardano' : 'solana', recipients: [cardano ? adaTo : to], perSend: '10', daily: '20', total: '30', maxFee: '0.1', minutes: 60 })
  return { core, port, auth, create, stored: () => stored, restart: () => new AgentNativeCore(port, () => now), advance: (ms: number) => { now += ms },
    lock: () => { unlocked = false }, revoke: () => { granted = false }, flagOff: () => { enabled = false },
    request: { requestId: 'send-1', chain: cardano ? 'cardano' : 'solana', recipient: cardano ? adaTo : to, amount: cardano ? '2' : '0.01' } }
}

describe('chain-specific x402 validation', () => {
  it('pins network, USDC mint, fee sponsor and ADA direct-payment semantics', () => {
    expect(validateNativeX402(fixture(), 'testnet').asset).toBe(SVM_USDC[SOL])
    expect(validateNativeX402(fixture(true), 'testnet').asset).toBe('lovelace')
    expect(() => validateNativeX402(fixture(), 'mainnet')).toThrow('mode')
    expect(nativeAmount('0.000000001', 9)).toBe('1'); expect(nativeAmount('0.000001', 6)).toBe('1')
    for (const value of ['0', '1e2', '-1', '0.0000001', '01', 1]) expect(() => nativeAmount(value, 6)).toThrow()
  })
  it.each(['asset', 'network', 'url', 'amount', 'scheme', 'sponsor', 'version', 'ata', 'extensions', 'memo', 'nonce'] as const)('rejects malformed or ambiguous %s', field => {
    const a: any = fixture(), req = a.paymentRequired.accepts[0]
    if (field === 'asset') req.asset = to
    if (field === 'network') req.network = 'solana:unknown'
    if (field === 'url') a.resourceUrl += '&changed=1'
    if (field === 'amount') req.amount = (2n ** 64n).toString()
    if (field === 'scheme') req.scheme = 'permit'
    if (field === 'sponsor') req.extra.feePayer = 'bad'
    if (field === 'version') req.extra.transactionVersions = [1]
    if (field === 'ata') req.extra.ataCreationRequired = true
    if (field === 'extensions') a.paymentRequired.extensions = { credentials: {} }
    if (field === 'memo') req.extra.memo = 'hidden\u202e'
    if (field === 'nonce') req.extra.nonce = 'server-chosen'
    expect(() => validateNativeX402(a, 'testnet')).toThrow()
  })
  it('rejects script/escrow Cardano methods, unknown assets and wrong address networks', () => {
    const a: any = fixture(true); a.paymentRequired.accepts[0].extra.assetTransferMethod = 'masumi'
    expect(() => validateNativeX402(a, 'testnet')).toThrow()
    a.paymentRequired.accepts[0].extra = {}; a.paymentRequired.accepts[0].asset = 'USDC'
    expect(() => validateNativeX402(a, 'testnet')).toThrow('ADA')
    expect(() => nativeAddress(adaTo, 'cardano:mainnet')).toThrow()
    expect(() => nativeAddress('11111111111111111111111111111111', SOL)).toThrow()
  })
})

describe.each([false, true])('SOL/ADA restricted execution (Cardano=%s)', cardano => {
  it('approves once, journals the hash before broadcast, tracks receipt and never resends on retry', async () => {
    const s = setup(cardano), tx = await s.core.request(s.auth, s.request, false)
    expect(s.port.sign).not.toHaveBeenCalled()
    await expect(s.core.approve(tx.id, 'forged')).rejects.toThrow('Review')
    const plan = await s.core.prepare(tx.id)
    s.port.broadcast = vi.fn(async t => { expect(s.stored().transactions[0].view.txHash).toBe(t.txHash); expect(s.stored().transactions[0].view.reservedAt).not.toBeNull(); return t.txHash! })
    const sent = await s.core.approve(tx.id, plan.plan!.reviewId)
    expect(sent.state).toBe('submitted'); expect((await s.core.status(tx.id, s.auth)).state).toBe('confirmed')
    expect((await s.core.request(s.auth, s.request, false)).id).toBe(tx.id); expect(s.port.sign).toHaveBeenCalledTimes(1)
    await expect(s.core.request(s.auth, { ...s.request, amount: '3' }, false)).rejects.toThrow('different')
  })
  it('sends autonomously only under exact immutable recipient, native value-plus-fee budgets and network', async () => {
    const s = setup(cardano), p = await s.create()
    const tx = await s.core.request(s.auth, { ...s.request, policyId: p.id }, true)
    expect(tx.from).toBe(p.address); expect(tx.accountIndex).toBe(1000); expect(tx.reservedAt).not.toBeNull()
    await expect(s.core.request(s.auth, { ...s.request, requestId: 'over', amount: '11', policyId: p.id }, true)).rejects.toThrow('cap')
    expect(s.port.sign).toHaveBeenCalledTimes(1)
    expect(s.restart().snapshot().policies[0].active).toBe(false)
  })
  it('issues x402 under separate explicit asset rules and exposes no payment credential to the renderer', async () => {
    const s = setup(cardano), p = await s.create(), args = fixture(cardano)
    await s.core.configureX402(s.auth, { policyId: p.id, resourceUrls: [url], perPayment: '3', daily: '4', total: '5' })
    const tx = await s.core.proposeX402(s.auth, p.id, args)
    expect(tx.state).toBe('authorized'); expect(tx.x402!.automatic).toBe(true); expect(s.port.broadcast).not.toHaveBeenCalled()
    expect(JSON.stringify(s.core.snapshot())).not.toContain('"transaction":"signed"')
    const header = s.core.retrieve(s.auth, tx.id, args.requestId, url), decoded = JSON.parse(Buffer.from(header.headerValue, 'base64').toString())
    expect(decoded.accepted).toEqual(args.paymentRequired.accepts[0]); expect(decoded.payload.transaction).toBe('signed')
    if (cardano) expect(decoded.payload.nonce).toBe(`${'aa'.repeat(32)}#0`)
    expect((await s.core.proposeX402(s.auth, p.id, args)).id).toBe(tx.id); expect(s.port.sign).toHaveBeenCalledTimes(1)
    expect(() => s.core.retrieve(s.auth, tx.id, 'wrong', url)).toThrow()
    expect(() => s.core.retrieve(s.auth, tx.id, args.requestId, url + '&other=1')).toThrow()
    s.core.kill(p.id); expect(() => s.core.retrieve(s.auth, tx.id, args.requestId, url)).toThrow()
  })
  it('requires an owner exception without automatic x402 rules, preserving exact amount and nonce', async () => {
    const s = setup(cardano), p = await s.create(), tx = await s.core.proposeX402(s.auth, p.id, fixture(cardano))
    expect(tx.state).toBe('prepared'); expect(tx.x402!.reasons.length).toBeGreaterThan(0); expect(s.port.sign).not.toHaveBeenCalled()
    expect((await s.core.approve(tx.id, tx.plan!.reviewId)).state).toBe('authorized')
  })
  it.each(['lock', 'revoke', 'flagOff', 'stop'] as const)('stops %s during x402 signing before release', async action => {
    const s = setup(cardano), p = await s.create()
    await s.core.configureX402(s.auth, { policyId: p.id, resourceUrls: [url], perPayment: '3', daily: '4', total: '5' })
    s.port.sign = vi.fn(async () => { if (action === 'stop') s.core.kill(p.id); else s[action](); return { raw: 'signed', hash: 'hash' } })
    if (action === 'lock') await expect(s.core.proposeX402(s.auth, p.id, fixture(cardano))).rejects.toThrow('Unlock')
    else expect((await s.core.proposeX402(s.auth, p.id, fixture(cardano))).state).toBe('unknown'); expect(s.stored().transactions[0].payment).toBeNull()
    expect(s.stored().transactions[0].view.reservedAt).not.toBeNull()
  })
  it('fails closed on audit/save failure and retains uncertain reservations without replacement', async () => {
    const s = setup(cardano), p = await s.create()
    s.port.audit = () => { throw new Error('audit unavailable') }
    await expect(s.core.request(s.auth, { ...s.request, policyId: p.id }, true)).rejects.toThrow('audit'); expect(s.port.sign).not.toHaveBeenCalled()
    s.port.audit = vi.fn(); s.port.broadcast = async () => { throw new Error('offline') }
    const tx = await s.core.request(s.auth, { ...s.request, policyId: p.id }, true)
    expect(tx.state).toBe('unknown'); expect((await s.core.request(s.auth, { ...s.request, policyId: p.id }, true)).id).toBe(tx.id)
    expect(s.port.sign).toHaveBeenCalledTimes(1)
  })
  it('recovers a stopped isolated account without reopening agent permissions', async () => {
    const s = setup(cardano), p = await s.create(); s.core.kill(p.id); s.revoke()
    const tx = await s.core.recovery(p.id, cardano ? adaTo : to, cardano ? '2' : '0.01')
    expect(tx.mode).toBe('recovery'); expect(tx.state).toBe('prepared')
    expect((await s.core.approve(tx.id, tx.plan!.reviewId)).state).toBe('submitted')
  })
  it('permits owner recovery after the original policy and grant expire', async () => {
    const s = setup(cardano), p = await s.create(); s.advance(3600001)
    const tx = await s.core.recovery(p.id, cardano ? adaTo : to, cardano ? '2' : '0.01')
    expect((await s.core.approve(tx.id, tx.plan!.reviewId)).state).toBe('submitted')
  })
  it('does not release inputs or reset x402 authority budgets on time expiry or restart', async () => {
    const s = setup(cardano), p = await s.create()
    await s.core.configureX402(s.auth, { policyId: p.id, resourceUrls: [url], perPayment: cardano ? '2' : '0.01', daily: cardano ? '2' : '0.01', total: cardano ? '2' : '0.01' })
    const tx = await s.core.proposeX402(s.auth, p.id, fixture(cardano)); s.advance(60001)
    expect(() => s.core.retrieve(s.auth, tx.id, tx.requestId, url)).toThrow()
    const next = await s.core.proposeX402(s.auth, p.id, { ...fixture(cardano), requestId: 'after-expiry' })
    expect(next.x402!.reasons.join(' ')).toContain('budget')
    expect(s.stored().transactions[0].view.reservedAt).not.toBeNull()
    expect(s.restart().snapshot().policies[0].active).toBe(false)
  })
  it('preserves corrupt journals and blocks signing when durable reservation fails', async () => {
    const s = setup(cardano), p = await s.create(), save = s.port.save
    s.port.save = value => { if (value.transactions.some(t => t.view.reservedAt !== null)) throw new Error('disk full'); save(value) }
    await expect(s.core.request(s.auth, { ...s.request, policyId: p.id }, true)).rejects.toThrow('disk')
    expect(s.port.sign).not.toHaveBeenCalled()
    const corrupt = structuredClone(s.stored()); corrupt.policies[0].network = 'unknown' as any; s.port.load = () => corrupt
    expect(() => s.restart().snapshot()).toThrow('journal')
    expect(corrupt.policies[0].network).toBe('unknown')
  })
  it('stops immediately in memory even if persisting Stop fails', async () => {
    const s = setup(cardano), p = await s.create()
    s.port.save = () => { throw new Error('read-only storage') }
    expect(() => s.core.kill(p.id)).toThrow('storage')
    expect(s.core.snapshot().policies[0].active).toBe(false)
    await expect(s.core.request(s.auth, { ...s.request, policyId: p.id }, true)).rejects.toThrow('stopped')
    expect(s.port.sign).not.toHaveBeenCalled()
  })
  it('honors expiry, rejection while awaiting checks, and durable input locks', async () => {
    const s = setup(cardano), tx = await s.core.request(s.auth, s.request, false), prepared = await s.core.prepare(tx.id)
    s.advance(60001); await expect(s.core.approve(tx.id, prepared.plan!.reviewId)).rejects.toThrow('expired')
    const fresh = await s.core.prepare(tx.id)
    let done!: () => void; s.port.check = () => new Promise<void>(resolve => { done = resolve })
    const pending = s.core.approve(tx.id, fresh.plan!.reviewId); s.core.reject(tx.id); done()
    await expect(pending).rejects.toThrow('changed'); expect(s.port.sign).not.toHaveBeenCalled()
  })
})
