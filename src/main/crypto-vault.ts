/**
 * crypto-vault.ts — MagicMoney Wallet
 *
 * Password-based authenticated encryption for secrets at rest, shared by the
 * Electron main process (secure-store.ts) and the browser extension
 * (chrome-store.ts). PBKDF2-SHA256 → AES-256-GCM with per-blob KDF params, so
 * old wallets remain readable while new writes use stronger settings.
 *
 * Uses WebCrypto (`crypto.subtle`), available as a global in browsers and in
 * Node 20+ (Electron main). A defensive fallback binds Node's webcrypto when the
 * global isn't present.
 */

// Resolve a WebCrypto implementation in both the browser and Node/Electron main.
const subtle: SubtleCrypto = (() => {
  const g = globalThis as unknown as { crypto?: Crypto }
  if (g.crypto?.subtle) return g.crypto.subtle
  // Node 20 exposes webcrypto on the 'crypto' module even if not globalized.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('crypto') as { webcrypto: Crypto }
  return nodeCrypto.webcrypto.subtle
})()

const getRandom = (len: number): Uint8Array<ArrayBuffer> => {
  const g = globalThis as unknown as { crypto?: Crypto }
  if (g.crypto?.getRandomValues) return g.crypto.getRandomValues(new Uint8Array(len))
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require('crypto') as { webcrypto: Crypto }
  return nodeCrypto.webcrypto.getRandomValues(new Uint8Array(len))
}

/** Serializable encrypted blob (number[] so it round-trips through JSON). */
export interface EncryptedBlob {
  salt: number[]   // 16 bytes
  iv: number[]     // 12 bytes
  data: number[]   // AES-GCM ciphertext + tag
  kdf?: 'PBKDF2-SHA256'
  kdfVersion?: number
  iterations?: number
}

export const LEGACY_PBKDF2_ITERATIONS = 210_000
export const ACTIVE_PBKDF2_ITERATIONS = 600_000
const ACTIVE_KDF_VERSION = 2

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const raw = await subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  )
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/** Encrypt a UTF-8 secret under `password`. Fresh random salt + IV each call. */
export async function encryptSecret(plaintext: string, password: string, iterations = ACTIVE_PBKDF2_ITERATIONS): Promise<EncryptedBlob> {
  const salt = getRandom(16)
  const iv = getRandom(12)
  const key = await deriveKey(password, salt, iterations)
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  return {
    salt: Array.from(salt),
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(ct)),
    kdf: 'PBKDF2-SHA256',
    kdfVersion: ACTIVE_KDF_VERSION,
    iterations,
  }
}

/** Decrypt a blob produced by `encryptSecret`. Throws on a wrong password. */
export async function decryptSecret(blob: EncryptedBlob, password: string): Promise<string> {
  const key = await deriveKey(password, new Uint8Array(blob.salt), kdfIterations(blob))
  let decrypted: ArrayBuffer
  try {
    decrypted = await subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(blob.iv) }, key, new Uint8Array(blob.data)
    )
  } catch {
    throw new Error('Incorrect password')
  }
  return new TextDecoder().decode(decrypted)
}

export function kdfIterations(blob: EncryptedBlob): number {
  const iterations = Number(blob.iterations ?? LEGACY_PBKDF2_ITERATIONS)
  if (!Number.isSafeInteger(iterations) || iterations < LEGACY_PBKDF2_ITERATIONS) {
    throw new Error('Unsupported wallet KDF parameters')
  }
  return iterations
}

export function needsKdfUpgrade(blob: EncryptedBlob): boolean {
  return kdfIterations(blob) < ACTIVE_PBKDF2_ITERATIONS
}

/** Shape guard — distinguishes a new-scheme blob from a legacy raw string. */
export function isEncryptedBlob(v: unknown): v is EncryptedBlob {
  if (!v || typeof v !== 'object') return false
  const b = v as Record<string, unknown>
  return Array.isArray(b.salt) && Array.isArray(b.iv) && Array.isArray(b.data)
}
