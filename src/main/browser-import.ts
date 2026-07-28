/**
 * browser-import.ts — MagicMoney Wallet
 *
 * Reads saved passwords and bookmarks out of the user's OTHER Chromium browsers
 * (Chrome, Edge, Brave, Vivaldi, Chromium) so they can be moved into MagicMoney's
 * own password manager and bookmark list.
 *
 * How Chromium stores logins:
 *   <profile>/Login Data      SQLite; table `logins` (origin_url, username_value,
 *                             password_value BLOB)
 *   <profile>/../Local State  JSON; os_crypt.encrypted_key = the AES master key,
 *                             base64, prefixed "DPAPI" and DPAPI-protected
 *
 *   password_value is  "v10"|"v11" + 12-byte nonce + ciphertext + 16-byte GCM tag
 *   under that master key (Windows), or AES-128-CBC under a keychain-derived key
 *   (macOS/Linux). Chrome 127+ additionally writes "v20" app-bound blobs which
 *   can only be unwrapped by Chrome's own elevation service — those are counted
 *   and reported as skipped rather than silently dropped.
 *
 * SQLite comes from Node's built-in `node:sqlite` (present in Electron 43's Node
 * 24) — no native module, nothing to rebuild for electron-builder. It is loaded
 * through require() with a local interface because @types/node 20 predates it.
 *
 * Everything here is read-only against a COPY of the source database: the live
 * file is locked (and WAL-journalled) while that browser is running.
 */

import { app } from 'electron'
import { spawn } from 'child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import { createDecipheriv, pbkdf2Sync } from 'crypto'

export interface ImportSource {
  /** Stable id the renderer passes back, e.g. "brave::Default". */
  id: string
  browser: string
  profile: string
  /** Absolute path of the profile directory. */
  path: string
  hasPasswords: boolean
  hasBookmarks: boolean
}

export interface ImportedLogin {
  url: string
  username: string
  password: string
}

export interface PasswordImportResult {
  logins: ImportedLogin[]
  /** Rows present in the source database. */
  total: number
  /** Rows we could not decrypt (app-bound v20, empty, or key mismatch). */
  skipped: number
  error?: string
}

export interface BookmarkImportResult {
  bookmarks: Array<{ url: string; title: string }>
  error?: string
}

// ─── Profile discovery ───────────────────────────────────────────────────────

interface BrowserDef {
  key: string
  name: string
  /** Directory containing "Local State" and the profile folders. */
  userDataDir: string | null
  /** macOS keychain service holding the storage key. */
  keychainService: string
}

function winLocalAppData(): string {
  return process.env['LOCALAPPDATA'] || join(homedir(), 'AppData', 'Local')
}

