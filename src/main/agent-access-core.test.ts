import { describe, it, expect, vi } from 'vitest'
import { AgentAccessCore, type AgentContext, type AgentReadPort } from './agent-access-core'
import type { AgentExecutionCore } from './agent-execution-core'
import type { X402Core } from './x402-core'

function setup() {
  let now = 10_000
  let context: AgentContext | null = { key: 'wallet-a-account0-mainnet', accountIndex: 0, environment: 'mainnet' }
  const transfer = { kind: 'transfer' as const, chain: 'base', recipient: '0xrecipient', amount: '1', symbol: 'ETH', network: 'Base' }
  const token = { chain: 'base', address: '0xtoken', symbol: 'ABC', name: 'Example', decimals: 18, isNative: false, logoUri: null }
  const port: AgentReadPort = {
    context: () => context,
    networks: vi.fn(async () => [{ id: 'base' }]), addresses: vi.fn(async () => ({ evm: 'public' })),
    balances: vi.fn(async () => ({ base: '3' })), tokens: vi.fn(async () => []), sessions: vi.fn(async () => []),
    search: vi.fn(async () => [token]), transfer: vi.fn(async () => transfer), balance: vi.fn(async () => '3'),
    quote: vi.fn(async () => ({ swap: { from: token, to: { ...token, address: '0xother' }, amount: '1', slippageBps: 50 }, estimate: { buyAmountRaw: '100' } })),
    record: vi.fn(),
  }
  const core = new AgentAccessCore(port, () => now)
  core.setEnabled(true)
  const pair = (propose = true) => core.pair('Local assistant', propose)
  const args = { requestId: 'request1', chain: 'base', recipient: '0xrecipient', amount: '1' }
  return { core, port, pair, args, setContext: (value: AgentContext | null) => { context = value }, advance: (ms: number) => { now += ms } }
}

