/**
 * passkey-sync.ts — MagicMoney Wallet
 *
 * The credential index, in a form a server can hold but never read.
 *
 * WHY. Credentials are derived, so the same seed reproduces the same keys on any
 * device. What does NOT travel is the knowledge that a credential EXISTS, and
 * username-less sign-in — the only kind ChainLens offers — needs exactly that.
 * So the index is shipped between a user's own devices as ciphertext, keyed by
 * their seed and stored against their ChainLens account.
 *
 * ⚠ SYNC IS AN ENHANCEMENT, NEVER THE SOURCE OF TRUTH. Every function here is
 * pure and offline. The local index keeps working with no network, no account
 * and no server, exactly as it does today; nothing in a ceremony path may block
 * on this. A sync that fails must be indistinguishable from a sync that never
 * ran.
 *
 * ⚠ AND A SYNCED ROW IS STILL ONLY A HINT. Merging is not trust: every
 * credentialId, wherever it came from, is re-verified by `parseCredentialId`
 * before anything is signed with it (see passkey-ceremony.ts). A hostile or
 * corrupted remote row can therefore cost discovery, never a wrong signature.
 * That property is what makes accepting rows from a server tolerable at all.
 *
 * ── The four rules this file exists to enforce ──────────────────────────────
 *
 * 1. DOMAIN SEPARATION, by salt AND info. The sync key must not be able to
 *    produce a credential key, nor a credential key this. A distinct `info`
 *    alone would share HKDF-Extract's PRK with the WebAuthn root; a distinct
 *    salt changes the PRK itself. Both differ here.
 *
 * 2. AES-256-GCM. The index decides which credentials get OFFERED, so a
 *    tampered or truncated blob must fail loudly rather than yield plausible
 *    rows. Authentication is the GCM tag, not a shape check — reusing
 *    `crypto-vault`'s envelope, the same one `wallet.passkey.enc` uses.
 *
 * 3. VERSIONED FROM BYTE ZERO. The derivation spec is frozen; this format is
 *    deliberately not. The version is the first field of the outer envelope and
 *    is read before anything else, so the format can change without a flag day.
 *
 * 4. MERGE, NEVER REPLACE, AND NEVER DELETE BY ABSENCE. A device that pushes
 *    before it pulls would otherwise erase another device's passkeys — the
 *    `putDiscovery` wholesale-replace defect one layer up. Rows union by
 *    credentialId; removal is an explicit tombstone and nothing else.
 *
 * ⚠ TOMBSTONES LIVE INSIDE THE CIPHERTEXT. If deletion were server-side
 * metadata, whoever holds the blob could suppress a user's passkeys at will.
 * Inside the envelope they are as unforgeable as the records.
 */

import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import * as bip39 from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'

import { encryptWithKeyMaterial, decryptWithKeyMaterial, type EncryptedBlob } from './crypto-vault'
import { sanitizePasskeyRecords, MAX_PASSKEY_RECORDS, type PasskeyCredentialRecord } from './passkey-index'

/**
 * HKDF salt for the sync key. DIFFERENT STRING from the WebAuthn root's
 * "magicmoney/webauthn" — that is rule 1, and it is the whole of it: a shared
 * salt would mean both keys came from one PRK.
 */
const SYNC_SALT = 'magicmoney/passkey-sync'

/** HKDF info. Also distinct, so the separation holds even if a salt is reused by mistake. */
const SYNC_INFO = 'sync/v1'

/** Outer envelope version. Bumped when the on-the-wire shape changes. */
export const SYNC_FORMAT_VERSION = 1

/** Thrown when a blob will not authenticate — wrong wallet, or tampered with. */
export const SYNC_BLOB_UNREADABLE = 'SYNC_BLOB_UNREADABLE'

/** Thrown for a version this build does not know how to read. */
export const SYNC_VERSION_UNSUPPORTED = 'SYNC_VERSION_UNSUPPORTED'

/**
 * An explicit removal. Absence never means deleted — only this does.
 * `deletedAt` breaks ties against a re-registration of the same credentialId.
 */
export interface PasskeyTombstone {
  credentialId: string
  rpId: string
  deletedAt: number
}

export interface SyncPayload {
  records: PasskeyCredentialRecord[]
  tombstones: PasskeyTombstone[]
}

/** The outer envelope. `v` is first, and is read before anything else. */
interface SyncEnvelope {
  v: number
  blob: EncryptedBlob
}

/**
 * The key the synced blob is encrypted under.
 *
 * Derived from the seed, so the server holds ciphertext it cannot open and no
 * account password can unlock it. Account 0's derivation is used as the wallet's
 * stable identity, matching the local index — one blob covers every account, and
 * each row carries its own accountIndex.
 */
