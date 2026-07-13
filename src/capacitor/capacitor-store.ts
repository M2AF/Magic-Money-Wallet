/**
 * capacitor-store.ts — Android/Capacitor storage adapter
 *
 * Replaces chrome-store.ts for the Capacitor build (vite alias). Same export
 * surface and the SAME at-rest vault format (PBKDF2-SHA256 600k → AES-256-GCM,
 * kdfVersion upgrade path), so wallets restore identically across targets.
 *
 * - Encrypted mnemonic + addresses + config: @capacitor/preferences (JSON strings)
 * - Decrypted mnemonic: module memory ONLY, never persisted. Process death = locked.
 * - Auto-lock: the extension's passive model — a 15-minute sliding `unlockedAt`
 *   timestamp checked on every mnemonic read (an active timer can't be trusted in
 *   a WebView Android may freeze or kill at any time). Expiry emits 'wallet:locked'.
 */

import { Preferences } from '@capacitor/preferences'
import { normalizeMnemonic, type WalletAddresses } from '../main/wallet-core'
import { emitUiEvent } from './platform-capacitor'

// ── WalletConfig — identical shape to secure-store.ts / chrome-store.ts ───────

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
  swapProxyUrl: string
  clientToken: string
  simpleSwapApiKey: string
  testnetMode: boolean
}

// Provider keys are EMPTY — they live only as Cloudflare Worker secrets and are
// injected server-side (see cloudflare-worker/, api-proxy.ts). An APK is publicly
// unzippable, exactly like an extension zip, so no keys ship here either.
const DEFAULT_CONFIG: WalletConfig = {
  alchemyKey:             '',
  ankrKey:                '',
  heliusKey:              '',
  blockfrostKey:          '',
  tatumKey:               '',
  moralisKey:             '',
  openseaKey:             '',
  ordiscanKey:            '',
  anvilKey:               '',
  supabaseUrl:            '',
  supabaseKey:            '',
  walletConnectProjectId: '1db049748ab5fecc3a39e64fbc11a41c',
  swapProxyUrl:           'https://magicmoney-swap-proxy.guildfordking.workers.dev',
  clientToken:            'magicmoney-wallet-v1',
  simpleSwapApiKey:       '',
  testnetMode:            false
}

const AUTO_LOCK_MS = 15 * 60_000
const LEGACY_PBKDF2_ITERATIONS = 210_000
const ACTIVE_PBKDF2_ITERATIONS = 600_000
const ACTIVE_KDF_VERSION = 2

type StoredEncryptedWallet = {
  salt: number[]
  iv: number[]
  data: number[]
  kdf?: 'PBKDF2-SHA256'
  kdfVersion?: number
  iterations?: number
}

// ── Preferences JSON helpers ──────────────────────────────────────────────────

async function prefGet<T>(key: string): Promise<T | null> {
  const { value } = await Preferences.get({ key })
  if (value == null) return null
  try { return JSON.parse(value) as T } catch { return null }
}

async function prefSet(key: string, value: unknown): Promise<void> {
  await Preferences.set({ key, value: JSON.stringify(value) })
}

// ── WebCrypto helpers (same parameters/format as chrome-store.ts) ─────────────

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations = ACTIVE_PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

function kdfIterations(blob: StoredEncryptedWallet): number {
  const iterations = Number(blob.iterations ?? LEGACY_PBKDF2_ITERATIONS)
  if (!Number.isSafeInteger(iterations) || iterations < LEGACY_PBKDF2_ITERATIONS) {
    throw new Error('Unsupported wallet KDF parameters')
  }
  return iterations
}

function needsKdfUpgrade(blob: StoredEncryptedWallet): boolean {
  return kdfIterations(blob) < ACTIVE_PBKDF2_ITERATIONS
}

async function encryptMnemonic(mnemonic: string, password: string): Promise<StoredEncryptedWallet> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv   = crypto.getRandomValues(new Uint8Array(12))
  const key  = await deriveKey(password, salt)
  const ct   = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(mnemonic))
  return {
    salt: Array.from(salt),
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(ct)),
    kdf: 'PBKDF2-SHA256',
    kdfVersion: ACTIVE_KDF_VERSION,
    iterations: ACTIVE_PBKDF2_ITERATIONS,
  }
}

