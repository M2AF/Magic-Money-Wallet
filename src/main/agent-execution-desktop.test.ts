import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { keccak256, parseTransaction, recoverTransactionAddress, type TransactionSerialized } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { getEvmPrivateKey } from './wallet-core'
import type { AgentExecutionAuth, AgentExecutionOwner, AgentTransaction } from '../shared/agent-execution'

const mocks = vi.hoisted(() => ({ profile: '', rpc: {} as Record<string, any>, encryption: true }))
vi.mock('electron', () => ({ app: { getPath: () => mocks.profile }, safeStorage: {
  isEncryptionAvailable: () => mocks.encryption,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: (s: string) => Buffer.from(`sealed:${s}`),
  decryptString: (b: Buffer) => { const s = b.toString(); if (!s.startsWith('sealed:')) throw new Error('Invalid seal'); return s.slice(7) },
} }))
vi.mock('./secure-store', () => ({ loadConfig: () => ({}), loadMnemonic: () => 'test test test test test test test test test test test junk' }))
vi.mock('./tx-sender', () => ({ evmReadClient: () => mocks.rpc }))
import { createAgentExecution } from './agent-execution-desktop'
import { EMOGOTCHI, EMOGOTCHI_CODE_HASH } from './agent-emogotchi'

const TO = '0x3333333333333333333333333333333333333333'
let owner: AgentExecutionOwner
let auth: AgentExecutionAuth
let submittedRaw: TransactionSerialized | undefined
beforeEach(async () => {
  mocks.profile = mkdtempSync(join(tmpdir(), 'mm-agent-signer-')); mocks.encryption = true
  submittedRaw = undefined
  owner = { context: 'public-fixture', accountIndex: 0, chainId: 11155111,
    address: privateKeyToAccount(await getEvmPrivateKey('test test test test test test test test test test test junk', 0)).address }
  auth = { id: 'agent', name: 'Fixture assistant', context: owner.context, accountIndex: 0, environment: 'testnet', expiresAt: Date.now() + 3600_000 }
  mocks.rpc = {
    getChainId: vi.fn(async () => 11155111), getCode: vi.fn(async () => '0x'), getTransactionCount: vi.fn(async () => 0),
    getBalance: vi.fn(async () => 100n * 10n ** 18n), getGasPrice: vi.fn(async () => 1000000000n), estimateGas: vi.fn(async () => 21000n), call: vi.fn(async () => ({ data: '0x' })),
    request: vi.fn(async (request: any) => {
      expect(request.method).toBe('eth_sendRawTransaction')
      submittedRaw = request.params[0]
      const journal = readFileSync(join(mocks.profile, 'agent-access/execution.enc.json'), 'utf8')
      // The real signature and derivation run; network submission is intercepted here.
      expect(journal).not.toContain(submittedRaw)
      return keccak256(submittedRaw!)
    }),
  }
})
afterEach(() => {
  expect(mocks.profile.startsWith(join(tmpdir(), 'mm-agent-signer-'))).toBe(true)
  rmSync(mocks.profile, { recursive: true, force: true })
})
const engine = () => createAgentExecution(() => owner, id => { if (id !== auth.id) throw new Error('denied'); return auth })
async function prepare() {
  const core = engine()
  const tx = await core.requestApproval(auth, { requestId: 'signature-fixture', chain: 'ethereum', recipient: TO, amount: '0.001' })
  return { core, tx: await core.prepare(tx.id) }
}
describe('desktop native signing with a public fixture seed and offline RPC', () => {
  async function monadPolicy() {
    owner.chainId = 1; auth.environment = 'mainnet'
    mocks.rpc.getChainId.mockResolvedValue(143)
    mocks.rpc.getBalance.mockResolvedValue(0n)
    const core = engine(), policy = await core.createPolicy(auth, { clientId: auth.id, chain: 'monad', recipients: [TO],
      perSend: '1.2', daily: '3', total: '5', maxFee: '0.1', minutes: 60, emogotchiTokenIds: ['7'] })
    const code = JSON.parse(readFileSync(join(__dirname, '__fixtures__/emogotchi-runtime.json'), 'utf8')).runtimeBytecode
    expect(keccak256(code)).toBe(EMOGOTCHI_CODE_HASH)
    mocks.rpc.getBalance.mockResolvedValue(5n * 10n ** 18n)
    mocks.rpc.getCode.mockImplementation(async ({ address }: { address: string }) => address === EMOGOTCHI ? code : '0x')
    mocks.rpc.estimateGas.mockImplementation(async ({ data }: { data?: string }) => data ? 300000n : 21000n)
    mocks.rpc.readContract = vi.fn(async () => policy.address)
    return { core, policy }
  }
  it('signs native MON with chain143 and no calldata, including owner-approved and isolated recovery sends', async () => {
    const { core, policy } = await monadPolicy()
    const tx = await core.requestApproval(auth, { requestId: 'monad-native', chain: 'monad', recipient: TO, amount: '0.1' })
    const prepared = await core.prepare(tx.id)
    expect((await core.approve(tx.id, prepared.plan!.reviewId)).state).toBe('submitted')
    expect(parseTransaction(submittedRaw!)).toMatchObject({ chainId: 143, to: TO, value: 10n ** 17n, gas: 21000n })
    const recovery = await core.recovery(policy.id, TO, '1')
    expect((await core.approve(recovery.id, recovery.plan!.reviewId)).state).toBe('submitted')
    expect(await recoverTransactionAddress({ serializedTransaction: submittedRaw! })).toBe(policy.address)
  })
  it('blocks the contract receive fallback through native MON sending even when its address is allowlisted', async () => {
    const { core } = await monadPolicy()
    const tx = await core.requestApproval(auth, { requestId: 'fallback-bypass', chain: 'monad', recipient: EMOGOTCHI, amount: '1000' })
    await expect(core.prepare(tx.id)).rejects.toThrow('plain native')
    expect(mocks.rpc.request).not.toHaveBeenCalled()
  })
  it('signs and broadcasts nonpayable pet with an RLP zero value, without treating an omitted decoded zero as a mismatch', async () => {
    const { core, policy } = await monadPolicy()
    const sent = await core.autonomousCall(auth, { policyId: policy.id, requestId: 'pet-zero', chain: 'monad', contract: EMOGOTCHI, function: 'pet', args: ['7', '2'], value: '0' })
    expect(sent.state).toBe('submitted'); expect(sent.valueRaw).toBe('0')
    const decoded = parseTransaction(submittedRaw!)
    expect(decoded.value ?? 0n).toBe(0n); expect(decoded.data).toBe(sent.call!.data)
  })
  it('signs exact Emogotchi calldata/value from the isolated key and checks receipt calldata and gas limit', async () => {
    const { core, policy } = await monadPolicy()
    const sent = await core.autonomousCall(auth, { policyId: policy.id, requestId: 'feed', chain: 'monad', contract: EMOGOTCHI, function: 'feed', args: ['7'], value: '1' })
    expect(sent.state).toBe('submitted')
    const decoded = parseTransaction(submittedRaw!)
    expect(decoded).toMatchObject({ chainId: 143, to: EMOGOTCHI.toLowerCase(), value: 10n ** 18n, gas: 300000n, data: sent.call!.data })
    expect(await recoverTransactionAddress({ serializedTransaction: submittedRaw! })).toBe(policy.address)
    mocks.rpc.getTransactionReceipt = vi.fn(async () => ({ transactionHash: sent.txHash, blockNumber: 100n, blockHash: '0xblock', gasUsed: 250000n, effectiveGasPrice: 1000000000n, status: 'success' }))
    const transaction = { from: policy.address, to: EMOGOTCHI, value: 10n ** 18n, nonce: 0, chainId: 143, gas: 300000n, input: sent.call!.data }
    mocks.rpc.getTransaction = vi.fn(async () => transaction)
    mocks.rpc.getBlockNumber = vi.fn(async () => 103n)
    mocks.rpc.getBlock = vi.fn(async () => ({ number: 100n, hash: '0xblock' }))
    expect((await core.status(sent.id, auth)).state).toBe('confirmed')
    mocks.rpc.getTransaction.mockResolvedValue({ ...transaction, input: '0xdeadbeef' })
    expect((await core.status(sent.id, auth)).state).toBe('unknown')
    mocks.rpc.getTransaction.mockResolvedValue({ ...transaction, gas: 500000n })
    expect((await core.status(sent.id, auth)).state).toBe('unknown')
  })
  it.each(['code', 'ownership', 'simulation', 'gas', 'delegated-source', 'fee-drift', 'code-drift'] as const)('denies unsafe Monad %s before broadcasting', async fault => {
    const { core, policy } = await monadPolicy()
    const code = mocks.rpc.getCode.getMockImplementation()!
    if (fault === 'code') mocks.rpc.getCode.mockImplementation(async ({ address }: { address: string }) => address === EMOGOTCHI ? '0x6000' : '0x')
    if (fault === 'ownership') mocks.rpc.readContract.mockResolvedValue(owner.address)
    if (fault === 'simulation') mocks.rpc.call.mockRejectedValue(new Error('NotAlive'))
    if (fault === 'gas') mocks.rpc.estimateGas.mockResolvedValue(6000000n)
    if (fault === 'delegated-source') mocks.rpc.getCode.mockImplementation(async ({ address }: { address: string }) => address === policy.address ? '0xef0100abcd' : code({ address }))
    if (fault === 'fee-drift') mocks.rpc.getGasPrice.mockResolvedValueOnce(1000000000n).mockResolvedValue(2000000000n)
    if (fault === 'code-drift') {
      let contractReads = 0
      mocks.rpc.getCode.mockImplementation(async ({ address }: { address: string }) => address === EMOGOTCHI && ++contractReads > 1 ? '0x6000' : code({ address }))
    }
    const action = core.autonomousCall(auth, { policyId: policy.id, requestId: 'bad', chain: 'monad', contract: EMOGOTCHI, function: 'feed', args: ['7'], value: '1' })
    if (fault === 'fee-drift' || fault === 'code-drift') expect((await action).state).toBe('failed')
    else await expect(action).rejects.toThrow()
    expect(mocks.rpc.request).not.toHaveBeenCalled()
  })
  it('derives, signs, verifies, hashes and journals the exact approved transaction', async () => {
    const { core, tx } = await prepare()
    expect(mocks.rpc.request).not.toHaveBeenCalled()
    const result = await core.approve(tx.id, tx.plan!.reviewId)
    expect(result.state).toBe('submitted'); expect(submittedRaw).toBeTruthy()
    const decoded = parseTransaction(submittedRaw!)
    expect(decoded).toMatchObject({ chainId: 11155111, nonce: 0, to: TO, value: 1000000000000000n, gas: 21000n, gasPrice: 1000000000n, type: 'legacy' })
    expect(await recoverTransactionAddress({ serializedTransaction: submittedRaw! })).toBe(owner.address)
    expect(result.txHash).toBe(keccak256(submittedRaw!))
    const wire = JSON.stringify(result)
    expect(wire).not.toContain(submittedRaw); expect(wire).not.toMatch(/privateKey|mnemonic|sealed/)
    const saved = JSON.parse(readFileSync(join(mocks.profile, 'agent-access/execution.enc.json'), 'utf8'))
    expect(Object.keys(saved).sort()).toEqual(['sealed', 'version'])
    expect(readFileSync(join(mocks.profile, 'agent-access/execution.enc.json'), 'utf8')).not.toContain(result.txHash)
    await core.approve(tx.id, tx.plan!.reviewId)
    expect(mocks.rpc.request).toHaveBeenCalledTimes(1)
  })
  it.each(['nonce', 'fee'] as const)('stops before submission if %s changes after review', async kind => {
    const { core, tx } = await prepare()
    if (kind === 'nonce') mocks.rpc.getTransactionCount.mockResolvedValue(1)
    else mocks.rpc.getGasPrice.mockResolvedValue(2000000000n)
    expect((await core.approve(tx.id, tx.plan!.reviewId)).state).toBe('failed')
    expect(mocks.rpc.request).not.toHaveBeenCalled()
  })
  it.each(['contract-recipient', 'delegated-source', 'wrong-chain', 'insufficient-funds', 'simulation-revert'] as const)('rejects %s', async kind => {
    if (kind === 'contract-recipient') mocks.rpc.getCode.mockImplementation(async ({ address }: { address: string }) => address === TO ? '0x6000' : '0x')
    if (kind === 'delegated-source') mocks.rpc.getCode.mockResolvedValue('0xef0100abcd')
    if (kind === 'wrong-chain') mocks.rpc.getChainId.mockResolvedValue(1)
    if (kind === 'insufficient-funds') mocks.rpc.getBalance.mockResolvedValue(1n)
    if (kind === 'simulation-revert') mocks.rpc.call.mockRejectedValue(new Error('revert'))
    await expect(prepare()).rejects.toThrow()
    expect(mocks.rpc.request).not.toHaveBeenCalled()
  })
  it('does not replace an unreadable sealed journal', () => {
    const core = engine(); core.snapshot()
    const path = join(mocks.profile, 'agent-access/execution.enc.json')
    writeFileSync(path, '{"version":1,"sealed":"damaged"}')
    expect(() => engine().snapshot()).toThrow('authenticated')
    expect(readFileSync(path, 'utf8')).toBe('{"version":1,"sealed":"damaged"}')
  })
  it('requires OS secure storage', () => {
    mocks.encryption = false
    expect(() => engine().snapshot()).toThrow('OS secure storage')
    expect(mocks.rpc.request).not.toHaveBeenCalled()
  })
  it('rejects an empty-object journal rather than resetting accounts and budgets', () => {
    engine().snapshot()
    const path = join(mocks.profile, 'agent-access/execution.enc.json')
    writeFileSync(path, '{}')
    expect(() => engine().snapshot()).toThrow('invalid')
    expect(readFileSync(path, 'utf8')).toBe('{}')
  })
  it('reconciles canonical receipt identity, confirmations and finality', async () => {
    const { core, tx } = await prepare(), sent = await core.approve(tx.id, tx.plan!.reviewId)
    mocks.rpc.getTransactionReceipt = vi.fn(async () => ({ transactionHash: sent.txHash, blockNumber: 100n, blockHash: '0xblock', gasUsed: 21000n, effectiveGasPrice: 1000000000n, status: 'success' }))
    mocks.rpc.getTransaction = vi.fn(async () => ({ hash: sent.txHash, from: owner.address, to: TO, value: 1000000000000000n, nonce: 0, chainId: 11155111 }))
    mocks.rpc.getBlockNumber = vi.fn(async () => 102n)
    mocks.rpc.getBlock = vi.fn(async ({ blockTag }: { blockTag?: string }) => blockTag === 'finalized' ? { number: 99n } : { number: 100n, hash: '0xblock' })
    const included = await core.status(tx.id, auth)
    expect(included.state).toBe('confirmed'); expect(included.confirmations).toBe(3); expect(included.finalized).toBe(false)
    mocks.rpc.getBlock.mockResolvedValue({ number: 100n, hash: '0xblock' })
    expect((await core.status(tx.id, auth)).finalized).toBe(true)
    mocks.rpc.getTransaction.mockResolvedValue({ from: owner.address, to: owner.address, value: 1000000000000000n, nonce: 0, chainId: 11155111 })
    expect((await core.status(tx.id, auth)).state).toBe('unknown')
  })
})
