/**
 * browser-data-local.ts — Android bookmarks + saved-password vault
 *
 * The Capacitor counterpart of the desktop's browser-store.ts + password-vault.ts,
 * collapsed into one module because both live behind the same storage adapter
 * (@capacitor/preferences) rather than two different ones (JSON files + safeStorage).
 *
 * Bookmarks/installed apps: plain JSON under `browser.bookmarks` / `browser.apps`.
 *
 * Passwords: `passwords.enc` holds an EncryptedBlob straight from crypto-vault
 * (PBKDF2-SHA256 600k → AES-256-GCM) under the WALLET password — the same
 * at-rest format capacitor-store.ts uses for `wallet.enc`. There is no
 * safeStorage/OS-keychain wrap here because Android has no such API exposed to
 * the WebView; the Keystore-backed layer on this platform is the biometric
 * material in biometric.ts, which guards the wallet itself.
 *
 * Session model matches desktop: unlocking caches the decrypted entries AND the
 * password (needed to re-encrypt on write) in module memory. lockPasswords() is
 * called from the same places the wallet locks, so the vault can never outlive
 * an unlocked wallet.
 */

import { Preferences } from '@capacitor/preferences'
import { encryptSecret, decryptSecret, isEncryptedBlob, type EncryptedBlob } from '../main/crypto-vault'
import { verifyPassword } from './capacitor-store'

// ── Types (shape-parity with the desktop modules) ───────────────────────────

export interface Bookmark {
  id: string
  url: string
  title: string
  addedAt: number
}

export interface WebApp {
  id: string
  url: string
  name: string
  shortcutPath: string | null
  installedAt: number
}

export interface PasswordEntry {
  id: string
  url: string
  username: string
  password: string
  note?: string
  createdAt: number
  updatedAt: number
}

export interface PasswordSummary {
  id: string
  url: string
  host: string
  username: string
  note?: string
  updatedAt: number
}

export interface PasswordVaultStatus {
  exists: boolean
  unlocked: boolean
  count: number
  available: boolean
}

const BOOKMARKS_KEY = 'browser.bookmarks'
const APPS_KEY = 'browser.apps'
const VAULT_KEY = 'passwords.enc'

const MAX_BOOKMARKS = 5000
const MAX_APPS = 500
const MAX_ENTRIES = 10_000

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

async function prefGet<T>(key: string): Promise<T | null> {
  const { value } = await Preferences.get({ key })
  if (value == null) return null
  try { return JSON.parse(value) as T } catch { return null }
}

async function prefSet(key: string, value: unknown): Promise<void> {
  await Preferences.set({ key, value: JSON.stringify(value) })
}

/** Canonical comparable form of a URL for "is this page already bookmarked?". */
export function canonicalUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    u.hash = ''
    if (u.pathname === '/') u.pathname = ''
    return u.toString()
  } catch {
    return null
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

// ── Bookmarks ────────────────────────────────────────────────────────────────

let bookmarksCache: Bookmark[] | null = null

function pickBookmark(v: unknown): Bookmark | null {
  if (!v || typeof v !== 'object') return null
  const b = v as Record<string, unknown>
  const url = typeof b.url === 'string' ? canonicalUrl(b.url) : null
  if (!url) return null
  return {
    id: typeof b.id === 'string' && b.id ? b.id : newId(),
    url,
    title: typeof b.title === 'string' ? b.title.slice(0, 300) : url,
    addedAt: Number.isFinite(b.addedAt) ? Number(b.addedAt) : Date.now(),
  }
}

export async function getBookmarks(): Promise<Bookmark[]> {
  if (bookmarksCache) return bookmarksCache
  const raw = await prefGet<unknown[]>(BOOKMARKS_KEY)
  bookmarksCache = (Array.isArray(raw) ? raw : [])
    .map(pickBookmark)
    .filter((b): b is Bookmark => b !== null)
    .slice(0, MAX_BOOKMARKS)
  return bookmarksCache
}

async function saveBookmarks(list: Bookmark[]): Promise<Bookmark[]> {
  bookmarksCache = list
  await prefSet(BOOKMARKS_KEY, list)
  return list
}

export async function isBookmarked(url: string): Promise<boolean> {
  const canonical = canonicalUrl(url)
  if (!canonical) return false
  return (await getBookmarks()).some(b => b.url === canonical)
}

export async function addBookmark(url: string, title: string): Promise<Bookmark[]> {
  const canonical = canonicalUrl(url)
  if (!canonical) return getBookmarks()
  const list = [...await getBookmarks()]
  const clean = (title || canonical).trim().slice(0, 300)
  const existing = list.findIndex(b => b.url === canonical)
  if (existing >= 0) {
    list[existing] = { ...list[existing], title: clean }
    return saveBookmarks(list)
  }
  if (list.length >= MAX_BOOKMARKS) return list
  return saveBookmarks([{ id: newId(), url: canonical, title: clean, addedAt: Date.now() }, ...list])
}

export async function removeBookmark(id: string): Promise<Bookmark[]> {
  return saveBookmarks((await getBookmarks()).filter(b => b.id !== id))
}

export async function removeBookmarkByUrl(url: string): Promise<Bookmark[]> {
  const canonical = canonicalUrl(url)
  if (!canonical) return getBookmarks()
  return saveBookmarks((await getBookmarks()).filter(b => b.url !== canonical))
}

export async function renameBookmark(id: string, title: string): Promise<Bookmark[]> {
  const list = (await getBookmarks()).map(b =>
    b.id === id ? { ...b, title: title.trim().slice(0, 300) || b.url } : b)
  return saveBookmarks(list)
}

// ── Installed web apps (home-screen shortcuts) ───────────────────────────────

let appsCache: WebApp[] | null = null

export async function getWebApps(): Promise<WebApp[]> {
  if (appsCache) return appsCache
  const raw = await prefGet<WebApp[]>(APPS_KEY)
  appsCache = (Array.isArray(raw) ? raw : []).filter(a => a && typeof a.url === 'string').slice(0, MAX_APPS)
  return appsCache
}

export async function recordWebApp(url: string, name: string): Promise<WebApp[]> {
  const canonical = canonicalUrl(url)
  if (!canonical) return getWebApps()
  const list = (await getWebApps()).filter(a => a.url !== canonical)
  const next = [{ id: newId(), url: canonical, name, shortcutPath: null, installedAt: Date.now() }, ...list]
  appsCache = next
  await prefSet(APPS_KEY, next)
  return next
}

export async function forgetWebApp(id: string): Promise<WebApp[]> {
  const next = (await getWebApps()).filter(a => a.id !== id)
  appsCache = next
  await prefSet(APPS_KEY, next)
  return next
}

export async function isWebAppInstalled(url: string): Promise<boolean> {
  const canonical = canonicalUrl(url)
  if (!canonical) return false
  return (await getWebApps()).some(a => a.url === canonical)
}

// ── Password vault ───────────────────────────────────────────────────────────

let _entries: PasswordEntry[] | null = null
let _password: string | null = null

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
  const blob = await encryptSecret(JSON.stringify(entries), _password)
  await prefSet(VAULT_KEY, blob)
  _entries = entries
}

