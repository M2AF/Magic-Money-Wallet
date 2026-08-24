/**
 * browser-store.ts — MagicMoney Wallet
 *
 * Persistence for BROWSER-only data: bookmarks, installed web apps and
 * browsing history.
 *
 * Deliberately NOT part of WalletConfig (config.json), for the same reason
 * magic-guard.ts keeps its site-exception list separate: these are variable-sized,
 * user-generated browsing records, not application configuration. They live under
 * `userData/browser/` following magic-guard's exact pattern — module-level cache,
 * tolerant loader (corrupt file ⇒ empty, never a crash), deterministic writer.
 *
 * Nothing here is a secret, so it is plain JSON. Saved passwords are the opposite
 * and live in password-vault.ts (encrypted, never in this file).
 */

import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { historyHost, type HistoryEntry } from '../shared/history-wire'

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
  /** Absolute path of the OS shortcut we created, so uninstall can remove it. */
  shortcutPath: string | null
  installedAt: number
}

function browserDir(): string {
  return join(app.getPath('userData'), 'browser')
}
function bookmarksPath(): string {
  return join(browserDir(), 'bookmarks.json')
}
function webAppsPath(): string {
  return join(browserDir(), 'web-apps.json')
}
function historyPath(): string {
  return join(browserDir(), 'history.json')
}

// Hard ceilings so a runaway import (a 50k-bookmark Chrome profile) can't turn
// every read into a multi-megabyte JSON.parse on the main thread.
const MAX_BOOKMARKS = 5000
const MAX_WEB_APPS = 500
// History is the one list that grows on its own, so its ceiling is the one that
// actually gets hit. 3000 entries is a few weeks of ordinary browsing and keeps
// the file well under a megabyte.
const MAX_HISTORY = 3000

let bookmarksCache: Bookmark[] | null = null
let webAppsCache: WebApp[] | null = null
let historyCache: HistoryEntry[] | null = null

/** Stable-ish unique id — the list is small and single-process, so this is enough. */
export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Canonical comparable form of a URL for "is this page already bookmarked?". */
export function canonicalUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    u.hash = ''
    // Trailing slash on a bare origin is noise: https://x.com/ === https://x.com
    if (u.pathname === '/') u.pathname = ''
    return u.toString()
  } catch {
    return null
  }
}

function readJsonArray<T>(path: string, pick: (v: unknown) => T | null, cap: number): T[] {
  try {
    if (!existsSync(path)) return []
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    if (!Array.isArray(parsed)) return []
    const out: T[] = []
    for (const raw of parsed) {
      const item = pick(raw)
      if (item) out.push(item)
      if (out.length >= cap) break
    }
    return out
  } catch {
    // Corrupt store: start empty rather than wedging the browser on every open.
    return []
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(browserDir(), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2))
}

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

function pickWebApp(v: unknown): WebApp | null {
  if (!v || typeof v !== 'object') return null
  const a = v as Record<string, unknown>
  const url = typeof a.url === 'string' ? canonicalUrl(a.url) : null
  if (!url) return null
  return {
    id: typeof a.id === 'string' && a.id ? a.id : newId(),
    url,
    name: typeof a.name === 'string' ? a.name.slice(0, 120) : url,
    shortcutPath: typeof a.shortcutPath === 'string' ? a.shortcutPath : null,
    installedAt: Number.isFinite(a.installedAt) ? Number(a.installedAt) : Date.now(),
  }
}

// ─── Bookmarks ───────────────────────────────────────────────────────────────

export function getBookmarks(): Bookmark[] {
  if (!bookmarksCache) bookmarksCache = readJsonArray(bookmarksPath(), pickBookmark, MAX_BOOKMARKS)
  return bookmarksCache
}

function saveBookmarks(list: Bookmark[]): Bookmark[] {
  bookmarksCache = list
  writeJson(bookmarksPath(), list)
  return list
}

/** True when `url` (canonicalized) is already bookmarked. */
export function isBookmarked(url: string): boolean {
  const canonical = canonicalUrl(url)
  if (!canonical) return false
  return getBookmarks().some(b => b.url === canonical)
}

/** Add a bookmark. Re-adding an existing URL refreshes its title instead of duplicating. */
export function addBookmark(url: string, title: string): Bookmark[] {
  const canonical = canonicalUrl(url)
  if (!canonical) return getBookmarks()
  const list = [...getBookmarks()]
  const existing = list.findIndex(b => b.url === canonical)
  const clean = (title || canonical).trim().slice(0, 300)
  if (existing >= 0) {
    list[existing] = { ...list[existing], title: clean }
    return saveBookmarks(list)
  }
  if (list.length >= MAX_BOOKMARKS) return list
  // Newest first — the panel and the star both read this order directly.
  return saveBookmarks([{ id: newId(), url: canonical, title: clean, addedAt: Date.now() }, ...list])
}

export function removeBookmark(id: string): Bookmark[] {
  return saveBookmarks(getBookmarks().filter(b => b.id !== id))
}

