import { describe, expect, it, vi } from 'vitest'
import { decodeFunctionData } from 'viem'
import { AgentExecutionCore, type AgentExecutionLedger, type AgentExecutionPort } from './agent-execution-core'
import { emogotchiCall, EMOGOTCHI, EMOGOTCHI_ABI, MAX_AGENT_CALL_GAS } from './agent-emogotchi'
import type { AgentExecutionAuth, AgentExecutionOwner, AgentPolicyInput } from '../shared/agent-execution'

const MAIN = '0x1111111111111111111111111111111111111111', FROM = '0x2222222222222222222222222222222222222222'
const TO = '0x3333333333333333333333333333333333333333'
function setup() {
  let now = 100_000, active = true, owner: AgentExecutionOwner | null = { context: 'mainnet', accountIndex: 0, address: MAIN, chainId: 1 }
  let saved: AgentExecutionLedger = { version: 1, nextAccountIndex: 1000, policies: [], transactions: [] }
  const auth: AgentExecutionAuth = { id: 'agent', name: 'Assistant', accountIndex: 0, context: 'mainnet', environment: 'mainnet', expiresAt: now + 3600_000 }
  const port: AgentExecutionPort = {
    owner: () => owner, authorize: () => { if (!active) throw new Error('revoked'); return auth },
    load: () => structuredClone(saved), save: vi.fn(state => { saved = structuredClone(state) }),
    address: vi.fn(async () => FROM), unused: vi.fn(async () => true),
    prepare: vi.fn(async tx => {
      const gas = tx.call ? 300_000n : 21000n, fee = gas * 100_000_000_000n
      return { chainId: tx.chainId, network: tx.network, from: tx.from, to: tx.recipient, valueRaw: tx.valueRaw, gas: gas.toString(),
        gasPriceRaw: '100000000000', maxFeeRaw: fee.toString(), totalRaw: (BigInt(tx.valueRaw) + fee).toString(),
        nonce: saved.transactions.filter(t => t.chainId === tx.chainId && t.txHash).length, ...(tx.call ? { data: tx.call.data } : {}) }
    }),
    sign: vi.fn(async () => ({ hash: `0x${saved.transactions.length.toString(16).padStart(64, '0')}`, raw: '0xabcd' })),
    broadcast: vi.fn(async () => { const tx = saved.transactions.at(-1)!; expect(tx.state).toBe('unknown'); return tx.txHash! }),
    receipt: vi.fn(async () => ({ state: 'confirmed' as const, confirmations: 4, finalized: false })),
  }
  const core = new AgentExecutionCore(port, () => now)
  const input: AgentPolicyInput = { clientId: auth.id, chain: 'monad', recipients: [TO], emogotchiTokenIds: ['7'], perSend: '1.1', daily: '2.1', total: '3.1', maxFee: '0.1', minutes: 60 }
  const args = { requestId: 'care-1', chain: 'monad', contract: EMOGOTCHI, function: 'feed', args: ['7'], value: '1' }
  return { core, port, auth, input, args, saved: () => saved, restart: () => new AgentExecutionCore(port, () => now),
    stop: () => core.kill(), revoke: () => { active = false }, lock: () => { owner = null }, advance: () => { now += 3600_001 },
    testnet: () => { owner = { ...owner!, chainId: 11155111 } } }
}
describe('Monad native transfers and fixed Emogotchi calls', () => {
  it('approves MON from the main account with chain/hash/receipt tracking and chain-bound request IDs', async () => {
    const s = setup(), args = { requestId: 'mon', chain: 'monad', recipient: TO, amount: '1' }
    const tx = await s.core.requestApproval(s.auth, args), prepared = await s.core.prepare(tx.id)
    expect(prepared.chainId).toBe(143); expect(prepared.from).toBe(MAIN); expect(s.port.sign).not.toHaveBeenCalled()
    const sent = await s.core.approve(tx.id, prepared.plan!.reviewId)
    expect(sent.explorerUrl).toContain('https://monadscan.com/tx/'); expect((await s.core.status(tx.id, s.auth)).state).toBe('confirmed')
    expect((await s.core.requestApproval(s.auth, args)).id).toBe(tx.id)
    await expect(s.core.requestApproval(s.auth, { ...args, chain: 'ethereum' })).rejects.toThrow('different')
  })
  it('uses one chain-specific MON budget for native sends, contract values and all maximum fees', async () => {
    const s = setup(), p = await s.core.createPolicy(s.auth, s.input)
    expect(s.port.unused).toHaveBeenCalledWith(FROM, 143)
    const send = await s.core.autonomous(s.auth, { policyId: p.id, requestId: 'native', chain: 'monad', recipient: TO, amount: '1' })
    await s.core.status(send.id, s.auth)
    const care = await s.core.autonomousCall(s.auth, { ...s.args, policyId: p.id })
    expect(care.from).toBe(FROM); expect(care.call?.function).toBe('feed'); expect(care.valueRaw).toBe('1000000000000000000')
    await s.core.status(care.id, s.auth)
    await expect(s.core.autonomousCall(s.auth, { ...s.args, policyId: p.id, requestId: 'over-daily' })).rejects.toThrow('Spending limit')
    expect(s.port.broadcast).toHaveBeenCalledTimes(2)
  })
  it('permits contract-only policies and zero-value pet calls, while ordinary zero-value sends remain denied', async () => {
    const s = setup(), p = await s.core.createPolicy(s.auth, { ...s.input, recipients: [] })
    const sent = await s.core.autonomousCall(s.auth, { ...s.args, policyId: p.id, function: 'pet', args: ['7', '20'], value: '0' })
    expect(sent.valueRaw).toBe('0'); expect(sent.plan!.totalRaw).toBe('30000000000000000')
    await expect(s.core.autonomous(s.auth, { policyId: p.id, requestId: 'zero', chain: 'monad', recipient: TO, amount: '0' })).rejects.toThrow()
  })
  it('does not enable calls on an ordinary MON policy or Ethereum policy', async () => {
    const s = setup(), p = await s.core.createPolicy(s.auth, { ...s.input, emogotchiTokenIds: undefined })
    await expect(s.core.autonomousCall(s.auth, { ...s.args, policyId: p.id })).rejects.toThrow('Token ID')
    await expect(s.core.createPolicy(s.auth, { ...s.input, chain: 'ethereum' })).rejects.toThrow('Monad')
    expect(s.port.sign).not.toHaveBeenCalled()
  })
  it.each(['contract', 'function', 'args', 'value', 'chain', 'policyId'] as const)('rejects altered %s without signing', async field => {
    const s = setup(), p = await s.core.createPolicy(s.auth, s.input)
    const bad: Record<string, unknown> = { ...s.args, policyId: p.id }
    bad[field] = { contract: TO, function: 'revive', args: ['8'], value: '2', chain: 'ethereum', policyId: 'another-policy' }[field]
    await expect(s.core.autonomousCall(s.auth, bad)).rejects.toThrow(); expect(s.port.sign).not.toHaveBeenCalled()
  })
  it('returns the same contract request/hash and refuses changes to the function or token arguments under its ID', async () => {
    const s = setup(), p = await s.core.createPolicy(s.auth, s.input), args = { ...s.args, policyId: p.id }
    const sent = await s.core.autonomousCall(s.auth, args)
    expect((await s.core.autonomousCall(s.auth, args)).txHash).toBe(sent.txHash)
    for (const change of [{ function: 'wash' }, { function: 'pet', args: ['7', '1'], value: '0' }])
      await expect(s.core.autonomousCall(s.auth, { ...args, ...change })).rejects.toThrow('different')
    expect(s.port.sign).toHaveBeenCalledTimes(1)
  })
  it.each(['stop', 'revoke', 'lock', 'advance', 'testnet'] as const)('blocks %s during contract signing before broadcast and retains the reservation', async action => {
    const s = setup(), p = await s.core.createPolicy(s.auth, s.input)
    s.port.sign = async () => { s[action](); return { hash: `0x${'ab'.repeat(32)}`, raw: '0xabcd' } }
    expect((await s.core.autonomousCall(s.auth, { ...s.args, policyId: p.id })).state).toBe('failed')
    expect(s.port.broadcast).not.toHaveBeenCalled(); expect(s.saved().transactions[0].reservedAt).not.toBeNull()
  })
  it('rejects changed calldata or excessive gas from a preparation port', async () => {
    for (const change of [{ data: '0xdeadbeef' }, { gas: (MAX_AGENT_CALL_GAS + 1n).toString() }]) {
      const s = setup(), p = await s.core.createPolicy(s.auth, s.input), prepare = s.port.prepare
      s.port.prepare = async tx => ({ ...await prepare(tx), ...change })
      await expect(s.core.autonomousCall(s.auth, { ...s.args, policyId: p.id })).rejects.toThrow('preparation')
      expect(s.port.sign).not.toHaveBeenCalled()
    }
  })
  it('keeps MON recovery after revocation on Monad and stops policies on restart', async () => {
    const s = setup(), p = await s.core.createPolicy(s.auth, s.input)
    s.revoke()
    const recovery = await s.core.recovery(p.id, MAIN, '1')
    expect(recovery.chainId).toBe(143); expect(recovery.call).toBeUndefined()
    expect((await s.core.approve(recovery.id, recovery.plan!.reviewId)).state).toBe('submitted')
    expect(s.restart().snapshot().policies[0].active).toBe(false)
  })
  it('blocks Monad mainnet in Testnet Mode for sends and policy creation', async () => {
    const s = setup(); s.testnet()
    await expect(s.core.createPolicy(s.auth, s.input)).rejects.toThrow('Testnet')
    await expect(s.core.requestApproval(s.auth, { requestId: 'mainnet', chain: 'monad', recipient: TO, amount: '1' })).rejects.toThrow('Testnet')
  })
  it.each(['perSend', 'maxFee'] as const)('enforces contract %s with the full gas limit charged', async cap => {
    const s = setup(), input = { ...s.input, [cap]: cap === 'perSend' ? '1.01' : '0.01' }
    const p = await s.core.createPolicy(s.auth, input)
    await expect(s.core.autonomousCall(s.auth, { ...s.args, policyId: p.id })).rejects.toThrow('Spending limit')
    expect(s.port.sign).not.toHaveBeenCalled()
  })
  it('retains an uncertain Monad call hash/reservation and never re-signs it', async () => {
    const s = setup(), p = await s.core.createPolicy(s.auth, s.input), args = { ...s.args, policyId: p.id }
    s.port.broadcast = async () => { throw new Error('timeout') }
    const uncertain = await s.core.autonomousCall(s.auth, args)
    expect(uncertain.state).toBe('unknown'); expect(uncertain.txHash).toBeTruthy()
    expect((await s.core.autonomousCall(s.auth, args)).txHash).toBe(uncertain.txHash)
    expect(s.port.sign).toHaveBeenCalledTimes(1)
    const restarted = s.restart(); expect(restarted.snapshot().transactions[0].txHash).toBe(uncertain.txHash)
  })
})
describe('Emogotchi closed ABI', () => {
  it.each(['feed', 'wash', 'play', 'sleep', 'clean'])('encodes the exact %s selector and uint256 ID without caller-supplied calldata', name => {
    const checked = emogotchiCall(EMOGOTCHI, name, ['7'], '1')
    expect(decodeFunctionData({ abi: EMOGOTCHI_ABI, data: checked.call.data as `0x${string}` })).toEqual({ functionName: name, args: [7n] })
    expect(checked.valueRaw).toBe('1000000000000000000')
  })
  it.each([
    ['revive', ['7'], '1'], ['setName', ['7', 'name'], '1'], ['approve', ['7'], '0'], ['care', ['7'], '1'],
    ['feed', [7], '1'], ['feed', ['07'], '1'], ['feed', ['7', '8'], '1'], ['feed', ['7'], '0'],
    ['pet', ['7', '21'], '0'], ['pet', ['7', '0'], '0'], ['pet', ['7', '1'], '1'], ['pet', ['7', '1e2'], '0'],
  ])('rejects unsupported %s input %j/value%s', (name, args, value) => {
    expect(() => emogotchiCall(EMOGOTCHI, name, args, value)).toThrow()
  })
})
