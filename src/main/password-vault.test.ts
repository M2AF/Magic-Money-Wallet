/**
 * password-vault.test.ts — the browser password manager's own biometric gate.
 *
 * The vault envelope, the HKDF wrap and the self-heal logic all run for real
 * against a temp userData dir; only the two things that cannot run headless —
 * the Windows Hello bridge and the Touch ID bridge — are stubbed, and they
 * record every (command, key) pair so the tests can assert WHICH key was used.
 *
 * The load-bearing test is 'never touches the wallet-unlock key': borrowing the
 * wallet's Hello key / keychain account would route a password-manager prompt
 * into secure-store's NotFound self-heal, which DELETES wallet.hello.enc and
 * silently disables biometric unlock for the WALLET. Mirrors the guard in
 * passkey-manager.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const { tmp, bio } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs'); const path = require('path'); const os = require('os')
  return {
    tmp: fs.mkdtempSync(path.join(os.tmpdir(), 'mm-pwvault-')),
    bio: {
      platform: 'none' as 'none' | 'win' | 'mac',
      helloSupported: true,
      /** Per-key overrides, so one key can fail while the other succeeds. */
      helloStatusByKey: {} as Record<string, string>,
      touchIdEnrolled: true,
      touchIdMissing: false,
      /** Every bridge call: `${command}:${keyOrAccount}`. */
      calls: [] as string[],
      /** Deterministic per-key material — a different key cannot decrypt. */
      materialFor: (key: string): Uint8Array => {
        const out = new Uint8Array(32)
        for (let i = 0; i < key.length; i++) out[i % 32] ^= key.charCodeAt(i)
        return out
      },
    },
  }
})

vi.mock('electron', () => ({
  app: { getPath: () => tmp },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => Buffer.from(b).toString('utf8'),
  },
}))

vi.mock('./hello-bridge', () => ({
  HELLO_KEY_NAME: 'MagicMoneyWalletVault',
  HELLO_CHALLENGE_B64: 'Y2hhbGxlbmdl',
  helloPlatformOk: () => bio.platform === 'win',
  helloSupported: async () => bio.helloSupported,
  runHello: async (command: string, keyName: string) => {
    bio.calls.push(`${command}:${keyName}`)
    const status = bio.helloStatusByKey[keyName]
    if (status) return { ok: false, status }
    if (command === 'delete') return { ok: true, status: 'Success' }
    return {
      ok: true,
      status: 'Success',
      signatureB64: Buffer.from(bio.materialFor(keyName)).toString('base64'),
    }
  },
}))

vi.mock('./touchid-bridge', () => ({
  TOUCHID_ITEM_MISSING: 'TOUCHID_ITEM_MISSING',
  TOUCHID_ACCOUNT: 'bio-unlock',
  TOUCHID_PASSWORD_ACCOUNT: 'password-vault',
  touchIdPlatformOk: () => bio.platform === 'mac',
  touchIdSupported: () => bio.touchIdEnrolled,
  touchIdVerify: async () => { /* no-op */ },
  touchIdEnrollMaterial: async (account = 'bio-unlock') => {
    bio.calls.push(`enroll:${account}`)
    return bio.materialFor(account)
  },
  touchIdGetMaterial: async (account = 'bio-unlock') => {
    bio.calls.push(`sign:${account}`)
    if (bio.touchIdMissing) throw new Error('TOUCHID_ITEM_MISSING')
    return bio.materialFor(account)
  },
  touchIdDeleteMaterial: async (account = 'bio-unlock') => { bio.calls.push(`delete:${account}`) },
}))

import {
  unlockPasswords, lockPasswords, savePassword, listPasswords, isPasswordVaultUnlocked,
  passwordVaultStatus, deletePasswordVault, hasPasswordBioUnlock, passwordBioStatus,
  enrollPasswordBio, unlockPasswordsWithBio, removePasswordBio,
} from './password-vault'
import { saveMnemonic, deleteWallet, enrollHello, unlockWithHello, hasHelloUnlock, lock, loadMnemonic } from './secure-store'

const MNEMONIC = 'test test test test test test test test test test test junk'
const PW = 'correct horse battery staple'