/** Remove by URL — what the address-bar star does when it's already filled in. */
export function removeBookmarkByUrl(url: string): Bookmark[] {
  const canonical = canonicalUrl(url)
  if (!canonical) return getBookmarks()
  return saveBookmarks(getBookmarks().filter(b => b.url !== canonical))
}

export function renameBookmark(id: string, title: string): Bookmark[] {
  const list = getBookmarks().map(b => (b.id === id ? { ...b, title: title.trim().slice(0, 300) || b.url } : b))
  return saveBookmarks(list)
}

/**
 * Bulk-add imported bookmarks, skipping URLs already present. Returns how many
 * were actually added so the import UI can report a real number.
 */
export function mergeBookmarks(incoming: Array<{ url: string; title: string }>): { added: number; skipped: number } {
  const list = [...getBookmarks()]
  const seen = new Set(list.map(b => b.url))
  let added = 0
  let skipped = 0
  for (const item of incoming) {
    const canonical = canonicalUrl(item.url)
    if (!canonical || seen.has(canonical)) { skipped++; continue }
    if (list.length >= MAX_BOOKMARKS) { skipped++; continue }
    seen.add(canonical)
    list.push({ id: newId(), url: canonical, title: (item.title || canonical).trim().slice(0, 300), addedAt: Date.now() })
    added++
  }
  saveBookmarks(list)
  return { added, skipped }
}

// ─── Installed web apps ──────────────────────────────────────────────────────

export function getWebApps(): WebApp[] {
  if (!webAppsCache) webAppsCache = readJsonArray(webAppsPath(), pickWebApp, MAX_WEB_APPS)
  return webAppsCache
}

function saveWebApps(list: WebApp[]): WebApp[] {
  webAppsCache = list
  writeJson(webAppsPath(), list)
  return list
}

export function recordWebApp(app_: Omit<WebApp, 'id' | 'installedAt'>): WebApp[] {
  const canonical = canonicalUrl(app_.url)
  if (!canonical) return getWebApps()
  const list = getWebApps().filter(a => a.url !== canonical)
  if (list.length >= MAX_WEB_APPS) return getWebApps()
  return saveWebApps([{ ...app_, url: canonical, id: newId(), installedAt: Date.now() }, ...list])
}

export function findWebApp(url: string): WebApp | undefined {
  const canonical = canonicalUrl(url)
  if (!canonical) return undefined
  return getWebApps().find(a => a.url === canonical)
}

export function forgetWebApp(id: string): WebApp[] {
  return saveWebApps(getWebApps().filter(a => a.id !== id))
}

// ─── History ─────────────────────────────────────────────────────────────────
//
// Newest-first, one entry per canonical URL. Re-visiting a page bumps its
// counter and moves it to the front rather than appending a duplicate — which
// is what makes `visits` meaningful for ranking address-bar suggestions, and
// what stops a page you reload twenty times from burying everything else.
//
// NOT written while Tor Mode is on. That gate lives in browser-manager, at the
// navigation handlers, because this module has no idea what the proxy is doing.

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

export function getHistory(): HistoryEntry[] {
  if (!historyCache) historyCache = readJsonArray(historyPath(), pickHistory, MAX_HISTORY)
  return historyCache
}

function saveHistory(list: HistoryEntry[]): HistoryEntry[] {
  historyCache = list
  writeJson(historyPath(), list)
  return list
}

/**
 * Record a visit. `canonicalUrl` rejects anything that isn't http(s), so the
 * browser's own about: pages and data: URLs never reach the list.
 *
 * The title is often empty here — `did-navigate` fires before the document has
 * one — so an empty title never overwrites a title already known for that URL;
 * `updateHistoryTitle` fills it in when page-title-updated arrives.
 */
export function recordVisit(rawUrl: string, title = ''): HistoryEntry[] {
  const url = canonicalUrl(rawUrl)
  if (!url) return getHistory()
  const clean = title.trim().slice(0, 300)
  const list = getHistory()
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
 * Fill in the title once the document has one. Deliberately does NOT count as a
 * visit or reorder the list — a page that renames its own tab repeatedly (a
 * chat app showing an unread count) would otherwise churn the history file.
 */
export function updateHistoryTitle(rawUrl: string, title: string): void {
  const url = canonicalUrl(rawUrl)
  const clean = title.trim().slice(0, 300)
  if (!url || !clean) return
  const list = getHistory()
  const at = list.findIndex(h => h.url === url)
  if (at < 0 || list[at].title === clean) return
  const next = [...list]
  next[at] = { ...next[at], title: clean }
  saveHistory(next)
}

export function removeHistoryEntry(id: string): HistoryEntry[] {
  return saveHistory(getHistory().filter(h => h.id !== id))
}

/** "Forget this site" — every page from one host at once. */
export function removeHistoryByHost(host: string): HistoryEntry[] {
  const target = host.trim().toLowerCase()
  if (!target) return getHistory()
  return saveHistory(getHistory().filter(h => h.host !== target))
}

export function clearHistory(): HistoryEntry[] {
  return saveHistory([])
}
