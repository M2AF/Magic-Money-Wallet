/**
 * password-csv.ts — password-export CSV parsing (pure; no Electron, no Node)
 *
 * Shared by the Electron importer (browser-import.ts, which reads the file from
 * disk after a native dialog) and the Android one (wallet-local.ts, which reads
 * it from an <input type="file"> in the WebView). Kept free of platform imports
 * precisely so the Capacitor bundle can pull it in unchanged.
 *
 * Every mainstream password manager exports the same flat shape: a header row
 * naming a URL, username and password column, then one login per line. Column
 * names differ per product (Chrome: url/username/password, Bitwarden:
 * login_uri/login_username/login_password, LastPass and 1Password:
 * url/username/password …), so match by a set of known aliases and fall back to
 * positional url,username,password when no header is recognized.
 */

export interface ImportedLogin {
  url: string
  username: string
  password: string
}

export interface CsvImportResult {
  logins: ImportedLogin[]
  /** Data rows seen in the file. */
  total: number
  /** Rows dropped for missing a URL or password. */
  skipped: number
  error?: string
}

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
export function parsePasswordCsv(text: string): CsvImportResult {
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
