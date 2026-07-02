/**
 * touchid-bridge.ts — macOS Touch ID bridge for vault unlock.
 *
 * macOS counterpart to hello-bridge.ts. Electron exposes LAContext natively
 * (systemPreferences.promptTouchID / canPromptTouchID), so unlike Windows no
 * out-of-process bridge is needed for the biometric ceremony itself.
 *
 * There is no macOS analog of KeyCredentialManager's deterministic TPM
 * signature reachable without a native module + code-signing entitlements
 * (Secure-Enclave keychain ACLs need kSecUseDataProtectionKeychain, which
 * fails on unsigned builds). So the wrap-key material here is a random
 * 32-byte secret we generate at enroll and park in the user's login Keychain
 * (via the `security` CLI, secret passed over stdin — never argv), released
 * to the app only after a successful Touch ID prompt.
 *
 * SECURITY MODEL (weaker than the Windows TPM path, and deliberately so
 * documented): the Touch ID prompt is enforced by THIS app's code, not by
 * hardware — the keychain item itself is readable by code running as the
 * user once the login keychain is unlocked. The password copy (wallet.enc)
 * remains the recovery path and is untouched; this is a convenience factor.
 *
 * macOS-only. Callers gate on process.platform === 'darwin'.
 */

import { spawn } from 'child_process'
import { systemPreferences } from 'electron'
import { randomBytes } from 'crypto'

// Keychain coordinates for the wrap-key material (login keychain, generic password).
export const TOUCHID_SERVICE = 'MagicMoneyWalletVault'
export const TOUCHID_ACCOUNT = 'bio-unlock'

/** Thrown (by message) when the keychain item has vanished — caller self-heals. */
export const TOUCHID_ITEM_MISSING = 'TOUCHID_ITEM_MISSING'

/** True only on macOS; LAContext / login keychain are macOS APIs. */
export function touchIdPlatformOk(): boolean {
  return process.platform === 'darwin'
}

/** Is Touch ID hardware present with at least one fingerprint enrolled? Non-interactive. */
export function touchIdSupported(): boolean {
  if (!touchIdPlatformOk()) return false
  try {
    return systemPreferences.canPromptTouchID()
  } catch {
    return false
  }
}

/**
 * Run one `security` invocation. When `stdinLine` is given the tool runs in
 * interactive mode (`security -i`) and the command — including the secret —
 * travels over stdin so it never appears in the process table (argv is
 * visible to `ps`; stdin is not).
 */
function runSecurity(args: string[], stdinLine?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = stdinLine != null
      ? spawn('/usr/bin/security', ['-i'])
      : spawn('/usr/bin/security', args)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d.toString() })
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('error', () => resolve({ code: -1, stdout, stderr: stderr || 'failed to launch security' }))
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
    if (stdinLine != null) {
      child.stdin.write(stdinLine + '\n')
      child.stdin.end()
    }
  })
}

/** Show the Touch ID sheet. Resolves on success; rejects on cancel/failure. */
async function promptTouchId(reason: string): Promise<void> {
  await systemPreferences.promptTouchID(reason)
}

/**
 * Enroll: verify the user with Touch ID, then mint fresh 32-byte key material
 * and store it in the login keychain (replacing any previous item). Returns
 * the material for the caller to HKDF-wrap the mnemonic with.
 */
export async function touchIdEnrollMaterial(): Promise<Uint8Array> {
  await promptTouchId('enable Touch ID unlock for your wallet')
  const material = randomBytes(32)
  // -U updates an existing item in place instead of erroring on duplicates.
  const cmd = `add-generic-password -U -s "${TOUCHID_SERVICE}" -a "${TOUCHID_ACCOUNT}" -w "${material.toString('hex')}"`
  const r = await runSecurity([], cmd)
  if (r.code !== 0) throw new Error(`Could not store the Touch ID key in the keychain: ${r.stderr.trim() || 'unknown error'}`)
  return new Uint8Array(material)
}

/**
 * Unlock ceremony: Touch ID prompt, then fetch the key material back from the
 * keychain. Throws TOUCHID_ITEM_MISSING when the item is gone (keychain reset,
 * item deleted) so the caller can drop the stale encrypted copy and re-enroll.
 */
export async function touchIdGetMaterial(): Promise<Uint8Array> {
  await promptTouchId('unlock your wallet')
  const r = await runSecurity(['find-generic-password', '-s', TOUCHID_SERVICE, '-a', TOUCHID_ACCOUNT, '-w'])
  const hex = r.stdout.trim()
  if (r.code !== 0 || !/^[0-9a-f]{64}$/i.test(hex)) throw new Error(TOUCHID_ITEM_MISSING)
  return new Uint8Array(Buffer.from(hex, 'hex'))
}

/** Remove the keychain item (disable / wallet delete). Best-effort, never throws. */
export async function touchIdDeleteMaterial(): Promise<void> {
  try {
    await runSecurity(['delete-generic-password', '-s', TOUCHID_SERVICE, '-a', TOUCHID_ACCOUNT])
  } catch { /* best effort */ }
}
