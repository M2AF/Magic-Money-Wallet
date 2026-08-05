import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

// Integration test for the C-1 vault + H-3 proxy pinning. The PASSWORD layer
// (crypto-vault, AES-GCM) runs for real; only Electron's OS keychain layer
// (safeStorage) and userData path are mocked — with a faithful reversible
// stand-in — so the unlock/lock/migration state machine is exercised end-to-end.
const { tmp } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs'); const path = require('path'); const os = require('os')
  return { tmp: fs.mkdtempSync(path.join(os.tmpdir(), 'mm-securestore-')) }
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
  saveMnemonic, loadMnemonic, unlock, lock, isUnlocked, isPasswordEncrypted,
  needsMigration, migrateLegacy, verifyPassword, walletExists, deleteWallet,
  loadConfig, saveConfig,
  hasPasskeyBackup, linkPasskey, mnemonicFromPasskeyBackup, removePasskeyBackup,
} from './secure-store'
import { ACTIVE_PBKDF2_ITERATIONS, LEGACY_PBKDF2_ITERATIONS, encryptSecret } from './crypto-vault'

const MNEMONIC = 'test test test test test test test test test test test junk'
const PW = 'correct horse battery staple'
const DEFAULT_PROXY = 'https://magicmoney-swap-proxy.guildfordking.workers.dev'

beforeEach(() => { deleteWallet(); lock() })

describe('secure-store · password vault (C-1)', () => {
  it('persists the wallet password-encrypted and leaves it unlocked', async () => {
    expect(walletExists()).toBe(false)
    await saveMnemonic(MNEMONIC, PW)
    expect(walletExists()).toBe(true)
    expect(isPasswordEncrypted()).toBe(true)
    expect(isUnlocked()).toBe(true)
    expect(loadMnemonic()).toBe(MNEMONIC)
  })

  it('gates loadMnemonic (every signing path) when locked', async () => {
    await saveMnemonic(MNEMONIC, PW)
    lock()
    expect(isUnlocked()).toBe(false)
    expect(() => loadMnemonic()).toThrow(/locked/i)
  })

  it('rejects the wrong password and accepts the right one', async () => {
    await saveMnemonic(MNEMONIC, PW)
    lock()
    await expect(unlock('the-wrong-password')).rejects.toThrow(/incorrect/i)
    expect(isUnlocked()).toBe(false)
    await unlock(PW)
    expect(isUnlocked()).toBe(true)
    expect(loadMnemonic()).toBe(MNEMONIC)
  })

  it('verifyPassword gates reveal without changing lock state', async () => {
    await saveMnemonic(MNEMONIC, PW)
    expect(await verifyPassword(PW)).toBe(true)
    expect(await verifyPassword('nope')).toBe(false)
    expect(isUnlocked()).toBe(true) // unchanged by verifyPassword
  })

  it('deleteWallet wipes the wallet and clears the unlocked phrase', async () => {
    await saveMnemonic(MNEMONIC, PW)
    deleteWallet()
    expect(walletExists()).toBe(false)
    expect(isUnlocked()).toBe(false)
  })
})

describe('secure-store · legacy migration', () => {
  it('detects a legacy (safeStorage-only) wallet and upgrades it in place', async () => {
    // Legacy format = safeStorage.encrypt(rawPhrase); the mock makes that the raw bytes.
    writeFileSync(join(tmp, 'wallet.enc'), Buffer.from(MNEMONIC, 'utf8'))
    expect(walletExists()).toBe(true)
    expect(isPasswordEncrypted()).toBe(false)
    expect(needsMigration()).toBe(true)

    await migrateLegacy(PW)
    expect(isPasswordEncrypted()).toBe(true)
    expect(needsMigration()).toBe(false)
    expect(loadMnemonic()).toBe(MNEMONIC)

    // And the upgraded wallet now unlocks with the password.
    lock()
    await unlock(PW)
    expect(loadMnemonic()).toBe(MNEMONIC)
  })

  it('upgrades legacy 210k password blobs after a successful unlock', async () => {
    const legacy = await encryptSecret(MNEMONIC, PW, LEGACY_PBKDF2_ITERATIONS)
    writeFileSync(join(tmp, 'wallet.enc'), Buffer.from(JSON.stringify(legacy), 'utf8'))

    await unlock(PW)
    expect(loadMnemonic()).toBe(MNEMONIC)

    const upgraded = JSON.parse(Buffer.from(readFileSync(join(tmp, 'wallet.enc'))).toString('utf8'))
    expect(upgraded.iterations).toBe(ACTIVE_PBKDF2_ITERATIONS)
  })
})

