/**
 * passkey-reconcile.ts — MagicMoney Wallet
 *
 * Drop local index rows for credentials the relying party has forgotten.
 *
 * WHY. A passkey deleted in a site's account settings is gone server-side, but
 * the wallet's index still lists it. Username-less sign-in then enumerates that
 * row, our authenticator signs with a perfectly valid key, and the server
 * answers "Passkey not recognised" — a failure the user cannot act on, because
 * everything on the device looks right. Observed live on chainlensnft.info.
 *
 * ⚠ THE DANGEROUS DIRECTION IS DELETING TOO MUCH. This code removes discovery
 * rows, and a wrong answer from the server would silently cost the user every
 * passkey they can find on this device. So the burden of proof sits on the
 * DELETE side: an answer must be positively authoritative before a single row
 * goes. "The server said nothing" and "the server said none" are not the same
 * as "the user has none", and ChainLens's own /list endpoint cannot currently
 * tell them apart — it answers `200 {passkeys: []}` when the table is missing
 * and when any query throws, not only when the account truly has none. See
 * `chainlensPasskeys` for how that is handled.
 *
 * SCOPE. Only ever one rpId at a time. A relying party is authoritative about
 * its OWN credentials and nothing else, so a row for another site is never
 * touched — that would be one site's outage deleting another site's sign-in.
 */

import { deriveWebauthnRoot } from './webauthn-authenticator'
import { loadIndex, removeRecord, PASSKEY_INDEX_UNREADABLE, type PasskeyCredentialRecord } from './passkey-index'
import type { PasskeyEnvironment } from './passkey-ceremony'
import {
  accountUserHandle as accountUserHandle_, chainlensWalletLogin,
  type ChainLensSession, type WalletSigner,
} from './chainlens-auth'

/** What a relying party says it still holds. */
export interface RelyingPartyPasskeys {
  /** Credential ids, base64url, exactly as the RP stores them. */
  credentialIds: string[]
  /**
   * Whether this answer is trustworthy enough to DELETE on. False for any
   * error, any unauthenticated call, and any response that could equally mean
   * "the server is misconfigured". False makes reconciliation a no-op rather
   * than a purge.
   */
  authoritative: boolean
  /**
   * The userHandle of the account this list belongs to, base64url — for
   * ChainLens, its user id (register-options sets `userID` to exactly that).
   *
   * ⚠ THE LIST IS ONLY AUTHORITATIVE ABOUT ITS OWN ACCOUNT. Signing in with the
   * wallet key authenticates the wallet-ADDRESS account, which is not
   * necessarily the account holding the passkeys — someone whose ChainLens
   * login is Google has passkeys elsewhere, and the account we reached has a
   * legitimately empty list. Pruning on that would delete every valid row, so
   * only rows carrying THIS userHandle are ever candidates for removal.
   */
  accountUserHandle: string
}

/**
 * Which local rows this relying party no longer recognises.
 *
 * Pure, so the rule that decides deletion is testable on its own — it is the
 * part that can lose data.
 */
export function recordsToForget(
  local: PasskeyCredentialRecord[], rpId: string, rp: RelyingPartyPasskeys,
): PasskeyCredentialRecord[] {
  if (!rp.authoritative) return []
  // No account identity ⇒ we cannot tell whose list this is ⇒ delete nothing.
  if (!rp.accountUserHandle) return []
  const known = new Set(rp.credentialIds)
  return local.filter(r =>
    r.rpId === rpId &&
    r.userHandle === rp.accountUserHandle &&   // this account's rows only
    !known.has(r.credentialId))
}

/**
 * Prune the index for one relying party. Returns how many rows were forgotten.
 *
 * Forgetting is a discovery change only: the credential is a function of the
 * seed and still signs whenever a site names it. That is precisely why this is
 * safe to do automatically, and why it can never be a substitute for the user
 * revoking a passkey in the site's own settings.
 */
