import { describe, it, expect, beforeEach, vi } from 'vitest'
import { existsSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'

// Same faithful stand-in as secure-store.test.ts: the AES-GCM envelope runs for
// real, only Electron's keychain layer and userData path are mocked. That means
// the "a different wallet cannot read this index" property is genuinely tested,
// not asserted against a fake.
const { tmp } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs'); const path = require('path'); const os = require('os')
  return { tmp: fs.mkdtempSync(path.join(os.tmpdir(), 'mm-passkeystore-')) }
})

vi.mock('electron', () => ({
  app: { getPath: () => tmp },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => Buffer.from(b).toString('utf8'),
  },
}))

import {
  loadPasskeyIndex, savePasskeyIndex, addPasskeyCredential, findPasskeyCredentials,
  removePasskeyCredential, clearPasskeyIndex, hasPasskeyIndex, sanitizePasskeyRecords,
  PASSKEY_INDEX_UNREADABLE, MAX_PASSKEY_RECORDS, type PasskeyCredentialRecord,
} from './passkey-store'
import { saveMnemonic, deleteWallet, lock, walletExists } from './secure-store'
import { deriveWebauthnRoot } from './webauthn-authenticator'

const MNEMONIC = 'test test test test test test test test test test test junk'
const OTHER_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const PW = 'correct horse battery staple'
const INDEX_FILE = join(tmp, 'passkey-index.enc')

let key: Uint8Array
let otherKey: Uint8Array

const record = (over: Partial<PasskeyCredentialRecord> = {}): PasskeyCredentialRecord => ({
  rpId: 'chainlensnft.info',
  credentialId: 'AQABAgMEBQYHCAkKCwwNDg-aTWtEjMD_nQDFK0li1TfZ',
  userHandle: 'dXNlci0x',
  userName: 'ryan@example.com',
  accountIndex: 0,
  createdAt: 1_700_000_000_000,
  ...over,
})

beforeEach(async () => {
  clearPasskeyIndex()
  key ??= await deriveWebauthnRoot(MNEMONIC, 0)
  otherKey ??= await deriveWebauthnRoot(OTHER_MNEMONIC, 0)
})

describe('passkey-store · the index', () => {
  it('starts empty and round-trips a credential', async () => {
    expect(hasPasskeyIndex()).toBe(false)
    expect(await loadPasskeyIndex(key)).toEqual([])

    await addPasskeyCredential(key, record())
    expect(hasPasskeyIndex()).toBe(true)
    const all = await loadPasskeyIndex(key)
    expect(all).toHaveLength(1)
    expect(all[0].rpId).toBe('chainlensnft.info')
    expect(all[0].userName).toBe('ryan@example.com')
  })

  it('never stores the index in plaintext', async () => {
    await addPasskeyCredential(key, record())
    const raw = readFileSync(INDEX_FILE, 'utf-8')
    // The site list is exactly the kind of thing that must not sit in the clear
    // next to addresses.json.
    expect(raw).not.toContain('chainlensnft.info')
    expect(raw).not.toContain('ryan@example.com')
    expect(JSON.parse(raw)).toHaveProperty('data')
  })

  it('finds by rpId, newest first, and ignores other sites', async () => {
    await addPasskeyCredential(key, record({ createdAt: 1000, credentialId: 'AAAA', userHandle: 'aA' }))
    await addPasskeyCredential(key, record({ createdAt: 3000, credentialId: 'BBBB', userHandle: 'bB' }))
    await addPasskeyCredential(key, record({ rpId: 'example.com', credentialId: 'CCCC', userHandle: 'cC' }))

    const found = await findPasskeyCredentials(key, 'chainlensnft.info')
    expect(found.map(r => r.credentialId)).toEqual(['BBBB', 'AAAA'])
    expect(await findPasskeyCredentials(key, 'nobody.example')).toEqual([])
  })

  // Real authenticators replace on re-registration: the RP has just stored a new
  // public key, so offering the old credential would only get the user rejected.
  it('replaces a credential when the same user re-registers on the same site', async () => {
    await addPasskeyCredential(key, record({ credentialId: 'OLD', userHandle: 'dXNlci0x' }))
    await addPasskeyCredential(key, record({ credentialId: 'NEW', userHandle: 'dXNlci0x' }))
    const found = await findPasskeyCredentials(key, 'chainlensnft.info')
    expect(found.map(r => r.credentialId)).toEqual(['NEW'])
  })

  it('keeps separate users on the same site', async () => {
    await addPasskeyCredential(key, record({ credentialId: 'AAA', userHandle: 'dXNlci0x' }))
    await addPasskeyCredential(key, record({ credentialId: 'BBB', userHandle: 'dXNlci0y' }))
    expect(await findPasskeyCredentials(key, 'chainlensnft.info')).toHaveLength(2)
  })

  it('removes one credential without touching the rest', async () => {
    await addPasskeyCredential(key, record({ credentialId: 'AAA', userHandle: 'aA' }))
    await addPasskeyCredential(key, record({ credentialId: 'BBB', userHandle: 'bB' }))
    await removePasskeyCredential(key, 'chainlensnft.info', 'AAA')
    expect((await loadPasskeyIndex(key)).map(r => r.credentialId)).toEqual(['BBB'])
    // A no-op removal must not corrupt anything.
    await removePasskeyCredential(key, 'chainlensnft.info', 'not-there')
    expect(await loadPasskeyIndex(key)).toHaveLength(1)
  })

  it('caps the index so a damaged file cannot grow without bound', async () => {
    const many = Array.from({ length: MAX_PASSKEY_RECORDS + 50 }, (_, i) =>
      record({ credentialId: `c${i}`, userHandle: `u${i}` }))
    await savePasskeyIndex(key, many)
    expect(await loadPasskeyIndex(key)).toHaveLength(MAX_PASSKEY_RECORDS)
  })

  it('rejects a key that is not the 32-byte root', async () => {
    await expect(loadPasskeyIndex(new Uint8Array(16))).rejects.toThrow(/32-byte/)
    await expect(savePasskeyIndex(new Uint8Array(31), [])).rejects.toThrow(/32-byte/)
  })
})

