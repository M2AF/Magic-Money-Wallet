/**
 * password-vault.ts — MagicMoney Wallet
 *
 * Encrypted store for WEBSITE logins saved in the built-in browser. Completely
 * separate from the wallet seed (wallet.enc) — a compromised site password must
 * never sit in the same blob as the recovery phrase — but it reuses the SAME
 * password and the same primitives, so the user has one secret to remember.
 *
 * At rest, passwords.enc holds   safeStorage.encrypt( JSON(EncryptedBlob) )
 *   where EncryptedBlob = encryptSecret(JSON(PasswordEntry[]), walletPassword)
 *   — i.e. AES-256-GCM under a PBKDF2-SHA256(600k) key, wrapped again by the OS
 *   keychain. Exactly the layering persistEncryptedMnemonic uses (secure-store.ts).
 *
 * Session model: the vault is opened separately from the wallet. Unlocking it
 * caches the decrypted entries AND the password in memory (the password is needed
 * to re-encrypt on every write; the wallet already holds a strictly more sensitive
 * secret — the mnemonic — the same way). Both are cleared by lockPasswords(),
 * which the wallet's lock() and idle auto-lock call, so the vault can never
 * outlive an unlocked wallet.
 *
 * Plaintext passwords leave this module only for:
 *   • an explicit "reveal"/"copy" the user clicked, and
 *   • an explicit "fill on this page" the user clicked.
 * The list APIs return metadata only.
 */

import { safeStorage, app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { encryptSecret, decryptSecret, isEncryptedBlob, type EncryptedBlob } from './crypto-vault'
import { verifyPassword } from './secure-store'

export interface PasswordEntry {
  id: string
  /** Origin or bare hostname the login belongs to, e.g. "https://app.uniswap.org". */
  url: string
  username: string
  password: string
  note?: string
  createdAt: number
  updatedAt: number
}

/** What the UI list sees — never the secret itself. */
export interface PasswordSummary {
  id: string
  url: string
  host: string
  username: string
  note?: string
  updatedAt: number
}

export interface PasswordVaultStatus {
  /** A vault file exists on disk (the user has saved at least one password). */
  exists: boolean
  unlocked: boolean
  count: number
  /** False when the OS keychain is unavailable — the vault cannot be used at all. */
  available: boolean
}

const MAX_ENTRIES = 10_000

let _entries: PasswordEntry[] | null = null
let _password: string | null = null

function vaultPath(): string {
  return join(app.getPath('userData'), 'passwords.enc')
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function requireSafeStorage(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is not available, so saved passwords cannot be encrypted on this machine.')
  }
}

/** Hostname for grouping/matching. Accepts a full URL or a bare host. */
export function hostOf(raw: string): string {
  const value = (raw || '').trim()
  if (!value) return ''
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase()
  } catch {
    return value.toLowerCase()
  }
}

function sanitizeEntry(v: unknown): PasswordEntry | null {
  if (!v || typeof v !== 'object') return null
  const e = v as Record<string, unknown>
  if (typeof e.url !== 'string' || typeof e.password !== 'string') return null
  const now = Date.now()
  return {
    id: typeof e.id === 'string' && e.id ? e.id : newId(),
    url: e.url.slice(0, 2000),
    username: typeof e.username === 'string' ? e.username.slice(0, 500) : '',
    password: e.password.slice(0, 2000),
    note: typeof e.note === 'string' && e.note ? e.note.slice(0, 1000) : undefined,
    createdAt: Number.isFinite(e.createdAt) ? Number(e.createdAt) : now,
    updatedAt: Number.isFinite(e.updatedAt) ? Number(e.updatedAt) : now,
  }
}

function requireUnlocked(): PasswordEntry[] {
  if (_entries == null || _password == null) throw new Error('The password manager is locked')
  return _entries
}

async function persist(entries: PasswordEntry[]): Promise<void> {
  if (_password == null) throw new Error('The password manager is locked')
  requireSafeStorage()
  const blob = await encryptSecret(JSON.stringify(entries), _password)
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(vaultPath(), safeStorage.encryptString(JSON.stringify(blob)))
  _entries = entries
}

export function vaultExists(): boolean {
  return existsSync(vaultPath())
}

export function passwordVaultStatus(): PasswordVaultStatus {
  return {
    exists: vaultExists(),
    unlocked: _entries !== null,
    count: _entries?.length ?? 0,
    available: safeStorage.isEncryptionAvailable(),
  }
}

/**
 * Open the vault with the wallet password. Creates an empty vault on first use —
 * gated on verifyPassword so a wrong password can't silently establish a NEW
 * vault under itself (which would then reject the real password forever).
 */
