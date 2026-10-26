import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashDomain, recoverTypedDataAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { getEvmPrivateKey } from './wallet-core'
import type { AgentExecutionAuth, AgentSpendingPolicy } from '../shared/agent-execution'
import { x402Fixture } from './x402-fixtures'
const mocks = vi.hoisted(() => ({ profile: '', rpc: {} as Record<string, any>, secure: true }))
vi.mock('electron', () => ({ app: { getPath: () => mocks.profile }, safeStorage: {
  isEncryptionAvailable: () => mocks.secure, getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: (v: string) => Buffer.from(`sealed:${v}`), decryptString: (v: Buffer) => { if (!v.toString().startsWith('sealed:')) throw new Error('seal'); return v.toString().slice(7) },
} }))
vi.mock('./secure-store', () => ({ loadConfig: () => ({}), loadMnemonic: () => 'test test test test test test test test test test test junk' }))
vi.mock('./tx-sender', () => ({ evmReadClient: () => mocks.rpc }))
import { createDesktopX402, x402TypedData } from './x402-desktop'
let auth: AgentExecutionAuth, account: AgentSpendingPolicy
beforeEach(async () => {
  mocks.profile = mkdtempSync(join(tmpdir(), 'mm-x402-signer-')); mocks.secure = true
  auth = { id: 'agent', name: 'Assistant', context: 'testnet', accountIndex: 0, environment: 'testnet', expiresAt: Date.now() + 3600_000 }
  const from = privateKeyToAccount(await getEvmPrivateKey('test test test test test test test test test test test junk', 1000)).address
  account = { id: 'isolated', clientId: auth.id, clientName: auth.name, context: auth.context, ownerAddress: '0x1111111111111111111111111111111111111111', accountIndex: 1000,
    address: from, chainId: 11155111, network: 'Sepolia', recipients: ['0x3333333333333333333333333333333333333333'], perSendRaw: '1', dailyRaw: '2', totalRaw: '3', maxFeeRaw: '1', createdAt: Date.now(), expiresAt: auth.expiresAt, active: true, stoppedReason: null }
  const domain = { name: 'USDC', version: '2', chainId: 84532n, verifyingContract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const }
  const separator = hashDomain({ domain, types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }] } })
  mocks.rpc = {
    getChainId: vi.fn(async () => 84532), getCode: vi.fn(async () => '0x'),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => ({ DOMAIN_SEPARATOR: separator, decimals: 6, balanceOf: 100000000n, authorizationState: false })[functionName]),
    call: vi.fn(async () => ({ data: `0x${'0'.repeat(63)}1` })), request: vi.fn(),
  }
})
afterEach(() => {
  expect(mocks.profile.startsWith(join(tmpdir(), 'mm-x402-signer-'))).toBe(true)
  rmSync(mocks.profile, { recursive: true, force: true })
})
const engine = () => createDesktopX402({ enabled: () => true, context: () => auth.context, authorize: id => { if (id !== auth.id) throw new Error('grant'); return auth },
  account: (_auth, id) => { if (!account.active || id !== account.id) throw new Error('stopped'); return account }, audit: vi.fn() })
async function signFixture() {
  const core = engine(), args = x402Fixture()
  await core.configure(auth, { policyId: account.id, resourceUrls: [args.resourceUrl], perPayment: '0.1', daily: '1', total: '2' })
  const view = await core.propose(auth, account.id, args)
  return { core, view, args }
}
describe('fixed desktop EIP-3009 signing with offline USDC reads', () => {
  it('signs the exact typed fields with the existing isolated-account key, and never exposes the signature to UI', async () => {
    const { core, view, args } = await signFixture()
    expect(view.state).toBe('authorized'); expect(view.accountIndex).toBe(1000)
    const header = core.retrieve(auth, view.id, args.requestId, args.resourceUrl)
    const payload = JSON.parse(Buffer.from(header.headerValue, 'base64').toString())
    expect(await recoverTypedDataAddress({ ...x402TypedData(view), signature: payload.payload.signature })).toBe(account.address)
    expect(payload.payload.authorization).toEqual(view.authorization)
    expect(payload.accepted.asset).toBe(args.paymentRequired.accepts[0].asset)
    const snapshot = JSON.stringify(core.snapshot())
    expect(snapshot).not.toContain(payload.payload.signature); expect(snapshot).not.toContain('test test test')
    const onDisk = readFileSync(join(mocks.profile, 'agent-access/x402.enc.json'), 'utf8')
    expect(Object.keys(JSON.parse(onDisk)).sort()).toEqual(['sealed', 'version'])
    expect(onDisk).not.toContain(payload.payload.signature)
    expect(mocks.rpc.request).not.toHaveBeenCalled()
    for (const [request] of mocks.rpc.call.mock.calls) {
      expect(request.data.startsWith('0xa9059cbb')).toBe(true)
      expect(request.data).not.toContain(payload.payload.signature.slice(2))
    }
  })
  it.each(['domain', 'decimals', 'balance', 'nonce', 'chain', 'simulation', 'delegated-source'] as const)('blocks incorrect %s without a signature release', async bad => {
    const read = mocks.rpc.readContract
    if (bad === 'chain') mocks.rpc.getChainId.mockResolvedValue(8453)
    if (bad === 'simulation') mocks.rpc.call.mockResolvedValue({ data: '0x' + '0'.repeat(64) })
    if (bad === 'delegated-source') mocks.rpc.getCode.mockResolvedValue('0xef0100abcd')
    mocks.rpc.readContract = vi.fn(async (r: any) => {
      if (bad === 'domain' && r.functionName === 'DOMAIN_SEPARATOR') return '0x' + '00'.repeat(32)
      if (bad === 'decimals' && r.functionName === 'decimals') return 18
      if (bad === 'balance' && r.functionName === 'balanceOf') return 0n
      if (bad === 'nonce' && r.functionName === 'authorizationState') return true
      return read(r)
    })
    await expect(signFixture()).rejects.toThrow('checks failed')
    expect(mocks.rpc.request).not.toHaveBeenCalled()
    expect(JSON.stringify(engine().snapshot())).not.toContain('signature')
  })
  it('fails closed without OS secure storage and preserves corrupted journals', () => {
    mocks.secure = false; expect(() => engine().snapshot()).toThrow('OS secure storage')
    mocks.secure = true; engine().snapshot()
    const path = join(mocks.profile, 'agent-access/x402.enc.json')
    writeFileSync(path, '{}')
    expect(() => engine().snapshot()).toThrow('Invalid x402 journal')
    expect(readFileSync(path, 'utf8')).toBe('{}')
  })
})
