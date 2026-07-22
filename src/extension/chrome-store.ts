/**
 * chrome-store.ts — Extension storage adapter
 *
 * Replaces secure-store.ts for the browser extension build.
 * - Mnemonic: AES-256-GCM encrypted via PBKDF2 password, stored in chrome.storage.local
 * - Decrypted mnemonic: cached in chrome.storage.session (cleared on browser close)
 * - Addresses + config: plain JSON in chrome.storage.local
 *
 * All functions are async (chrome.storage is always async).
 */

import { normalizeMnemonic, type WalletAddresses } from '../main/wallet-core'

// ── WalletConfig — identical shape to secure-store.ts so aliased imports work ─

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
  torBrowserEnabled: boolean // Shape parity only; Chrome tabs cannot use the in-app Tor proxy
  torBrowserPort: number
  moneroRestoreHeight: number // Monero wallet birthday (block height at first Privacy Mode enable)
}

// Provider keys are EMPTY — they live only as Cloudflare Worker secrets and are
// injected server-side (see cloudflare-worker/, api-proxy.ts). A Chrome Web Store
// package is publicly unzippable, so shipping keys here was the worst exposure;
// this closes it. `walletConnectProjectId` stays client-side by design (WC connects
// to its relay directly, not through our Worker).
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
  moneroRestoreHeight:    0
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

// ── WebCrypto helpers ─────────────────────────────────────────────────────────

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

// ── Mnemonic (encrypted at rest, decrypted in session) ───────────────────────

async function saveUnlockedMnemonic(mnemonic: string): Promise<void> {
  await chrome.storage.session.set({
    'wallet.unlocked': mnemonic,
    'wallet.unlockedAt': Date.now()
  })
}

async function clearUnlockedMnemonic(): Promise<void> {
  await chrome.storage.session.remove(['wallet.unlocked', 'wallet.unlockedAt'])
}

async function getUnlockedMnemonic(): Promise<string | null> {
  const r = await chrome.storage.session.get(['wallet.unlocked', 'wallet.unlockedAt'])
  const mnemonic = r['wallet.unlocked']
  if (!mnemonic) return null
  const unlockedAt = Number(r['wallet.unlockedAt'] ?? 0)
  if (!Number.isFinite(unlockedAt) || Date.now() - unlockedAt > AUTO_LOCK_MS) {
    await clearUnlockedMnemonic()
    return null
  }
  await chrome.storage.session.set({ 'wallet.unlockedAt': Date.now() })
  return mnemonic as string
}

export async function saveMnemonic(mnemonic: string, password: string): Promise<void> {
  // Canonical form at rest — bip39 seeds the raw string, so stray whitespace
  // would change the derived keys (mirrors secure-store.ts).
  const cleaned = normalizeMnemonic(mnemonic)
  await chrome.storage.local.set({ 'wallet.enc': await encryptMnemonic(cleaned, password) })
  await saveUnlockedMnemonic(cleaned)
}

export async function walletExists(): Promise<boolean> {
  const r = await chrome.storage.local.get('wallet.enc')
  return !!r['wallet.enc']
}

export async function isUnlocked(): Promise<boolean> {
  return (await getUnlockedMnemonic()) !== null
}

export async function unlock(password: string): Promise<void> {
  const r = await chrome.storage.local.get('wallet.enc')
  if (!r['wallet.enc']) throw new Error('No wallet found')
  const blob = r['wallet.enc'] as StoredEncryptedWallet
  // Normalize on unlock so pre-normalization wallets feed signing the canonical form.
  const mnemonic = normalizeMnemonic(await decryptMnemonic(blob, password))
  if (needsKdfUpgrade(blob)) {
    await chrome.storage.local.set({ 'wallet.enc': await encryptMnemonic(mnemonic, password) })
  }
  await saveUnlockedMnemonic(mnemonic)
}

export async function verifyPassword(password: string): Promise<boolean> {
  const r = await chrome.storage.local.get('wallet.enc')
  if (!r['wallet.enc']) return false
  try {
    await decryptMnemonic(r['wallet.enc'] as StoredEncryptedWallet, password)
    return true
  } catch {
    return false
  }
}

export async function lock(): Promise<void> {
  await clearUnlockedMnemonic()
}

export async function loadMnemonic(): Promise<string> {
  const mnemonic = await getUnlockedMnemonic()
  if (!mnemonic) throw new Error('Wallet is locked — please unlock first')
  return mnemonic
}

export async function deleteWallet(): Promise<void> {
  await chrome.storage.local.remove(['wallet.enc', 'wallet.addresses'])
  await clearUnlockedMnemonic()
}

// ── Temp mnemonic during create/import flow (before password is set) ──────────

export async function saveTempMnemonic(mnemonic: string): Promise<void> {
  await chrome.storage.session.set({ 'wallet.temp': mnemonic })
}

export async function loadTempMnemonic(): Promise<string> {
  const r = await chrome.storage.session.get('wallet.temp')
  if (!r['wallet.temp']) throw new Error('No pending wallet — start over')
  return r['wallet.temp'] as string
}