export async function deriveSyncKey(mnemonic: string): Promise<Uint8Array> {
  const cleaned = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!bip39.validateMnemonic(cleaned, wordlist)) {
    throw new Error('Invalid BIP-39 mnemonic phrase')
  }
  const seed = await bip39.mnemonicToSeed(cleaned)
  return hkdf(sha256, seed, new TextEncoder().encode(SYNC_SALT), new TextEncoder().encode(SYNC_INFO), 32)
}

function sanitizeTombstones(parsed: unknown): PasskeyTombstone[] {
  if (!Array.isArray(parsed)) return []
  const out: PasskeyTombstone[] = []
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue
    const t = raw as Record<string, unknown>
    if (typeof t.credentialId !== 'string' || t.credentialId.length === 0) continue
    if (typeof t.rpId !== 'string' || t.rpId.length === 0) continue
    const deletedAt = Number(t.deletedAt)
    out.push({
      credentialId: t.credentialId,
      rpId: t.rpId,
      deletedAt: Number.isFinite(deletedAt) && deletedAt > 0 ? deletedAt : 0,
    })
  }
  return out.slice(-MAX_PASSKEY_RECORDS)
}

/** Encrypt a payload for the server. Version first, ciphertext second. */
export async function encodeSyncBlob(payload: SyncPayload, key: Uint8Array): Promise<string> {
  const plaintext = JSON.stringify({
    records: payload.records.slice(-MAX_PASSKEY_RECORDS),
    tombstones: payload.tombstones.slice(-MAX_PASSKEY_RECORDS),
  })
  const envelope: SyncEnvelope = { v: SYNC_FORMAT_VERSION, blob: await encryptWithKeyMaterial(plaintext, key) }
  return JSON.stringify(envelope)
}

/**
 * Decrypt a blob from the server.
 *
 * Reads the version BEFORE attempting anything else, so a future format is
 * reported as such rather than as corruption. A failed GCM tag throws — it is
 * never downgraded to "empty", because "we could not read your list" and "you
 * have no passkeys" must not look the same to the layer above.
 */
export async function decodeSyncBlob(raw: string, key: Uint8Array): Promise<SyncPayload> {
  let envelope: SyncEnvelope
  try {
    envelope = JSON.parse(raw) as SyncEnvelope
  } catch {
    throw new Error(SYNC_BLOB_UNREADABLE)
  }
  if (!envelope || typeof envelope.v !== 'number') throw new Error(SYNC_BLOB_UNREADABLE)
  if (envelope.v !== SYNC_FORMAT_VERSION) throw new Error(SYNC_VERSION_UNSUPPORTED)

  let json: string
  try {
    json = await decryptWithKeyMaterial(envelope.blob, key)
  } catch {
    throw new Error(SYNC_BLOB_UNREADABLE)
  }

  try {
    const parsed = JSON.parse(json) as { records?: unknown; tombstones?: unknown }
    return {
      records: sanitizePasskeyRecords(parsed.records),
      tombstones: sanitizeTombstones(parsed.tombstones),
    }
  } catch {
    throw new Error(SYNC_BLOB_UNREADABLE)
  }
}

/**
 * Combine two devices' views. Order-independent and idempotent.
 *
 * Union by credentialId — the credentialId is MAC-bound to (root, rpId), so it
 * is a real identity and not a stand-in for one. Two devices registering the
 * same site produce DIFFERENT credentialIds (the nonce is fresh per
 * registration), and both are genuine credentials the site may hold, so keeping
 * both is correct rather than merely safe.
 *
 * A tombstone removes a record only when it is at least as new as the record.
 * That way deleting a passkey and then registering a new one for the same site
 * does not resurrect the dead one, and re-registering the SAME credentialId
 * after a delete wins over the tombstone.
 *
 * ⚠ Deliberately never uses "missing from the other side" as evidence of
 * anything. That is how a first sync from a fresh device would wipe an
 * established one.
 */
export function mergeIndexes(local: SyncPayload, remote: SyncPayload): SyncPayload {
  const tombstones = new Map<string, PasskeyTombstone>()
  for (const t of [...local.tombstones, ...remote.tombstones]) {
    const seen = tombstones.get(t.credentialId)
    if (!seen || t.deletedAt > seen.deletedAt) tombstones.set(t.credentialId, t)
  }

  const records = new Map<string, PasskeyCredentialRecord>()
  for (const r of [...local.records, ...remote.records]) {
    const seen = records.get(r.credentialId)
    if (!seen || r.createdAt > seen.createdAt) records.set(r.credentialId, r)
  }

  const live: PasskeyCredentialRecord[] = []
  for (const r of records.values()) {
    const t = tombstones.get(r.credentialId)
    if (t && t.deletedAt >= r.createdAt) continue
    live.push(r)
  }

  live.sort((a, b) => a.createdAt - b.createdAt)
  return {
    records: live.slice(-MAX_PASSKEY_RECORDS),
    tombstones: [...tombstones.values()].sort((a, b) => a.deletedAt - b.deletedAt).slice(-MAX_PASSKEY_RECORDS),
  }
}