export async function reconcileRelyingParty(
  env: PasskeyEnvironment, rpId: string, lookup: () => Promise<RelyingPartyPasskeys>,
): Promise<number> {
  const rp = await lookup()
  if (!rp.authoritative) return 0

  const mnemonic = await env.loadMnemonic()          // throws when locked
  const indexKey = await deriveWebauthnRoot(mnemonic, 0)

  let local: PasskeyCredentialRecord[]
  try {
    local = await loadIndex(env.storage, indexKey)
  } catch (e) {
    // An index we cannot read is one we must not rewrite.
    if (e instanceof Error && e.message === PASSKEY_INDEX_UNREADABLE) return 0
    throw e
  }

  const doomed = recordsToForget(local, rpId, rp)
  for (const record of doomed) {
    await removeRecord(env.storage, indexKey, record.rpId, record.credentialId)
  }
  return doomed.length
}

/**
 * Reconcile the ChainLens rows, end to end. Returns how many were forgotten.
 *
 * ⚠ Reaches the network ONLY when the wallet already holds ChainLens passkeys.
 * `wallet-login` upserts an account, so calling it speculatively would create a
 * ChainLens account for a user who never asked for one; having a passkey for the
 * site is the evidence that they already use it.
 *
 * Best-effort: a locked wallet, no network or a failed login all return 0. The
 * local index keeps working regardless — this only ever removes rows the server
 * has positively disowned.
 */
export async function reconcileChainLens(
  env: PasskeyEnvironment,
  origin: string,
  rpId: string,
  signer: WalletSigner,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  try {
    const mnemonic = await env.loadMnemonic()          // throws when locked
    const indexKey = await deriveWebauthnRoot(mnemonic, 0)

    let local: PasskeyCredentialRecord[]
    try {
      local = await loadIndex(env.storage, indexKey)
    } catch {
      return 0
    }
    // Nothing for this site ⇒ no reason to touch the network at all.
    if (!local.some(r => r.rpId === rpId)) return 0

    const session = await chainlensWalletLogin(fetchImpl, origin, signer)
    if (!session) return 0

    return await reconcileRelyingParty(env, rpId, () => chainlensPasskeys(fetchImpl, origin, session))
  } catch {
    return 0
  }
}

/**
 * Ask ChainLens which passkeys it still holds for the signed-in account.
 *
 * ⚠ AN EMPTY LIST IS ONLY BELIEVED WHEN THE SERVER SAYS IT MEANS IT. `/list`
 * has historically answered `200 {passkeys: []}` when passkeys are unconfigured
 * and when the query throws, not only when the account has none — so acting on a
 * bare empty list would let a database hiccup delete the user's whole local
 * passkey list. The endpoint now sends `configured` and `unavailable` alongside,
 * which separate "none" from "don't know".
 *
 * Against an older server those flags are absent, and then a non-empty list is
 * the only thing trusted. The cost of that fallback is that deleting your LAST
 * passkey leaves one stale row behind, failing exactly as it does today; the
 * benefit is that no transient fault can purge the index. This client must stay
 * safe against a backend that has not been deployed yet.
 */
export async function chainlensPasskeys(
  fetchImpl: typeof fetch, origin: string, session: ChainLensSession,
): Promise<RelyingPartyPasskeys> {
  const accountUserHandle = accountUserHandle_(session.userId)
  const unknown = { credentialIds: [], authoritative: false, accountUserHandle }
  try {
    const res = await fetchImpl(`${origin}/api/auth/passkey/list`, {
      headers: { Authorization: `Bearer ${session.token}` },
    })
    if (!res.ok) return unknown
    const body = await res.json() as {
      passkeys?: Array<{ credential_id?: string }>
      configured?: boolean
      unavailable?: boolean
    }
    const ids = (body.passkeys ?? [])
      .map(p => p.credential_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)

    // A server that reports its own health: believe an empty list only when it
    // says passkeys are configured AND the lookup actually succeeded.
    if (typeof body.configured === 'boolean') {
      return {
        credentialIds: ids,
        authoritative: body.configured && body.unavailable !== true,
        accountUserHandle,
      }
    }
    // Older server, no flags — trust nothing but a non-empty list.
    return { credentialIds: ids, authoritative: ids.length > 0, accountUserHandle }
  } catch {
    return unknown
  }
}
