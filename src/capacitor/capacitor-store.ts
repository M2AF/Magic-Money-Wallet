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
import {
  normalizeApprovedOrigins, hasChainGrant, grantChain, revokeChain, originList,
  type ApprovedOrigin, type DappChain,
} from '../main/dapp-permissions'
import { emitUiEvent } from './platform-capacitor'

// ── WalletConfig — identical shape to secure-store.ts / chrome-store.ts ───────

// User-added EVM network — shape parity with secure-store.ts (chain-config
// imports this type through the secure-store alias).
export interface CustomChain {
  id: string
  name: string
  chainId: number
  nativeSymbol: string
  rpcUrl: string
  explorerUrl: string
}

// A manually imported ERC-20 on a custom chain. Mirrors secure-store.ts.
export interface CustomToken {
  chain: string
  contractAddress: string
  name: string
  symbol: string
  decimals: number
}

// A manually imported NFT on a custom chain. Mirrors secure-store.ts.
export interface CustomNft {
  chain: string
  contractAddress: string
  tokenId: string
  type: 'ERC-721' | 'ERC-1155'
}

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
  privacyMode: boolean       // Privacy Mode: portfolio shows ONLY XMR/ZEC/NIGHT — mutually exclusive with testnetMode
  torBrowserEnabled: boolean
  torBrowserPort: number
  moneroRestoreHeight: number // Monero wallet birthday (block height at first Privacy Mode enable)
  magicGuardEnabled: boolean // Shape parity only; the Android native WebView adapter ships in a later batch
  customChains: CustomChain[] // Shape parity only; the Android build has no add-network UI yet
  customTokens: CustomToken[] // Shape parity only
  customNfts: CustomNft[] // Shape parity only
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
  testnetMode:            false,
  privacyMode:            false,
  torBrowserEnabled:      false,
  torBrowserPort:         9050,
  moneroRestoreHeight:    0,
  magicGuardEnabled:      true,
  customChains:           [],
  customTokens:           [],
  customNfts:             []
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

// Extra secrets that must die with the wallet session — currently the browser's
// saved-password vault (browser-data-local). Registered from wallet-local rather
// than imported here, so this module keeps no dependency on the browser feature
// (and there is no import cycle back through verifyPassword).
const _lockListeners: Array<() => void> = []

/** Run `fn` whenever the wallet session is cleared (explicit lock or idle expiry). */
export function registerLockListener(fn: () => void): void {
  if (!_lockListeners.includes(fn)) _lockListeners.push(fn)
}

function clearUnlockedMnemonic(): void {
  _unlockedMnemonic = null
  _unlockedAt = 0
  for (const fn of _lockListeners) { try { fn() } catch { /* a listener must never block locking */ } }
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
  // The passkey recovery copy deliberately SURVIVES wallet deletion — it is a
  // backup, and destroying it defeats the one job it has (mirrors
  // secure-store.ts). Unlink in Settings to remove it.
  clearUnlockedMnemonic()
}

// ── Passkey recovery blob (link an EXISTING wallet to a passkey) ──────────────
// Envelope encryption under 32 bytes of WebAuthn PRF output, mirroring
// secure-store.ts on Electron. Distinct from generate-with-passkey, which
// DERIVES a wallet from those bytes and stores nothing.
//
// The key material is already 32 uniform bytes from HMAC-SHA-256, so it is
// imported directly as an AES-256 key — no PBKDF2. Stretching a
// high-entropy key would add cost without adding strength.

const PASSKEY_BLOB_KEY = 'wallet.passkey.enc'

interface PasskeyBlob { iv: number[]; data: number[] }

