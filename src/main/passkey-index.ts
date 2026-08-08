/**
 * passkey-index.ts — MagicMoney Wallet
 *
 * The discoverable-credential index, minus the place it is stored.
 *
 * WHY AN INDEX EXISTS AT ALL. Credentials are stateless: given `credentialId` +
 * `rpId`, the private key re-derives from the seed and the MAC proves we minted
 * it. Nothing needs storing. The one exception is *discoverable* ("resident")
 * credentials — username-less sign-in, where the site sends no
 * `allowCredentials` and we must enumerate what we hold. That needs a list.
 *
 * WHAT LOSING IT COSTS. Discovery, and only discovery. A targeted sign-in (the
 * site supplies the credentialId) never reads this file and still works from the
 * seed alone. That is why the index is a convenience cache, not key material.
 *
 * ⚠ A MISSING INDEX MUST NEVER FALL BACK TO DERIVING A CREDENTIAL. The nonce
 * inside a credentialId is random at registration and is not recoverable from
 * rpId alone. Anything that "helpfully" invented one would mint a valid key the
 * relying party has never seen and hand back a successful-looking sign-in for
 * the wrong credential — the exact shape of the `mnemonicFromPasskeyBackup` bug.
 * Reads therefore fail loudly (see PASSKEY_INDEX_UNREADABLE); they never guess.
 *
 * AT REST. AES-256-GCM under the wallet's account-0 `webauthnRoot`, via the same
 * `encryptWithKeyMaterial` envelope that `wallet.passkey.enc` uses. Consequences,
 * all deliberate:
 *   - Unreadable without the wallet. The list of every site you hold an account
 *     on is not something to leave in plaintext beside the address book.
 *   - Keyed by `webauthnRoot`, NOT the seed — so the Android provider (Phase 4),
 *     which is only ever given the root, can read and write it too.
 *   - Per WALLET, not per install. A different wallet's index simply will not
 *     decrypt, so a new wallet cannot inherit the previous one's site list the
 *     way the dApp grants once did.
 *   - Never wrapped in the OS keystore (unlike wallet.hello.enc), for the same
 *     reason wallet.passkey.enc isn't: that binds ciphertext to one machine, and
 *     this has to be restorable anywhere the seed is.
 *
 * WHERE it is stored is the caller's business — `PasskeyIndexStorage` is a blob
 * of text. Electron writes `passkey-index.enc` in userData; Capacitor writes a
 * Preferences key. The envelope, the sanitising and the replace-on-re-register
 * rule live HERE so the two platforms cannot drift.
 */

import { encryptWithKeyMaterial, decryptWithKeyMaterial, type EncryptedBlob } from './crypto-vault'
import type { PasskeyCredentialRecord } from './passkey-protocol'

export type { PasskeyCredentialRecord }

/**
 * Thrown when the index blob is present but will not decrypt with the supplied
 * root — i.e. it belongs to a different wallet, or it is damaged. Callers must
 * surface this rather than treating it as "no credentials", because those two
 * mean very different things to the person trying to sign in.
 */
export const PASSKEY_INDEX_UNREADABLE = 'PASSKEY_INDEX_UNREADABLE'

/** Where the encrypted index lives. Text in, text out; null means "nothing yet". */
export interface PasskeyIndexStorage {
  read(): Promise<string | null>
  write(blob: string): Promise<void>
  clear(): Promise<void>
  /** Cheap existence probe, for UI that must not force a decrypt. */
  exists(): Promise<boolean>
}

/**
 * Hard cap. Each registration costs an approval dialog and a biometric check, so
 * this is not a growth path a site can drive on its own — it is a bound on how
 * much damage a corrupted or hand-edited blob can do to the read path.
 */
export const MAX_PASSKEY_RECORDS = 1000

const BASE64URL = /^[A-Za-z0-9_-]+$/

/**
 * Coerce whatever was stored into well-formed records, dropping anything that
 * isn't. The blob is authenticated, so this is not the security boundary — the
 * credentialId MAC is — but a single malformed row must not break enumeration
 * for every other site.
 */
