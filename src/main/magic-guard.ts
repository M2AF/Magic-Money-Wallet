/**
 * magic-guard.ts — MagicMoney Wallet
 *
 * Magic Guard is a browser-only privacy boundary around untrusted dApp pages in
 * the built-in dApp browser (persist:mm-dapp-browser). This module owns:
 *   - the global on/off preference (WalletConfig.magicGuardEnabled)
 *   - exact-hostname per-site exceptions, stored outside WalletConfig because they
 *     are variable-sized browser data, not application configuration
 *   - the adblock-rust engine lifecycle (bundled EasyList/EasyPrivacy snapshots,
 *     network-rules-only, per MAGIC_GUARD_IMPLEMENTATION_PLAN.md Batch B)
 *   - the request policy: what to allow/block, resource-type mapping, source-URL
 *     derivation, fail-open on any engine/URL error
 *   - per-tab/per-page block counters
 *   - the MagicGuardState published to the chrome renderer for the active tab
 *
 * The actual `onBeforeRequest` listener lives in browser-manager.ts (it owns
 * dappSession() and the tab registry); this module is called from there.
 *
 * Decision logic (decideRequest/deriveSourceUrl/mapResourceType) is pure — no
 * module state, no Electron types beyond a local string union — so it's directly
 * unit-testable against a real in-memory adblock-rs Engine without mocking
 * Electron. Stateful pieces (engine instance, config, exceptions, counters) are
 * kept separate in magicGuardDecide() and the counter functions below.
 */
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { FilterSet, Engine, RuleTypes } from 'adblock-rs'
import { loadConfig, saveConfig } from './secure-store'

export type MagicGuardStatus = 'loading' | 'ready' | 'degraded' | 'disabled'

export interface MagicGuardState {
  enabled: boolean            // global preference
  siteEnabled: boolean        // false when the current host is excepted
  effectiveEnabled: boolean   // enabled && siteEnabled && the engine is actually loaded
  status: MagicGuardStatus
  hostname: string | null
  blockedThisPage: number
  blockedThisTab: number
  listVersion?: string
  lastUpdatedAt?: number
  error?: string               // sanitized, never includes browsing URLs
}

// ─── Site exceptions (exact hostname, browser-only data — not WalletConfig) ──

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

// ─── Resource-type mapping (Electron → adblock-rust request-type alias) ─────
// Table transcribed from MAGIC_GUARD_IMPLEMENTATION_PLAN.md section 8, verified
// against Electron 43's OnBeforeRequestListenerDetails.resourceType union.

export type ElectronResourceType =
  | 'mainFrame' | 'subFrame' | 'stylesheet' | 'script' | 'image' | 'font'
  | 'object' | 'xhr' | 'ping' | 'cspReport' | 'media' | 'webSocket' | 'other'

const RESOURCE_TYPE_MAP: Record<ElectronResourceType, string> = {
  mainFrame: 'document',
  subFrame: 'subdocument',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  font: 'font',
  object: 'object',
  xhr: 'xmlhttprequest',
  ping: 'ping',
  cspReport: 'csp_report',
  media: 'media',
  webSocket: 'websocket',
  other: 'other',
}

export function mapResourceType(t: ElectronResourceType): string {
  return RESOURCE_TYPE_MAP[t] ?? 'other'
}

// ─── Source URL derivation ────────────────────────────────────────────────
// Order per plan: frame URL → referrer → owning tab's top-level URL → request
// URL itself as a last resort. Only accepts http(s) — a frame/tab URL is always
// a real document, never a ws(s):// URL.

function isHttpUrl(url: string | null | undefined): url is string {
  if (!url) return false
  try {
    const p = new URL(url).protocol
    return p === 'http:' || p === 'https:'
  } catch { return false }
}

export function deriveSourceUrl(input: {
  frameUrl: string | null
  referrer: string | null
  tabUrl: string | null
  url: string
}): string {
  if (isHttpUrl(input.frameUrl)) return input.frameUrl
  if (isHttpUrl(input.referrer)) return input.referrer
  if (isHttpUrl(input.tabUrl)) return input.tabUrl
  return input.url
}

