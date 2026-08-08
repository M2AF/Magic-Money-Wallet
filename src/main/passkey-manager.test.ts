import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'

const { tmp, ui, bio } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs'); const path = require('path'); const os = require('os')
  return {
    tmp: fs.mkdtempSync(path.join(os.tmpdir(), 'mm-passkeymgr-')),
    // The approval window and the biometric bridges are the two things we cannot
    // run headless. Everything else — the vault envelope, the derivation, the
    // signatures — runs for real.
    ui: { approve: true, choiceId: undefined as string | undefined, shown: [] as Array<Record<string, unknown>> },
    bio: {
      platform: 'none' as 'none' | 'win' | 'mac',
      helloSupported: true,
      helloResult: { ok: true, status: 'Success' } as { ok: boolean; status?: string; error?: string },
      helloResultOnRetry: null as null | { ok: boolean; status?: string },
      touchIdThrows: false,
      touchIdEnrolled: true,
      calls: [] as string[],
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

vi.mock('./browser-manager', () => ({
  showApprovalWindow: async (opts: Record<string, unknown>) => { ui.shown.push(opts); return ui.approve },
  showApprovalDecision: async (opts: Record<string, unknown>) => {
    ui.shown.push(opts)
    return { approved: ui.approve, choiceId: ui.choiceId }
  },
}))

vi.mock('./hello-bridge', () => ({
  HELLO_KEY_NAME: 'MagicMoneyWalletVault',
  HELLO_CHALLENGE_B64: 'Y2hhbGxlbmdl',
  helloPlatformOk: () => bio.platform === 'win',
  helloSupported: async () => bio.helloSupported,
  runHello: async (command: string, keyName: string) => {
    bio.calls.push(`${command}:${keyName}`)
    if (command === 'enroll' && bio.helloResultOnRetry) return bio.helloResultOnRetry
    return bio.helloResult
  },
}))

vi.mock('./touchid-bridge', () => ({
  TOUCHID_ITEM_MISSING: 'TOUCHID_ITEM_MISSING',
  touchIdPlatformOk: () => bio.platform === 'mac',
  touchIdSupported: () => bio.touchIdEnrolled,
  touchIdVerify: async (reason: string) => {
    bio.calls.push(`touch-id:${reason}`)
    if (bio.touchIdThrows) throw new Error('Touch ID was canceled')
  },
  touchIdEnrollMaterial: async () => new Uint8Array(32),
  touchIdGetMaterial: async () => new Uint8Array(32),
  touchIdDeleteMaterial: async () => { /* no-op */ },
}))

import {
  createPasskey, assertPasskey, listPasskeys, forgetPasskey,
  buildPasskeyApproval, rpIdMatchesOrigin, requireSiteForRpId, verifyUserForPasskey,
  PASSKEY_REJECTED, PASSKEY_NO_CREDENTIAL, PASSKEY_ORIGIN_MISMATCH, PASSKEY_VERIFICATION_FAILED,
} from './passkey-manager'
import { clearPasskeyIndex, loadPasskeyIndex, savePasskeyIndex, addPasskeyCredential } from './passkey-store'
import { saveMnemonic, saveAddresses, lock, deleteWallet } from './secure-store'
import { deriveWebauthnRoot, buildClientDataJSON, base64url, fromBase64url } from './webauthn-authenticator'
import type { WalletAddresses } from './wallet-core'

const MNEMONIC = 'test test test test test test test test test test test junk'
const OTHER_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const PW = 'correct horse battery staple'

const RP_ID = 'chainlensnft.info'
const ORIGIN = `https://${RP_ID}`
const USER_HANDLE = new Uint8Array([1, 2, 3, 4])
const USER_NAME = 'ryan@example.com'

const sha256 = (b: Uint8Array) => new Uint8Array(createHash('sha256').update(b).digest())

const addresses = (accountIndex: number, evm: string): WalletAddresses => ({
  evm, solana: 'So1ana', cardano: 'addr1', cardanoStake: 'stake1',
  bitcoin: 'bc1q', bitcoinNested: '3abc', bitcoinTaproot: 'bc1p',
  polkadot: '1abc', tron: 'Tabc', dogecoin: 'Dabc', accountIndex,
})

function useAccount(i: number): void {
  saveAddresses(addresses(i, i === 0 ? '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' : '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'))
}

beforeEach(async () => {
  deleteWallet()
  clearPasskeyIndex()
  lock()
  ui.approve = true
  ui.choiceId = undefined
  ui.shown.length = 0
  bio.platform = 'none'
  bio.helloSupported = true
  bio.helloResult = { ok: true, status: 'Success' }
  bio.helloResultOnRetry = null
  bio.touchIdThrows = false
  bio.touchIdEnrolled = true
  bio.calls.length = 0
  await saveMnemonic(MNEMONIC, PW)
  useAccount(0)
})

// ─── Gate 1: the site must own the rpId it claims ───────────────────────────

describe('passkey-manager · rpId must belong to the origin', () => {
  it('accepts an exact host and a registrable suffix', () => {
    expect(rpIdMatchesOrigin('chainlensnft.info', 'https://chainlensnft.info')).toBe(true)
    expect(rpIdMatchesOrigin('chainlensnft.info', 'https://www.chainlensnft.info')).toBe(true)
    expect(rpIdMatchesOrigin('chainlensnft.info', 'https://a.b.chainlensnft.info')).toBe(true)
    expect(rpIdMatchesOrigin('localhost', 'http://localhost:5183')).toBe(true)
    expect(rpIdMatchesOrigin('localhost', 'https://localhost')).toBe(true)
  })

  // Without this, a page on evil.example could mint a passkey for a bank and the
  // approval dialog would faithfully print the bank's name.
  it('refuses another site’s rpId, a bare TLD, and insecure origins', () => {
    expect(rpIdMatchesOrigin('chainlensnft.info', 'https://evil.example')).toBe(false)
    expect(rpIdMatchesOrigin('chainlensnft.info', 'https://notchainlensnft.info')).toBe(false)
    expect(rpIdMatchesOrigin('info', 'https://chainlensnft.info')).toBe(false)
    expect(rpIdMatchesOrigin('com', 'https://evil.com')).toBe(false)
    expect(rpIdMatchesOrigin('chainlensnft.info', 'http://chainlensnft.info')).toBe(false)
    expect(rpIdMatchesOrigin('', 'https://chainlensnft.info')).toBe(false)
    expect(rpIdMatchesOrigin('chainlensnft.info', 'not a url')).toBe(false)
  })

  it('names the real host and throws with a stable code', () => {
    expect(requireSiteForRpId(RP_ID, 'https://www.chainlensnft.info')).toBe('www.chainlensnft.info')
    expect(() => requireSiteForRpId(RP_ID, 'https://evil.example'))
      .toThrow(expect.objectContaining({ code: PASSKEY_ORIGIN_MISMATCH }))
  })

  it('refuses before any prompt is shown', async () => {
    await expect(createPasskey({ rpId: RP_ID, origin: 'https://evil.example', userHandle: USER_HANDLE, userName: USER_NAME }))
      .rejects.toThrow(expect.objectContaining({ code: PASSKEY_ORIGIN_MISMATCH }))
    expect(ui.shown).toHaveLength(0)
    expect(bio.calls).toHaveLength(0)
  })
})

// ─── Gate 2: the approval dialog ────────────────────────────────────────────

describe('passkey-manager · approval dialog', () => {
  it('says which site, which account, and that this is a creation', () => {
    const opts = buildPasskeyApproval({
      ceremony: 'create', site: RP_ID, origin: ORIGIN, accountIndex: 0,
      accountAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', userName: USER_NAME,
    })
    expect(opts.heading).toContain(RP_ID)
    expect(opts.heading).toMatch(/create/i)
    expect(opts.confirmLabel).toBe('Create passkey')
    expect(opts.origin).toBe(ORIGIN)
    expect(opts.detail).toContain(`Site: ${RP_ID}`)
    expect(opts.detail).toContain('Account 1')
    expect(opts.detail).toContain('0xf39Fd6…b92266')
    expect(opts.detail).toContain(USER_NAME)
    // The thing that makes a seed-derived passkey different must be said out loud.
    expect(opts.detail).toMatch(/seed phrase/i)
  })

  it('distinguishes a sign-in from a creation', () => {
    const opts = buildPasskeyApproval({ ceremony: 'get', site: RP_ID, origin: ORIGIN, accountIndex: 2, userName: USER_NAME })
    expect(opts.heading).toMatch(/sign you in/i)
    expect(opts.confirmLabel).toBe('Sign in')
    expect(opts.detail).toContain('Account 3')
    expect(opts.detail).not.toMatch(/seed phrase/i)
    expect(opts.warnings).toBeUndefined()
  })

  // Re-registration kills the old credential at the RP. Saying so is the
  // difference between an informed choice and a silent lockout.
  it('warns when a creation replaces an existing passkey', () => {
    const opts = buildPasskeyApproval({
      ceremony: 'create', site: RP_ID, origin: ORIGIN, accountIndex: 0, replacesExisting: true,
    })
    expect(opts.warnings?.[0]).toMatch(/replaces/i)
    expect(opts.warnings?.[0]).toMatch(/stop working/i)
  })

  it('shows the create dialog before touching the vault, and rejection indexes nothing', async () => {
    ui.approve = false
    await expect(createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME }))
      .rejects.toThrow(expect.objectContaining({ code: PASSKEY_REJECTED }))
    expect(ui.shown).toHaveLength(1)
    expect(ui.shown[0].confirmLabel).toBe('Create passkey')
    expect(await listPasskeys()).toEqual([])
    expect(bio.calls).toHaveLength(0)      // never prompted for a biometric
  })

  it('warns on the real dialog when re-registering the same user', async () => {
    await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME })
    ui.shown.length = 0
    await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME })
    expect((ui.shown[0].warnings as string[])[0]).toMatch(/replaces/i)
  })
})