async function decryptMnemonic(blob: StoredEncryptedWallet, password: string): Promise<string> {
  const key = await deriveKey(password, new Uint8Array(blob.salt), kdfIterations(blob))
  try {
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(blob.iv) }, key, new Uint8Array(blob.data))
    return new TextDecoder().decode(decrypted)
  } catch {
    throw new Error('Incorrect password')
  }
}

// ── Mnemonic (encrypted at rest, decrypted in module memory while unlocked) ───

let _unlockedMnemonic: string | null = null
let _unlockedAt = 0
let _tempMnemonic: string | null = null

function saveUnlockedMnemonic(mnemonic: string): void {
  _unlockedMnemonic = mnemonic
  _unlockedAt = Date.now()
}

function clearUnlockedMnemonic(): void {
  _unlockedMnemonic = null
  _unlockedAt = 0
}

function getUnlockedMnemonic(): string | null {
  if (!_unlockedMnemonic) return null
  if (Date.now() - _unlockedAt > AUTO_LOCK_MS) {
    clearUnlockedMnemonic()
    emitUiEvent('wallet:locked', null)
    return null
  }
  _unlockedAt = Date.now()  // sliding window — activity keeps the session alive
  return _unlockedMnemonic
}

export async function saveMnemonic(mnemonic: string, password: string): Promise<void> {
  // Canonical form at rest — bip39 seeds the raw string, so stray whitespace
  // would change the derived keys (mirrors secure-store.ts).
  const cleaned = normalizeMnemonic(mnemonic)
  await prefSet('wallet.enc', await encryptMnemonic(cleaned, password))
  saveUnlockedMnemonic(cleaned)
}

export async function walletExists(): Promise<boolean> {
  return (await prefGet<StoredEncryptedWallet>('wallet.enc')) !== null
}

export async function isUnlocked(): Promise<boolean> {
  return getUnlockedMnemonic() !== null
}

export async function unlock(password: string): Promise<void> {
  const blob = await prefGet<StoredEncryptedWallet>('wallet.enc')
  if (!blob) throw new Error('No wallet found')
  // Normalize on unlock so pre-normalization wallets feed signing the canonical form.
  const mnemonic = normalizeMnemonic(await decryptMnemonic(blob, password))
  if (needsKdfUpgrade(blob)) {
    await prefSet('wallet.enc', await encryptMnemonic(mnemonic, password))
  }
  saveUnlockedMnemonic(mnemonic)
}

export async function verifyPassword(password: string): Promise<boolean> {
  const blob = await prefGet<StoredEncryptedWallet>('wallet.enc')
  if (!blob) return false
  try {
    await decryptMnemonic(blob, password)
    return true
  } catch {
    return false
  }
}

export async function lock(): Promise<void> {
  clearUnlockedMnemonic()
}

export async function loadMnemonic(): Promise<string> {
  const mnemonic = getUnlockedMnemonic()
  if (!mnemonic) throw new Error('Wallet is locked — please unlock first')
  return mnemonic
}

/**
 * Restore an unlocked session from the biometric path (biometric.ts) — the
 * mnemonic was decrypted from the Keystore-wrapped copy, not the password vault.
 */
export function restoreUnlockedSession(mnemonic: string): void {
  saveUnlockedMnemonic(normalizeMnemonic(mnemonic))
}

export async function deleteWallet(): Promise<void> {
  await Preferences.remove({ key: 'wallet.enc' })
  await Preferences.remove({ key: 'wallet.addresses' })
  clearUnlockedMnemonic()
}

// ── Temp mnemonic during create/import flow (before password is set) ──────────
// In-memory: on Android the create/import flow lives in the same JS context and
// a killed process should drop the un-encrypted pending phrase anyway.

export async function saveTempMnemonic(mnemonic: string): Promise<void> {
  _tempMnemonic = mnemonic
}

export async function loadTempMnemonic(): Promise<string> {
  if (!_tempMnemonic) throw new Error('No pending wallet — start over')
  return _tempMnemonic
}

export async function clearTempMnemonic(): Promise<void> {
  _tempMnemonic = null
}

// ── Addresses (plain JSON) ────────────────────────────────────────────────────

/**
 * Testnet Mode address substitution — mirrors secure-store.effectiveAddresses.
 * Swaps the testnet-encoded Bitcoin/Cardano set into the top-level fields and
 * clears AGW (hidden in testnet mode). Pure/sync on purpose.
 */