function browserDefs(): BrowserDef[] {
  const home = homedir()
  if (process.platform === 'win32') {
    const local = winLocalAppData()
    return [
      { key: 'chrome',   name: 'Google Chrome', userDataDir: join(local, 'Google', 'Chrome', 'User Data'),              keychainService: '' },
      { key: 'edge',     name: 'Microsoft Edge', userDataDir: join(local, 'Microsoft', 'Edge', 'User Data'),            keychainService: '' },
      { key: 'brave',    name: 'Brave',          userDataDir: join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'), keychainService: '' },
      { key: 'vivaldi',  name: 'Vivaldi',        userDataDir: join(local, 'Vivaldi', 'User Data'),                      keychainService: '' },
      { key: 'chromium', name: 'Chromium',       userDataDir: join(local, 'Chromium', 'User Data'),                     keychainService: '' },
    ]
  }
  if (process.platform === 'darwin') {
    const support = join(home, 'Library', 'Application Support')
    return [
      { key: 'chrome',   name: 'Google Chrome',  userDataDir: join(support, 'Google', 'Chrome'),                     keychainService: 'Chrome Safe Storage' },
      { key: 'edge',     name: 'Microsoft Edge', userDataDir: join(support, 'Microsoft Edge'),                       keychainService: 'Microsoft Edge Safe Storage' },
      { key: 'brave',    name: 'Brave',          userDataDir: join(support, 'BraveSoftware', 'Brave-Browser'),        keychainService: 'Brave Safe Storage' },
      { key: 'vivaldi',  name: 'Vivaldi',        userDataDir: join(support, 'Vivaldi'),                              keychainService: 'Vivaldi Safe Storage' },
      { key: 'chromium', name: 'Chromium',       userDataDir: join(support, 'Chromium'),                             keychainService: 'Chromium Safe Storage' },
    ]
  }
  const config = process.env['XDG_CONFIG_HOME'] || join(home, '.config')
  return [
    { key: 'chrome',   name: 'Google Chrome',  userDataDir: join(config, 'google-chrome'),                    keychainService: '' },
    { key: 'edge',     name: 'Microsoft Edge', userDataDir: join(config, 'microsoft-edge'),                   keychainService: '' },
    { key: 'brave',    name: 'Brave',          userDataDir: join(config, 'BraveSoftware', 'Brave-Browser'),   keychainService: '' },
    { key: 'vivaldi',  name: 'Vivaldi',        userDataDir: join(config, 'vivaldi'),                          keychainService: '' },
    { key: 'chromium', name: 'Chromium',       userDataDir: join(config, 'chromium'),                         keychainService: '' },
  ]
}

function isDir(path: string): boolean {
  try { return statSync(path).isDirectory() } catch { return false }
}

/** Profile folders inside a Chromium user-data dir: "Default", "Profile 1", … */
function profileDirs(userDataDir: string): string[] {
  try {
    return readdirSync(userDataDir)
      .filter(name => name === 'Default' || /^Profile \d+$/.test(name))
      .filter(name => isDir(join(userDataDir, name)))
      .sort()
  } catch {
    return []
  }
}

/** Every Chromium profile on this machine that has something worth importing. */
export function listImportSources(): ImportSource[] {
  const out: ImportSource[] = []
  for (const def of browserDefs()) {
    if (!def.userDataDir || !isDir(def.userDataDir)) continue
    for (const profile of profileDirs(def.userDataDir)) {
      const path = join(def.userDataDir, profile)
      const hasPasswords = existsSync(join(path, 'Login Data'))
      const hasBookmarks = existsSync(join(path, 'Bookmarks'))
      if (!hasPasswords && !hasBookmarks) continue
      out.push({ id: `${def.key}::${profile}`, browser: def.name, profile, path, hasPasswords, hasBookmarks })
    }
  }
  return out
}

function resolveSource(id: string): { def: BrowserDef; source: ImportSource } | null {
  const [key, profile] = String(id ?? '').split('::')
  const def = browserDefs().find(d => d.key === key)
  if (!def || !def.userDataDir || !profile) return null
  const source = listImportSources().find(s => s.id === id)
  if (!source) return null
  return { def, source }
}

// ─── Master key ──────────────────────────────────────────────────────────────

/** DPAPI-unprotect a batch of base64 blobs via PowerShell. Windows only. */
function dpapiUnprotect(blobsB64: string[]): Promise<Array<Buffer | null>> {
  if (process.platform !== 'win32') return Promise.resolve(blobsB64.map(() => null))
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$items = @([Console]::In.ReadToEnd() | ConvertFrom-Json)
$out = New-Object System.Collections.ArrayList
foreach ($b64 in $items) {
  try {
    $bytes = [Convert]::FromBase64String($b64)
    $dec = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    [void]$out.Add([Convert]::ToBase64String($dec))
  } catch { [void]$out.Add($null) }
}
Write-Output (ConvertTo-Json @{ items = @($out) } -Compress -Depth 3)
`.trim()
  const encoded = Buffer.from(script, 'utf16le').toString('base64')

  return new Promise(resolve => {
    let stdout = ''
    let child
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true })
    } catch {
      resolve(blobsB64.map(() => null))
      return
    }
    child.stdout.on('data', d => { stdout += d.toString() })
    child.on('error', () => resolve(blobsB64.map(() => null)))
    child.on('close', () => {
      try {
        const line = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean).pop() ?? ''
        const parsed = JSON.parse(line) as { items?: unknown }
        // PowerShell 5.1 collapses a single-element array to a scalar.
        const items = Array.isArray(parsed.items) ? parsed.items : [parsed.items]
        resolve(blobsB64.map((_, i) => {
          const v = items[i]
          return typeof v === 'string' ? Buffer.from(v, 'base64') : null
        }))
      } catch {
        resolve(blobsB64.map(() => null))
      }
    })
    child.stdin.end(JSON.stringify(blobsB64))
  })
}

/** Read one password out of the macOS login keychain (same tool touchid-bridge uses). */
function macKeychainPassword(service: string): Promise<string | null> {
  return new Promise(resolve => {
    let stdout = ''
    let child
    try {
      child = spawn('/usr/bin/security', ['find-generic-password', '-wa', service.replace(/ Safe Storage$/, ''), '-s', service])
    } catch {
      resolve(null)
      return
    }
    child.stdout.on('data', d => { stdout += d.toString() })
    child.on('error', () => resolve(null))
    child.on('close', code => resolve(code === 0 && stdout.trim() ? stdout.trim() : null))
  })
}

interface StorageKey {
  /** AES-256-GCM key (Windows) or AES-128-CBC key (macOS/Linux). */
  key: Buffer
  scheme: 'gcm' | 'cbc'
}

async function storageKeyFor(def: BrowserDef): Promise<StorageKey | null> {
  if (process.platform === 'win32') {
    if (!def.userDataDir) return null
    const localStatePath = join(def.userDataDir, 'Local State')
    if (!existsSync(localStatePath)) return null
    let encryptedKeyB64: string
    try {
      const state = JSON.parse(readFileSync(localStatePath, 'utf-8')) as { os_crypt?: { encrypted_key?: string } }
      encryptedKeyB64 = state.os_crypt?.encrypted_key ?? ''
    } catch {
      return null
    }
    if (!encryptedKeyB64) return null
    const wrapped = Buffer.from(encryptedKeyB64, 'base64')
    // Strip the literal "DPAPI" prefix Chromium writes in front of the blob.
    const blob = wrapped.subarray(0, 5).toString('latin1') === 'DPAPI' ? wrapped.subarray(5) : wrapped
    const [unprotected] = await dpapiUnprotect([blob.toString('base64')])
    return unprotected ? { key: unprotected, scheme: 'gcm' } : null
  }

  // macOS/Linux: a passphrase (keychain / the literal "peanuts" fallback) stretched
  // with Chromium's fixed PBKDF2-SHA1 parameters into a 16-byte AES-CBC key.
  const passphrase = process.platform === 'darwin'
    ? (await macKeychainPassword(def.keychainService)) ?? 'peanuts'
    : 'peanuts'
  const iterations = process.platform === 'darwin' ? 1003 : 1
  return { key: pbkdf2Sync(passphrase, 'saltysalt', iterations, 16, 'sha1'), scheme: 'cbc' }
}

// ─── Value decryption ────────────────────────────────────────────────────────

function stripPkcs7(buf: Buffer): Buffer {
  const pad = buf[buf.length - 1]
  if (!pad || pad > 16 || pad > buf.length) return buf
  return buf.subarray(0, buf.length - pad)
}

/** Decrypt one password_value blob. Returns null for anything we can't open. */
function decryptValue(blob: Buffer, storage: StorageKey): string | null {
  if (blob.length === 0) return null
  const version = blob.subarray(0, 3).toString('latin1')

  if (version === 'v10' || version === 'v11') {
    if (storage.scheme === 'gcm') {
      if (blob.length < 3 + 12 + 16) return null
      const nonce = blob.subarray(3, 15)
      const tag = blob.subarray(blob.length - 16)
      const ciphertext = blob.subarray(15, blob.length - 16)
      try {
        const decipher = createDecipheriv('aes-256-gcm', storage.key, nonce)
        decipher.setAuthTag(tag)
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8')
      } catch {
        return null
      }
    }
    try {
      const decipher = createDecipheriv('aes-128-cbc', storage.key, Buffer.alloc(16, 0x20))
      decipher.setAutoPadding(false)
      const out = Buffer.concat([decipher.update(blob.subarray(3)), decipher.final()])
      return stripPkcs7(out).toString('utf-8')
    } catch {
      return null
    }
  }

  // "v20" = Chrome 127+ app-bound encryption. The key is held by Chrome's
  // elevation service and is deliberately not reachable by other applications;
  // there is no correct way to read these, so they are reported as skipped.
  if (version === 'v20') return null

  // No version prefix ⇒ pre-2017 Windows format: the value is DPAPI-protected
  // directly. Handled by the caller's batch pass (decryptLegacyValues).
  return null
}

function isLegacyDpapi(blob: Buffer): boolean {
  if (process.platform !== 'win32' || blob.length < 4) return false
  const version = blob.subarray(0, 3).toString('latin1')
  return version !== 'v10' && version !== 'v11' && version !== 'v20'
}

// ─── SQLite (node:sqlite, loaded dynamically — see file header) ───────────────

interface SqliteStatement { all(...params: unknown[]): Array<Record<string, unknown>> }
interface SqliteDatabase { prepare(sql: string): SqliteStatement; close(): void }

function openSqlite(path: string): SqliteDatabase {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('node:sqlite') as { DatabaseSync: new (p: string) => SqliteDatabase }
  return new mod.DatabaseSync(path)
}

/**
 * Copy the profile database (plus its WAL sidecars) into a scratch dir. The live
 * file is locked while that browser is running and replaying a WAL would mean
 * WRITING to the user's real profile — never acceptable for an import.
 */
function copyDatabase(sourcePath: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mm-import-'))
  const file = join(dir, 'db.sqlite')
  copyFileSync(sourcePath, file)
  for (const suffix of ['-wal', '-shm']) {
    const side = `${sourcePath}${suffix}`
    if (existsSync(side)) { try { copyFileSync(side, `${file}${suffix}`) } catch { /* optional */ } }
  }
  return { dir, file }
}

function toBuffer(value: unknown): Buffer | null {
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (Buffer.isBuffer(value)) return value
  return null
}

// ─── Public: password import ─────────────────────────────────────────────────

export async function importPasswordsFrom(sourceId: string): Promise<PasswordImportResult> {
  const resolved = resolveSource(sourceId)
  if (!resolved) return { logins: [], total: 0, skipped: 0, error: 'That browser profile is no longer available' }
  const { def, source } = resolved

  const loginDataPath = join(source.path, 'Login Data')
  if (!existsSync(loginDataPath)) {
    return { logins: [], total: 0, skipped: 0, error: `${def.name} has no saved passwords in this profile` }
  }

  const storage = await storageKeyFor(def)
  if (!storage) {
    return {
      logins: [], total: 0, skipped: 0,
      error: `Could not read ${def.name}'s encryption key. It is tied to your Windows/macOS user account — make sure you are signed in as the same user.`,
    }
  }

  let scratch: { dir: string; file: string } | null = null
  try {
    scratch = copyDatabase(loginDataPath)
  } catch {
    return { logins: [], total: 0, skipped: 0, error: `Could not read ${def.name}'s password database. Close ${def.name} completely and try again.` }
  }

  let rows: Array<Record<string, unknown>> = []
  try {
    const db = openSqlite(scratch.file)
    try {
      rows = db.prepare('SELECT origin_url, username_value, password_value FROM logins').all()
    } finally {
      db.close()
    }
  } catch (e) {
    rmSync(scratch.dir, { recursive: true, force: true })
    return { logins: [], total: 0, skipped: 0, error: `Could not open ${def.name}'s password database (${e instanceof Error ? e.message : 'unknown error'})` }
  } finally {
    if (scratch) rmSync(scratch.dir, { recursive: true, force: true })
  }

  const logins: ImportedLogin[] = []
  const legacyIdx: number[] = []
  const legacyBlobs: string[] = []
  let skipped = 0

  rows.forEach((row, index) => {
    const url = typeof row.origin_url === 'string' ? row.origin_url : ''
    const username = typeof row.username_value === 'string' ? row.username_value : ''
    const blob = toBuffer(row.password_value)
    if (!url || !blob || blob.length === 0) { skipped++; return }

    if (isLegacyDpapi(blob)) {
      legacyIdx.push(index)
      legacyBlobs.push(blob.toString('base64'))
      return
    }
    const password = decryptValue(blob, storage)
    if (password) logins.push({ url, username, password })
    else skipped++
  })

  // Pre-2017 rows are DPAPI-protected one by one — unwrap them in a single batch
  // rather than spawning PowerShell per row.
  if (legacyBlobs.length > 0) {
    const unwrapped = await dpapiUnprotect(legacyBlobs)
    unwrapped.forEach((buf, i) => {
      const row = rows[legacyIdx[i]]
      const url = typeof row.origin_url === 'string' ? row.origin_url : ''
      const username = typeof row.username_value === 'string' ? row.username_value : ''
      const password = buf?.toString('utf-8') ?? ''
      if (url && password) logins.push({ url, username, password })
      else skipped++
    })
  }

  return { logins, total: rows.length, skipped }
}

