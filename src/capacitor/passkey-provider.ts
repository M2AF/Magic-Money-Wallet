/**
 * passkey-provider.ts — Android binding of the passkey ceremonies
 *
 * The Capacitor counterpart to src/main/passkey-manager.ts. It supplies the four
 * platform things — mnemonic, current account, index storage, approval +
 * biometric — and hands them to the SAME shared core (src/main/passkey-ceremony).
 * Nothing security-critical is decided here: the credential-resolution rules,
 * the MAC invariant and the rpId/origin check all live in that core so Electron
 * and Android cannot drift apart.
 *
 * The AAGUID is zeroed. In the in-app browser we are BOTH authenticator and
 * client, and blanking it is the client's job — on the Phase 4 system-provider
 * path Chrome does that for us and the real AAGUID is reported instead.
 */

import { Preferences } from '@capacitor/preferences'
import { NativeBiometric } from '@capgo/capacitor-native-biometric'
import { ZERO_AAGUID } from '../main/webauthn-authenticator'
import type { PasskeyIndexStorage } from '../main/passkey-index'
import type { PasskeyEnvironment } from '../main/passkey-ceremony'
import {
  passkeyError, PASSKEY_REJECTED, PASSKEY_VERIFICATION_FAILED,
  type PasskeyAccount, type PasskeyApprovalRequest, type PasskeyApprovalDecision,
  type PasskeyVerification,
} from '../main/passkey-protocol'
import { loadMnemonic, loadAddresses } from './capacitor-store'
import { requestApproval } from './platform-capacitor'

/**
 * `passkey.index.enc` in Preferences — the Android analog of Electron's
 * passkey-index.enc file. Same envelope, same rules; only the shelf differs.
 * Deliberately NOT in the Keystore: that binds ciphertext to one device, and
 * this has to be restorable anywhere the seed is.
 */
const INDEX_KEY = 'passkey.index.enc'

export const capacitorPasskeyStorage: PasskeyIndexStorage = {
  async read() {
    const { value } = await Preferences.get({ key: INDEX_KEY })
    return value ?? null
  },
  async write(blob: string) {
    await Preferences.set({ key: INDEX_KEY, value: blob })
  },
  async clear() {
    await Preferences.remove({ key: INDEX_KEY })
  },
  async exists() {
    const { value } = await Preferences.get({ key: INDEX_KEY })
    return value != null
  },
}

// ─── Approval ───────────────────────────────────────────────────────────────
//
// Android has no separate approval WINDOW: the wallet's own WebView renders an
// overlay (CapApp) on top of the native dApp WebViews. Same shape as the
// existing connect/sign queues — park a resolver, push a UI event, let the
// overlay settle it.

interface PendingApproval {
  resolve: (decision: PasskeyApprovalDecision) => void
  request: PasskeyApprovalRequest
}

const _pending = new Map<string, PendingApproval>()

/** Two minutes, matching the other dApp approval queues. */
const APPROVAL_TIMEOUT_MS = 120_000

function capacitorApprove(request: PasskeyApprovalRequest): Promise<PasskeyApprovalDecision> {
  const id = crypto.randomUUID()
  return new Promise<PasskeyApprovalDecision>((resolve) => {
    _pending.set(id, { resolve, request })
    requestApproval('passkey:approval-request', { id, ...request })
    setTimeout(() => {
      if (_pending.has(id)) {
        _pending.delete(id)
        resolve({ approved: false })   // an unanswered prompt is a refusal
      }
    }, APPROVAL_TIMEOUT_MS)
  })
}

/** Called by the overlay when the user answers. Unknown ids are stale — ignore. */
export function resolvePasskeyApproval(id: string, approved: boolean, choiceId?: string): void {
  const pending = _pending.get(id)
  if (!pending) return
  _pending.delete(id)
  pending.resolve({ approved, choiceId })
}

/** Any prompts still waiting — lets a remounting overlay re-render them. */
export function getPendingPasskeyApprovals(): Array<PasskeyApprovalRequest & { id: string }> {
  return Array.from(_pending.entries()).map(([id, p]) => ({ id, ...p.request }))
}

// ─── Biometric gate ─────────────────────────────────────────────────────────

/**
 * BiometricPrompt, verification only.
 *
 * ⚠ It never touches the unlock credential (`info.chainlens.magicmoney.vault`)
 * that biometric.ts stores. A passkey prompt has no business reading or
 * replacing the key that wraps wallet.hello.enc — the desktop equivalent of that
 * mistake would silently disable the user's biometric wallet unlock.
 *
 * Falls back to `wallet-password` where the device has no enrolled biometric.
 * That still satisfies WebAuthn's UV bit: the wallet is unlocked, which took the
 * user's password, and platform authenticators set UV for a PIN on exactly the
 * same reasoning.
 */
async function capacitorVerifyUser(reason: string): Promise<PasskeyVerification> {
  let available = false
  // TOUCH_ID = 1, FACE_ID = 2 in @capgo's BiometryType; anything else is an
  // Android sensor (FINGERPRINT / FACE_AUTHENTICATION / IRIS / MULTIPLE).
  let sensor: PasskeyVerification = 'android-biometric'
  try {
    const status = await NativeBiometric.isAvailable()
    available = !!status.isAvailable
    if (status.biometryType === 1) sensor = 'touch-id'
    else if (status.biometryType === 2) sensor = 'face-id'
  } catch {
    available = false
  }
  if (!available) return 'wallet-password'

  try {
    await NativeBiometric.verifyIdentity({
      reason,
      title: 'MagicMoney Wallet',
      subtitle: reason,
      useFallback: true,
    })
    // Both native targets reach this path (@capgo/capacitor-native-biometric
    // ships an iOS implementation), so report the sensor the device actually
    // has rather than hardcoding Android — a Face ID confirmation recorded as
    // 'android-biometric' is wrong in the approval record and in telemetry.
    return sensor
  } catch (e) {
    throw passkeyError(PASSKEY_VERIFICATION_FAILED, e instanceof Error ? e.message : 'Biometric check failed')
  }
}

// ─── The environment ────────────────────────────────────────────────────────

async function currentAccount(): Promise<PasskeyAccount> {
  const addresses = await loadAddresses()
  return { accountIndex: addresses?.accountIndex ?? 0, accountAddress: addresses?.evm }
}

export const capacitorPasskeyEnv: PasskeyEnvironment = {
  loadMnemonic,                       // throws when the wallet is locked
  currentAccount,
  storage: capacitorPasskeyStorage,
  approve: capacitorApprove,
  verifyUser: capacitorVerifyUser,
  aaguid: ZERO_AAGUID,
}

export { PASSKEY_REJECTED }
