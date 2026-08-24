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
import { historyHost, type HistoryEntry, type HistorySnapshot } from '../shared/history-wire'
import {
  encryptSecret, decryptSecret, isEncryptedBlob,
  encryptWithKeyMaterial, decryptWithKeyMaterial, type EncryptedBlob,
} from '../main/crypto-vault'
import { verifyPassword } from './capacitor-store'
// Resolves to src/ios/biometric.ts on the iOS build (vite.ios.config.ts alias).
// Both modules expose this same contract, so nothing below branches on platform.
import {
  biometricCapability, passwordGateEnrollMaterial, passwordGateGetMaterial,
  passwordGateDeleteMaterial, BIO_MATERIAL_MISSING,
} from './biometric'

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

export interface PasswordBioStatus {
  supported: boolean
  enrolled: boolean
  method: string | null
}

const BOOKMARKS_KEY = 'browser.bookmarks'
const HISTORY_KEY = 'browser.history'
const APPS_KEY = 'browser.apps'
const VAULT_KEY = 'passwords.enc'
const VAULT_BIO_KEY = 'passwords.hello.enc'

const MAX_BOOKMARKS = 5000
// Lower than the desktop's 3000: this whole list is one Preferences string that
// is JSON-parsed on a phone, and 2000 entries is already weeks of browsing.
const MAX_HISTORY = 2000
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

// ── History ─────────────────────────────────────────────────────────────────
//
// The mobile half of the desktop's browser-store.ts history, over the same wire
// contract (shared/history-wire.ts) because one React panel renders both. There
// is no native counterpart: DappBrowserPlugin already emits urlChanged and
// titleChanged on Android AND iOS, so BrowserOverlay records from the WebView
// layer and no Java or Swift is involved.
//
// NOT written while Tor Mode is on. That gate lives in BrowserOverlay, which is
// what holds the Tor state; this module has no idea what the proxy is doing.

let historyCache: HistoryEntry[] | null = null

function pickHistory(v: unknown): HistoryEntry | null {
  if (!v || typeof v !== 'object') return null
  const h = v as Record<string, unknown>
  const url = typeof h.url === 'string' ? canonicalUrl(h.url) : null
  if (!url) return null
  return {
    id: typeof h.id === 'string' && h.id ? h.id : newId(),
    url,
    title: typeof h.title === 'string' ? h.title.slice(0, 300) : '',
    host: typeof h.host === 'string' && h.host ? h.host : historyHost(url),
    lastVisitedAt: Number.isFinite(h.lastVisitedAt) ? Number(h.lastVisitedAt) : Date.now(),
    visits: Number.isFinite(h.visits) && Number(h.visits) > 0 ? Math.floor(Number(h.visits)) : 1,
  }
}

export async function getHistory(): Promise<HistoryEntry[]> {
  if (historyCache) return historyCache
  const raw = await prefGet<unknown[]>(HISTORY_KEY)
  historyCache = (Array.isArray(raw) ? raw : [])
    .map(pickHistory)
    .filter((h): h is HistoryEntry => h !== null)
    .slice(0, MAX_HISTORY)
  return historyCache
}

async function saveHistory(list: HistoryEntry[]): Promise<HistoryEntry[]> {
  historyCache = list
  await prefSet(HISTORY_KEY, list)
  return list
}

/**
 * Record a visit. A repeat of the same canonical URL bumps its counter and moves
 * to the front rather than appending a duplicate — that is what makes `visits`
 * meaningful for ranking suggestions, and what stops a page reloaded twenty
 * times from burying everything else.
 *
 * An empty title never overwrites one already known for the URL: urlChanged
 * arrives before the document has a title, and updateHistoryTitle fills it in.
 */
export async function recordVisit(rawUrl: string, title = ''): Promise<HistoryEntry[]> {
  const url = canonicalUrl(rawUrl)
  if (!url) return getHistory()
  const clean = title.trim().slice(0, 300)
  const list = await getHistory()
  const existing = list.findIndex(h => h.url === url)
  if (existing >= 0) {
    const prev = list[existing]
    const next: HistoryEntry = {
      ...prev,
      title: clean || prev.title,
      lastVisitedAt: Date.now(),
      visits: prev.visits + 1,
    }
    return saveHistory([next, ...list.slice(0, existing), ...list.slice(existing + 1)])
  }
  const fresh: HistoryEntry = {
    id: newId(),
    url,
    title: clean,
    host: historyHost(url),
    lastVisitedAt: Date.now(),
    visits: 1,
  }
  return saveHistory([fresh, ...list].slice(0, MAX_HISTORY))
}

/**
 * Fill in the title once the document has one. Deliberately not a visit and not
 * a reorder — a page that renames its own tab repeatedly (a chat app showing an
 * unread count) would otherwise churn this store on every update.
 */
export async function updateHistoryTitle(rawUrl: string, title: string): Promise<void> {
  const url = canonicalUrl(rawUrl)
  const clean = title.trim().slice(0, 300)
  if (!url || !clean) return
  const list = await getHistory()
  const at = list.findIndex(h => h.url === url)
  if (at < 0 || list[at].title === clean) return
  const next = [...list]
  next[at] = { ...next[at], title: clean }
  await saveHistory(next)
}