// ─── Gate 3: the biometric check ────────────────────────────────────────────

describe('passkey-manager · biometric gate', () => {
  it('falls back to the unlocked wallet where no biometric exists', async () => {
    expect(await verifyUserForPasskey('test')).toBe('wallet-password')
    expect(bio.calls).toHaveLength(0)
  })

  it('uses Touch ID on macOS and fails closed when it is canceled', async () => {
    bio.platform = 'mac'
    expect(await verifyUserForPasskey('sign in')).toBe('touch-id')
    expect(bio.calls[0]).toBe('touch-id:sign in')

    bio.touchIdThrows = true
    await expect(verifyUserForPasskey('sign in'))
      .rejects.toThrow(expect.objectContaining({ code: PASSKEY_VERIFICATION_FAILED }))
  })

  // bioMethod() reports 'touch-id' for ANY Mac, enrolled or not. Prompting an
  // un-enrolled machine would throw and lock it out of passkeys altogether
  // instead of falling back to the password the wallet was unlocked with.
  it('falls back on a Mac with no fingerprint enrolled', async () => {
    bio.platform = 'mac'
    bio.touchIdEnrolled = false
    expect(await verifyUserForPasskey('sign in')).toBe('wallet-password')
    expect(bio.calls).toHaveLength(0)
  })

  it('falls back on Windows with Hello not set up', async () => {
    bio.platform = 'win'
    bio.helloSupported = false
    expect(await verifyUserForPasskey('sign in')).toBe('wallet-password')
    expect(bio.calls).toHaveLength(0)
  })

  it('uses Windows Hello and fails closed on cancel', async () => {
    bio.platform = 'win'
    expect(await verifyUserForPasskey('sign in')).toBe('windows-hello')

    bio.helloResult = { ok: false, status: 'UserCanceled' }
    await expect(verifyUserForPasskey('sign in'))
      .rejects.toThrow(expect.objectContaining({ code: PASSKEY_VERIFICATION_FAILED }))
  })

  // ⚠ Regression guard. Borrowing HELLO_KEY_NAME would route a passkey prompt
  // into secure-store's NotFound self-heal, which DELETES wallet.hello.enc — so a
  // site's sign-in prompt could silently disable the user's biometric unlock.
  it('never touches the wallet-unlock Hello key', async () => {
    bio.platform = 'win'
    await verifyUserForPasskey('sign in')
    expect(bio.calls.join(',')).toContain('MagicMoneyPasskeyGate')
    expect(bio.calls.join(',')).not.toContain('MagicMoneyWalletVault')
  })

  it('enrolls its own key on first use rather than erroring', async () => {
    bio.platform = 'win'
    bio.helloResult = { ok: false, status: 'NotFound' }
    bio.helloResultOnRetry = { ok: true, status: 'Success' }
    expect(await verifyUserForPasskey('sign in')).toBe('windows-hello')
    expect(bio.calls).toEqual(['sign:MagicMoneyPasskeyGate', 'enroll:MagicMoneyPasskeyGate'])
  })

  it('blocks the ceremony and indexes nothing when verification fails', async () => {
    bio.platform = 'mac'
    bio.touchIdThrows = true
    await expect(createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME }))
      .rejects.toThrow(expect.objectContaining({ code: PASSKEY_VERIFICATION_FAILED }))
    expect(await listPasskeys()).toEqual([])
  })
})

