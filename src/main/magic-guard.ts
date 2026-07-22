/**
 * magic-guard.ts — MagicMoney Wallet
 *
 * Magic Guard is a browser-only privacy boundary around untrusted dApp pages in
 * the built-in dApp browser (persist:mm-dapp-browser). This module owns:
 *   - the global on/off preference (WalletConfig.magicGuardEnabled)
 *   - exact-hostname per-site exceptions, stored outside WalletConfig because they
 *     are variable-sized browser data, not application configuration
 *   - the MagicGuardState published to the chrome renderer for the active tab
 *
 * v1 note: this module does not filter network requests yet — that's the separate
 * adblock-rust native-engine integration. Until that engine is wired in, toggles
 * here persist correctly (so nothing is lost once it ships) but `status` always
 * reports 'degraded' when enabled, with an `error` explaining why, so the UI can
 * never claim protection that isn't actually happening.
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { loadConfig, saveConfig } from './secure-store'

export type MagicGuardStatus = 'loading' | 'ready' | 'degraded' | 'disabled'

export interface MagicGuardState {
  enabled: boolean            // global preference
  siteEnabled: boolean        // false when the current host is excepted
  effectiveEnabled: boolean   // enabled && siteEnabled && an engine is actually filtering
  status: MagicGuardStatus
  hostname: string | null
  blockedThisPage: number
  blockedThisTab: number
  listVersion?: string
  lastUpdatedAt?: number
  error?: string               // sanitized, never includes browsing URLs
}

function exceptionsDir(): string {
  return join(app.getPath('userData'), 'magic-guard')
}
function exceptionsPath(): string {
  return join(exceptionsDir(), 'site-exceptions.json')
}

let exceptionsCache: Set<string> | null = null

function loadExceptions(): Set<string> {
  if (exceptionsCache) return exceptionsCache
  try {
    if (!existsSync(exceptionsPath())) {
      exceptionsCache = new Set()
      return exceptionsCache
    }
    const parsed: unknown = JSON.parse(readFileSync(exceptionsPath(), 'utf-8'))
    exceptionsCache = new Set(
      Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === 'string') : []
    )
  } catch {
    // Corrupt store: quarantine it in memory and default to protection ON everywhere.
    exceptionsCache = new Set()
  }
  return exceptionsCache
}

function saveExceptions(set: Set<string>): void {
  exceptionsCache = set
  mkdirSync(exceptionsDir(), { recursive: true })
  writeFileSync(exceptionsPath(), JSON.stringify([...set].sort(), null, 2))
}

/**
 * Canonicalize to an exact, comparable hostname, or null if the input isn't a
 * plausible site host. Rejects paths, credentials, ports, wildcards, and bare/IP
 * ambiguous single-label hosts — v1 uses exact hostname matching only (no subdomain
 * or public-suffix logic), which is safer and easier to explain than a guess.
 */
function canonicalizeHost(raw: string): string | null {
  let h = raw.trim().toLowerCase()
  if (!h) return null
  h = h.replace(/\.+$/, '')
  if (!h || /[/@:*?#]/.test(h)) return null
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)) return null
  return h
}

/** Derive a canonical hostname from a full URL — never returns a path/query. */
export function hostnameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try { return canonicalizeHost(new URL(url).hostname) } catch { return null }
}

export function isSiteExcepted(hostname: string | null): boolean {
  if (!hostname) return false
  return loadExceptions().has(hostname)
}

function buildState(hostname: string | null): MagicGuardState {
  const enabled = loadConfig().magicGuardEnabled === true
  const siteEnabled = !isSiteExcepted(hostname)
  return {
    enabled,
    siteEnabled,
    effectiveEnabled: false, // no filtering engine wired in yet
    status: enabled ? 'degraded' : 'disabled',
    hostname,
    blockedThisPage: 0,
    blockedThisTab: 0,
    error: enabled
      ? 'The filtering engine ships in a later update. Your on/off and site settings are saved now and take effect automatically once it does.'
      : undefined,
  }
}

export function getMagicGuardState(hostname: string | null): MagicGuardState {
  return buildState(hostname)
}

export function setMagicGuardEnabled(enabled: boolean, hostname: string | null): MagicGuardState {
  saveConfig({ magicGuardEnabled: enabled === true })
  return buildState(hostname)
}

/** `protect: false` excepts the site (Magic Guard off there); `true` removes any exception. */
export function setMagicGuardForSite(hostname: string | null, protect: boolean): MagicGuardState {
  const host = canonicalizeHost(hostname ?? '')
  if (host) {
    const set = loadExceptions()
    if (protect) set.delete(host)
    else set.add(host)
    saveExceptions(set)
  }
  return buildState(host)
}