async function aesKeyFromMaterial(material: Uint8Array): Promise<CryptoKey> {
  if (material.length !== 32) throw new Error('Passkey key material must be 32 bytes')
  // Copy into a fresh ArrayBuffer-backed view — importKey rejects shared buffers.
  const raw = new Uint8Array(32)
  raw.set(material)
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function hasPasskeyBackup(): Promise<boolean> {
  return (await prefGet<PasskeyBlob>(PASSKEY_BLOB_KEY)) !== null
}

/** Link the CURRENTLY-UNLOCKED wallet to `material` (32 bytes of PRF output). */
export async function linkPasskey(material: Uint8Array): Promise<void> {
  const mnemonic = getUnlockedMnemonic()
  if (!mnemonic) throw new Error('Unlock the wallet first')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await aesKeyFromMaterial(material)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(normalizeMnemonic(mnemonic))
  )
  await prefSet(PASSKEY_BLOB_KEY, { iv: Array.from(iv), data: Array.from(new Uint8Array(ct)) })
}

/**
 * Recover the phrase from the passkey blob. Throws when nothing is linked, or
 * when `material` is from a different passkey — AES-GCM authentication fails,
 * which is the desired outcome rather than returning garbage.
 */
export async function mnemonicFromPasskeyBackup(material: Uint8Array): Promise<string> {
  const blob = await prefGet<PasskeyBlob>(PASSKEY_BLOB_KEY)
  if (!blob) throw new Error('No passkey is linked to a wallet on this device')
  const key = await aesKeyFromMaterial(material)
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(blob.iv) }, key, new Uint8Array(blob.data)
  )
  return normalizeMnemonic(new TextDecoder().decode(pt))
}

/** Unlink: drop the encrypted copy. The passkey itself is the user's to delete. */
export async function removePasskeyBackup(): Promise<void> {
  await Preferences.remove({ key: PASSKEY_BLOB_KEY })
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
  const previous = await prefGet<WalletAddresses>('wallet.addresses')
  await prefSet('wallet.addresses', addresses)

  // Follow the selected account into the Android passkey provider. Without this
  // the provider keeps minting under whichever account was current when it was
  // first enabled — silently the wrong one. This is the ONLY place every account
  // change funnels through (switch, import, restore), which is why the hook
  // lives here rather than in the set-account handler shared with the extension.
  //
  // ⚠ Dynamic import: passkey-system-provider imports THIS module, so a static
  // import would close the cycle.
  if ((previous?.accountIndex ?? -1) !== addresses.accountIndex) {
    try {
      const { syncPasskeyAccount } = await import('./passkey-system-provider')
      await syncPasskeyAccount(addresses.accountIndex)
    } catch { /* no provider on this platform, or it was never enabled */ }
  }
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
// Per-chain grants; legacy flat string[] values migrate on read. Shape and
// migration are shared with the Electron and extension stores — see
// ../main/dapp-permissions.ts. This file serves BOTH native targets (Android and
// iOS resolve `./secure-store` here), so a change made once covers both.

export async function getApprovedOriginRecords(): Promise<ApprovedOrigin[]> {
  return normalizeApprovedOrigins(await prefGet<unknown>('wallet.approved_origins'))
}

export async function getApprovedOrigins(): Promise<string[]> {
  return originList(await getApprovedOriginRecords())
}

/** Is this origin allowed to use this chain? The gate every dApp handler uses. */
export async function hasOriginChain(origin: string, chain: DappChain): Promise<boolean> {
  return hasChainGrant(await getApprovedOriginRecords(), origin, chain)
}

export async function addApprovedOrigin(origin: string, chain: DappChain): Promise<void> {
  await prefSet('wallet.approved_origins', grantChain(await getApprovedOriginRecords(), origin, chain))
}

/** Revoke one chain, or the whole origin when `chain` is omitted. */
export async function removeApprovedOrigin(origin: string, chain?: DappChain): Promise<void> {
  await prefSet('wallet.approved_origins', revokeChain(await getApprovedOriginRecords(), origin, chain))
}

/** Revoke every connected dApp at once (Settings → Connected Sites → Disconnect All). */
export async function clearApprovedOrigins(): Promise<void> {
  await prefSet('wallet.approved_origins', [])
}