export function effectiveAddresses(addresses: WalletAddresses, cfg: WalletConfig): WalletAddresses {
  if (!cfg.testnetMode || !addresses.testnet) return addresses
  const t = addresses.testnet
  return {
    ...addresses,
    bitcoin: t.bitcoin,
    bitcoinNested: t.bitcoinNested,
    bitcoinTaproot: t.bitcoinTaproot,
    cardano: t.cardano,
    cardanoStake: t.cardanoStake,
    agw: undefined,
    agwOwned: false,
  }
}

export async function saveAddresses(addresses: WalletAddresses): Promise<void> {
  await prefSet('wallet.addresses', addresses)
}

export async function loadAddresses(): Promise<WalletAddresses | null> {
  const a = await prefGet<WalletAddresses>('wallet.addresses')
  if (!a) return null
  // Wallets saved before accountIndex existed lack the field — default to 0.
  return { ...a, accountIndex: a.accountIndex ?? 0 }
}

// ── Config (plain JSON) ───────────────────────────────────────────────────────

export async function loadConfig(): Promise<WalletConfig> {
  const stored = await prefGet<Partial<WalletConfig>>('wallet.config')
  return { ...DEFAULT_CONFIG, ...(stored ?? {}) }
}

export async function saveConfig(config: Partial<WalletConfig>): Promise<void> {
  const current = await loadConfig()
  await prefSet('wallet.config', { ...current, ...config })
}

// ── NFT floor cache (display-only market data) ────────────────────────────────

export interface FloorCacheEntry { floor: number; symbol: string; at: number }

export async function loadFloorCache(): Promise<Record<string, FloorCacheEntry>> {
  const m = await prefGet<Record<string, FloorCacheEntry>>('wallet.floor_cache')
  return (m && typeof m === 'object') ? m : {}
}

export function saveFloorCache(map: Record<string, FloorCacheEntry>): void {
  prefSet('wallet.floor_cache', map).catch(() => { /* display-only cache */ })
}

// ── ERC-20 balance cache (last-known-good alchemy_getTokenBalances) ───────────

export interface TokenBalanceCacheEntry {
  balances: Array<{ contractAddress: string; tokenBalance: string }>
  at: number
}

export async function loadTokenBalanceCache(): Promise<Record<string, TokenBalanceCacheEntry>> {
  const m = await prefGet<Record<string, TokenBalanceCacheEntry>>('wallet.token_balance_cache')
  return (m && typeof m === 'object') ? m : {}
}

export function saveTokenBalanceCache(map: Record<string, TokenBalanceCacheEntry>): void {
  prefSet('wallet.token_balance_cache', map).catch(() => { /* display-only cache */ })
}

// ── Abstract Global Wallet manual override (per account) ──────────────────────

export async function loadAgwOverride(accountIndex: number): Promise<string | null> {
  const map = (await prefGet<Record<string, string>>('wallet.agw_overrides')) ?? {}
  return map[String(accountIndex)] ?? null
}

export async function saveAgwOverride(accountIndex: number, address: string | null): Promise<void> {
  const map = { ...((await prefGet<Record<string, string>>('wallet.agw_overrides')) ?? {}) }
  if (address) map[String(accountIndex)] = address
  else delete map[String(accountIndex)]
  await prefSet('wallet.agw_overrides', map)
}

// ── Active EVM chain (persisted so it survives app restarts) ──────────────────

export async function getCurrentChain(): Promise<string | null> {
  const hex = await prefGet<string>('wallet.current_chain')
  return typeof hex === 'string' ? hex : null
}

export async function setCurrentChain(hex: string): Promise<void> {
  await prefSet('wallet.current_chain', hex)
}

// ── Approved dApp origins ─────────────────────────────────────────────────────

export async function getApprovedOrigins(): Promise<string[]> {
  return (await prefGet<string[]>('wallet.approved_origins')) ?? []
}

export async function addApprovedOrigin(origin: string): Promise<void> {
  const existing = await getApprovedOrigins()
  if (!existing.includes(origin)) {
    await prefSet('wallet.approved_origins', [...existing, origin])
  }
}

export async function removeApprovedOrigin(origin: string): Promise<void> {
  const existing = await getApprovedOrigins()
  await prefSet('wallet.approved_origins', existing.filter(o => o !== origin))
}

/** Revoke every connected dApp at once (Settings → Connected Sites → Disconnect All). */
export async function clearApprovedOrigins(): Promise<void> {
  await prefSet('wallet.approved_origins', [])
}