// ─── Public: bookmark import ─────────────────────────────────────────────────

interface ChromeBookmarkNode {
  type?: string
  name?: string
  url?: string
  children?: ChromeBookmarkNode[]
}

function flattenBookmarks(node: ChromeBookmarkNode, out: Array<{ url: string; title: string }>): void {
  if (out.length > 5000) return
  if (node.type === 'url' && typeof node.url === 'string') {
    if (/^https?:\/\//i.test(node.url)) out.push({ url: node.url, title: node.name || node.url })
    return
  }
  for (const child of node.children ?? []) flattenBookmarks(child, out)
}

export function importBookmarksFrom(sourceId: string): BookmarkImportResult {
  const resolved = resolveSource(sourceId)
  if (!resolved) return { bookmarks: [], error: 'That browser profile is no longer available' }
  const { def, source } = resolved

  const path = join(source.path, 'Bookmarks')
  if (!existsSync(path)) return { bookmarks: [], error: `${def.name} has no bookmarks in this profile` }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { roots?: Record<string, ChromeBookmarkNode> }
    const out: Array<{ url: string; title: string }> = []
    for (const root of Object.values(parsed.roots ?? {})) {
      if (root && typeof root === 'object') flattenBookmarks(root, out)
    }
    return { bookmarks: out }
  } catch {
    return { bookmarks: [], error: `Could not read ${def.name}'s bookmarks file` }
  }
}

