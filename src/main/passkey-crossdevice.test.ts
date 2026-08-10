/**
 * passkey-crossdevice.test.ts — DIAGNOSTIC (2026-08-10)
 *
 * Two devices, one seed. Reproduces the cross-device sign-in failure headlessly
 * over the real ceremony code, so the on-device logcat line has a mechanism
 * behind it rather than a story.
 *
 * Device A = Windows (Electron), Device B = the phone. Same mnemonic, same
 * account, separate index storage — because the index is per-install and nothing
 * syncs it. Everything except the approval dialog and the biometric runs for
 * real: the derivation, the AES-GCM index envelope, the signatures, and
 * @simplewebauthn/server's verdict on them.
 *
 * These assertions describe CURRENT behaviour, including the broken parts. They
 * are written to fail loudly if a fix lands, so whoever fixes it must come back
 * and restate what is true.
 */

import { describe, it, expect } from 'vitest'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'

import { runCreate, runAssert, hasCredentialFor, type PasskeyEnvironment } from './passkey-ceremony'
import type { PasskeyIndexStorage } from './passkey-index'
import { base64url, buildClientDataJSON } from './webauthn-authenticator'
import { PASSKEY_NO_CREDENTIAL, PASSKEY_EXCLUDED } from './passkey-protocol'

// The user's real relying party. ChainLens sign-in is discoverable-only:
// /api/auth/passkey/login-options sends no allowCredentials at all.
const RP_ID = 'chainlensnft.info'
const ORIGIN = 'https://chainlensnft.info'
const MNEMONIC = 'test test test test test test test test test test test junk'
const USER_HANDLE = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
const USER_NAME = 'ryan@example.com'

/** A device's index storage. Two of these never see each other — that is the bug. */
function deviceStorage(): PasskeyIndexStorage & { blob: string | null } {
  return {
    blob: null as string | null,
    async read() { return this.blob },
    async write(b: string) { this.blob = b },
    async clear() { this.blob = null },
    async exists() { return this.blob != null },
  }
}

function device(storage: PasskeyIndexStorage): PasskeyEnvironment {
  return {
    loadMnemonic: async () => MNEMONIC,
    currentAccount: async () => ({ accountIndex: 0, accountAddress: '0xabc' }),
    storage,
    approve: async () => ({ approved: true }),
    verifyUser: async () => 'windows-hello' as const,
  }
}