const walletHello = () => join(tmp, 'wallet.hello.enc')
const vaultHello = () => join(tmp, 'passwords.hello.enc')

/** An open vault holding one login — the state enrollment requires. */
async function openVaultWithOneLogin(): Promise<void> {
  await unlockPasswords(PW)
  await savePassword({ url: 'https://example.com', username: 'ryan', password: 's3cret' })
}

beforeEach(async () => {
  // Reset the harness FIRST: deletePasswordVault() fires the platform-key
  // removal, and on 'none' that is a no-op, so teardown can never leave calls
  // in the log for the next test to trip over.
  bio.platform = 'none'
  bio.helloSupported = true
  bio.helloStatusByKey = {}
  bio.touchIdEnrolled = true
  bio.touchIdMissing = false
  bio.calls.length = 0

  deleteWallet()
  deletePasswordVault()
  lockPasswords()
  await saveMnemonic(MNEMONIC, PW)
})

// ─── The key separation (the whole point) ───────────────────────────────────

describe('password-vault · biometric gate uses its own key', () => {
  // ⚠ Regression guard. Borrowing HELLO_KEY_NAME would route a password-manager
  // prompt into secure-store's NotFound self-heal, which DELETES
  // wallet.hello.enc — so opening saved logins could silently disable the
  // user's biometric WALLET unlock.
  it('never touches the wallet-unlock Hello key', async () => {
    bio.platform = 'win'
    await openVaultWithOneLogin()
    await enrollPasswordBio()
    lockPasswords()
    await unlockPasswordsWithBio()
    await removePasswordBio()

    const seen = bio.calls.join(',')
    expect(seen).toContain('MagicMoneyPasswordGate')
    expect(seen).not.toContain('MagicMoneyWalletVault')
  })

  it('never touches the wallet-unlock keychain account on macOS', async () => {
    bio.platform = 'mac'
    await openVaultWithOneLogin()
    await enrollPasswordBio()
    lockPasswords()
    await unlockPasswordsWithBio()
    await removePasswordBio()

    const seen = bio.calls.join(',')
    expect(seen).toContain('password-vault')
    expect(seen).not.toContain('bio-unlock')
  })

  // The two gates derive from different key names, so even a bug that swapped
  // the FILES could not silently succeed — the material would not decrypt.
  it('derives different key material than the wallet gate', async () => {
    expect(Buffer.from(bio.materialFor('MagicMoneyPasswordGate')))
      .not.toEqual(Buffer.from(bio.materialFor('MagicMoneyWalletVault')))
  })
})

// ─── wallet.hello.enc must survive everything this module does ──────────────

describe('password-vault · wallet.hello.enc survives a password-manager prompt', () => {
  it('is untouched across enroll, unlock and remove', async () => {
    bio.platform = 'win'
    await enrollHello()                       // real wallet enrollment
    expect(hasHelloUnlock()).toBe(true)
    const before = readFileSync(walletHello())

    await openVaultWithOneLogin()
    await enrollPasswordBio()
    lockPasswords()
    await unlockPasswordsWithBio()
    await removePasswordBio()

    expect(readFileSync(walletHello())).toEqual(before)
    // …and the wallet's own biometric unlock still works afterwards.
    lock()
    await unlockWithHello()
    expect(loadMnemonic()).toBe(MNEMONIC)
  })

  // The exact failure the separate key exists to prevent: the platform loses
  // the gate's key, the self-heal fires, and it must drop OUR copy only.
  it('self-heals its own copy on NotFound and leaves the wallet copy alone', async () => {
    bio.platform = 'win'
    await enrollHello()
    const before = readFileSync(walletHello())

    await openVaultWithOneLogin()
    await enrollPasswordBio()
    lockPasswords()

    bio.helloStatusByKey['MagicMoneyPasswordGate'] = 'NotFound'
    await expect(unlockPasswordsWithBio()).rejects.toThrow(/turn it back on/i)

    expect(existsSync(vaultHello())).toBe(false)
    expect(existsSync(walletHello())).toBe(true)
    expect(readFileSync(walletHello())).toEqual(before)

    lock()
    await unlockWithHello()
    expect(loadMnemonic()).toBe(MNEMONIC)
  })

  it('self-heals its own copy when the macOS keychain item vanishes', async () => {
    bio.platform = 'mac'
    await enrollHello()
    writeFileSync(walletHello(), readFileSync(walletHello()))   // settle mtime
    const before = readFileSync(walletHello())

    await openVaultWithOneLogin()
    await enrollPasswordBio()
    lockPasswords()

    bio.touchIdMissing = true
    await expect(unlockPasswordsWithBio()).rejects.toThrow(/turn it back on/i)

    expect(existsSync(vaultHello())).toBe(false)
    expect(readFileSync(walletHello())).toEqual(before)
  })
})

