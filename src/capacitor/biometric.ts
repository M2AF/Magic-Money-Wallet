/**
 * biometric.ts — Android biometric unlock (BiometricPrompt + Keystore)
 *
 * The Android analog of hello-bridge.ts / touchid-bridge.ts, same trust model:
 *  - Enroll: generate random 32-byte key material, park it behind the device
 *    Keystore (via @capgo/capacitor-native-biometric credentials storage), and
 *    store an HKDF→AES-GCM-wrapped copy of the mnemonic (the existing
 *    encryptWithKeyMaterial from crypto-vault.ts) under 'wallet.hello.enc'.
 *  - Unlock: BiometricPrompt gesture → fetch material → decrypt → restore the
 *    in-memory session in capacitor-store.
 *  - The password vault ('wallet.enc') is untouched and remains the recovery
 *    path — removing biometrics never touches the primary vault.
 *
 * Like the macOS Touch ID path, the biometric gate is app-enforced (the
 * material is released by a successful verifyIdentity call, not by a
 * hardware-bound CryptoObject). Hardening to setUserAuthenticationRequired
 * Keystore keys is noted future work in the plan.
 */

import { NativeBiometric } from '@capgo/capacitor-native-biometric'
import { Preferences } from '@capacitor/preferences'
import { encryptWithKeyMaterial, decryptWithKeyMaterial, type EncryptedBlob } from '../main/crypto-vault'
import { loadMnemonic, restoreUnlockedSession } from './capacitor-store'

const BLOB_KEY = 'wallet.hello.enc'
// Keystore alias namespace for the wrapped key material (the plugin keys its
// encrypted credential storage by this "server" identifier).
const CRED_SERVER = 'info.chainlens.magicmoney.vault'

/**
 * A SECOND credential namespace, for the browser password manager's gate.
 *
 * Deliberately not CRED_SERVER. That entry is the key to 'wallet.hello.enc',
 * and the callers self-heal a missing one by DELETING the wrapped copy — so
 * sharing it would let a password-manager prompt silently disable biometric
 * WALLET unlock. Same separation as Electron's 'MagicMoneyPasswordGate'.
 */
const PASSWORD_CRED_SERVER = 'info.chainlens.magicmoney.passwords'

/** Thrown (by message) when the Keystore entry is gone — the caller self-heals. */
export const BIO_MATERIAL_MISSING = 'BIO_MATERIAL_MISSING'

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
    const r = await NativeBiometric.isAvailable()
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

export async function helloStatus(): Promise<{ supported: boolean; enrolled: boolean; method: 'android-biometric' | null }> {
  const supported = await biometricsAvailable()
  const enrolled = supported && (await loadBlob()) !== null
  return { supported, enrolled, method: supported ? 'android-biometric' : null }
}

/** Enroll biometric unlock. Requires the wallet to be UNLOCKED (Settings-gated). */
export async function helloEnroll(): Promise<boolean> {
  const mnemonic = await loadMnemonic()  // throws if locked — mirrors hello-bridge
  await NativeBiometric.verifyIdentity({
    reason: 'Enable biometric unlock',
    title: 'MagicMoney Wallet',
    subtitle: 'Confirm to enable biometric unlock',
    useFallback: true,
  })
  const material = crypto.getRandomValues(new Uint8Array(32))
  await NativeBiometric.setCredentials({
    server: CRED_SERVER,
    username: 'vault',
    password: toBase64(material),
  })
  const blob = await encryptWithKeyMaterial(mnemonic, material)
  await Preferences.set({ key: BLOB_KEY, value: JSON.stringify(blob) })
  return true
}

/** Unlock with a biometric gesture. Restores the in-memory session on success. */
export async function helloUnlock(): Promise<boolean> {
  const blob = await loadBlob()
  if (!blob) throw new Error('Biometric unlock is not set up')
  await NativeBiometric.verifyIdentity({
    reason: 'Unlock your wallet',
    title: 'MagicMoney Wallet',
    subtitle: 'Unlock with biometrics',
    useFallback: true,
  })
  const { password: materialB64 } = await NativeBiometric.getCredentials({ server: CRED_SERVER })
  const mnemonic = await decryptWithKeyMaterial(blob, fromBase64(materialB64))
  restoreUnlockedSession(mnemonic)
  return true
}

/** Turn biometric unlock off. The password vault is untouched. */
export async function helloRemove(): Promise<boolean> {
  try { await NativeBiometric.deleteCredentials({ server: CRED_SERVER }) } catch { /* not set */ }
  await Preferences.remove({ key: BLOB_KEY })
  return true
}

// ─── Password-manager gate (separate key, see PASSWORD_CRED_SERVER) ──────────
//
// Only the ceremony + the key material live here; the wrapped copy of the vault
// password is browser-data-local.ts's business, the same way secure-store owns
// 'wallet.hello.enc' above. Nothing in this section can read or remove the
// wallet's own credential entry.

/** Platform capability + sensor label, independent of any enrollment. */
export async function biometricCapability(): Promise<{ supported: boolean; method: string | null }> {
  const supported = await biometricsAvailable()
  return { supported, method: supported ? 'android-biometric' : null }
}

/** Mint fresh 32-byte material for the password gate, behind a biometric check. */
export async function passwordGateEnrollMaterial(): Promise<Uint8Array> {
  await NativeBiometric.verifyIdentity({
    reason: 'Enable biometric unlock for your saved passwords',
    title: 'MagicMoney Wallet',
    subtitle: 'Confirm to enable biometric unlock',
    useFallback: true,
  })
  const material = crypto.getRandomValues(new Uint8Array(32))
  await NativeBiometric.setCredentials({
    server: PASSWORD_CRED_SERVER,
    username: 'passwords',
    password: toBase64(material),
  })
  return material
}

/**
 * Reproduce the password gate's material. Throws BIO_MATERIAL_MISSING when the
 * Keystore entry is gone, so the caller can drop its now-undecryptable copy.
 */
export async function passwordGateGetMaterial(): Promise<Uint8Array> {
  await NativeBiometric.verifyIdentity({
    reason: 'Open your saved passwords',
    title: 'MagicMoney Wallet',
    subtitle: 'Unlock with biometrics',
    useFallback: true,
  })
  let materialB64: string
  try {
    materialB64 = (await NativeBiometric.getCredentials({ server: PASSWORD_CRED_SERVER })).password
  } catch {
    throw new Error(BIO_MATERIAL_MISSING)
  }
  if (!materialB64) throw new Error(BIO_MATERIAL_MISSING)
  return fromBase64(materialB64)
}

/** Forget the password gate's material. Best-effort, never throws. */
export async function passwordGateDeleteMaterial(): Promise<void> {
  try { await NativeBiometric.deleteCredentials({ server: PASSWORD_CRED_SERVER }) } catch { /* not set */ }
}