describe('cross-device passkey sign-in (same seed, two installs)', () => {
  it('DIAGNOSIS: device B cannot discover a credential device A created', async () => {
    const deskStore = deviceStorage()
    const phoneStore = deviceStorage()
    const desktop = device(deskStore)
    const phone = device(phoneStore)

    // ── Device A (Windows): create the passkey. ──────────────────────────────
    await runCreate(desktop, {
      origin: ORIGIN, rpId: RP_ID, userHandle: USER_HANDLE, userName: USER_NAME,
      challenge: new Uint8Array(32).fill(7),
    })
    expect(deskStore.blob).not.toBeNull()          // A recorded it
    expect(phoneStore.blob).toBeNull()             // ...and B was never told

    // ── Device B (phone): the exact request ChainLens sends. ─────────────────
    // No allowCredentials ⇒ discoverable ⇒ enumerate the index ⇒ nothing there.
    await expect(runAssert(phone, {
      origin: ORIGIN, rpId: RP_ID, challenge: new Uint8Array(32).fill(9),
    })).rejects.toThrow(expect.objectContaining({ code: PASSKEY_NO_CREDENTIAL }))

    // The silent-probe surface agrees, which is what makes the phone offer zero
    // entries in the system sheet rather than erroring: nothing to show.
    expect(await hasCredentialFor(phone, ORIGIN, RP_ID)).toBe(false)
    expect(await hasCredentialFor(desktop, ORIGIN, RP_ID)).toBe(true)
  })

  it('PROOF the key itself is fine: device B signs correctly when the site NAMES the credential', async () => {
    const deskStore = deviceStorage()
    const phoneStore = deviceStorage()
    const desktop = device(deskStore)
    const phone = device(phoneStore)

    const created = await runCreate(desktop, {
      origin: ORIGIN, rpId: RP_ID, userHandle: USER_HANDLE, userName: USER_NAME,
      challenge: new Uint8Array(32).fill(7),
    })

    // Same ceremony, same empty index on B — but allowCredentials supplied.
    const challenge = new Uint8Array(32).fill(11)
    const res = await runAssert(phone, {
      origin: ORIGIN, rpId: RP_ID, challenge,
      allowCredentials: [created.credentialId],
    })

    // The relying party's own verifier accepts the phone's signature against the
    // public key the DESKTOP registered. The seed reproduces the key perfectly;
    // only the ability to find it was lost.
    const clientDataJSON = buildClientDataJSON('webauthn.get', challenge, ORIGIN, false)
    const verification = await verifyAuthenticationResponse({
      response: {
        id: base64url(res.credentialId),
        rawId: base64url(res.credentialId),
        response: {
          clientDataJSON: base64url(clientDataJSON),
          authenticatorData: base64url(res.authenticatorData),
          signature: base64url(res.signature),
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

    // ⚠ And the userHandle is null, because only the index knew it. A relying
    // party that identifies the account from userHandle alone gets nothing even
    // on this working path.
    expect(res.userHandle).toBeNull()
  })

  /**
   * FIXED. This asserted the deadlock: device B refused to register because the
   * MAC verified, while also being unable to discover device A's credential.
   * Exclusion is now scoped to what a device can actually OFFER, so B registers
   * its own credential and can sign in with it — one passkey per device, no sync
   * required. Sync later upgrades this to a shared one; it was never a
   * precondition.
   */
  it('device B CAN register its own credential, even though it could derive A\'s', async () => {
    const deskStore = deviceStorage()
    const phoneStore = deviceStorage()
    const desktop = device(deskStore)
    const phone = device(phoneStore)

    const created = await runCreate(desktop, {
      origin: ORIGIN, rpId: RP_ID, userHandle: USER_HANDLE, userName: USER_NAME,
      challenge: new Uint8Array(32).fill(7),
    })

    // A signed-in user hitting "add a passkey" on device B: the RP sends what it
    // already holds, which device B's seed can derive but has never recorded.
    const onPhone = await runCreate(phone, {
      origin: ORIGIN, rpId: RP_ID, userHandle: USER_HANDLE, userName: USER_NAME,
      challenge: new Uint8Array(32).fill(7),
      excludeCredentials: [created.credentialId],
    })

    // Genuinely distinct — the nonce is fresh per registration.
    expect(base64url(onPhone.credentialId)).not.toBe(base64url(created.credentialId))

    // And now B can do the thing it could not before: discoverable sign-in.
    const res = await runAssert(phone, {
      origin: ORIGIN, rpId: RP_ID, challenge: new Uint8Array(32).fill(9),
    })
    expect(base64url(res.credentialId)).toBe(base64url(onPhone.credentialId))
  })

  it('still refuses a duplicate the SAME device already offers', async () => {
    const store = deviceStorage()
    const env = device(store)

    const created = await runCreate(env, {
      origin: ORIGIN, rpId: RP_ID, userHandle: USER_HANDLE, userName: USER_NAME,
      challenge: new Uint8Array(32).fill(7),
    })

    // The point of excludeCredentials survives: two indistinguishable entries
    // for one site is the confusion it exists to prevent.
    await expect(runCreate(env, {
      origin: ORIGIN, rpId: RP_ID, userHandle: USER_HANDLE, userName: USER_NAME,
      challenge: new Uint8Array(32).fill(7),
      excludeCredentials: [created.credentialId],
    })).rejects.toThrow(expect.objectContaining({ code: PASSKEY_EXCLUDED }))
  })

  it('CONTROL: same device, same storage — discovery works, so the seam is the store and nothing else', async () => {
    const store = deviceStorage()
    const env = device(store)
    await runCreate(env, {
      origin: ORIGIN, rpId: RP_ID, userHandle: USER_HANDLE, userName: USER_NAME,
      challenge: new Uint8Array(32).fill(7),
    })
    const res = await runAssert(env, {
      origin: ORIGIN, rpId: RP_ID, challenge: new Uint8Array(32).fill(9),
    })
    expect(res.userHandle).not.toBeNull()
    expect(base64url(res.userHandle!)).toBe(base64url(USER_HANDLE))
  })
})