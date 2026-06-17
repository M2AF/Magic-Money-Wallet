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
}

// ─── Public addresses (plain JSON, not secrets) ──────────────────────────────

export function saveAddresses(addresses: WalletAddresses): void {
  mkdirSync(userData(), { recursive: true })
  writeFileSync(addressesPath(), JSON.stringify(addresses, null, 2))
}

export function loadAddresses(): WalletAddresses | null {
  if (!existsSync(addressesPath())) return null
  try {
    const parsed = JSON.parse(readFileSync(addressesPath(), 'utf-8'))
    // Default accountIndex to 0 for wallets created before multi-account support
    return { accountIndex: 0, ...parsed }
  } catch {
    return null
  }
}

// ─── API config (plain JSON) ─────────────────────────────────────────────────

export interface WalletConfig {
  alchemyKey: string
  heliusKey: string
  blockfrostKey: string
  tatumKey: string
  moralisKey: string
}

const DEFAULT_CONFIG: WalletConfig = {
  alchemyKey: 'REDACTED_ALCHEMY_KEY',
  heliusKey: 'REDACTED_HELIUS_KEY',
  blockfrostKey: 'REDACTED_BLOCKFROST_KEY',
  tatumKey: 'REDACTED_TATUM_KEY',
  moralisKey: 'REDACTED_JWT'
}

export function loadConfig(): WalletConfig {
  if (!existsSync(configPath())) {
    // Write defaults on first run
    mkdirSync(userData(), { recursive: true })
    writeFileSync(configPath(), JSON.stringify(DEFAULT_CONFIG, null, 2))
    return DEFAULT_CONFIG
  }
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(configPath(), 'utf-8')) }
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveConfig(config: Partial<WalletConfig>): void {
  const current = loadConfig()
  mkdirSync(userData(), { recursive: true })
  writeFileSync(configPath(), JSON.stringify({ ...current, ...config }, null, 2))
}