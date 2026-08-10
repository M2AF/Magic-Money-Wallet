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
  const known = new Set(rp.credentialIds)
  return local.filter(r => r.rpId === rpId && !known.has(r.credentialId))
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
  fetchImpl: typeof fetch, origin: string, token: string,
): Promise<RelyingPartyPasskeys> {
  try {
    const res = await fetchImpl(`${origin}/api/auth/passkey/list`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return { credentialIds: [], authoritative: false }
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
      return { credentialIds: ids, authoritative: body.configured && body.unavailable !== true }
    }
    // Older server, no flags — trust nothing but a non-empty list.
    return { credentialIds: ids, authoritative: ids.length > 0 }
  } catch {
    return { credentialIds: [], authoritative: false }
  }
}