export async function unlockPasswords(password: string): Promise<PasswordVaultStatus> {
  requireSafeStorage()
  if (!password) throw new Error('Enter your wallet password')

  if (!vaultExists()) {
    if (!(await verifyPassword(password))) throw new Error('Incorrect password')
    _password = password
    await persist([])
    return passwordVaultStatus()
  }

  const outer = safeStorage.decryptString(readFileSync(vaultPath()))
  const parsed: unknown = (() => { try { return JSON.parse(outer) } catch { return null } })()
  if (!isEncryptedBlob(parsed)) throw new Error('The saved-password store is corrupt')
  const json = await decryptSecret(parsed as EncryptedBlob, password)   // throws 'Incorrect password'
  const raw: unknown = (() => { try { return JSON.parse(json) } catch { return [] } })()
  _entries = (Array.isArray(raw) ? raw : []).map(sanitizeEntry).filter((e): e is PasswordEntry => e !== null)
  _password = password
  return passwordVaultStatus()
}

/** Clear the decrypted entries and the cached password. Called by the wallet's lock paths. */
export function lockPasswords(): void {
  _entries = null
  _password = null
}

export function isPasswordVaultUnlocked(): boolean {
  return _entries !== null
}

/** Metadata-only listing, newest-updated first. Never includes the secret. */
export function listPasswords(): PasswordSummary[] {
  const entries = requireUnlocked()
  return entries
    .map(e => ({ id: e.id, url: e.url, host: hostOf(e.url), username: e.username, note: e.note, updatedAt: e.updatedAt }))
    .sort((a, b) => a.host.localeCompare(b.host) || a.username.localeCompare(b.username))
}

/** The plaintext password for one entry — only ever called from an explicit user action. */
export function revealPassword(id: string): string {
  const entry = requireUnlocked().find(e => e.id === id)
  if (!entry) throw new Error('That saved password no longer exists')
  return entry.password
}

export async function savePassword(input: { id?: string; url: string; username: string; password: string; note?: string }): Promise<PasswordSummary[]> {
  const entries = [...requireUnlocked()]
  const url = (input.url || '').trim()
  if (!url) throw new Error('Enter the site address')
  if (!input.password) throw new Error('Enter the password')
  const now = Date.now()

  if (input.id) {
    const idx = entries.findIndex(e => e.id === input.id)
    if (idx < 0) throw new Error('That saved password no longer exists')
    entries[idx] = {
      ...entries[idx],
      url,
      username: (input.username || '').trim(),
      password: input.password,
      note: input.note?.trim() || undefined,
      updatedAt: now,
    }
  } else {
    if (entries.length >= MAX_ENTRIES) throw new Error('The password manager is full')
    entries.push({
      id: newId(),
      url,
      username: (input.username || '').trim(),
      password: input.password,
      note: input.note?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    })
  }

  await persist(entries)
  return listPasswords()
}

export async function deletePassword(id: string): Promise<PasswordSummary[]> {
  await persist(requireUnlocked().filter(e => e.id !== id))
  return listPasswords()
}

/**
 * Bulk-add imported logins. De-duplicates on (host, username, password) so
 * re-running an import is a no-op rather than a pile of duplicates.
 */
export async function mergePasswords(
  incoming: Array<{ url: string; username: string; password: string }>
): Promise<{ added: number; skipped: number }> {
  const entries = [...requireUnlocked()]
  const key = (host: string, user: string, pass: string) => `${host} ${user} ${pass}`
  const seen = new Set(entries.map(e => key(hostOf(e.url), e.username, e.password)))
  const now = Date.now()
  let added = 0
  let skipped = 0

  for (const item of incoming) {
    const url = (item.url || '').trim()
    if (!url || !item.password) { skipped++; continue }
    const k = key(hostOf(url), item.username || '', item.password)
    if (seen.has(k) || entries.length >= MAX_ENTRIES) { skipped++; continue }
    seen.add(k)
    entries.push({
      id: newId(),
      url,
      username: (item.username || '').trim(),
      password: item.password,
      createdAt: now,
      updatedAt: now,
    })
    added++
  }

  if (added > 0) await persist(entries)
  return { added, skipped }
}

/**
 * Logins saved for `host`, best match first. Exact hostname wins over a
 * registrable-domain suffix match, so "app.example.com" prefers its own entry
 * over a bare "example.com" one. Returns metadata only — filling the page is a
 * separate, explicitly-clicked step (see browser-manager's fillCredentials).
 */
export function matchPasswordsForHost(host: string): PasswordSummary[] {
  if (_entries == null) return []
  const target = hostOf(host)
  if (!target) return []
  const scored: Array<{ score: number; entry: PasswordEntry }> = []
  for (const entry of _entries) {
    const h = hostOf(entry.url)
    if (!h) continue
    if (h === target) scored.push({ score: 2, entry })
    else if (target.endsWith(`.${h}`) || h.endsWith(`.${target}`)) scored.push({ score: 1, entry })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.entry.username.localeCompare(b.entry.username))
    .map(({ entry }) => ({
      id: entry.id, url: entry.url, host: hostOf(entry.url),
      username: entry.username, note: entry.note, updatedAt: entry.updatedAt,
    }))
}

/** Wipe the whole vault (Danger zone / wallet delete). */
export function deletePasswordVault(): void {
  try { if (vaultExists()) unlinkSync(vaultPath()) } catch { /* best effort */ }
  lockPasswords()
}