// ─── Public: CSV password import ─────────────────────────────────────────────
//
// Every mainstream password manager exports the same flat shape: a header row
// naming a URL, username and password column, then one login per line. Column
// names differ per product (Chrome: url/username/password, Bitwarden:
// login_uri/login_username/login_password, LastPass: url/username/password,
// 1Password: url/username/password …), so match by a set of known aliases and
// fall back to positional url,username,password when no header is recognized.

const CSV_URL_KEYS = new Set(['url', 'login_uri', 'website', 'web site', 'site', 'origin', 'uri', 'hostname'])
const CSV_USER_KEYS = new Set(['username', 'login_username', 'user', 'login', 'email', 'user name', 'login name'])
const CSV_PASS_KEYS = new Set(['password', 'login_password', 'pass'])

/** RFC-4180-ish parser: quoted fields, doubled quotes, CRLF/LF, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        field += c
      }
      continue
    }
    if (c === '"') { inQuotes = true; continue }
    if (c === ',') { row.push(field); field = ''; continue }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
      continue
    }
    field += c
  }
  row.push(field)
  if (row.length > 1 || row[0] !== '') rows.push(row)
  return rows
}

/**
 * Extract logins from password-export CSV text. Never throws — a malformed file
 * comes back as { logins: [], error }.
 */