export async function removeHistoryEntry(id: string): Promise<HistoryEntry[]> {
  return saveHistory((await getHistory()).filter(h => h.id !== id))
}

/** "Forget this site" — every page from one host at once. */
export async function removeHistoryByHost(host: string): Promise<HistoryEntry[]> {
  const target = host.trim().toLowerCase()
  if (!target) return getHistory()
  return saveHistory((await getHistory()).filter(h => h.host !== target))
}

export async function clearHistory(): Promise<HistoryEntry[]> {
  return saveHistory([])
}

/**
 * Whether visits are being written down right now.
 *
 * Set by BrowserOverlay, which is what holds the Tor state — visits made with
 * Tor Mode on are deliberately never recorded. It lives here rather than in
 * wallet-local because wallet-local already imports BrowserOverlay (for
 * HOME_URL), and importing back the other way would close a module cycle.
 */
let _recording = true

export function setHistoryRecording(recording: boolean): void {
  _recording = recording
}

/** Wrap a list as the snapshot every history read returns. */
export function historySnapshot(items: HistoryEntry[]): HistorySnapshot {
  return {
    items,
    recording: _recording,
    ...(_recording ? {} : { pausedReason: 'Tor Mode is on — pages are not being added to history.' }),
  }
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

// ── Biometric unlock for the vault (optional, additive) ──────────────────────
//
// 'passwords.hello.enc' holds the vault password wrapped (HKDF → AES-GCM) by
// key material the platform releases only after a biometric gesture — the same
// shape biometric.ts uses for 'wallet.hello.enc', and the same doctrine: it is
// a convenience factor, and the typed password stays the recovery path.
//
// ⚠ The gate runs under its OWN Keystore/Enclave entry (PASSWORD_CRED_SERVER /
// PASSWORD_MATERIAL_KEY in biometric.ts). Borrowing the wallet's would let a
// password-manager prompt reach a self-heal that deletes 'wallet.hello.enc' and
// silently disable biometric WALLET unlock. Nothing here writes that key.

async function bioBlob(): Promise<EncryptedBlob | null> {
  const stored = await prefGet<unknown>(VAULT_BIO_KEY)
  return isEncryptedBlob(stored) ? (stored as EncryptedBlob) : null
}

/** Drop the biometric copy. Never touches 'wallet.hello.enc' — see the note above. */
async function dropBioCopy(): Promise<void> {
  await Preferences.remove({ key: VAULT_BIO_KEY })
}

export async function passwordBioStatus(): Promise<PasswordBioStatus> {
  const { supported, method } = await biometricCapability()
  return { supported, enrolled: (await bioBlob()) !== null, method }
}

/**
 * Turn biometric unlock on. Requires the vault to be OPEN — the password being
 * wrapped is the one cached by unlockPasswords, so the user has just typed it.
 */
export async function enrollPasswordBio(): Promise<boolean> {
  if (_password == null) throw new Error('Unlock the password manager first')
  const { supported } = await biometricCapability()
  if (!supported) throw new Error('Biometric unlock is not available on this device')
  const material = await passwordGateEnrollMaterial()
  await prefSet(VAULT_BIO_KEY, await encryptWithKeyMaterial(_password, material))
  return true
}

/**
 * Open the vault with a biometric gesture instead of typing the password. The
 * recovered password goes through unlockPasswords, so every check the typed
 * path makes still runs.
 */
export async function unlockPasswordsWithBio(): Promise<PasswordVaultStatus> {
  const blob = await bioBlob()
  if (!blob) throw new Error('Biometric unlock is not set up for your saved passwords')

  let material: Uint8Array
  try {
    material = await passwordGateGetMaterial()
  } catch (e) {
    // The platform lost the key, so the copy it wrapped can never be read
    // again. Drop it (and only it) and fall back to the password.
    if (e instanceof Error && e.message === BIO_MATERIAL_MISSING) {
      await dropBioCopy()
      throw new Error('Biometric unlock for saved passwords was lost. Unlock with your password, then turn it back on.')
    }
    throw e
  }

  // The material is deterministic, so an unwrap failure is never transient —
  // the copy will fail identically forever. Drop it (ours only) rather than
  // leaving a button that can never work.
  let password: string
  try {
    password = await decryptWithKeyMaterial(blob, material)
  } catch {
    await dropBioCopy()
    throw new Error('Biometric unlock for saved passwords could not be read. Unlock with your password, then turn it back on.')
  }

  try {
    return await unlockPasswords(password)
  } catch (e) {
    // A password that no longer opens the vault (the wallet was re-created
    // under a different one) can never work again.
    if (e instanceof Error && e.message === 'Incorrect password') {
      await dropBioCopy()
      throw new Error('Your saved passwords no longer open with biometrics. Unlock with your password, then turn it back on.')
    }
    throw e
  }
}

/** Turn biometric unlock off: drop the copy and the platform key. */
export async function removePasswordBio(): Promise<boolean> {
  await dropBioCopy()
  await passwordGateDeleteMaterial()
  return true
}

export async function deletePasswordVault(): Promise<void> {
  lockPasswords()
  await Preferences.remove({ key: VAULT_KEY })
  // The biometric copy holds the password to a vault that no longer exists.
  await removePasswordBio()
}