export function sanitizePasskeyRecords(parsed: unknown): PasskeyCredentialRecord[] {
  if (!Array.isArray(parsed)) return []
  const out: PasskeyCredentialRecord[] = []
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue
    const rec = raw as Record<string, unknown>
    if (typeof rec.rpId !== 'string' || rec.rpId.length === 0) continue
    if (typeof rec.credentialId !== 'string' || !BASE64URL.test(rec.credentialId)) continue
    if (typeof rec.userHandle !== 'string') continue
    if (rec.userHandle.length > 0 && !BASE64URL.test(rec.userHandle)) continue
    const accountIndex = Number(rec.accountIndex)
    if (!Number.isInteger(accountIndex) || accountIndex < 0) continue
    const createdAt = Number(rec.createdAt)
    out.push({
      rpId: rec.rpId,
      credentialId: rec.credentialId,
      userHandle: rec.userHandle,
      userName: typeof rec.userName === 'string' ? rec.userName.slice(0, 256) : '',
      accountIndex,
      createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : 0,
    })
  }
  return out.slice(-MAX_PASSKEY_RECORDS)
}

function assertIndexKey(indexKey: Uint8Array): void {
  if (!(indexKey instanceof Uint8Array) || indexKey.length !== 32) {
    throw new Error('Passkey index key must be the 32-byte webauthnRoot')
  }
}

/**
 * Every credential this wallet has recorded.
 *
 * Nothing stored → `[]`, which honestly means "nothing registered here".
 * Stored but foreign or damaged → THROWS `PASSKEY_INDEX_UNREADABLE`.
 * Never invents a record, and never derives one.
 */
export async function loadIndex(storage: PasskeyIndexStorage, indexKey: Uint8Array): Promise<PasskeyCredentialRecord[]> {
  assertIndexKey(indexKey)
  const raw = await storage.read()
  if (raw == null) return []
  let json: string
  try {
    json = await decryptWithKeyMaterial(JSON.parse(raw) as EncryptedBlob, indexKey)
  } catch {
    // AES-GCM authentication failed, or the envelope is not parseable. Both mean
    // "this is not ours"; guessing past it is what we must never do.
    throw new Error(PASSKEY_INDEX_UNREADABLE)
  }
  try {
    return sanitizePasskeyRecords(JSON.parse(json))
  } catch {
    throw new Error(PASSKEY_INDEX_UNREADABLE)
  }
}

export async function saveIndex(
  storage: PasskeyIndexStorage, indexKey: Uint8Array, records: PasskeyCredentialRecord[],
): Promise<void> {
  assertIndexKey(indexKey)
  const blob = await encryptWithKeyMaterial(JSON.stringify(records.slice(-MAX_PASSKEY_RECORDS)), indexKey)
  await storage.write(JSON.stringify(blob))
}

/**
 * Record a newly created discoverable credential.
 *
 * Re-registering the same `(rpId, userHandle)` REPLACES the old record, matching
 * what platform authenticators do: the relying party has just stored a new
 * public key, so the previous credential is dead to it. Keeping both would offer
 * the user a credential the site would reject.
 *
 * If the stored index belongs to a different wallet, this starts a fresh one.
 * The alternative — refusing forever — would leave a newly created wallet unable
 * to register any passkey on a device that once held another. The old wallet
 * loses discovery only, which is the documented cost of losing this blob.
 */
export async function addRecord(
  storage: PasskeyIndexStorage, indexKey: Uint8Array, record: PasskeyCredentialRecord,
): Promise<void> {
  assertIndexKey(indexKey)
  const [clean] = sanitizePasskeyRecords([record])
  if (!clean) throw new Error('Refusing to index a malformed passkey record')

  let existing: PasskeyCredentialRecord[]
  try {
    existing = await loadIndex(storage, indexKey)
  } catch (e) {
    if (e instanceof Error && e.message === PASSKEY_INDEX_UNREADABLE) existing = []
    else throw e
  }

  const next = existing.filter(r => !(
    r.rpId === clean.rpId &&
    (r.credentialId === clean.credentialId || (clean.userHandle !== '' && r.userHandle === clean.userHandle))
  ))
  next.push(clean)
  await saveIndex(storage, indexKey, next)
}

/** Records for one relying party, newest first. Propagates an unreadable index. */
export async function findRecords(
  storage: PasskeyIndexStorage, indexKey: Uint8Array, rpId: string,
): Promise<PasskeyCredentialRecord[]> {
  const all = await loadIndex(storage, indexKey)
  return all.filter(r => r.rpId === rpId).sort((a, b) => b.createdAt - a.createdAt)
}

/** Forget one credential (site says it's revoked, or the user removes it). */
export async function removeRecord(
  storage: PasskeyIndexStorage, indexKey: Uint8Array, rpId: string, credentialId: string,
): Promise<void> {
  const all = await loadIndex(storage, indexKey)
  const next = all.filter(r => !(r.rpId === rpId && r.credentialId === credentialId))
  if (next.length !== all.length) await saveIndex(storage, indexKey, next)
}