// ─── The unlock path itself ─────────────────────────────────────────────────

describe('password-vault · biometric unlock', () => {
  it('opens the vault and restores the saved logins', async () => {
    bio.platform = 'win'
    await openVaultWithOneLogin()
    await enrollPasswordBio()
    lockPasswords()
    expect(isPasswordVaultUnlocked()).toBe(false)

    const status = await unlockPasswordsWithBio()
    expect(status.unlocked).toBe(true)
    expect(listPasswords()).toHaveLength(1)
    expect(listPasswords()[0].host).toBe('example.com')
  })

  it('leaves the password working as the recovery path', async () => {
    bio.platform = 'win'
    await openVaultWithOneLogin()
    await enrollPasswordBio()
    lockPasswords()

    // Typed password, no ceremony at all.
    bio.calls.length = 0
    const status = await unlockPasswords(PW)
    expect(status.unlocked).toBe(true)
    expect(bio.calls).toHaveLength(0)
  })

  it('still allows biometric unlock after the vault is written to again', async () => {
    bio.platform = 'win'
    await openVaultWithOneLogin()
    await enrollPasswordBio()
    await savePassword({ url: 'https://second.example', username: 'a', password: 'b' })
    lockPasswords()

    await unlockPasswordsWithBio()
    expect(listPasswords()).toHaveLength(2)
  })

  it('refuses when nothing is enrolled', async () => {
    bio.platform = 'win'
    await expect(unlockPasswordsWithBio()).rejects.toThrow(/not set up/i)
    expect(bio.calls).toHaveLength(0)
  })

  it('surfaces a cancel without dropping the enrollment', async () => {
    bio.platform = 'win'
    await openVaultWithOneLogin()
    await enrollPasswordBio()
    lockPasswords()

    bio.helloStatusByKey['MagicMoneyPasswordGate'] = 'UserCanceled'
    await expect(unlockPasswordsWithBio()).rejects.toThrow(/cancel/i)
    expect(hasPasswordBioUnlock()).toBe(true)   // still enrolled — just declined
  })

  // The material is deterministic, so an unwrap failure can never be transient.
  // Leaving the copy would leave a button that fails identically forever.
  it('drops a copy it cannot unwrap, and keeps the wallet copy', async () => {
    bio.platform = 'win'
    await enrollHello()
    const walletBefore = readFileSync(walletHello())

    await openVaultWithOneLogin()
    await enrollPasswordBio()
    lockPasswords()
    writeFileSync(vaultHello(), 'not an encrypted blob at all')

    await expect(unlockPasswordsWithBio()).rejects.toThrow(/could not be read/i)
    expect(existsSync(vaultHello())).toBe(false)
    expect(readFileSync(walletHello())).toEqual(walletBefore)

    // The password path is untouched by any of it.
    expect((await unlockPasswords(PW)).unlocked).toBe(true)
  })

  // A stale copy from a wallet re-created under a different password can never
  // open the vault again, so it is dropped rather than left to fail forever.
  it('drops a copy whose password no longer opens the vault', async () => {
    bio.platform = 'win'
    await openVaultWithOneLogin()
    await enrollPasswordBio()

    // Re-create the wallet AND the vault under a different password, keeping
    // the biometric copy behind (deletePasswordVault would normally remove it).
    const stale = readFileSync(vaultHello())
    deleteWallet()
    deletePasswordVault()
    await saveMnemonic(MNEMONIC, 'a completely different password')
    await unlockPasswords('a completely different password')
    await savePassword({ url: 'https://x.example', username: 'u', password: 'p' })
    lockPasswords()
    writeFileSync(vaultHello(), stale)

    await expect(unlockPasswordsWithBio()).rejects.toThrow(/no longer open/i)
    expect(existsSync(vaultHello())).toBe(false)
    // The vault itself is intact — the password still opens it.
    expect((await unlockPasswords('a completely different password')).unlocked).toBe(true)
  })
})

