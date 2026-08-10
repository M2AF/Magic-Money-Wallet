/**
 * passkey-sync.test.ts
 *
 * One test per rule, written from the direction that loses data or leaks it.
 */

import { describe, it, expect } from 'vitest'

import {
  deriveSyncKey, encodeSyncBlob, decodeSyncBlob, mergeIndexes,
  SYNC_FORMAT_VERSION, SYNC_BLOB_UNREADABLE, SYNC_VERSION_UNSUPPORTED,
  type SyncPayload, type PasskeyTombstone,
} from './passkey-sync'
import { deriveWebauthnRoot, deriveCredentialMacKey } from './webauthn-authenticator'
import type { PasskeyCredentialRecord } from './passkey-index'

const MNEMONIC = 'test test test test test test test test test test test junk'
const OTHER = 'legal winner thank year wave sausage worth useful legal winner thank yellow'

const rec = (credentialId: string, createdAt: number, rpId = 'chainlensnft.info'): PasskeyCredentialRecord => ({
  rpId, credentialId, userHandle: 'aGFuZGxl', userName: 'criptoejesus', accountIndex: 0, createdAt,
})
const tomb = (credentialId: string, deletedAt: number, rpId = 'chainlensnft.info'): PasskeyTombstone =>
  ({ credentialId, rpId, deletedAt })
const payload = (records: PasskeyCredentialRecord[], tombstones: PasskeyTombstone[] = []): SyncPayload =>
  ({ records, tombstones })

const hex = (u8: Uint8Array) => Buffer.from(u8).toString('hex')

describe('rule 1 — domain separation by salt AND info', () => {
  it('is not the WebAuthn root for any account', async () => {
    const sync = hex(await deriveSyncKey(MNEMONIC))
    for (const account of [0, 1, 2, 9]) {
      expect(sync).not.toBe(hex(await deriveWebauthnRoot(MNEMONIC, account)))
    }
  })

  it('cannot produce, and is not produced by, a credential MAC key', async () => {
    const sync = hex(await deriveSyncKey(MNEMONIC))
    const mac = hex(deriveCredentialMacKey(await deriveWebauthnRoot(MNEMONIC, 0)))
    expect(sync).not.toBe(mac)
  })

  it('is wallet-specific — a different seed cannot open another wallet\'s blob', async () => {
    expect(hex(await deriveSyncKey(MNEMONIC))).not.toBe(hex(await deriveSyncKey(OTHER)))
  })

  it('is deterministic, or a second device could never decrypt the first\'s blob', async () => {
    expect(hex(await deriveSyncKey(MNEMONIC))).toBe(hex(await deriveSyncKey(' TEST test  test test test test test test test test test JUNK ')))
  })

  it('refuses a mnemonic that is not valid BIP-39', async () => {
    await expect(deriveSyncKey('not a real mnemonic at all')).rejects.toThrow(/BIP-39/)
  })
})

describe('rule 2 — AES-GCM: tampering fails loudly, never plausibly', () => {
  it('round-trips', async () => {
    const key = await deriveSyncKey(MNEMONIC)
    const blob = await encodeSyncBlob(payload([rec('AAA', 10)], [tomb('OLD', 5)]), key)
    const back = await decodeSyncBlob(blob, key)
    expect(back.records.map(r => r.credentialId)).toEqual(['AAA'])
    expect(back.tombstones.map(t => t.credentialId)).toEqual(['OLD'])
  })

  it('does not leak the site list in plaintext', async () => {
    const key = await deriveSyncKey(MNEMONIC)
    const blob = await encodeSyncBlob(payload([rec('AAA', 10)]), key)
    expect(blob).not.toContain('chainlensnft.info')
    expect(blob).not.toContain('criptoejesus')
  })

  it('rejects a blob from a different wallet rather than returning rows', async () => {
    const blob = await encodeSyncBlob(payload([rec('AAA', 10)]), await deriveSyncKey(MNEMONIC))
    await expect(decodeSyncBlob(blob, await deriveSyncKey(OTHER)))
      .rejects.toThrow(SYNC_BLOB_UNREADABLE)
  })

  it('rejects a single flipped ciphertext byte', async () => {
    const key = await deriveSyncKey(MNEMONIC)
    const parsed = JSON.parse(await encodeSyncBlob(payload([rec('AAA', 10)]), key))
    parsed.blob.data[0] ^= 0x01
    await expect(decodeSyncBlob(JSON.stringify(parsed), key)).rejects.toThrow(SYNC_BLOB_UNREADABLE)
  })

  it('rejects a truncated blob', async () => {
    const key = await deriveSyncKey(MNEMONIC)
    const parsed = JSON.parse(await encodeSyncBlob(payload([rec('AAA', 10)]), key))
    parsed.blob.data = parsed.blob.data.slice(0, -4)
    await expect(decodeSyncBlob(JSON.stringify(parsed), key)).rejects.toThrow(SYNC_BLOB_UNREADABLE)
  })

  it('rejects garbage instead of treating it as an empty list', async () => {
    await expect(decodeSyncBlob('not json', await deriveSyncKey(MNEMONIC)))
      .rejects.toThrow(SYNC_BLOB_UNREADABLE)
  })
})

