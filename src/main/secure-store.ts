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

const userData = () => app.getPath('userData')
const walletEncPath = () => join(userData(), 'wallet.enc')
const addressesPath = () => join(userData(), 'addresses.json')
const configPath = () => join(userData(), 'config.json')
const approvedOriginsPath = () => join(userData(), 'approved-origins.json')

// ─── Mnemonic (encrypted) ────────────────────────────────────────────────────

export function saveMnemonic(mnemonic: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS secure storage is not available. Cannot save wallet safely on this platform.'
    )
  }
  mkdirSync(userData(), { recursive: true })
  const encrypted = safeStorage.encryptString(mnemonic)
  writeFileSync(walletEncPath(), encrypted)
}

export function loadMnemonic(): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage not available')
  }
  if (!existsSync(walletEncPath())) {
    throw new Error('No wallet found — please create or import one')
  }
  const encrypted = readFileSync(walletEncPath())
  return safeStorage.decryptString(encrypted)
}

export function walletExists(): boolean {
  return existsSync(walletEncPath())
}

export function deleteWallet(): void {
  if (existsSync(walletEncPath())) unlinkSync(walletEncPath())
  if (existsSync(addressesPath())) unlinkSync(addressesPath())
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

// ─── API config (plain JSON) ─────────────────────────────────────────────────

export interface WalletConfig {
  alchemyKey: string
  heliusKey: string
  blockfrostKey: string
  tatumKey: string
  moralisKey: string
  openseaKey: string
  supabaseUrl: string
  supabaseKey: string
  walletConnectProjectId: string
  swapProxyUrl: string       // MagicMoney swap proxy (Cloudflare Worker) origin — empty until deployed
  simpleSwapApiKey: string
}

const DEFAULT_CONFIG: WalletConfig = {
  alchemyKey: 'REDACTED_ALCHEMY_KEY',
  heliusKey: 'REDACTED_HELIUS_KEY',
  blockfrostKey: 'REDACTED_BLOCKFROST_KEY',
  tatumKey: 'REDACTED_TATUM_KEY',
  moralisKey: 'REDACTED_JWT',
  openseaKey: 'REDACTED_OPENSEA_KEY',
  supabaseUrl: 'https://REDACTED_SUPABASE_PROJECT.supabase.co',
  supabaseKey: 'REDACTED_SUPABASE_SECRET',
  walletConnectProjectId: '1db049748ab5fecc3a39e64fbc11a41c',
  // DEX swaps route through this proxy (keys injected server-side).
  swapProxyUrl: 'https://magicmoney-swap-proxy.guildfordking.workers.dev',
  // SimpleSwap DeFi (crypto) key — direct calls for now; moves behind swapProxyUrl /ss/* when deployed.
  simpleSwapApiKey: 'e7f2026e-5e26-41ba-a6ed-dc688d2fcae8'
}

let configCache: WalletConfig | null = null

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
    configCache = { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(configPath(), 'utf-8')) }
  } catch {
    configCache = DEFAULT_CONFIG
  }
  return configCache ?? DEFAULT_CONFIG
}

export function saveConfig(config: Partial<WalletConfig>): void {
  const current = loadConfig()
  const merged = { ...current, ...config }
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