describe('agent access authorization and proposal isolation', () => {
  it('gates autonomous contract calls by pairing and rejects raw calldata and audit failures before execution', async () => {
    const s = setup(), execution = { kill: vi.fn(), autonomousCall: vi.fn(async () => ({ id: 'call' })) }
    const core = new AgentAccessCore(s.port, Date.now, execution as unknown as AgentExecutionCore)
    core.setEnabled(true)
    const read = core.pair('Reader', false), write = core.pair('Caller', true)
    await expect(core.call(read.token, 'wallet_call_autonomous', {})).rejects.toThrow('pairing')
    const args = { policyId: 'p', requestId: 'r', chain: 'monad', contract: 'fixed', function: 'feed', args: ['7'], value: '1' }
    await expect(core.call(write.token, 'wallet_call_autonomous', { ...args, data: '0x' })).rejects.toThrow('Unknown argument')
    expect(await core.call(write.token, 'wallet_call_autonomous', args)).toEqual({ id: 'call' })
    execution.autonomousCall.mockClear(); s.port.record = () => { throw new Error('audit unavailable') }
    await expect(core.call(write.token, 'wallet_call_autonomous', args)).rejects.toThrow('audit')
    expect(execution.autonomousCall).not.toHaveBeenCalled()
  })
  it('exposes x402 only when installed and permitted; direct calls cannot bypass read-only pairing', async () => {
    const s = setup()
    const x402 = { propose: vi.fn(async () => ({ id: 'bounded' })), list: vi.fn(() => []), snapshot: () => ({ limits: [] }), retrieve: vi.fn(), pendingCount: () => 0 }
    const core = new AgentAccessCore(s.port, Date.now, undefined, x402 as unknown as X402Core)
    core.setEnabled(true)
    const reader = core.pair('Reader', false), writer = core.pair('Payments', true)
    expect((await core.call(reader.token, 'tools', {}) as { name: string }[]).some(t => t.name.includes('x402'))).toBe(false)
    for (const name of ['wallet_propose_x402_payment', 'wallet_x402_payments', 'wallet_x402_payment'])
      await expect(core.call(reader.token, name, {})).rejects.toThrow('pairing')
    expect(x402.propose).not.toHaveBeenCalled(); expect(x402.retrieve).not.toHaveBeenCalled()
    expect((await core.call(writer.token, 'tools', {}) as { name: string }[]).filter(t => t.name.includes('x402'))).toHaveLength(3)
    const args = { policyId: 'isolated', requestId: 'one', resourceUrl: 'https://example.com/data', paymentRequired: {} }
    await expect(core.call(writer.token, 'wallet_propose_x402_payment', { ...args, nonce: 'injected' })).rejects.toThrow('Unknown argument')
    expect(await core.call(writer.token, 'wallet_propose_x402_payment', args)).toEqual({ id: 'bounded' })
    expect(x402.propose).toHaveBeenCalledWith(expect.objectContaining({ id: writer.grant.id }), 'isolated', { requestId: 'one', resourceUrl: args.resourceUrl, paymentRequired: {} })
    const legacy = s.pair()
    await expect(s.core.call(legacy.token, 'wallet_propose_x402_payment', args)).rejects.toThrow('Unknown tool')
  })
  it('gates executable tools behind request permission and never exposes approval or policy creation to agents', async () => {
    const s = setup()
    const execution = { kill: vi.fn(), stopClient: vi.fn(), requestApproval: vi.fn(async () => ({ id: 'request' })) }
    const core = new AgentAccessCore(s.port, Date.now, execution as unknown as AgentExecutionCore)
    core.setEnabled(true)
    const read = core.pair('Reader', false), write = core.pair('Requester', true)
    const readTools = await core.call(read.token, 'tools', {}) as { name: string }[]
    expect(readTools.some(t => t.name === 'wallet_request_transaction')).toBe(false)
    await expect(core.call(read.token, 'wallet_request_transaction', {})).rejects.toThrow('pairing')
    expect(execution.requestApproval).not.toHaveBeenCalled()
    const args = { requestId: 'one', chain: 'ethereum', recipient: 'public-address', amount: '0.001' }
    await expect(core.call(write.token, 'wallet_request_transaction', { ...args, data: '0x' })).rejects.toThrow('Unknown argument')
    expect(await core.call(write.token, 'wallet_request_transaction', args)).toEqual({ id: 'request' })
    for (const name of ['wallet_approve', 'wallet_create_policy', 'wallet_recovery', 'wallet_sign']) await expect(core.call(write.token, name, {})).rejects.toThrow('Unknown tool')
    core.revoke(write.grant.id)
    expect(execution.stopClient).toHaveBeenCalledWith(write.grant.id)
    core.setEnabled(false); expect(execution.kill).toHaveBeenCalled()
  })
  it('defaults off and pairs only in an available unlocked context', () => {
    const s = setup()
    s.core.setEnabled(false)
    expect(() => s.pair()).toThrow()
    s.core.setEnabled(true); s.setContext(null)
    expect(() => s.pair()).toThrow()
  })
  it('denies absent, forged and revoked tokens without calling a read port', async () => {
    const s = setup(), p = s.pair()
    for (const token of ['', 'x'.repeat(64), 'a'.repeat(64)]) await expect(s.core.call(token, 'wallet_addresses', {})).rejects.toThrow()
    expect(s.port.addresses).not.toHaveBeenCalled()
    s.core.revoke(p.grant.id)
    await expect(s.core.call(p.token, 'wallet_addresses', {})).rejects.toThrow()
  })
  it('denies lock, account replacement and environment changes', async () => {
    const s = setup(), p = s.pair()
    for (const context of [null, { key: 'other-wallet', accountIndex: 0, environment: 'mainnet' }, { key: 'testnet', accountIndex: 0, environment: 'testnet' }]) {
      s.setContext(context)
      await expect(s.core.call(p.token, 'wallet_balances', {})).rejects.toThrow()
    }
    expect(s.port.balances).not.toHaveBeenCalled()
  })
  it('does not expose credentials through snapshots or results', async () => {
    const s = setup(), p = s.pair()
    const snapshot = JSON.stringify(s.core.snapshot())
    expect(snapshot).not.toContain(p.token)
    expect(snapshot).not.toContain('hash')
    const result = await s.core.call(p.token, 'wallet_addresses', {})
    expect(result).toEqual({ evm: 'public' })
  })
  it('has no signing, unlock, generic IPC, arbitrary URL or approval-decision tool', async () => {
    const s = setup(), p = s.pair()
    for (const tool of ['wallet_send', 'wallet_unlock', 'wallet_sign', 'swap:execute', 'wallet_approve', 'fetch'])
      await expect(s.core.call(p.token, tool, {})).rejects.toThrow('Unknown tool')
    await expect(s.core.call(p.token, 'wallet_addresses', { mnemonic: true })).rejects.toThrow('Unknown argument')
  })
  it('enforces read-only permissions even when a client bypasses tools/list', async () => {
    const s = setup(), p = s.pair(false)
    const tools = await s.core.call(p.token, 'tools', {}) as Array<{ name: string }>
    expect(tools.some(t => t.name === 'wallet_propose_transfer')).toBe(false)
    await expect(s.core.call(p.token, 'wallet_propose_transfer', s.args)).rejects.toThrow('read-only')
    expect(s.port.transfer).not.toHaveBeenCalled()
  })
  it('expires grants and proposals, invalidates restart credentials and disabling clears access', async () => {
    const s = setup(), p = s.pair()
    const proposal = await s.core.call(p.token, 'wallet_propose_transfer', s.args) as { id: string }
    s.advance(10 * 60_000)
    await expect(s.core.review(proposal.id, 'open')).rejects.toThrow()
    expect(s.core.snapshot().proposals[0].state).toBe('expired')
    s.advance(8 * 60 * 60_000)
    await expect(s.core.call(p.token, 'wallet_addresses', {})).rejects.toThrow()
    const fresh = setup()
    await expect(fresh.core.call(p.token, 'wallet_addresses', {})).rejects.toThrow()
    const next = fresh.pair(); fresh.core.setEnabled(false)
    await expect(fresh.core.call(next.token, 'wallet_addresses', {})).rejects.toThrow()
  })
  it('deduplicates retries, including concurrent requests and retries after review', async () => {
    const s = setup(), p = s.pair()
    const [a, b] = await Promise.all([s.core.call(p.token, 'wallet_propose_transfer', s.args), s.core.call(p.token, 'wallet_propose_transfer', s.args)]) as Array<{ id: string }>
    expect(a.id).toBe(b.id)
    expect(s.core.snapshot().proposals).toHaveLength(1)
    await s.core.review(a.id, 'open')
    expect(await s.core.call(p.token, 'wallet_propose_transfer', s.args)).toMatchObject({ id: a.id, state: 'opened' })
    await expect(s.core.call(p.token, 'wallet_propose_transfer', { ...s.args, amount: '2' })).rejects.toThrow('different proposal')
    await expect(s.core.review(a.id, 'open')).rejects.toThrow()
  })
  it('isolates proposals and quote ids per agent and clones draft data', async () => {
    const s = setup(), a = s.pair(), b = s.pair()
    const quote = await s.core.call(a.token, 'wallet_quote', { fromChain: 'base', toChain: 'base', fromToken: 'a', toToken: 'b', sellAmountRaw: '1', slippageBps: 50 }) as { quoteId: string }
    await expect(s.core.call(b.token, 'wallet_propose_swap', { requestId: 'b', quoteId: quote.quoteId })).rejects.toThrow()
    const proposal = await s.core.call(a.token, 'wallet_propose_swap', { requestId: 'a', quoteId: quote.quoteId }) as { draft: { swap: { amount: string } } }
    proposal.draft.swap.amount = '999'
    expect(JSON.stringify(await s.core.call(a.token, 'wallet_proposals', {}))).not.toContain('999')
    expect(await s.core.call(b.token, 'wallet_proposals', {})).toEqual([])
  })
  it('discards late read results and late proposals after revoke or account changes', async () => {
    const s = setup(), p = s.pair()
    let finish!: (value: unknown) => void
    s.port.balances = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const read = s.core.call(p.token, 'wallet_balances', {})
    s.core.revoke(p.grant.id); finish({ privateAccount: true })
    await expect(read).rejects.toThrow()
    const next = s.pair()
    let complete!: (value: any) => void
    s.port.transfer = vi.fn(() => new Promise<Awaited<ReturnType<AgentReadPort['transfer']>>>(resolve => { complete = resolve }))
    const pending = s.core.call(next.token, 'wallet_propose_transfer', s.args)
    s.setContext({ key: 'other', accountIndex: 1, environment: 'mainnet' })
    complete({ kind: 'transfer' })
    await expect(pending).rejects.toThrow()
    expect(s.core.snapshot().proposals).toHaveLength(0)
  })
  it('rechecks authorization after async balance validation and before an adopted form signs', async () => {
    const s = setup(), p = s.pair()
    const first = await s.core.call(p.token, 'wallet_propose_transfer', s.args) as { id: string }
    let finish!: (value: string) => void
    s.port.balance = vi.fn(() => new Promise<string>(resolve => { finish = resolve }))
    const review = s.core.review(first.id, 'open')
    s.core.revoke(p.grant.id); finish('3')
    await expect(review).rejects.toThrow()
    const next = s.pair()
    s.port.balance = vi.fn(async () => '3')
    const second = await s.core.call(next.token, 'wallet_propose_transfer', s.args) as { id: string }
    await s.core.review(second.id, 'open')
    expect(() => s.core.checkReview(second.id)).not.toThrow()
    s.setContext(null)
    expect(() => s.core.checkReview(second.id)).toThrow()
  })
  it('bounds request rate and in-flight provider work', async () => {
    const s = setup(), p = s.pair()
    let release!: () => void
    const wait = new Promise<void>(resolve => { release = resolve })
    s.port.balances = vi.fn(async () => { await wait; return {} })
    const a = s.core.call(p.token, 'wallet_balances', {}), b = s.core.call(p.token, 'wallet_balances', {})
    await expect(s.core.call(p.token, 'wallet_balances', {})).rejects.toThrow('busy')
    release(); await Promise.all([a, b])
    for (let i = 0; i < 18; i++) await s.core.call(p.token, 'wallet_addresses', {})
    await expect(s.core.call(p.token, 'wallet_addresses', {})).rejects.toThrow('rate limit')
    s.advance(60_000)
    await expect(s.core.call(p.token, 'wallet_addresses', {})).resolves.toEqual({ evm: 'public' })
  })
  it('fails closed on audit storage failure and never logs request arguments or token', async () => {
    const s = setup(), p = s.pair()
    await s.core.call(p.token, 'wallet_propose_transfer', s.args)
    const logs = JSON.stringify(vi.mocked(s.port.record).mock.calls)
    expect(logs).not.toContain(p.token); expect(logs).not.toContain('0xrecipient')
    s.port.record = () => { throw new Error('Disk full') }
    await expect(s.core.call(p.token, 'wallet_addresses', {})).rejects.toThrow()
  })
})