function isFilterableUrl(url: string): boolean {
  try {
    const p = new URL(url).protocol
    return p === 'http:' || p === 'https:' || p === 'ws:' || p === 'wss:'
  } catch { return false }
}

// ─── Request policy (pure — takes the engine as a parameter) ────────────────
// Order per plan section 8 "Request policy": non-http(s)/ws → allow; disabled or
// site-excepted → allow; mainFrame → allow (bypass; top-level phishing guard is
// separate); otherwise ask the engine; any engine/URL error → fail open (allow).

export function decideRequest(params: {
  engine: Engine | null
  enabled: boolean
  siteEnabled: boolean
  url: string
  sourceUrl: string
  resourceType: ElectronResourceType
  method: string
}): { cancel: boolean } {
  if (!isFilterableUrl(params.url)) return { cancel: false }
  if (!params.enabled || !params.siteEnabled) return { cancel: false }
  if (params.resourceType === 'mainFrame') return { cancel: false }
  if (!params.engine) return { cancel: false }
  try {
    const blocked = params.engine.check(params.url, params.sourceUrl, mapResourceType(params.resourceType), params.method)
    return { cancel: blocked === true }
  } catch {
    return { cancel: false } // fail-open: malformed URL or any engine error never blocks browsing
  }
}

// ─── Engine lifecycle ────────────────────────────────────────────────────
// v1 note: FilterSet.addFilters/Engine construction are synchronous, CPU-bound
// native calls — adblock-rs has no async variant. initMagicGuardEngine() is
// invoked via setImmediate from index.ts so it never runs inline with startup's
// synchronous module-evaluation path, but the parse itself (~3.6MB of EasyList +
// EasyPrivacy text) still briefly occupies the event loop when it runs. True
// off-main-thread parsing (a worker_thread/utility process) is a follow-up
// hardening item (fits under plan Batch D's performance budgets), not required
// for Batch B network-only correctness.

let engine: Engine | null = null
let engineStatus: MagicGuardStatus = 'loading'
let engineError: string | undefined

const LIST_FILES = ['easylist.txt', 'easyprivacy.txt', 'magicmoney-unbreak.txt']

function findResource(fileName: string): string | null {
  // Electron E2E fixture override (magic-guard.spec.ts): point at a small
  // deterministic test list instead of the real bundled EasyList/EasyPrivacy,
  // which are fetched live and evolve over time — relying on their exact
  // current content would make a committed E2E test flaky. Same pattern as the
  // existing MM_TEST_USERDATA / MM_TOR_SMOKE_USERDATA e2e env overrides.
  const testOverrideDir = process.env.MM_MAGIC_GUARD_TEST_RESOURCES
  if (testOverrideDir) {
    const p = join(testOverrideDir, fileName)
    return existsSync(p) ? p : null
  }
  // Mirrors tor-manager.ts's packagedTorExecutable(): resourcesPath first (in
  // case a future extraResources config unpacks these), then the current
  // "files" glob location (project root in dev, inside app.asar when packaged —
  // asar-patched fs.readFileSync reads plain text fine from either).
  // process.resourcesPath only exists under Electron — guard it out under plain
  // Node (unit tests) instead of letting path.join throw on undefined.
  const candidates = [
    ...(process.resourcesPath ? [join(process.resourcesPath, 'magic-guard', fileName)] : []),
    join(app.getAppPath(), 'resources', 'magic-guard', fileName),
  ]
  return candidates.find(existsSync) ?? null
}

/** Pure: build an Engine from already-loaded filter list text (unit-testable). */
export function buildEngineFromTexts(texts: string[]): Engine {
  const filterSet = new FilterSet()
  for (const text of texts) {
    if (text.trim()) filterSet.addFilters(text, { rule_types: RuleTypes.NETWORK_ONLY })
  }
  return new Engine(filterSet)
}

/**
 * Load the bundled lists and (re)build the engine, then atomically swap the
 * module-level reference — decideRequest() only ever sees a fully-built engine
 * or null, never a partially-constructed one. Never throws: on any failure the
 * engine is cleared and status becomes 'degraded', which fail-opens every
 * request (see decideRequest) rather than blocking or crashing the browser.
 */
