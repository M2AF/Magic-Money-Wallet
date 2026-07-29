/**
 * biometric.ts (iOS) — Face ID / Touch ID unlock, hardware-enforced.
 *
 * Same trust model and same on-disk format as the Android module it replaces
 * (src/capacitor/biometric.ts), so the two stay interchangeable behind the
 * helloStatus/Enroll/Unlock/Remove contract that SettingsModal and CapApp use:
 *
 *  - Enroll: generate random 32-byte key material, park it in the Secure
 *    Enclave, and store an HKDF→AES-GCM-wrapped copy of the mnemonic (the
 *    shared encryptWithKeyMaterial) under 'wallet.hello.enc'.
 *  - Unlock: biometric match → material released → decrypt → restore session.
 *  - The password vault ('wallet.enc') is untouched and remains the recovery
 *    path — removing biometrics never touches the primary vault.
 *
 * THE ONE REAL DIFFERENCE FROM ANDROID, and the reason this file exists:
 * Android's gate is app-enforced — the material is released by a successful
 * verifyIdentity() call rather than by the hardware. Here the material is
 * bound to kSecAttrAccessControl = .biometryCurrentSet, so the Secure Enclave
 * itself refuses to release it without a live biometric match, and the item
 * self-destructs if a new face/finger is enrolled. There is no separate
 * "verify then fetch" step to bypass, because the fetch IS the verification.
 *
 * @capgo/capacitor-native-biometric is deliberately NOT used for storage here
 * (it writes an unprotected keychain item) — see SecureVaultPlugin.swift.
 */

import { registerPlugin } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { encryptWithKeyMaterial, decryptWithKeyMaterial, type EncryptedBlob } from '../main/crypto-vault'
import { loadMnemonic, restoreUnlockedSession } from '../capacitor/capacitor-store'

const BLOB_KEY = 'wallet.hello.enc'
/** Keychain account name for the wrapping material inside the vault service. */
const MATERIAL_KEY = 'vault'

interface SecureVaultPlugin {
  isAvailable(): Promise<{ isAvailable: boolean; biometry: 'faceId' | 'touchId' | 'opticId' | 'none'; reason: string }>
  store(o: { key: string; value: string }): Promise<void>
  retrieve(o: { key: string; reason: string }): Promise<{ value: string }>
  remove(o: { key: string }): Promise<void>
  hasItem(o: { key: string }): Promise<{ exists: boolean }>
}

const SecureVault = registerPlugin<SecureVaultPlugin>('SecureVault')

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function biometricsAvailable(): Promise<boolean> {
  try {
    const r = await SecureVault.isAvailable()
    return !!r.isAvailable
  } catch {
    return false
  }
}

async function loadBlob(): Promise<EncryptedBlob | null> {
  const { value } = await Preferences.get({ key: BLOB_KEY })
  if (!value) return null
  try { return JSON.parse(value) as EncryptedBlob } catch { return null }
}

/**
 * `method` reports the actual sensor so the UI can say "Face ID" or "Touch ID"
 * rather than a generic word — matching how Electron reports 'windows-hello'
 * vs 'touch-id'.
 */
export async function helloStatus(): Promise<{ supported: boolean; enrolled: boolean; method: string | null }> {
  let supported = false
  let method: string | null = null
  try {
    const r = await SecureVault.isAvailable()
    supported = !!r.isAvailable
    if (supported) method = r.biometry === 'touchId' ? 'touch-id' : 'face-id'
  } catch {
    return { supported: false, enrolled: false, method: null }
  }
  // Both halves must be present: the wrapped mnemonic AND the Enclave item.
  // .biometryCurrentSet invalidates the keychain item when biometrics change,
  // which would otherwise leave a stale blob advertising an unlock that can
  // never succeed.
  let enrolled = false
  if (supported && (await loadBlob()) !== null) {
    try {
      enrolled = (await SecureVault.hasItem({ key: MATERIAL_KEY })).exists
    } catch {
      enrolled = false
    }
  }
  return { supported, enrolled, method }
}

/** Enroll biometric unlock. Requires the wallet to be UNLOCKED (Settings-gated). */
export async function helloEnroll(): Promise<boolean> {
  const mnemonic = await loadMnemonic()  // throws if locked — mirrors hello-bridge
  if (!(await biometricsAvailable())) {
    throw new Error('Face ID / Touch ID is not available on this device')
  }
  const material = crypto.getRandomValues(new Uint8Array(32))
  // Writing does not prompt (the plugin sets interactionNotAllowed), so enroll
  // is a single biometric-free step; the first prompt the user sees is their
  // first unlock.
  await SecureVault.store({ key: MATERIAL_KEY, value: toBase64(material) })
  const blob = await encryptWithKeyMaterial(mnemonic, material)
  await Preferences.set({ key: BLOB_KEY, value: JSON.stringify(blob) })
  return true
}

/** Unlock with a biometric gesture. Restores the in-memory session on success. */
export async function helloUnlock(): Promise<boolean> {
  const blob = await loadBlob()
  if (!blob) throw new Error('Biometric unlock is not set up')
  // This single call IS the authentication — the Enclave releases the material
  // only on a live match. There is no preceding verify step to skip.
  const { value: materialB64 } = await SecureVault.retrieve({
    key: MATERIAL_KEY,
    reason: 'Unlock your MagicMoney wallet',
  })
  const mnemonic = await decryptWithKeyMaterial(blob, fromBase64(materialB64))
  restoreUnlockedSession(mnemonic)
  return true
}

/** Turn biometric unlock off. The password vault is untouched. */
export async function helloRemove(): Promise<boolean> {
  try { await SecureVault.remove({ key: MATERIAL_KEY }) } catch { /* not set */ }
  await Preferences.remove({ key: BLOB_KEY })
  return true
}