// ─── Registration end-to-end ────────────────────────────────────────────────

describe('passkey-manager · createPasskey', () => {
  it('refuses to run at all while the wallet is locked', async () => {
    lock()
    await expect(createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME }))
      .rejects.toThrow(/locked/i)
    expect(ui.shown).toHaveLength(0)
  })

  it('mints a credential and records it for discovery', async () => {
    const res = await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME })
    expect(res.credentialId).toHaveLength(33)
    expect(res.accountIndex).toBe(0)
    expect(res.userVerification).toBe('wallet-password')

    const listed = await listPasskeys()
    expect(listed).toHaveLength(1)
    expect(listed[0].rpId).toBe(RP_ID)
    expect(listed[0].userName).toBe(USER_NAME)
    expect(listed[0].credentialId).toBe(base64url(res.credentialId))
    expect(listed[0].userHandle).toBe(base64url(USER_HANDLE))
    expect(listed[0].accountIndex).toBe(0)
  })

  it('gives every registration a distinct credential', async () => {
    const a = await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME })
    const b = await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: new Uint8Array([9, 9]), userName: 'other' })
    expect(base64url(a.credentialId)).not.toBe(base64url(b.credentialId))
  })

  it('does not index a non-discoverable credential', async () => {
    const res = await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME, discoverable: false })
    expect(await listPasskeys()).toEqual([])
    // …but it is still a real credential, usable when the site names it.
    const assertion = await assertPasskey({
      rpId: RP_ID, origin: ORIGIN, clientDataHash: sha256(new Uint8Array(4)), allowCredentials: [res.credentialId],
    })
    expect(base64url(assertion.credentialId)).toBe(base64url(res.credentialId))
  })

  it('records the account that minted it', async () => {
    useAccount(1)
    const res = await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME })
    expect(res.accountIndex).toBe(1)
    expect((await listPasskeys())[0].accountIndex).toBe(1)
  })
})

