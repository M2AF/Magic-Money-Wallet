/**
 * passkey-system-provider.test.ts — the wallet↔provider seam
 *
 * Covers the three defects found when a desktop-created passkey would not sign
 * in on the phone (2026-08-10):
 *   a) the provider never followed a wallet account switch, so passkeys were
 *      minted under a STALE account's root — silently the wrong account;
 *   c) discovery rows now carry a root fingerprint, because the provider service
 *      has no UI and can never unwrap a root to check a credentialId's MAC at
 *      offer time.
 *
 * (b), the merge that stops a wallet sync deleting Chrome-created rows, lives in
 * PasskeyVault.putDiscovery and needs an Android Context — it is not reachable
 * from here.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

interface EnrolOptions { rootHex: string; accountIndex: number; discovery?: unknown[] }
interface SyncOptions { discovery: Array<{ rootFp: string }> }

const plugin = vi.hoisted(() => ({
  status: vi.fn(),
  // Typed parameters, so `.mock.calls[0][0]` is a real object rather than an
  // element of an empty tuple.
  enrol: vi.fn(async (_o: { rootHex: string; accountIndex: number; discovery?: unknown[] }) => {}),
  syncDiscovery: vi.fn(async (_o: { discovery: Array<{ rootFp: string }> }) => {}),
  setCurrentAccount: vi.fn(async (_o: { accountIndex: number }) => {}),
  disable: vi.fn(async () => {}),
}))

const store = vi.hoisted(() => ({
  mnemonic: 'test test test test test test test test test test test junk',
  addresses: { accountIndex: 0, evm: '0xabc' } as Record<string, unknown> | null,
}))

vi.mock('@capacitor/core', () => ({
  registerPlugin: (name: string) => (name === 'PasskeyProvider' ? plugin : {}),
}))

vi.mock('./capacitor-store', () => ({
  loadMnemonic: async () => store.mnemonic,
  loadAddresses: async () => store.addresses,
}))

// An in-memory index, standing in for the Capacitor Preferences blob.
const indexBlob = { value: null as string | null }
vi.mock('./passkey-provider', () => ({
  capacitorPasskeyStorage: {
    async read() { return indexBlob.value },
    async write(b: string) { indexBlob.value = b },
    async clear() { indexBlob.value = null },
    async exists() { return indexBlob.value != null },
  },
}))

import {
  rootFingerprint, currentDiscovery, syncPasskeyAccount, syncPasskeyDiscovery,
} from './passkey-system-provider'
import { deriveWebauthnRoot, toHex } from '../main/webauthn-authenticator'
import { saveIndex } from '../main/passkey-index'

const MNEMONIC = store.mnemonic
const enrolled = { supported: true, androidVersion: 34, enrolled: true, enabledInSettings: true }

beforeEach(() => {
  vi.clearAllMocks()
  indexBlob.value = null
  store.addresses = { accountIndex: 0, evm: '0xabc' }
  plugin.status.mockResolvedValue(enrolled)
})

describe('root fingerprint (cross-language contract with PasskeyVault.rootFingerprint)', () => {
  it('reproduces the shared vector the Java suite pins', async () => {
    const root = Uint8Array.from({ length: 32 }, (_, i) => i)
    expect(await rootFingerprint(root)).toBe('630dcd2966c43366')
  })

  it('differs for two accounts of the SAME wallet — which is the whole point', async () => {
    const a = await rootFingerprint(await deriveWebauthnRoot(MNEMONIC, 0))
    const b = await rootFingerprint(await deriveWebauthnRoot(MNEMONIC, 1))
    expect(a).not.toBe(b)
  })
})

describe('following the wallet account (defect a)', () => {
  it('ENROLS the new account, rather than only moving the pointer', async () => {
    await syncPasskeyAccount(2)

    expect(plugin.enrol).toHaveBeenCalledTimes(1)
    const call: EnrolOptions = plugin.enrol.mock.calls[0][0]
    expect(call.accountIndex).toBe(2)
    // The root handed over must be account 2's, not account 0's. Handing over the
    // wrong one is exactly how a passkey ends up minted under a stale account.
    expect(call.rootHex).toBe(toHex(await deriveWebauthnRoot(MNEMONIC, 2)))
    expect(call.rootHex).not.toBe(toHex(await deriveWebauthnRoot(MNEMONIC, 0)))
  })

  it('does nothing when the provider was never enabled', async () => {
    plugin.status.mockResolvedValue({ ...enrolled, enrolled: false })
    await syncPasskeyAccount(1)
    expect(plugin.enrol).not.toHaveBeenCalled()
  })

  it('does nothing below Android 14', async () => {
    plugin.status.mockResolvedValue({ ...enrolled, supported: false })
    await syncPasskeyAccount(1)
    expect(plugin.enrol).not.toHaveBeenCalled()
  })

  it('never throws an account switch, even if native rejects', async () => {
    plugin.enrol.mockRejectedValueOnce(new Error('keystore invalidated'))
    await expect(syncPasskeyAccount(1)).resolves.toBeUndefined()
  })
})

describe('discovery rows carry the minting root (defect c)', () => {
  const record = (accountIndex: number, credentialId: string) => ({
    rpId: 'chainlensnft.info', credentialId, userHandle: 'aGFuZGxl',
    userName: 'criptoejesus', accountIndex, createdAt: 1,
  })

  it('stamps each row with ITS OWN account root fingerprint', async () => {
    const indexKey = await deriveWebauthnRoot(MNEMONIC, 0)
    await saveIndex(
      { read: async () => indexBlob.value, write: async (b: string) => { indexBlob.value = b },
        clear: async () => { indexBlob.value = null }, exists: async () => indexBlob.value != null },
      indexKey,
      [record(0, 'AAAA'), record(3, 'BBBB')],
    )

    const rows = await currentDiscovery(MNEMONIC)
    expect(rows).toHaveLength(2)

    const byId = Object.fromEntries(rows.map(r => [r.credentialId, r]))
    expect(byId['AAAA'].rootFp).toBe(await rootFingerprint(await deriveWebauthnRoot(MNEMONIC, 0)))
    expect(byId['BBBB'].rootFp).toBe(await rootFingerprint(await deriveWebauthnRoot(MNEMONIC, 3)))
    // A row stamped with the wrong account's fingerprint would be silently
    // dropped by the service, so the two must not be interchangeable.
    expect(byId['AAAA'].rootFp).not.toBe(byId['BBBB'].rootFp)
  })

  it('an unreadable index yields no rows rather than unstamped ones', async () => {
    indexBlob.value = JSON.stringify({ v: 1, salt: 'x', iv: 'y', data: 'z' })
    expect(await currentDiscovery(MNEMONIC)).toEqual([])
  })

  it('pushes stamped rows through syncDiscovery', async () => {
    const indexKey = await deriveWebauthnRoot(MNEMONIC, 0)
    await saveIndex(
      { read: async () => indexBlob.value, write: async (b: string) => { indexBlob.value = b },
        clear: async () => { indexBlob.value = null }, exists: async () => indexBlob.value != null },
      indexKey,
      [record(0, 'AAAA')],
    )

    await syncPasskeyDiscovery(MNEMONIC)

    const pushed: SyncOptions = plugin.syncDiscovery.mock.calls[0][0]
    expect(pushed.discovery).toHaveLength(1)
    expect(pushed.discovery[0].rootFp).toMatch(/^[0-9a-f]{16}$/)
  })
})
