/**
 * secure-store.ts — MagicMoney Wallet
 *
 * Wraps electron.safeStorage to encrypt/decrypt the mnemonic using the OS
 * credential store (Windows Credential Manager / macOS Keychain / libsecret).
 * This gives AES-256 encryption tied to the OS user account with zero
 * crypto code to maintain ourselves.
 *
 * Public addresses and API config are stored as plain JSON (not secrets).
 */

import { safeStorage, app } from 'electron'
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { WalletAddresses } from './wallet-core'
import { encryptSecret, decryptSecret, isEncryptedBlob, needsKdfUpgrade, encryptWithKeyMaterial, decryptWithKeyMaterial, type EncryptedBlob } from './crypto-vault'
import { runHello, helloPlatformOk, HELLO_KEY_NAME, HELLO_CHALLENGE_B64 } from './hello-bridge'

const userData = () => app.getPath('userData')
const walletEncPath = () => join(userData(), 'wallet.enc')
const addressesPath = () => join(userData(), 'addresses.json')
const walletHelloPath = () => join(userData(), 'wallet.hello.enc')
const configPath = () => join(userData(), 'config.json')
const approvedOriginsPath = () => join(userData(), 'approved-origins.json')
const agwOverridesPath = () => join(userData(), 'agw-overrides.json')

// ─── Mnemonic (password-encrypted, layered over OS safeStorage) ──────────────
//
// At rest, wallet.enc holds   safeStorage.encrypt( JSON(EncryptedBlob) )
//   — an AES-256-GCM blob (PBKDF2 password key) wrapped again by the OS keychain.
// The decrypted phrase is held ONLY in this in-memory variable after unlock and
// is the single source every signing path reads (loadMnemonic). It is cleared on
// lock(), wallet delete, and the idle auto-lock timer (driven from ipc-handlers).
//
// Legacy wallets (created before passwords) stored safeStorage.encrypt(rawPhrase)
// directly; needsMigration()/migrateLegacy() upgrade them in place on first run.

let _unlockedMnemonic: string | null = null

function requireSafeStorage(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is not available. Cannot store the wallet safely on this platform.')
  }
}

/** Decrypt the outer safeStorage layer to the stored string (blob-JSON or legacy phrase). */
function readOuter(): string | null {
  if (!existsSync(walletEncPath())) return null
  requireSafeStorage()
  return safeStorage.decryptString(readFileSync(walletEncPath()))
}

/** Encrypt `mnemonic` under `password` and persist it; leaves the wallet unlocked. */
export async function saveMnemonic(mnemonic: string, password: string): Promise<void> {
  await persistEncryptedMnemonic(mnemonic, password)
  _unlockedMnemonic = mnemonic
}

async function persistEncryptedMnemonic(mnemonic: string, password: string): Promise<void> {
  requireSafeStorage()
  const blob = await encryptSecret(mnemonic, password)
  mkdirSync(userData(), { recursive: true })
  writeFileSync(walletEncPath(), safeStorage.encryptString(JSON.stringify(blob)))
}

/** True when wallet.enc holds the new password-encrypted blob (vs. a legacy phrase). */
export function isPasswordEncrypted(): boolean {
  try {
    const outer = readOuter()
    if (outer == null) return false
    return isEncryptedBlob(JSON.parse(outer))
  } catch {
    return false
  }
}

/** A wallet exists but predates password encryption — must be migrated before use. */
export function needsMigration(): boolean {
  return walletExists() && !isPasswordEncrypted()
}

/** Decrypt with `password` and cache the phrase in memory. Throws on wrong password. */
export async function unlock(password: string): Promise<void> {
  const outer = readOuter()
  if (outer == null) throw new Error('No wallet found — please create or import one')
  const parsed = (() => { try { return JSON.parse(outer) } catch { return null } })()
  if (!isEncryptedBlob(parsed)) throw new Error('NEEDS_MIGRATION')
  const blob = parsed as EncryptedBlob
  _unlockedMnemonic = await decryptSecret(blob, password)
  if (needsKdfUpgrade(blob)) {
    await persistEncryptedMnemonic(_unlockedMnemonic, password)
  }
}