describe('secure-store · swap proxy pinning (H-3)', () => {
  it('rejects a non-allowlisted or non-https proxy, preserves the trusted one', () => {
    saveConfig({ swapProxyUrl: 'http://evil.example.com/inject' })
    expect(loadConfig().swapProxyUrl).toBe(DEFAULT_PROXY)         // non-https → default

    saveConfig({ swapProxyUrl: 'https://attacker.workers.dev' })
    expect(loadConfig().swapProxyUrl).toBe(DEFAULT_PROXY)         // host not allowlisted → default

    saveConfig({ swapProxyUrl: `${DEFAULT_PROXY}/` })
    expect(loadConfig().swapProxyUrl).toBe(DEFAULT_PROXY)         // allowlisted → kept (slash trimmed)

    saveConfig({ swapProxyUrl: '' })
    expect(loadConfig().swapProxyUrl).toBe('')                    // explicit "no proxy" → allowed
  })

  it('sanitizes the persisted local Tor browser port', () => {
    saveConfig({ torBrowserEnabled: true, torBrowserPort: 70_000 })
    expect(loadConfig().torBrowserEnabled).toBe(true)
    expect(loadConfig().torBrowserPort).toBe(9050)

    saveConfig({ torBrowserPort: 9150 })
    expect(loadConfig().torBrowserPort).toBe(9150)
  })
})

// ── Passkey recovery blob (link an EXISTING wallet to a passkey) ─────────────
// Envelope encryption: the phrase is stored under a key derived from 32 bytes of
// WebAuthn PRF output. Unlike wallet:generate-passkey, which DERIVES a wallet
// from those bytes, this must return the operator's own pre-existing phrase.
describe('secure-store · passkey recovery blob', () => {
  const PRF = new Uint8Array(32).map((_, i) => (i * 5 + 3) & 0xff)

  beforeEach(async () => {
    lock()
    removePasskeyBackup()
    await saveMnemonic(MNEMONIC, 'Correct-Horse-9!')
  })

  it('round-trips the existing phrase, not a derived one', async () => {
    expect(hasPasskeyBackup()).toBe(false)
    await linkPasskey(PRF)
    expect(hasPasskeyBackup()).toBe(true)
    // The whole point: what comes back is the wallet we already had.
    expect(await mnemonicFromPasskeyBackup(PRF)).toBe(MNEMONIC)
  })

  it('refuses a different passkey rather than returning garbage', async () => {
    await linkPasskey(PRF)
    const other = new Uint8Array(PRF); other[0] ^= 0xff
    await expect(mnemonicFromPasskeyBackup(other)).rejects.toThrow()
  })

  it('requires an unlocked wallet to link', async () => {
    lock()
    await expect(linkPasskey(PRF)).rejects.toThrow(/Unlock/i)
  })

  it('throws when nothing is linked', async () => {
    await expect(mnemonicFromPasskeyBackup(PRF)).rejects.toThrow(/No passkey/i)
  })

  // Regression: the blob was originally destroyed by deleteWallet, so importing
  // after a delete found nothing, fell through to DERIVING from the PRF bytes,
  // and silently produced a different wallet that looked like a real restore.
  // Surviving deletion is the entire point of a recovery factor.
  it('survives wallet deletion so it can still restore', async () => {
    await linkPasskey(PRF)
    deleteWallet()
    expect(walletExists()).toBe(false)
    expect(hasPasskeyBackup()).toBe(true)
    expect(await mnemonicFromPasskeyBackup(PRF)).toBe(MNEMONIC)
  })

  it('is removed only by an explicit unlink', async () => {
    await linkPasskey(PRF)
    removePasskeyBackup()
    expect(hasPasskeyBackup()).toBe(false)
  })
})
