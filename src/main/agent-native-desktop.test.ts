import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Keypair } from '@solana/web3.js'
import { deriveCardanoAddress } from './cardano-pure'
import { createNativeExecution } from './agent-native-desktop'
const mocks = vi.hoisted(() => ({ profile: '', secure: true }))
vi.mock('electron', () => ({ app: { getPath: () => mocks.profile }, safeStorage: {
  isEncryptionAvailable: () => mocks.secure, getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: (s: string) => Buffer.from(`sealed:${s}`), decryptString: (b: Buffer) => { if (!b.toString().startsWith('sealed:')) throw new Error('seal'); return b.toString().slice(7) },
} }))
vi.mock('./secure-store', () => ({ loadConfig: () => ({}), loadMnemonic: () => 'test test test test test test test test test test test junk' }))
const to = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey.toBase58()
const auth = { id: 'agent', name: 'Fixture', context: 'testnet', accountIndex: 0, environment: 'testnet', expiresAt: Date.now() + 3600000 }
const owner = { context: auth.context, accountIndex: 0, environment: 'testnet', solana: to, cardano: deriveCardanoAddress(new Uint8Array(16).fill(2), 0, true) }
const engine = (enabled = true) => createNativeExecution({ owner: () => owner, authorize: id => { if (id !== auth.id) throw new Error('grant'); return auth }, x402Enabled: () => enabled, audit: vi.fn() })
beforeEach(() => { mocks.profile = mkdtempSync(join(tmpdir(), 'mm-native-storage-')); mocks.secure = true; vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No network permitted') })) })
afterEach(() => { vi.unstubAllGlobals(); expect(mocks.profile.startsWith(join(tmpdir(), 'mm-native-storage-'))).toBe(true); rmSync(mocks.profile, { recursive: true, force: true }) })
describe('native OS-storage and capability boundaries', () => {
  it('uses only a sealed atomic envelope; restart stops policy and retains asset rules and derivation index', async () => {
    const core = engine(), policy = await core.createPolicy(auth, { clientId: auth.id, chain: 'solana', recipients: [to], perSend: '1', daily: '2', total: '3', maxFee: '0.1', minutes: 60 })
    await core.configureX402(auth, { policyId: policy.id, resourceUrls: ['https://merchant.example.com/data'], perPayment: '1', daily: '2', total: '3' })
    const stored = JSON.parse(readFileSync(join(mocks.profile, 'agent-access/native-execution.enc.json'), 'utf8'))
    expect(Object.keys(stored).sort()).toEqual(['sealed', 'version']); expect(stored.version).toBe(1)
    const restarted = engine().snapshot(); expect(restarted.policies[0].active).toBe(false); expect(restarted.policies[0].address).toBe(policy.address); expect(restarted.limits[0].policyId).toBe(policy.id)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
  it('fails closed without OS encryption and leaves corrupt storage untouched', () => {
    mocks.secure = false; expect(() => engine().snapshot()).toThrow('OS secure storage')
    mocks.secure = true; engine().snapshot()
    const path = join(mocks.profile, 'agent-access/native-execution.enc.json'), corrupt = '{"version":1,"sealed":"Y29ycnVwdA=="}'
    writeFileSync(path, corrupt); expect(() => engine().snapshot()).toThrow('authenticate'); expect(readFileSync(path, 'utf8')).toBe(corrupt)
  })
  it('keeps native execution available with x402 disabled and refuses x402 configuration', async () => {
    const core = engine(false), p = await core.createPolicy(auth, { clientId: auth.id, chain: 'solana', recipients: [to], perSend: '1', daily: '2', total: '3', maxFee: '0.1', minutes: 60 })
    expect(core.snapshot().x402Available).toBe(false)
    await expect(core.configureX402(auth, { policyId: p.id, resourceUrls: ['https://merchant.example.com/data'], perPayment: '1', daily: '2', total: '3' })).rejects.toThrow('disabled')
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
