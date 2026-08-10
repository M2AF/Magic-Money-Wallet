/**
 * passkey-reconcile.test.ts
 *
 * The deletion rule, tested from the direction that can lose data. Most of these
 * assert that reconciliation does NOTHING — that is the point: every way the
 * server can fail must leave the index alone.
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  recordsToForget, reconcileRelyingParty, chainlensPasskeys,
} from './passkey-reconcile'
import { saveIndex, loadIndex, type PasskeyIndexStorage, type PasskeyCredentialRecord } from './passkey-index'
import { deriveWebauthnRoot } from './webauthn-authenticator'
import type { PasskeyEnvironment } from './passkey-ceremony'

const MNEMONIC = 'test test test test test test test test test test test junk'
const RP = 'chainlensnft.info'

const blob = { value: null as string | null }
const storage: PasskeyIndexStorage = {
  async read() { return blob.value },
  async write(b: string) { blob.value = b },
  async clear() { blob.value = null },
  async exists() { return blob.value != null },
}

const env: PasskeyEnvironment = {
  loadMnemonic: async () => MNEMONIC,
  currentAccount: async () => ({ accountIndex: 0, accountAddress: '0xabc' }),
  storage,
  approve: async () => ({ approved: true }),
  verifyUser: async () => 'windows-hello' as const,
}

const rec = (rpId: string, credentialId: string): PasskeyCredentialRecord => ({
  rpId, credentialId, userHandle: 'aGFuZGxl', userName: 'criptoejesus', accountIndex: 0, createdAt: 1,
})

const seed = async (records: PasskeyCredentialRecord[]) => {
  blob.value = null
  await saveIndex(storage, await deriveWebauthnRoot(MNEMONIC, 0), records)
}

const remaining = async () => loadIndex(storage, await deriveWebauthnRoot(MNEMONIC, 0))

beforeEach(() => { blob.value = null })

describe('recordsToForget', () => {
  const local = [rec(RP, 'KEPT'), rec(RP, 'GONE'), rec('example.com', 'OTHER')]

  it('forgets only what this relying party no longer lists', () => {
    const doomed = recordsToForget(local, RP, { credentialIds: ['KEPT'], authoritative: true })
    expect(doomed.map(r => r.credentialId)).toEqual(['GONE'])
  })

  it('never touches another site — one RP is not authoritative about another', () => {
    const doomed = recordsToForget(local, RP, { credentialIds: [], authoritative: true })
    expect(doomed.map(r => r.credentialId)).toEqual(['KEPT', 'GONE'])
    expect(doomed.some(r => r.rpId === 'example.com')).toBe(false)
  })

  it('deletes NOTHING when the answer is not authoritative', () => {
    expect(recordsToForget(local, RP, { credentialIds: [], authoritative: false })).toEqual([])
  })
})

describe('reconcileRelyingParty', () => {
  it('removes the stale row and leaves the rest of the index intact', async () => {
    await seed([rec(RP, 'KEPT'), rec(RP, 'GONE'), rec('example.com', 'OTHER')])

    const forgotten = await reconcileRelyingParty(env, RP, async () => ({
      credentialIds: ['KEPT'], authoritative: true,
    }))

    expect(forgotten).toBe(1)
    expect((await remaining()).map(r => r.credentialId).sort()).toEqual(['KEPT', 'OTHER'])
  })

  it('is a no-op on a non-authoritative answer, however wrong the index looks', async () => {
    await seed([rec(RP, 'GONE')])
    const forgotten = await reconcileRelyingParty(env, RP, async () => ({
      credentialIds: [], authoritative: false,
    }))
    expect(forgotten).toBe(0)
    expect(await remaining()).toHaveLength(1)
  })

  it('leaves an unreadable index alone rather than rewriting it', async () => {
    blob.value = JSON.stringify({ v: 1, salt: 'x', iv: 'y', data: 'z' })
    const forgotten = await reconcileRelyingParty(env, RP, async () => ({
      credentialIds: ['ANY'], authoritative: true,
    }))
    expect(forgotten).toBe(0)
    expect(blob.value).not.toBeNull()
  })
})

describe('chainlensPasskeys — every server failure must be non-authoritative', () => {
  const ok = (body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch

  it('is authoritative for a real, non-empty list', async () => {
    const rp = await chainlensPasskeys(ok({ passkeys: [{ credential_id: 'AAA' }] }), 'https://x', 't')
    expect(rp).toEqual({ credentialIds: ['AAA'], authoritative: true })
  })

  it('on an OLD server, treats bare 200-with-empty as NOT authoritative', async () => {
    // No flags: indistinguishable from "misconfigured" or "the query threw".
    const rp = await chainlensPasskeys(ok({ passkeys: [] }), 'https://x', 't')
    expect(rp.authoritative).toBe(false)
  })

  it('believes an empty list only when the server vouches for it', async () => {
    const healthy = await chainlensPasskeys(ok({ passkeys: [], configured: true }), 'https://x', 't')
    expect(healthy).toEqual({ credentialIds: [], authoritative: true })
  })

  it('does not believe an empty list when passkeys are unconfigured server-side', async () => {
    const rp = await chainlensPasskeys(ok({ passkeys: [], configured: false }), 'https://x', 't')
    expect(rp.authoritative).toBe(false)
  })

  it('does not believe a list the server itself flags as unavailable', async () => {
    const rp = await chainlensPasskeys(
      ok({ passkeys: [], configured: true, unavailable: true }), 'https://x', 't')
    expect(rp.authoritative).toBe(false)
  })

  it('treats a non-2xx as not authoritative', async () => {
    const failing = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch
    expect((await chainlensPasskeys(failing, 'https://x', 't')).authoritative).toBe(false)
  })

  it('treats a thrown request as not authoritative', async () => {
    const throwing = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect((await chainlensPasskeys(throwing, 'https://x', 't')).authoritative).toBe(false)
  })

  it('ignores malformed rows rather than counting them as known credentials', async () => {
    const rp = await chainlensPasskeys(
      ok({ passkeys: [{ credential_id: 'AAA' }, { label: 'no id' }, { credential_id: '' }] }),
      'https://x', 't',
    )
    expect(rp.credentialIds).toEqual(['AAA'])
  })
})