// ─── Enrollment + status ────────────────────────────────────────────────────

describe('password-vault · enrollment', () => {
  it('refuses to enroll while the vault is locked', async () => {
    bio.platform = 'win'
    await expect(enrollPasswordBio()).rejects.toThrow(/unlock the password manager/i)
    expect(hasPasswordBioUnlock()).toBe(false)
    expect(bio.calls).toHaveLength(0)
  })

  it('refuses on a platform with no biometric API', async () => {
    bio.platform = 'none'
    await openVaultWithOneLogin()
    await expect(enrollPasswordBio()).rejects.toThrow(/not available/i)
    expect(bio.calls).toHaveLength(0)
  })

  it('reports supported: false where the control must be hidden', async () => {
    bio.platform = 'none'
    expect(await passwordBioStatus()).toEqual({ supported: false, enrolled: false, method: null })

    // Windows with Hello not set up on the machine: a platform, but no ceremony.
    bio.platform = 'win'
    bio.helloSupported = false
    expect((await passwordBioStatus()).supported).toBe(false)
  })

  it('reports the method so the UI can name the sensor', async () => {
    bio.platform = 'win'
    expect((await passwordBioStatus()).method).toBe('windows-hello')
    bio.platform = 'mac'
    expect((await passwordBioStatus()).method).toBe('touch-id')
  })

  it('flips enrolled on and back off', async () => {
    bio.platform = 'win'
    await openVaultWithOneLogin()
    expect((await passwordBioStatus()).enrolled).toBe(false)

    await enrollPasswordBio()
    expect((await passwordBioStatus()).enrolled).toBe(true)

    await removePasswordBio()
    expect((await passwordBioStatus()).enrolled).toBe(false)
    expect(bio.calls).toContain('delete:MagicMoneyPasswordGate')
  })
})

// ─── Lifecycle: locking and deleting ────────────────────────────────────────

describe('password-vault · lifecycle', () => {
  // The wallet's lock paths call lockPasswords(); enrolling a biometric must
  // not turn that into a vault that stays open behind a locked wallet.
  it('lockPasswords still closes a biometrically-unlocked vault', async () => {
    bio.platform = 'win'
    await openVaultWithOneLogin()
    await enrollPasswordBio()
    lockPasswords()
    await unlockPasswordsWithBio()
    expect(isPasswordVaultUnlocked()).toBe(true)

    lockPasswords()
    expect(isPasswordVaultUnlocked()).toBe(false)
    expect(passwordVaultStatus().unlocked).toBe(false)
    expect(() => listPasswords()).toThrow(/locked/i)
  })

  it('deleting the vault removes the biometric copy too', async () => {
    bio.platform = 'win'
    await openVaultWithOneLogin()
    await enrollPasswordBio()
    expect(existsSync(vaultHello())).toBe(true)

    deletePasswordVault()
    expect(existsSync(vaultHello())).toBe(false)
    expect(hasPasswordBioUnlock()).toBe(false)
  })

  // Deleting the vault must not take the WALLET's enrollment with it.
  it('deleting the vault leaves the wallet biometric unlock intact', async () => {
    bio.platform = 'win'
    await enrollHello()
    const before = readFileSync(walletHello())

    await openVaultWithOneLogin()
    await enrollPasswordBio()
    deletePasswordVault()

    expect(existsSync(walletHello())).toBe(true)
    expect(readFileSync(walletHello())).toEqual(before)
    lock()
    await unlockWithHello()
    expect(loadMnemonic()).toBe(MNEMONIC)
  })
})
