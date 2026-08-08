/**
 * passkey-store.ts — MagicMoney Wallet
 *
 * The Electron storage adapter for the discoverable-credential index. All the
 * logic — the AES-GCM envelope, sanitising, replace-on-re-register, the
 * unreadable-index rules — lives in passkey-index.ts so Electron and Android
 * cannot drift; this file only says WHERE the blob goes on desktop.
 *
 * `passkey-index.enc` in userData, deliberately NOT wrapped in safeStorage (for
 * the same reason wallet.passkey.enc isn't: safeStorage binds ciphertext to one
 * machine, and this has to be restorable anywhere the seed is). It SURVIVES
 * deleteWallet(), like wallet.passkey.enc — the credentials it describes outlive
 * the install, because they live in the seed.
 */

import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'
import {
  loadIndex, saveIndex, addRecord, findRecords, removeRecord,
  type PasskeyIndexStorage, type PasskeyCredentialRecord,
} from './passkey-index'

export {
  PASSKEY_INDEX_UNREADABLE, MAX_PASSKEY_RECORDS, sanitizePasskeyRecords,
  type PasskeyCredentialRecord,
} from './passkey-index'

const userData = (): string => app.getPath('userData')
const passkeyIndexPath = (): string => join(userData(), 'passkey-index.enc')

export const electronPasskeyStorage: PasskeyIndexStorage = {
  async read() {
    return existsSync(passkeyIndexPath()) ? readFileSync(passkeyIndexPath(), 'utf-8') : null
  },
  async write(blob: string) {
    mkdirSync(userData(), { recursive: true })
    writeFileSync(passkeyIndexPath(), blob)
  },
  async clear() {
    try { if (existsSync(passkeyIndexPath())) unlinkSync(passkeyIndexPath()) } catch { /* already gone */ }
  },
  async exists() {
    return existsSync(passkeyIndexPath())
  },
}

// ── Convenience wrappers bound to the Electron storage ───────────────────────

/** Does this device hold an index at all (for any wallet)? */
export function hasPasskeyIndex(): boolean {
  return existsSync(passkeyIndexPath())
}

export const loadPasskeyIndex = (indexKey: Uint8Array): Promise<PasskeyCredentialRecord[]> =>
  loadIndex(electronPasskeyStorage, indexKey)

export const savePasskeyIndex = (indexKey: Uint8Array, records: PasskeyCredentialRecord[]): Promise<void> =>
  saveIndex(electronPasskeyStorage, indexKey, records)

export const addPasskeyCredential = (indexKey: Uint8Array, record: PasskeyCredentialRecord): Promise<void> =>
  addRecord(electronPasskeyStorage, indexKey, record)

export const findPasskeyCredentials = (indexKey: Uint8Array, rpId: string): Promise<PasskeyCredentialRecord[]> =>
  findRecords(electronPasskeyStorage, indexKey, rpId)

export const removePasskeyCredential = (indexKey: Uint8Array, rpId: string, credentialId: string): Promise<void> =>
  removeRecord(electronPasskeyStorage, indexKey, rpId, credentialId)

/**
 * Drop the whole index. Explicit user action only — nothing in the wallet
 * lifecycle calls this, and deleteWallet() deliberately leaves it alone.
 */
export function clearPasskeyIndex(): void {
  try { if (existsSync(passkeyIndexPath())) unlinkSync(passkeyIndexPath()) } catch { /* already gone */ }
}
