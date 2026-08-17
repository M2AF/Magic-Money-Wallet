/**
 * chainlens-auth.test.ts
 *
 * The session is only worth having if it names the right account, and the
 * signed message must match the server's byte for byte.
 */

import { describe, it, expect, vi } from 'vitest'

import {
  chainlensWalletLogin, chainlensWalletSession, isChainLensSession,
  loginMessage, accountUserHandle,
} from './chainlens-auth'

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

describe('chainlensWalletSession', () => {
  const OTHER = '3f2c6cb8-2a43-4b69-bf5e-099ef63be79f'

  /** A fetch stub for nonce → wallet-session. */
  const sessionFlow = (over: { session?: unknown; status?: number; body?: unknown } = {}) => {
    const calls: Array<{ url: string; body: unknown }> = []
    const impl = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })
      if (String(url).endsWith('/api/auth/nonce')) {
        return new Response(JSON.stringify({ nonce: 'abc123' }), { status: 200 })
      }
      return new Response(
        JSON.stringify(over.body ?? over.session ?? { token: 'jwt', profile: { id: ACCOUNT } }),
        { status: over.status ?? 200 },
      )
    }) as unknown as typeof fetch
    return { impl, calls }
  }

  it('names the account it is asked for and returns its session', async () => {
    const { impl, calls } = sessionFlow()
    const result = await chainlensWalletSession(impl, 'https://x', signer(), ACCOUNT)

    expect(isChainLensSession(result)).toBe(true)
    expect(result).toEqual({ token: 'jwt', userId: ACCOUNT })
    // The id must be SENT, not inferred server-side from the address — that is
    // the whole difference between this route and /wallet-login.
    expect(calls[1].body).toMatchObject({ chainlens_id: ACCOUNT, address: ADDRESS, nonce: 'abc123' })
  })

  // The failure this route exists to prevent: signing in as a different account
  // than the wallet is displaying. Even if the server ever regressed, the client
  // refuses the session rather than chatting under the wrong identity.
  it('refuses a session whose profile id is not the one requested', async () => {
    const { impl } = sessionFlow({ session: { token: 'jwt', profile: { id: OTHER } } })
    const result = await chainlensWalletSession(impl, 'https://x', signer(), ACCOUNT)

    expect(isChainLensSession(result)).toBe(false)
    expect(result).toEqual({ error: expect.stringMatching(/different account/i), mismatch: true })
  })

  it('treats a case-different id from the server as the same account', async () => {
    const { impl } = sessionFlow({ session: { token: 'jwt', profile: { id: ACCOUNT.toUpperCase() } } })
    const result = await chainlensWalletSession(impl, 'https://x', signer(), ACCOUNT)
    expect(isChainLensSession(result)).toBe(true)
  })

  it('surfaces the server’s own wording, and flags a mismatch as not retryable', async () => {
    const { impl } = sessionFlow({ status: 403, body: { error: 'This wallet is not a verified wallet on that ChainLens account.' } })
    const result = await chainlensWalletSession(impl, 'https://x', signer(), ACCOUNT)

    expect(result).toEqual({
      error: 'This wallet is not a verified wallet on that ChainLens account.',
      mismatch: true,
    })
  })

  it('flags a 404 as a mismatch too — both are fixed from Profile', async () => {
    const { impl } = sessionFlow({ status: 404, body: { error: 'No ChainLens account has that ID.' } })
    const result = await chainlensWalletSession(impl, 'https://x', signer(), ACCOUNT)
    expect(result).toMatchObject({ mismatch: true })
  })

  // A backend that predates this route answers Express's HTML "Cannot POST",
  // which is a 404 with no JSON error — indistinguishable from "no such
  // account" unless it is called out, and it cost real diagnosis time once.
  it('names an out-of-date backend instead of blaming the account', async () => {
    const html = (async (url: string) => {
      if (String(url).endsWith('/api/auth/nonce')) {
        return new Response(JSON.stringify({ nonce: 'abc123' }), { status: 200 })
      }
      return new Response('<!DOCTYPE html><pre>Cannot POST /api/auth/wallet-session</pre>', {
        status: 404, headers: { 'Content-Type': 'text/html' },
      })
    }) as unknown as typeof fetch

    const result = await chainlensWalletSession(html, 'https://x', signer(), ACCOUNT)
    expect(result).toEqual({
      error: expect.stringMatching(/does not support wallet sign-in yet/i),
      // Not a mismatch: nothing about the account is wrong.
      mismatch: false,
    })
  })

  it('reports an unexpected non-JSON status without guessing at a cause', async () => {
    const gateway = (async (url: string) => {
      if (String(url).endsWith('/api/auth/nonce')) {
        return new Response(JSON.stringify({ nonce: 'abc123' }), { status: 200 })
      }
      return new Response('<html>502 Bad Gateway</html>', { status: 502 })
    }) as unknown as typeof fetch

    const result = await chainlensWalletSession(gateway, 'https://x', signer(), ACCOUNT)
    expect(result).toEqual({ error: 'ChainLens returned an unexpected 502.', mismatch: false })
  })

  // A 5xx or a dropped connection is worth retrying; a rejected identity is not.
  it('does not flag a server error as a mismatch', async () => {
    const { impl } = sessionFlow({ status: 500, body: { error: 'Could not start a ChainLens session' } })
    const result = await chainlensWalletSession(impl, 'https://x', signer(), ACCOUNT)
    expect(result).toEqual({ error: 'Could not start a ChainLens session', mismatch: false })
  })

  it('reports a reachable failure rather than throwing when offline', async () => {
    const offline = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    const result = await chainlensWalletSession(offline, 'https://x', signer(), ACCOUNT)
    expect(result).toEqual({ error: expect.stringMatching(/unreachable/i), mismatch: false })
  })

  it('rejects an incomplete session payload', async () => {
    const { impl } = sessionFlow({ session: { token: 'jwt' } })
    const result = await chainlensWalletSession(impl, 'https://x', signer(), ACCOUNT)
    expect(isChainLensSession(result)).toBe(false)
  })

  it('signs the same message the server rebuilds', async () => {
    const sign = vi.fn(async () => '0xsig')
    const { impl } = sessionFlow()
    await chainlensWalletSession(impl, 'https://x', signer(sign), ACCOUNT)
    expect(sign).toHaveBeenCalledWith(`ChainLens login\nAddress: ${ADDRESS}\nNonce: abc123`)
  })
})
