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

import type { WalletAddresses } from '../main/wallet-core'

// ── WalletConfig — identical shape to secure-store.ts so aliased imports work ─

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
  swapProxyUrl: string
  simpleSwapApiKey: string
}

// Provider keys are EMPTY — they live only as Cloudflare Worker secrets and are
// injected server-side (see cloudflare-worker/, api-proxy.ts). A Chrome Web Store
// package is publicly unzippable, so shipping keys here was the worst exposure;
// this closes it. `walletConnectProjectId` stays client-side by design (WC connects
// to its relay directly, not through our Worker).
const DEFAULT_CONFIG: WalletConfig = {
  alchemyKey:             '',
  heliusKey:              '',
  blockfrostKey:          '',
  tatumKey:               '',
  moralisKey:             '',
  openseaKey:             '',
  supabaseUrl:            '',
  supabaseKey:            '',
  walletConnectProjectId: '1db049748ab5fecc3a39e64fbc11a41c',
  swapProxyUrl:           'https://magicmoney-swap-proxy.guildfordking.workers.dev',
  simpleSwapApiKey:       ''
}

// ── WebCrypto helpers ─────────────────────────────────────────────────────────

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 210_000, hash: 'SHA-256' },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

// ── Mnemonic (encrypted at rest, decrypted in session) ───────────────────────

export async function saveMnemonic(mnemonic: string, password: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv   = crypto.getRandomValues(new Uint8Array(12))
  const key  = await deriveKey(password, salt)
  const ct   = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(mnemonic))
  await chrome.storage.local.set({
    'wallet.enc': {
      salt: Array.from(salt),
      iv:   Array.from(iv),
      data: Array.from(new Uint8Array(ct))
    }
  })
  await chrome.storage.session.set({ 'wallet.unlocked': mnemonic })
}

export async function walletExists(): Promise<boolean> {
  const r = await chrome.storage.local.get('wallet.enc')
  return !!r['wallet.enc']
}

export async function isUnlocked(): Promise<boolean> {
  const r = await chrome.storage.session.get('wallet.unlocked')
  return !!r['wallet.unlocked']
}

export async function unlock(password: string): Promise<void> {
  const r = await chrome.storage.local.get('wallet.enc')
  if (!r['wallet.enc']) throw new Error('No wallet found')
  const { salt, iv, data } = r['wallet.enc'] as { salt: number[]; iv: number[]; data: number[] }
  const key = await deriveKey(password, new Uint8Array(salt))
  let decrypted: ArrayBuffer
  try {
    decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, key, new Uint8Array(data))
  } catch {
    throw new Error('Incorrect password')
  }
  const mnemonic = new TextDecoder().decode(decrypted)
  await chrome.storage.session.set({ 'wallet.unlocked': mnemonic })
}

export async function lock(): Promise<void> {
  await chrome.storage.session.remove('wallet.unlocked')
}

export async function loadMnemonic(): Promise<string> {
  const r = await chrome.storage.session.get('wallet.unlocked')
  if (!r['wallet.unlocked']) throw new Error('Wallet is locked — please unlock first')
  return r['wallet.unlocked'] as string
}

export async function deleteWallet(): Promise<void> {
  await chrome.storage.local.remove(['wallet.enc', 'wallet.addresses'])
  await chrome.storage.session.remove('wallet.unlocked')
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

export async function saveAddresses(addresses: WalletAddresses): Promise<void> {
  await chrome.storage.local.set({ 'wallet.addresses': addresses })
}

export async function loadAddresses(): Promise<WalletAddresses | null> {
  const r = await chrome.storage.local.get('wallet.addresses')
  const a = r['wallet.addresses']
  if (!a) return null
  return { accountIndex: 0, ...(a as WalletAddresses) }
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

// ── Approved dApp origins ─────────────────────────────────────────────────────

export async function getApprovedOrigins(): Promise<string[]> {
  const r = await chrome.storage.local.get('wallet.approved_origins')
  return r['wallet.approved_origins'] ?? []
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