describe('rule 3 — versioned from byte zero', () => {
  it('puts the version first, before the ciphertext', async () => {
    const blob = await encodeSyncBlob(payload([rec('AAA', 10)]), await deriveSyncKey(MNEMONIC))
    expect(blob.startsWith(`{"v":${SYNC_FORMAT_VERSION}`)).toBe(true)
  })

  it('reports a future format as unsupported, NOT as corruption', async () => {
    const key = await deriveSyncKey(MNEMONIC)
    const parsed = JSON.parse(await encodeSyncBlob(payload([rec('AAA', 10)]), key))
    parsed.v = SYNC_FORMAT_VERSION + 1
    // The distinction matters: corruption invites "re-sync", a newer format
    // invites "update the app", and telling a user the wrong one wastes them.
    await expect(decodeSyncBlob(JSON.stringify(parsed), key)).rejects.toThrow(SYNC_VERSION_UNSUPPORTED)
  })

  it('treats a missing version as unreadable', async () => {
    const key = await deriveSyncKey(MNEMONIC)
    const parsed = JSON.parse(await encodeSyncBlob(payload([rec('AAA', 10)]), key))
    delete parsed.v
    await expect(decodeSyncBlob(JSON.stringify(parsed), key)).rejects.toThrow(SYNC_BLOB_UNREADABLE)
  })
})

describe('rule 4 — merge, never replace; deletion is never implicit', () => {
  it('keeps BOTH devices rows — absence is not deletion', () => {
    const merged = mergeIndexes(payload([rec('LOCAL', 10)]), payload([rec('REMOTE', 20)]))
    expect(merged.records.map(r => r.credentialId).sort()).toEqual(['LOCAL', 'REMOTE'])
  })

  it('a fresh device pushing first cannot erase an established one', () => {
    const established = payload([rec('A', 1), rec('B', 2), rec('C', 3)])
    const brandNew = payload([])
    expect(mergeIndexes(brandNew, established).records).toHaveLength(3)
    expect(mergeIndexes(established, brandNew).records).toHaveLength(3)
  })

  it('is order-independent and idempotent', () => {
    const a = payload([rec('A', 1)], [tomb('X', 5)])
    const b = payload([rec('B', 2)], [tomb('Y', 6)])
    const ab = mergeIndexes(a, b)
    const ba = mergeIndexes(b, a)
    expect(ab).toEqual(ba)
    expect(mergeIndexes(ab, ab)).toEqual(ab)
  })

  it('removes a record only for an explicit tombstone', () => {
    const merged = mergeIndexes(payload([rec('A', 1), rec('B', 2)]), payload([], [tomb('A', 9)]))
    expect(merged.records.map(r => r.credentialId)).toEqual(['B'])
  })

  it('does not resurrect a deleted credential from the other device', () => {
    const stale = payload([rec('A', 1)])
    const deleted = payload([], [tomb('A', 9)])
    expect(mergeIndexes(stale, deleted).records).toHaveLength(0)
    expect(mergeIndexes(deleted, stale).records).toHaveLength(0)
  })

  it('lets a re-registration after a delete win', () => {
    // Same credentialId registered again AFTER the tombstone: newer wins.
    const merged = mergeIndexes(payload([rec('A', 20)]), payload([], [tomb('A', 9)]))
    expect(merged.records.map(r => r.credentialId)).toEqual(['A'])
  })

  it('carries tombstones forward so a third device also honours the delete', () => {
    const merged = mergeIndexes(payload([rec('B', 2)]), payload([], [tomb('A', 9)]))
    expect(merged.tombstones.map(t => t.credentialId)).toEqual(['A'])
  })
})