export async function clearTempMnemonic(): Promise<void> {
  await chrome.storage.session.remove('wallet.temp')
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
  await chrome.storage.local.set({ 'wallet.addresses': addresses })
}

export async function loadAddresses(): Promise<WalletAddresses | null> {
  const r = await chrome.storage.local.get('wallet.addresses')
  const a = r['wallet.addresses']
  if (!a) return null
  // Wallets saved before accountIndex existed lack the field — default to 0.
  const addrs = a as WalletAddresses
  return { ...addrs, accountIndex: addrs.accountIndex ?? 0 }
}

// ── Config (plain JSON) ───────────────────────────────────────────────────────

export async function loadConfig(): Promise<WalletConfig> {
  const r = await chrome.storage.local.get('wallet.config')
  return { ...DEFAULT_CONFIG, ...(r['wallet.config'] ?? {}) }
}

export async function saveConfig(config: Partial<WalletConfig>): Promise<void> {
  const current = await loadConfig()
  await chrome.storage.local.set({ 'wallet.config': { ...current, ...config } })
}

// ── NFT floor cache (display-only market data) ────────────────────────────────
// Mirrors secure-store.ts's floor-cache.json, persisted in chrome.storage so a
// freshly-woken service worker starts with warm last-known-good floors.

export interface FloorCacheEntry { floor: number; symbol: string; at: number }

export async function loadFloorCache(): Promise<Record<string, FloorCacheEntry>> {
  const r = await chrome.storage.local.get('wallet.floor_cache')
  const m = r['wallet.floor_cache']
  return (m && typeof m === 'object') ? m as Record<string, FloorCacheEntry> : {}
}

export function saveFloorCache(map: Record<string, FloorCacheEntry>): void {
  chrome.storage.local.set({ 'wallet.floor_cache': map }).catch(() => { /* display-only cache */ })
}

// ── ERC-20 balance cache (last-known-good alchemy_getTokenBalances) ───────────
// Mirrors secure-store.ts's token-balance-cache.json. Served by alchemy-cache.ts
// when the live call fails so throttling never presents as "zero tokens".

export interface TokenBalanceCacheEntry {
  balances: Array<{ contractAddress: string; tokenBalance: string }>
  at: number
}

export async function loadTokenBalanceCache(): Promise<Record<string, TokenBalanceCacheEntry>> {
  const r = await chrome.storage.local.get('wallet.token_balance_cache')
  const m = r['wallet.token_balance_cache']
  return (m && typeof m === 'object') ? m as Record<string, TokenBalanceCacheEntry> : {}
}

export function saveTokenBalanceCache(map: Record<string, TokenBalanceCacheEntry>): void {
  chrome.storage.local.set({ 'wallet.token_balance_cache': map }).catch(() => { /* display-only cache */ })
}

// ── Abstract Global Wallet manual override (per account) ──────────────────────
// Mirrors secure-store.ts's agw-overrides.json, but persisted in chrome.storage.

export async function loadAgwOverride(accountIndex: number): Promise<string | null> {
  const r = await chrome.storage.local.get('wallet.agw_overrides')
  const map = (r['wallet.agw_overrides'] ?? {}) as Record<string, string>
  return map[String(accountIndex)] ?? null
}

export async function saveAgwOverride(accountIndex: number, address: string | null): Promise<void> {
  const r = await chrome.storage.local.get('wallet.agw_overrides')
  const map = { ...((r['wallet.agw_overrides'] ?? {}) as Record<string, string>) }
  if (address) map[String(accountIndex)] = address
  else delete map[String(accountIndex)]
  await chrome.storage.local.set({ 'wallet.agw_overrides': map })
}

// ── Active EVM chain (persisted so it survives service-worker restarts) ───────
// The service worker's in-memory `_currentChainId` resets to Ethereum whenever
// the MV3 SW sleeps. Persisting the user's selection here keeps the injected
// provider's eth_chainId stable across restarts (see background.ts hydration).

export async function getCurrentChain(): Promise<string | null> {
  const r = await chrome.storage.local.get('wallet.current_chain')
  const hex = r['wallet.current_chain']
  return typeof hex === 'string' ? hex : null
}

export async function setCurrentChain(hex: string): Promise<void> {
  await chrome.storage.local.set({ 'wallet.current_chain': hex })
}

// ── Approved dApp origins ─────────────────────────────────────────────────────

export async function getApprovedOrigins(): Promise<string[]> {
  const r = await chrome.storage.local.get('wallet.approved_origins')
  return (r['wallet.approved_origins'] as string[] | undefined) ?? []
}

export async function addApprovedOrigin(origin: string): Promise<void> {
  const existing = await getApprovedOrigins()
  if (!existing.includes(origin)) {
    await chrome.storage.local.set({ 'wallet.approved_origins': [...existing, origin] })
  }
}

export async function removeApprovedOrigin(origin: string): Promise<void> {
  const existing = await getApprovedOrigins()
  await chrome.storage.local.set({ 'wallet.approved_origins': existing.filter(o => o !== origin) })
}

/** Revoke every connected dApp at once (Settings → Connected Sites → Disconnect All). */
export async function clearApprovedOrigins(): Promise<void> {
  await chrome.storage.local.set({ 'wallet.approved_origins': [] })
}