/** Upgrade a legacy (safeStorage-only) wallet to password encryption, then unlock. */
export async function migrateLegacy(password: string): Promise<void> {
  const outer = readOuter()
  if (outer == null) throw new Error('No wallet found')
  if (isEncryptedBlob((() => { try { return JSON.parse(outer) } catch { return null } })())) {
    throw new Error('Wallet is already password-protected')
  }
  await saveMnemonic(outer, password)   // `outer` is the raw legacy phrase
}

/** Verify `password` against the stored blob without changing lock state. */
export async function verifyPassword(password: string): Promise<boolean> {
  try {
    const outer = readOuter()
    if (outer == null) return false
    const parsed = JSON.parse(outer)
    if (!isEncryptedBlob(parsed)) return false
    await decryptSecret(parsed, password)
    return true
  } catch {
    return false
  }
}

export function lock(): void {
  _unlockedMnemonic = null
}

// ─── Windows Hello unlock (optional, additive) ───────────────────────────────
//
// A SECOND encrypted copy of the mnemonic at wallet.hello.enc, wrapped by a key
// derived (HKDF) from a TPM-backed Windows Hello signature (hello-bridge.ts). It
// NEVER touches the password copy (wallet.enc) — it's a convenience unlock and the
// password remains the recovery path. At rest it's safeStorage.encrypt(JSON(blob)),
// and the blob is only decryptable after a real Hello ceremony: the signature can't
// be produced without the TPM key + user verification, so the seed stays
// unrecoverable from the device files alone.

/** True when a Hello unlock copy is enrolled for this wallet. */
export function hasHelloUnlock(): boolean {
  return existsSync(walletHelloPath())
}

/** Enroll Hello unlock for the CURRENTLY-UNLOCKED wallet. Triggers a Hello prompt. */
export async function enrollHello(): Promise<void> {
  if (!helloPlatformOk()) throw new Error('Windows Hello is only available on Windows')
  if (_unlockedMnemonic == null) throw new Error('Unlock the wallet first')
  requireSafeStorage()
  const res = await runHello('enroll', HELLO_KEY_NAME, HELLO_CHALLENGE_B64)
  if (!res.ok || !res.signatureB64) {
    throw new Error(res.status === 'UserCanceled' ? 'Windows Hello was canceled' : (res.status ?? res.error ?? 'Windows Hello enrollment failed'))
  }
  const material = new Uint8Array(Buffer.from(res.signatureB64, 'base64'))
  const blob = await encryptWithKeyMaterial(_unlockedMnemonic, material)
  mkdirSync(userData(), { recursive: true })
  writeFileSync(walletHelloPath(), safeStorage.encryptString(JSON.stringify(blob)))
}

/** Unlock via Windows Hello. Triggers a Hello prompt; caches the phrase on success. */
export async function unlockWithHello(): Promise<void> {
  if (!hasHelloUnlock()) throw new Error('Windows Hello is not set up for this wallet')
  requireSafeStorage()
  const res = await runHello('sign', HELLO_KEY_NAME, HELLO_CHALLENGE_B64)
  if (!res.ok || !res.signatureB64) {
    throw new Error(res.status === 'UserCanceled' ? 'Windows Hello was canceled' : (res.status ?? res.error ?? 'Windows Hello unlock failed'))
  }
  const material = new Uint8Array(Buffer.from(res.signatureB64, 'base64'))
  const outer = safeStorage.decryptString(readFileSync(walletHelloPath()))
  const blob = JSON.parse(outer) as EncryptedBlob
  _unlockedMnemonic = await decryptWithKeyMaterial(blob, material)
}

/** Disable Hello unlock: remove the encrypted copy and the TPM-backed key. */
export async function removeHello(): Promise<void> {
  if (existsSync(walletHelloPath())) unlinkSync(walletHelloPath())
  if (helloPlatformOk()) { try { await runHello('delete', HELLO_KEY_NAME) } catch { /* best effort */ } }
}

export function isUnlocked(): boolean {
  return _unlockedMnemonic !== null
}

/** The decrypted phrase. Every signing path goes through here — throws when locked. */
export function loadMnemonic(): string {
  if (_unlockedMnemonic == null) throw new Error('Wallet is locked — please unlock first')
  return _unlockedMnemonic
}

export function walletExists(): boolean {
  return existsSync(walletEncPath())
}