export async function vaultExists(): Promise<boolean> {
  return (await prefGet<unknown>(VAULT_KEY)) !== null
}

export async function passwordVaultStatus(): Promise<PasswordVaultStatus> {
  return {
    exists: await vaultExists(),
    unlocked: _entries !== null,
    count: _entries?.length ?? 0,
    available: true,   // WebCrypto is always present in the Android WebView
  }
}

/**
 * Open the vault with the wallet password. Creates an empty vault on first use,
 * gated on verifyPassword so a wrong password can't silently establish a NEW
 * vault under itself (which would then reject the real password forever).
 */
export async function unlockPasswords(password: string): Promise<PasswordVaultStatus> {
  if (!password) throw new Error('Enter your wallet password')

  const stored = await prefGet<unknown>(VAULT_KEY)
  if (stored == null) {
    if (!(await verifyPassword(password))) throw new Error('Incorrect password')
    _password = password
    await persist([])
    return passwordVaultStatus()
  }

  if (!isEncryptedBlob(stored)) throw new Error('The saved-password store is corrupt')
  const json = await decryptSecret(stored as EncryptedBlob, password)   // throws 'Incorrect password'
  const raw: unknown = (() => { try { return JSON.parse(json) } catch { return [] } })()
  _entries = (Array.isArray(raw) ? raw : []).map(sanitizeEntry).filter((e): e is PasswordEntry => e !== null)
  _password = password
  return passwordVaultStatus()
}

export function lockPasswords(): void {
  _entries = null
  _password = null
}

export function isPasswordVaultUnlocked(): boolean {
  return _entries !== null
}

export function listPasswords(): PasswordSummary[] {
  return requireUnlocked()
    .map(e => ({ id: e.id, url: e.url, host: hostOf(e.url), username: e.username, note: e.note, updatedAt: e.updatedAt }))
    .sort((a, b) => a.host.localeCompare(b.host) || a.username.localeCompare(b.username))
}

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
      id: newId(), url,
      username: (input.username || '').trim(),
      password: input.password,
      note: input.note?.trim() || undefined,
      createdAt: now, updatedAt: now,
    })
  }

  await persist(entries)
  return listPasswords()
}

export async function deletePassword(id: string): Promise<PasswordSummary[]> {
  await persist(requireUnlocked().filter(e => e.id !== id))
  return listPasswords()
}

/** Bulk-add imported logins, de-duplicated on (host, username, password). */
export async function mergePasswords(
  incoming: Array<{ url: string; username: string; password: string }>
): Promise<{ added: number; skipped: number }> {
  const entries = [...requireUnlocked()]
  const key = (host: string, user: string, pass: string) => `${host} ${user} ${pass}`
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
      id: newId(), url,
      username: (item.username || '').trim(),
      password: item.password,
      createdAt: now, updatedAt: now,
    })
    added++
  }

  if (added > 0) await persist(entries)
  return { added, skipped }
}

/** Logins saved for `host`, exact-host matches first. Metadata only. */
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

export async function deletePasswordVault(): Promise<void> {
  lockPasswords()
  await Preferences.remove({ key: VAULT_KEY })
}