// ── The safety property this whole file exists for ──────────────────────────
describe('passkey-store · a missing or foreign index never yields a credential', () => {
  it('returns nothing (not something) when no index exists', async () => {
    expect(await loadPasskeyIndex(key)).toEqual([])
    expect(await findPasskeyCredentials(key, 'chainlensnft.info')).toEqual([])
  })

  // The failure mode from mnemonicFromPasskeyBackup: a missing store must not
  // fall through to producing a plausible-looking answer.
  it('refuses a different wallet loudly instead of reporting an empty list', async () => {
    await addPasskeyCredential(key, record())
    await expect(loadPasskeyIndex(otherKey)).rejects.toThrow(PASSKEY_INDEX_UNREADABLE)
    await expect(findPasskeyCredentials(otherKey, 'chainlensnft.info')).rejects.toThrow(PASSKEY_INDEX_UNREADABLE)
  })

  it('refuses a corrupted envelope loudly', async () => {
    await addPasskeyCredential(key, record())
    const blob = JSON.parse(readFileSync(INDEX_FILE, 'utf-8'))
    blob.data[0] ^= 0xff                               // flip a ciphertext bit
    writeFileSync(INDEX_FILE, JSON.stringify(blob))
    await expect(loadPasskeyIndex(key)).rejects.toThrow(PASSKEY_INDEX_UNREADABLE)
  })

  it('refuses a truncated / non-JSON file loudly', async () => {
    writeFileSync(INDEX_FILE, 'not an envelope at all')
    await expect(loadPasskeyIndex(key)).rejects.toThrow(PASSKEY_INDEX_UNREADABLE)
  })

  // A new wallet on a device that once held another must still be able to
  // register. Refusing forever would be a hard breakage; the old wallet loses
  // discovery only, which is the documented cost of losing this file.
  it('lets a new wallet start a fresh index over a foreign one', async () => {
    await addPasskeyCredential(key, record({ credentialId: 'FIRSTWALLET', userHandle: 'aA' }))
    await addPasskeyCredential(otherKey, record({ credentialId: 'SECONDWALLET', userHandle: 'bB' }))

    expect((await loadPasskeyIndex(otherKey)).map(r => r.credentialId)).toEqual(['SECONDWALLET'])
    // …and the first wallet's records are gone, not silently readable.
    await expect(loadPasskeyIndex(key)).rejects.toThrow(PASSKEY_INDEX_UNREADABLE)
  })
})

describe('passkey-store · survives wallet deletion', () => {
  it('outlives deleteWallet the way wallet.passkey.enc does', async () => {
    await saveMnemonic(MNEMONIC, PW)
    await addPasskeyCredential(key, record())
    expect(walletExists()).toBe(true)

    deleteWallet()

    expect(walletExists()).toBe(false)
    expect(existsSync(INDEX_FILE)).toBe(true)
    // Re-importing the same seed gets the list back — the credentials it
    // describes were never on this device to begin with.
    expect(await findPasskeyCredentials(key, 'chainlensnft.info')).toHaveLength(1)
    lock()
  })

  it('is removed only by an explicit clear', async () => {
    await addPasskeyCredential(key, record())
    clearPasskeyIndex()
    expect(hasPasskeyIndex()).toBe(false)
    expect(await loadPasskeyIndex(key)).toEqual([])
  })
})

describe('passkey-store · sanitizePasskeyRecords', () => {
  it('drops malformed rows rather than failing the whole index', () => {
    const out = sanitizePasskeyRecords([
      record(),
      null,
      'nope',
      record({ rpId: '' }),
      { ...record(), credentialId: 'not base64url!!' },
      { ...record(), userHandle: 'also bad!!' },
      { ...record(), accountIndex: -1 },
      { ...record(), accountIndex: 1.5 },
      { ...record(), credentialId: undefined },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].rpId).toBe('chainlensnft.info')
  })

  it('accepts an empty userHandle and normalises a missing userName', () => {
    const out = sanitizePasskeyRecords([{ ...record(), userHandle: '', userName: undefined }])
    expect(out).toHaveLength(1)
    expect(out[0].userHandle).toBe('')
    expect(out[0].userName).toBe('')
  })

  it('bounds a hostile userName and a non-array file', () => {
    const out = sanitizePasskeyRecords([{ ...record(), userName: 'x'.repeat(5000) }])
    expect(out[0].userName).toHaveLength(256)
    expect(sanitizePasskeyRecords({ not: 'an array' })).toEqual([])
    expect(sanitizePasskeyRecords(null)).toEqual([])
  })

  it('refuses to index a malformed record at the write path too', async () => {
    await expect(addPasskeyCredential(key, record({ rpId: '' }))).rejects.toThrow(/malformed/)
    expect(hasPasskeyIndex()).toBe(false)
  })
})