export function deleteWallet(): void {
  if (existsSync(walletEncPath())) unlinkSync(walletEncPath())
  if (existsSync(addressesPath())) unlinkSync(addressesPath())
  // Also remove the Hello unlock copy + its TPM key (fire-and-forget for the key).
  if (existsSync(walletHelloPath())) unlinkSync(walletHelloPath())
  if (helloPlatformOk()) { void runHello('delete', HELLO_KEY_NAME).catch(() => { /* best effort */ }) }
  _unlockedMnemonic = null
  addressesCache = null
  addressesCached = false
}

// ─── Public addresses (plain JSON, not secrets) ──────────────────────────────

// In-memory caches for the hot read path. Connected dApps poll web3:request
// many times per second; without caching, each poll did a synchronous
// readFileSync + JSON.parse on the main thread, stalling window dragging.
// These values only change through the setters below, so invalidation is exact.
let addressesCache: WalletAddresses | null = null
let addressesCached = false

export function saveAddresses(addresses: WalletAddresses): void {
  mkdirSync(userData(), { recursive: true })
  writeFileSync(addressesPath(), JSON.stringify(addresses, null, 2))
  addressesCache = addresses
  addressesCached = true
}

export function loadAddresses(): WalletAddresses | null {
  if (addressesCached) return addressesCache
  if (!existsSync(addressesPath())) {
    addressesCache = null
    addressesCached = true
    return null
  }
  try {
    const parsed = JSON.parse(readFileSync(addressesPath(), 'utf-8'))
    // Default accountIndex to 0 for wallets created before multi-account support
    addressesCache = { accountIndex: 0, ...parsed }
  } catch {
    addressesCache = null
  }
  addressesCached = true
  return addressesCache
}

// ─── AGW overrides (per-account manual Abstract Global Wallet address) ───────
// Stored separately from addresses.json because switching accounts re-derives
// addresses wholesale. Map: accountIndex (string) → AGW address. A null/missing
// entry means "auto-derive from the EOA".

let agwOverridesCache: Record<string, string> | null = null

function loadAgwOverrides(): Record<string, string> {
  if (agwOverridesCache) return agwOverridesCache
  if (!existsSync(agwOverridesPath())) {
    agwOverridesCache = {}
    return agwOverridesCache
  }
  try {
    const parsed = JSON.parse(readFileSync(agwOverridesPath(), 'utf-8'))
    agwOverridesCache = (parsed && typeof parsed === 'object') ? parsed as Record<string, string> : {}
  } catch {
    agwOverridesCache = {}
  }
  return agwOverridesCache
}

export function loadAgwOverride(accountIndex: number): string | null {
  return loadAgwOverrides()[String(accountIndex)] ?? null
}

/** Set (or clear, when address is null) the manual AGW override for an account. */
export function saveAgwOverride(accountIndex: number, address: string | null): void {
  const current = { ...loadAgwOverrides() }
  if (address) {
    current[String(accountIndex)] = address
  } else {
    delete current[String(accountIndex)]
  }
  mkdirSync(userData(), { recursive: true })
  writeFileSync(agwOverridesPath(), JSON.stringify(current, null, 2))
  agwOverridesCache = current
}

// ─── API config (plain JSON) ─────────────────────────────────────────────────

export interface WalletConfig {
  alchemyKey: string
  ankrKey: string
  heliusKey: string
  blockfrostKey: string
  tatumKey: string
  moralisKey: string
  openseaKey: string
  ordiscanKey: string
  anvilKey: string
  supabaseUrl: string
  supabaseKey: string
  walletConnectProjectId: string
  swapProxyUrl: string       // MagicMoney swap proxy (Cloudflare Worker) origin — empty until deployed
  clientToken: string         // Public client tag sent to the Worker as x-mm-client/mm_client
  simpleSwapApiKey: string
}

// All provider keys are EMPTY by default — they live only as Cloudflare Worker
// secrets and are injected server-side (see cloudflare-worker/, api-proxy.ts).
// Shipping keys in the bundle was the security hole this closes. A self-hoster can
// still paste their own keys in Settings; with a key present the client falls back
// to a direct call when no proxy is configured. `swapProxyUrl` (the Worker origin)
// is the one populated default. `walletConnectProjectId` stays client-side by
// design — WalletConnect connects to its relay directly, not through our Worker.
const DEFAULT_CONFIG: WalletConfig = {
  alchemyKey: '',
  ankrKey: '',
  heliusKey: '',
  blockfrostKey: '',
  tatumKey: '',
  moralisKey: '',
  openseaKey: '',
  ordiscanKey: '',
  anvilKey: '',
  supabaseUrl: '',
  supabaseKey: '',
  walletConnectProjectId: '1db049748ab5fecc3a39e64fbc11a41c',
  // All keyed providers (RPC, NFT, prices, DEX, Supabase) route through this proxy.
  swapProxyUrl: 'https://magicmoney-swap-proxy.guildfordking.workers.dev',
  clientToken: 'magicmoney-wallet-v1',
  simpleSwapApiKey: ''
}