// ─── Authentication end-to-end ──────────────────────────────────────────────

describe('passkey-manager · assertPasskey', () => {
  it('signs in from the index with no credential named', async () => {
    const created = await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME })
    const res = await assertPasskey({ rpId: RP_ID, origin: ORIGIN, clientDataHash: sha256(new Uint8Array(8)) })
    expect(base64url(res.credentialId)).toBe(base64url(created.credentialId))
    expect(res.userHandle && base64url(res.userHandle)).toBe(base64url(USER_HANDLE))
    expect(res.authenticatorData).toHaveLength(37)
  })

  // The whole pipeline — approval, gate, vault lookup, derivation, signature —
  // has to produce something a real relying party accepts. Our own agreement is
  // not evidence of that.
  it('produces an assertion @simplewebauthn/server verifies', async () => {
    const created = await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME })
    const challenge = Uint8Array.from({ length: 32 }, (_, i) => (i * 13 + 5) & 0xff)
    const clientDataJSON = buildClientDataJSON('webauthn.get', challenge, ORIGIN)

    const res = await assertPasskey({ rpId: RP_ID, origin: ORIGIN, clientDataHash: sha256(clientDataJSON) })

    const verification = await verifyAuthenticationResponse({
      response: {
        id: base64url(res.credentialId),
        rawId: base64url(res.credentialId),
        response: {
          clientDataJSON: base64url(clientDataJSON),
          authenticatorData: base64url(res.authenticatorData),
          signature: base64url(res.signature),
          userHandle: res.userHandle ? base64url(res.userHandle) : undefined,
        },
        clientExtensionResults: {},
        type: 'public-key',
      },
      expectedChallenge: base64url(challenge),
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: { id: base64url(created.credentialId), publicKey: created.publicKeyCose, counter: 0 },
    })
    expect(verification.verified).toBe(true)
    expect(verification.authenticationInfo.userVerified).toBe(true)
  })

  it('shows a sign-in dialog naming the account, and rejection stops it', async () => {
    await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME })
    ui.shown.length = 0
    ui.approve = false
    await expect(assertPasskey({ rpId: RP_ID, origin: ORIGIN, clientDataHash: sha256(new Uint8Array(8)) }))
      .rejects.toThrow(expect.objectContaining({ code: PASSKEY_REJECTED }))
    expect(ui.shown[0].confirmLabel).toBe('Sign in')
    expect(ui.shown[0].detail).toContain(USER_NAME)
  })

  it('refuses to run while the wallet is locked', async () => {
    await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME })
    lock()
    await expect(assertPasskey({ rpId: RP_ID, origin: ORIGIN, clientDataHash: sha256(new Uint8Array(8)) }))
      .rejects.toThrow(/locked/i)
  })

  it('signs in with a passkey made under another account', async () => {
    useAccount(1)
    const created = await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME })
    useAccount(0)   // user switched accounts since registering

    const res = await assertPasskey({ rpId: RP_ID, origin: ORIGIN, clientDataHash: sha256(new Uint8Array(8)) })
    expect(res.accountIndex).toBe(1)
    expect(base64url(res.credentialId)).toBe(base64url(created.credentialId))

    // …and targeted sign-in finds it across accounts too.
    const targeted = await assertPasskey({
      rpId: RP_ID, origin: ORIGIN, clientDataHash: sha256(new Uint8Array(8)), allowCredentials: [created.credentialId],
    })
    expect(targeted.accountIndex).toBe(1)
  })
})