export function parsePasswordCsv(text: string): PasswordImportResult {
  // Strip a UTF-8 BOM (Excel and several exporters write one).
  const rows = parseCsv(text.replace(/^﻿/, ''))
  if (rows.length === 0) return { logins: [], total: 0, skipped: 0, error: 'The file is empty' }

  const header = rows[0].map(h => h.trim().toLowerCase())
  let urlIdx = header.findIndex(h => CSV_URL_KEYS.has(h))
  let userIdx = header.findIndex(h => CSV_USER_KEYS.has(h))
  let passIdx = header.findIndex(h => CSV_PASS_KEYS.has(h))
  let body = rows.slice(1)

  if (urlIdx < 0 || passIdx < 0) {
    // No recognizable header — treat every row as positional url,username,password.
    urlIdx = 0; userIdx = 1; passIdx = 2
    body = rows
  }

  const logins: ImportedLogin[] = []
  let skipped = 0
  for (const cells of body) {
    const url = (cells[urlIdx] ?? '').trim()
    const password = cells[passIdx] ?? ''
    if (!url || !password) { skipped++; continue }
    logins.push({ url, username: userIdx >= 0 ? (cells[userIdx] ?? '').trim() : '', password })
  }

  if (logins.length === 0) {
    return {
      logins: [], total: body.length, skipped,
      error: 'No logins were found. The file needs URL and password columns (a standard Chrome, Edge, Brave, Bitwarden or LastPass export).',
    }
  }
  return { logins, total: body.length, skipped }
}

/** Diagnostic used by the Import panel's empty state. */
export function importScratchRoot(): string {
  return app.getPath('temp')
}