let configCache: WalletConfig | null = null

// H-3: the swap proxy is part of the signing trust base — its responses become
// swap calldata the wallet signs. config.json is plaintext + user-writable, so a
// hostile value could redirect that calldata. Pin the proxy host to this
// code-defined allowlist (which a local file edit cannot change). An empty value
// is allowed (= no proxy, direct keyed calls). Self-hosters add their host here.
const ALLOWED_PROXY_HOSTS = new Set<string>([
  'magicmoney-swap-proxy.guildfordking.workers.dev',
])

/** Coerce swapProxyUrl to a trusted https origin on the allowlist, or '' / default. */
function sanitizeProxyUrl(url: string | undefined): string {
  if (!url || !url.trim()) return ''   // explicit "no proxy" — safe (no redirection)
  try {
    const u = new URL(url.trim())
    if (u.protocol !== 'https:') return DEFAULT_CONFIG.swapProxyUrl
    if (!ALLOWED_PROXY_HOSTS.has(u.hostname)) return DEFAULT_CONFIG.swapProxyUrl
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '')
  } catch {
    return DEFAULT_CONFIG.swapProxyUrl
  }
}

function sanitizeConfig(cfg: WalletConfig): WalletConfig {
  return { ...cfg, swapProxyUrl: sanitizeProxyUrl(cfg.swapProxyUrl) }
}

export function loadConfig(): WalletConfig {
  if (configCache) return configCache
  if (!existsSync(configPath())) {
    // Write defaults on first run
    mkdirSync(userData(), { recursive: true })
    writeFileSync(configPath(), JSON.stringify(DEFAULT_CONFIG, null, 2))
    configCache = DEFAULT_CONFIG
    return configCache
  }
  try {
    configCache = sanitizeConfig({ ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(configPath(), 'utf-8')) })
  } catch {
    configCache = DEFAULT_CONFIG
  }
  return configCache ?? DEFAULT_CONFIG
}

export function saveConfig(config: Partial<WalletConfig>): void {
  const current = loadConfig()
  const merged = sanitizeConfig({ ...current, ...config })
  mkdirSync(userData(), { recursive: true })
  writeFileSync(configPath(), JSON.stringify(merged, null, 2))
  configCache = merged
}

// ─── Approved dApp origins (plain JSON, not secrets) ────────────────────────

let approvedOriginsCache: string[] | null = null

export function getApprovedOrigins(): string[] {
  if (approvedOriginsCache) return approvedOriginsCache
  if (!existsSync(approvedOriginsPath())) {
    approvedOriginsCache = []
    return approvedOriginsCache
  }
  try {
    const parsed = JSON.parse(readFileSync(approvedOriginsPath(), 'utf-8'))
    approvedOriginsCache = Array.isArray(parsed)
      ? parsed.filter((origin): origin is string => typeof origin === 'string')
      : []
  } catch {
    approvedOriginsCache = []
  }
  return approvedOriginsCache
}

export function addApprovedOrigin(origin: string): void {
  const existing = getApprovedOrigins()
  if (existing.includes(origin)) return
  const next = [...existing, origin]
  mkdirSync(userData(), { recursive: true })
  writeFileSync(approvedOriginsPath(), JSON.stringify(next, null, 2))
  approvedOriginsCache = next
}

export function removeApprovedOrigin(origin: string): void {
  const existing = getApprovedOrigins()
  const next = existing.filter(o => o !== origin)
  mkdirSync(userData(), { recursive: true })
  writeFileSync(approvedOriginsPath(), JSON.stringify(next, null, 2))
  approvedOriginsCache = next
}

/** Revoke every connected dApp at once (Settings → Connected Sites → Disconnect All). */
export function clearApprovedOrigins(): void {
  mkdirSync(userData(), { recursive: true })
  writeFileSync(approvedOriginsPath(), JSON.stringify([], null, 2))
  approvedOriginsCache = []
}