// ─── The invariant: never derive a credential we cannot prove we minted ─────

describe('passkey-manager · a missing or tampered index never yields a credential', () => {
  it('fails discovery instead of inventing a credential when the index is gone', async () => {
    const created = await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME })
    clearPasskeyIndex()

    await expect(assertPasskey({ rpId: RP_ID, origin: ORIGIN, clientDataHash: sha256(new Uint8Array(8)) }))
      .rejects.toThrow(expect.objectContaining({ code: PASSKEY_NO_CREDENTIAL }))
    expect(ui.shown).toHaveLength(1)   // only the create dialog — no sign-in was offered

    // A TARGETED sign-in still works from the seed alone: the index was only ever
    // a discovery aid, and this is what makes losing it survivable.
    const res = await assertPasskey({
      rpId: RP_ID, origin: ORIGIN, clientDataHash: sha256(new Uint8Array(8)), allowCredentials: [created.credentialId],
    })
    expect(base64url(res.credentialId)).toBe(base64url(created.credentialId))
  })

  it('fails discovery when the index belongs to a different wallet', async () => {
    const otherKey = await deriveWebauthnRoot(OTHER_MNEMONIC, 0)
    await addPasskeyCredential(otherKey, {
      rpId: RP_ID, credentialId: 'AQABAgMEBQYHCAkKCwwNDg-aTWtEjMD_nQDFK0li1TfZ',
      userHandle: 'dXNlcg', userName: 'someone-else', accountIndex: 0, createdAt: Date.now(),
    })
    await expect(assertPasskey({ rpId: RP_ID, origin: ORIGIN, clientDataHash: sha256(new Uint8Array(8)) }))
      .rejects.toThrow(expect.objectContaining({ code: PASSKEY_NO_CREDENTIAL }))
  })

  // The index is a hint; the MAC is the authority. A row whose credentialId has
  // been altered must be skipped, never signed with — signing would hand the site
  // a signature from a key it has never seen.
  it('skips an index row whose credentialId fails the MAC', async () => {
    await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME })
    const key = await deriveWebauthnRoot(MNEMONIC, 0)
    const records = await loadPasskeyIndex(key)

    const bytes = fromBase64url(records[0].credentialId)
    bytes[20] ^= 0x01                                   // flip a bit in the MAC tag
    records[0].credentialId = base64url(bytes)
    await savePasskeyIndex(key, records)

    await expect(assertPasskey({ rpId: RP_ID, origin: ORIGIN, clientDataHash: sha256(new Uint8Array(8)) }))
      .rejects.toThrow(expect.objectContaining({ code: PASSKEY_NO_CREDENTIAL }))
  })

  it('rejects an index row pointing at another site’s credential', async () => {
    const elsewhere = await createPasskey({ rpId: 'example.com', origin: 'https://example.com', userHandle: USER_HANDLE, userName: USER_NAME })
    const key = await deriveWebauthnRoot(MNEMONIC, 0)
    // Re-file that credential under a site it was never minted for.
    await savePasskeyIndex(key, [{
      rpId: RP_ID, credentialId: base64url(elsewhere.credentialId),
      userHandle: base64url(USER_HANDLE), userName: USER_NAME, accountIndex: 0, createdAt: Date.now(),
    }])

    await expect(assertPasskey({ rpId: RP_ID, origin: ORIGIN, clientDataHash: sha256(new Uint8Array(8)) }))
      .rejects.toThrow(expect.objectContaining({ code: PASSKEY_NO_CREDENTIAL }))
  })

  it('rejects an index row attributed to the wrong account', async () => {
    await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME })
    const key = await deriveWebauthnRoot(MNEMONIC, 0)
    const records = await loadPasskeyIndex(key)
    records[0].accountIndex = 5                          // never minted this
    await savePasskeyIndex(key, records)

    await expect(assertPasskey({ rpId: RP_ID, origin: ORIGIN, clientDataHash: sha256(new Uint8Array(8)) }))
      .rejects.toThrow(expect.objectContaining({ code: PASSKEY_NO_CREDENTIAL }))
  })

  it('refuses a credential minted by a different wallet', async () => {
    const otherRoot = await deriveWebauthnRoot(OTHER_MNEMONIC, 0)
    const { buildAttestationObject } = await import('./webauthn-authenticator')
    const theirs = buildAttestationObject({ root: otherRoot, rpId: RP_ID, nonce: new Uint8Array(16) })

    await expect(assertPasskey({
      rpId: RP_ID, origin: ORIGIN, clientDataHash: sha256(new Uint8Array(8)), allowCredentials: [theirs.credentialId],
    })).rejects.toThrow(expect.objectContaining({ code: PASSKEY_NO_CREDENTIAL }))
  })

  it('refuses a tampered credentialId the site supplies', async () => {
    const created = await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME })
    for (const byte of [0, 1, 16, 17, 32]) {
      const bad = created.credentialId.slice()
      bad[byte] ^= 0x01
      await expect(assertPasskey({
        rpId: RP_ID, origin: ORIGIN, clientDataHash: sha256(new Uint8Array(8)), allowCredentials: [bad],
      })).rejects.toThrow(expect.objectContaining({ code: PASSKEY_NO_CREDENTIAL }))
    }
  })

  it('refuses a credential minted for a different site', async () => {
    const created = await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME })
    await expect(assertPasskey({
      rpId: 'example.com', origin: 'https://example.com',
      clientDataHash: sha256(new Uint8Array(8)), allowCredentials: [created.credentialId],
    })).rejects.toThrow(expect.objectContaining({ code: PASSKEY_NO_CREDENTIAL }))
  })

  it('rejects a clientDataHash that is not 32 bytes', async () => {
    await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME })
    await expect(assertPasskey({ rpId: RP_ID, origin: ORIGIN, clientDataHash: new Uint8Array(31) }))
      .rejects.toThrow(/32 bytes/)
  })
})

