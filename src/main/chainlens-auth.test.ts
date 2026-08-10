/**
 * chainlens-auth.test.ts
 *
 * The session is only worth having if it names the right account, and the
 * signed message must match the server's byte for byte.
 */

import { describe, it, expect, vi } from 'vitest'

import { chainlensWalletLogin, loginMessage, accountUserHandle } from './chainlens-auth'

const ADDRESS = '0x1111111111111111111111111111111111111111'
const ACCOUNT = 'ec18dcf5-3271-46fd-8029-41e5b2f39eed'

const signer = (signMessage = vi.fn(async () => '0xsig')) => ({ address: ADDRESS, signMessage })

/** A fetch stub that answers the two-step flow. */
const flow = (over: { nonce?: unknown; login?: unknown; nonceStatus?: number; loginStatus?: number } = {}) =>
  (async (url: string) => {
    if (String(url).endsWith('/api/auth/nonce')) {
      return new Response(JSON.stringify(over.nonce ?? { nonce: 'abc123' }), { status: over.nonceStatus ?? 200 })
    }
    return new Response(
      JSON.stringify(over.login ?? { token: 'jwt', profile: { id: ACCOUNT } }),
      { status: over.loginStatus ?? 200 },
    )
  }) as unknown as typeof fetch

describe('loginMessage', () => {
  it('matches the string backend-server.js rebuilds', () => {
    // Drift here reads as "invalid signature" with nothing pointing at why.
    expect(loginMessage(ADDRESS, 'abc123'))
      .toBe(`ChainLens login\nAddress: ${ADDRESS}\nNonce: abc123`)
  })
})

describe('accountUserHandle', () => {
  it('reproduces the userHandle observed on the device', () => {
    // Captured live from a real ChainLens assertion during diagnosis.
    expect(accountUserHandle(ACCOUNT)).toBe('ZWMxOGRjZjUtMzI3MS00NmZkLTgwMjktNDFlNWIyZjM5ZWVk')
  })
})

describe('chainlensWalletLogin', () => {
  it('signs the server\'s nonce and returns the session', async () => {
    const sign = vi.fn(async () => '0xsig')
    const session = await chainlensWalletLogin(flow(), 'https://x', signer(sign))

    expect(sign).toHaveBeenCalledWith(`ChainLens login\nAddress: ${ADDRESS}\nNonce: abc123`)
    expect(session).toEqual({ token: 'jwt', userId: ACCOUNT })
  })

  it('returns null rather than throwing when the nonce step fails', async () => {
    expect(await chainlensWalletLogin(flow({ nonceStatus: 500 }), 'https://x', signer())).toBeNull()
  })

  it('returns null when login is rejected', async () => {
    expect(await chainlensWalletLogin(flow({ loginStatus: 401 }), 'https://x', signer())).toBeNull()
  })

  // Without a profile id there is no account identity, and the reconciler must
  // never prune against a list it cannot attribute to an account.
  it('returns null when the response carries no account id', async () => {
    expect(await chainlensWalletLogin(flow({ login: { token: 'jwt' } }), 'https://x', signer())).toBeNull()
  })

  it('returns null when the server sends no nonce', async () => {
    expect(await chainlensWalletLogin(flow({ nonce: {} }), 'https://x', signer())).toBeNull()
  })

  it('returns null when signing fails, without surfacing the error', async () => {
    const sign = vi.fn(async () => { throw new Error('wallet locked') })
    expect(await chainlensWalletLogin(flow(), 'https://x', signer(sign))).toBeNull()
  })

  it('returns null when the network is down', async () => {
    const offline = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect(await chainlensWalletLogin(offline, 'https://x', signer())).toBeNull()
  })
})