export async function initMagicGuardEngine(): Promise<void> {
  engineStatus = 'loading'
  try {
    const texts: string[] = []
    for (const file of LIST_FILES) {
      const path = findResource(file)
      if (!path) {
        if (file === 'magicmoney-unbreak.txt') continue // optional — fine if absent
        throw new Error(`missing bundled filter list: ${file}`)
      }
      texts.push(readFileSync(path, 'utf-8'))
    }
    const built = buildEngineFromTexts(texts)
    engine = built
    engineStatus = 'ready'
    engineError = undefined
  } catch (err) {
    engine = null
    engineStatus = 'degraded'
    engineError = 'Filter lists failed to load — Magic Guard is temporarily inactive (requests are allowed through).'
    console.error('[magic-guard] engine init failed:', err)
  }
}

// ─── Per-tab / per-page block counters ───────────────────────────────────
// Keyed by webContents id (stable per tab for its lifetime). browser-manager.ts
// calls register/unregister on tab create/close and resetPage on top-level
// did-start-navigation, before the plan's counter-semantics section.

interface TabCounters { page: number; tab: number }
const counters = new Map<number, TabCounters>()

export function registerTab(webContentsId: number): void {
  counters.set(webContentsId, { page: 0, tab: 0 })
}
export function unregisterTab(webContentsId: number): void {
  counters.delete(webContentsId)
}
export function resetPageCounter(webContentsId: number): void {
  const c = counters.get(webContentsId)
  if (c) c.page = 0
}
export function noteBlocked(webContentsId: number): void {
  const c = counters.get(webContentsId)
  if (!c) return
  c.page += 1
  c.tab += 1
}
export function getCounts(webContentsId: number | null | undefined): TabCounters {
  if (webContentsId == null) return { page: 0, tab: 0 }
  const c = counters.get(webContentsId)
  return c ? { page: c.page, tab: c.tab } : { page: 0, tab: 0 }
}

// ─── Stateful glue (reads module state: config, exceptions, engine) ─────────

/** Called from browser-manager.ts's single onBeforeRequest listener on dappSession(). */
export function magicGuardDecide(input: {
  url: string
  method: string
  resourceType: ElectronResourceType
  frameUrl: string | null
  referrer: string | null
  tabUrl: string | null
}): { cancel: boolean } {
  const enabled = loadConfig().magicGuardEnabled === true
  const topHost = hostnameFromUrl(input.tabUrl) ?? hostnameFromUrl(input.frameUrl) ?? hostnameFromUrl(input.referrer)
  const siteEnabled = !isSiteExcepted(topHost)
  const sourceUrl = deriveSourceUrl(input)
  return decideRequest({
    engine, enabled, siteEnabled,
    url: input.url, sourceUrl, resourceType: input.resourceType, method: input.method,
  })
}

function buildState(hostname: string | null, counts: TabCounters): MagicGuardState {
  const enabled = loadConfig().magicGuardEnabled === true
  const siteEnabled = !isSiteExcepted(hostname)
  const status: MagicGuardStatus = !enabled ? 'disabled' : engineStatus
  return {
    enabled,
    siteEnabled,
    effectiveEnabled: enabled && siteEnabled && engineStatus === 'ready',
    status,
    hostname,
    blockedThisPage: counts.page,
    blockedThisTab: counts.tab,
    error: !enabled
      ? undefined
      : engineStatus === 'ready'
        ? undefined
        : engineStatus === 'loading'
          ? 'Filter lists are loading…'
          : engineError,
  }
}

export function getMagicGuardState(hostname: string | null, webContentsId?: number | null): MagicGuardState {
  return buildState(hostname, getCounts(webContentsId))
}

export function setMagicGuardEnabled(enabled: boolean, hostname: string | null, webContentsId?: number | null): MagicGuardState {
  saveConfig({ magicGuardEnabled: enabled === true })
  return buildState(hostname, getCounts(webContentsId))
}

/** `protect: false` excepts the site (Magic Guard off there); `true` removes any exception. */
export function setMagicGuardForSite(hostname: string | null, protect: boolean, webContentsId?: number | null): MagicGuardState {
  const host = canonicalizeHost(hostname ?? '')
  if (host) {
    const set = loadExceptions()
    if (protect) set.delete(host)
    else set.add(host)
    saveExceptions(set)
  }
  return buildState(host, getCounts(webContentsId))
}