// ─── Vault doctrine ─────────────────────────────────────────────────────────

describe('passkey-manager · vault doctrine', () => {
  it('survives deleteWallet and returns after the seed is re-imported', async () => {
    await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME })
    deleteWallet()
    await saveMnemonic(MNEMONIC, PW)
    useAccount(0)
    expect(await listPasskeys()).toHaveLength(1)
  })

  it('shows a different wallet an empty list rather than someone else’s sites', async () => {
    await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME })
    deleteWallet()
    await saveMnemonic(OTHER_MNEMONIC, PW)
    useAccount(0)
    expect(await listPasskeys()).toEqual([])
  })

  it('leaves the wallet.passkey.enc recovery blob and Hello unlock copy untouched', async () => {
    // Both are separate artifacts with their own lifecycles; a passkey ceremony
    // must not create, read or destroy either.
    writeFileSync(join(tmp, 'wallet.passkey.enc'), '{"sentinel":"recovery"}')
    writeFileSync(join(tmp, 'wallet.hello.enc'), 'sentinel-hello')
    await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME })
    await assertPasskey({ rpId: RP_ID, origin: ORIGIN, clientDataHash: sha256(new Uint8Array(8)) })
    expect(readFileSync(join(tmp, 'wallet.passkey.enc'), 'utf-8')).toBe('{"sentinel":"recovery"}')
    expect(readFileSync(join(tmp, 'wallet.hello.enc'), 'utf-8')).toBe('sentinel-hello')
  })

  // Forgetting is a discovery change, not a revocation: the passkey is a
  // function of the seed and keeps working wherever the site names it.
  it('forgets a credential for discovery while leaving it usable when named', async () => {
    const created = await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: USER_NAME })
    await forgetPasskey(RP_ID, base64url(created.credentialId))
    expect(await listPasskeys()).toEqual([])

    await expect(assertPasskey({ rpId: RP_ID, origin: ORIGIN, clientDataHash: sha256(new Uint8Array(8)) }))
      .rejects.toThrow(expect.objectContaining({ code: PASSKEY_NO_CREDENTIAL }))

    const res = await assertPasskey({
      rpId: RP_ID, origin: ORIGIN, clientDataHash: sha256(new Uint8Array(8)), allowCredentials: [created.credentialId],
    })
    expect(base64url(res.credentialId)).toBe(base64url(created.credentialId))
  })

  it('lists newest first across sites', async () => {
    await createPasskey({ rpId: RP_ID, origin: ORIGIN, userHandle: USER_HANDLE, userName: 'first' })
    await createPasskey({ rpId: 'example.com', origin: 'https://example.com', userHandle: USER_HANDLE, userName: 'second' })
    const listed = await listPasskeys()
    expect(listed).toHaveLength(2)
    expect(listed[0].createdAt).toBeGreaterThanOrEqual(listed[1].createdAt)
  })
})
