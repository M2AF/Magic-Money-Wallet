/**
 * chainlens-auth.ts — MagicMoney Wallet
 *
 * A ChainLens session obtained from the wallet's own key, with no password and
 * no browser: `POST /api/auth/nonce` → sign → `POST /api/auth/wallet-login`.
 *
 * Built for passkey reconciliation, which has to ask ChainLens which
 * credentials it still holds. The index sync will use the same session.
 *
 * ⚠ WALLET-LOGIN CREATES AN ACCOUNT WHEN NONE EXISTS. With no Authorization
 * header the server upserts a user keyed by the wallet address, so calling this
 * is not a read-only act — it can mint a ChainLens account for someone who
 * never asked for one. Two consequences the callers here must respect:
 *
 *   1. Never call it speculatively. Reconciliation only reaches for a session
 *      when the wallet actually holds ChainLens passkeys, i.e. when the user
 *      demonstrably already uses the service.
 *
 *   2. The account this returns is NOT NECESSARILY THE ONE THAT OWNS THE
 *      PASSKEYS. A user whose ChainLens account is a Google login has passkeys
 *      under that account, while this signs in as the wallet-address account —
 *      a different, possibly brand-new, one whose passkey list is legitimately
 *      empty. Pruning against it would delete every valid row. That is why the
 *      session carries `userId` and every caller must match it against the
 *      credential's own userHandle rather than assuming the two agree.
 *
 * Best-effort throughout: this backs a background convenience, so every failure
 * returns null rather than throwing into a caller that cannot act on it.
 */

/** An authenticated ChainLens session. `userId` is the identity that matters. */
export interface ChainLensSession {
  token: string
  /**
   * The account we actually authenticated as. A passkey belongs to this account
   * only when its userHandle carries this id — see `accountUserHandle`.
   */
  userId: string
}

/** What signing needs. Injected, so this file stays platform-neutral. */
export interface WalletSigner {
  /** The EVM address the signature will recover to. */
  address: string
  /** EIP-191 personal_sign over the exact message given. */
  signMessage(message: string): Promise<string>
}

/**
 * The message the server rebuilds and verifies. Byte-identical to
 * backend-server.js — any drift here reads as "invalid signature".
 */
export function loginMessage(address: string, nonce: string): string {
  return `ChainLens login\nAddress: ${address}\nNonce: ${nonce}`
}

/**
 * The userHandle a ChainLens passkey carries for an account.
 *
 * register-options sets `userID: new TextEncoder().encode(user.id)`, and the
 * wallet index stores that as base64url — so this is how a stored credential
 * names the account it belongs to.
 */
export function accountUserHandle(userId: string): string {
  return Buffer.from(userId, 'utf8').toString('base64url')
}

/** Why a session could not be issued, in words the UI can show as-is. */
export interface ChainLensSessionError {
  error: string
  /** True when the account exists but this wallet is not verified on it. */
  mismatch: boolean
}

/**
 * A session for the account the wallet is ALREADY SHOWING — not whichever one
 * the address happens to resolve to.
 *
 * This is what the Messenger signs in with, and the reason it exists is the
 * warning at the top of this file. `wallet-login` upserts ('evm_wallet', addr)
 * and hands back whatever that produces; for a user whose ChainLens account is
 * keyed by a Solana wallet or a Google login, that is a DIFFERENT account from
 * the one ProfilePage displays — a second identity with no social link, so
 * permanently ineligible for chat, showing a ChainLens ID that nobody can add.
 *
 * So the caller names the account. `POST /api/auth/wallet-session` verifies the
 * signing address is a proved (non-watch-only) wallet of exactly that account
 * and issues a JWT for it, or refuses. It never creates or links anything, so
 * unlike `chainlensWalletLogin` this one is safe to call speculatively.
 *
 * Returns the session, or a message to put in front of the user. The two failure
 * shapes are distinguished because only one of them is worth a retry: a network
 * blip says "try again", "not your account" says "open Profile and sync".
 */
export async function chainlensWalletSession(
  fetchImpl: typeof fetch, origin: string, signer: WalletSigner, chainlensId: string,
): Promise<ChainLensSession | ChainLensSessionError> {
  const fail = (error: string, mismatch = false): ChainLensSessionError => ({ error, mismatch })
  try {
    const nonceRes = await fetchImpl(`${origin}/api/auth/nonce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: signer.address }),
    })
    if (!nonceRes.ok) return fail('ChainLens is unreachable right now.')
    const { nonce } = await nonceRes.json() as { nonce?: string }
    if (typeof nonce !== 'string' || nonce.length === 0) return fail('ChainLens is unreachable right now.')

    const signature = await signer.signMessage(loginMessage(signer.address, nonce))

    const res = await fetchImpl(`${origin}/api/auth/wallet-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chainlens_id: chainlensId, address: signer.address, signature, nonce }),
    })
    const body = await res.json().catch(() => null) as { token?: string; profile?: { id?: string }; error?: string } | null

    // A ChainLens error always arrives as JSON with an `error`. Anything else —
    // Express's HTML "Cannot POST", a proxy page — means this build is talking
    // to a backend that predates this route, which is a deployment state, not a
    // rejected identity. Worth saying plainly: the two look identical otherwise
    // (both land as a 404) and the generic wording sent us hunting the account.
    if (!res.ok && !body?.error) {
      return fail(
        res.status === 404
          ? 'This ChainLens server does not support wallet sign-in yet. Update the ChainLens backend.'
          : `ChainLens returned an unexpected ${res.status}.`,
      )
    }
    if (!res.ok) return fail(body!.error!, res.status === 403 || res.status === 404)
    if (typeof body?.token !== 'string' || typeof body.profile?.id !== 'string') {
      return fail('ChainLens returned an incomplete session.')
    }

    // Belt and braces. The server binds `sub` to the id we sent, but the whole
    // point of this route is that chat runs as the identity the wallet displays
    // — so verify it here too rather than trust the round trip.
    if (body.profile.id.toLowerCase() !== chainlensId.toLowerCase()) {
      return fail('ChainLens signed in as a different account. Open Profile and sync.', true)
    }

    return { token: body.token, userId: body.profile.id }
  } catch {
    return fail('ChainLens is unreachable right now.')
  }
}

/** Narrow the union `chainlensWalletSession` returns. */
export function isChainLensSession(
  value: ChainLensSession | ChainLensSessionError,
): value is ChainLensSession {
  return typeof (value as ChainLensSession).token === 'string'
}

export async function chainlensWalletLogin(
  fetchImpl: typeof fetch, origin: string, signer: WalletSigner,
): Promise<ChainLensSession | null> {
  try {
    const nonceRes = await fetchImpl(`${origin}/api/auth/nonce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: signer.address }),
    })
    if (!nonceRes.ok) return null
    const { nonce } = await nonceRes.json() as { nonce?: string }
    if (typeof nonce !== 'string' || nonce.length === 0) return null

    const signature = await signer.signMessage(loginMessage(signer.address, nonce))

    const loginRes = await fetchImpl(`${origin}/api/auth/wallet-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain: 'evm', address: signer.address, signature, nonce }),
    })
    if (!loginRes.ok) return null
    const body = await loginRes.json() as { token?: string; profile?: { id?: string } }
    if (typeof body.token !== 'string' || typeof body.profile?.id !== 'string') return null

    return { token: body.token, userId: body.profile.id }
  } catch {
    return null
  }
}
