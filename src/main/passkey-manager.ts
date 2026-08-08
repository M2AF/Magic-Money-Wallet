/**
 * passkey-manager.ts — MagicMoney Wallet
 *
 * The ELECTRON binding of the passkey ceremonies: it supplies the four platform
 * things (mnemonic, current account, index storage, approval + biometric) and
 * hands them to the shared core in passkey-ceremony.ts. Nothing security-
 * critical is decided here — see that file for the resolution rules and the
 * MAC invariant, and passkey-protocol.ts for the rpId/origin rules.
 *
 * Two environments, because they must report different AAGUIDs:
 *   walletEnv    — the wallet's own surfaces (Settings, tests). Real AAGUID.
 *   inAppBrowserEnv — the built-in dApp browser, where the shim is also the
 *                  CLIENT, so the AAGUID is zeroed the way a browser would.
 *
 * This module deliberately does not touch wallet.passkey.enc, wallet.hello.enc,
 * or the biometric-unlock enrollment.
 */

import { ZERO_AAGUID } from './webauthn-authenticator'
import { electronPasskeyStorage } from './passkey-store'
import { loadMnemonic, loadAddresses, bioMethod, bioSupported } from './secure-store'
import { runHello } from './hello-bridge'
import { touchIdVerify, touchIdSupported } from './touchid-bridge'
import { showApprovalDecision, type ApprovalOptions } from './browser-manager'
import {
  runCreate, runAssert, listRecords, forgetRecord, hasCredentialFor,
  type PasskeyEnvironment, type CeremonyCreateRequest, type CeremonyCreateResult,
  type CeremonyAssertRequest, type CeremonyAssertResult,
} from './passkey-ceremony'
import {
  passkeyError, PASSKEY_VERIFICATION_FAILED,
  type PasskeyAccount, type PasskeyApprovalRequest, type PasskeyApprovalDecision,
  type PasskeyVerification, type PasskeyCredentialRecord,
} from './passkey-protocol'

export {
  rpIdMatchesOrigin, requireSiteForRpId, defaultRpIdForOrigin, passkeyErrorCode,
  PASSKEY_REJECTED, PASSKEY_NO_CREDENTIAL, PASSKEY_ORIGIN_MISMATCH,
  PASSKEY_VERIFICATION_FAILED, PASSKEY_UNSUPPORTED_ALGORITHM, PASSKEY_EXCLUDED,
  type PasskeyVerification, type PasskeyCredentialRecord,
} from './passkey-protocol'

// ─── The approval dialog ────────────────────────────────────────────────────

const shortAddress = (a: string): string => (a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a)

/**
 * Pure — the dialog copy, split out so it can be tested without an Electron
 * window. Answers the three questions the plan asks it to: which site, which
 * account, and create-vs-sign; plus the chooser when a discoverable sign-in
 * matched more than one identity.
 */
export function buildPasskeyApproval(ctx: PasskeyApprovalRequest): ApprovalOptions {
  const account = ctx.accountAddress
    ? `Account ${ctx.accountIndex + 1} · ${shortAddress(ctx.accountAddress)}`
    : `Account ${ctx.accountIndex + 1}`

  const lines = [`Site: ${ctx.site}`]
  if (!ctx.choices?.length) lines.push(`Wallet: ${account}`)
  if (ctx.userName) lines.push(`${ctx.ceremony === 'create' ? 'Sign up as' : 'Sign in as'}: ${ctx.userName}`)

  if (ctx.ceremony === 'create') {
    lines.push(
      '',
      'This passkey is derived from your seed phrase. It will work on any device',
      'where you restore those words — and anyone who has them can sign in as you.',
    )
    return {
      title: 'Create a passkey',
      heading: `${ctx.site} wants to create a passkey`,
      detail: lines.join('\n'),
      confirmLabel: 'Create passkey',
      origin: ctx.origin,
      warnings: ctx.replacesExisting
        ? [`This replaces the passkey you already have for ${ctx.site}. The old one will stop working.`]
        : undefined,
    }
  }

  if (ctx.choices?.length) lines.push('', 'Choose which account to sign in with.')

  return {
    title: 'Sign in with a passkey',
    heading: `${ctx.site} wants to sign you in`,
    detail: lines.join('\n'),
    confirmLabel: 'Sign in',
    origin: ctx.origin,
    choices: ctx.choices,
  }
}

async function electronApprove(request: PasskeyApprovalRequest): Promise<PasskeyApprovalDecision> {
  return showApprovalDecision(buildPasskeyApproval(request))
}

// ─── The biometric gate ─────────────────────────────────────────────────────

/**
 * A Hello key used ONLY to prove the user is present for a passkey ceremony.
 *
 * Deliberately NOT `HELLO_KEY_NAME`. That key wraps wallet.hello.enc, and
 * secure-store self-heals a `NotFound` on it by deleting the encrypted unlock
 * copy — so borrowing it here would let a passkey prompt silently disable the
 * user's biometric wallet unlock. Nothing about this key can decrypt anything;
 * the signature it produces is discarded.
 */
const PASSKEY_GATE_KEY_NAME = 'MagicMoneyPasskeyGate'
const PASSKEY_GATE_CHALLENGE_B64 = Buffer.from('magicmoney-passkey-gate-v1', 'utf8').toString('base64')

async function windowsHelloGate(): Promise<void> {
  let res = await runHello('sign', PASSKEY_GATE_KEY_NAME, PASSKEY_GATE_CHALLENGE_B64)
  // First ever use, or Windows evicted the key (reboot / PIN change / TPM reset).
  // Creating it prompts Hello just as signing does, so the user is still verified.
  if (!res.ok && res.status === 'NotFound') {
    res = await runHello('enroll', PASSKEY_GATE_KEY_NAME, PASSKEY_GATE_CHALLENGE_B64)
  }
  if (res.ok) return
  if (res.status === 'UserCanceled') {
    throw passkeyError(PASSKEY_VERIFICATION_FAILED, 'Windows Hello was canceled')
  }
  throw passkeyError(PASSKEY_VERIFICATION_FAILED, res.status ?? res.error ?? 'Windows Hello verification failed')
}

/**
 * Verify the human in front of the machine.
 *
 * Falls back to `wallet-password` where no biometric is available (Linux, or a
 * machine with nothing enrolled). That still satisfies WebAuthn's UV bit: the
 * wallet is unlocked, which took the user's password, and platform
 * authenticators set UV for a PIN on exactly the same reasoning. We never report
 * UV without one of the three having happened.
 */
export async function verifyUserForPasskey(reason: string): Promise<PasskeyVerification> {
  const method = bioMethod()
  // Both arms check ENROLLMENT, not just the platform. A Mac with no Touch ID
  // hardware still reports 'touch-id' from bioMethod(); prompting there would
  // throw and lock the user out of passkeys entirely rather than falling back.
  if (method === 'touch-id' && touchIdSupported()) {
    try {
      await touchIdVerify(reason)
      return 'touch-id'
    } catch (e) {
      throw passkeyError(PASSKEY_VERIFICATION_FAILED, e instanceof Error ? e.message : 'Touch ID verification failed')
    }
  }
  if (method === 'windows-hello' && await bioSupported()) {
    await windowsHelloGate()
    return 'windows-hello'
  }
  return 'wallet-password'
}

// ─── The environments ───────────────────────────────────────────────────────

async function currentAccount(): Promise<PasskeyAccount> {
  const addresses = loadAddresses()
  return { accountIndex: addresses?.accountIndex ?? 0, accountAddress: addresses?.evm }
}

const baseEnv = {
  loadMnemonic: async () => loadMnemonic(),
  currentAccount,
  storage: electronPasskeyStorage,
  approve: electronApprove,
  verifyUser: verifyUserForPasskey,
}

/** The wallet's own surfaces. Reports the real Magic Money AAGUID. */
export const walletEnv: PasskeyEnvironment = { ...baseEnv }

/**
 * The built-in dApp browser. Here we are BOTH authenticator and client, and the
 * client is what zeroes the AAGUID when attestation is "none" — so we do it
 * ourselves rather than leak what a real browser would have hidden.
 */
export const inAppBrowserEnv: PasskeyEnvironment = { ...baseEnv, aaguid: ZERO_AAGUID }

// ─── Public API (unchanged from Phase 2) ────────────────────────────────────

export type { CeremonyCreateRequest, CeremonyCreateResult, CeremonyAssertRequest, CeremonyAssertResult }

export const createPasskey = (req: CeremonyCreateRequest): Promise<CeremonyCreateResult> => runCreate(walletEnv, req)
export const assertPasskey = (req: CeremonyAssertRequest): Promise<CeremonyAssertResult> => runAssert(walletEnv, req)
export const listPasskeys = (): Promise<PasskeyCredentialRecord[]> => listRecords(walletEnv)
export const forgetPasskey = (rpId: string, credentialId: string): Promise<void> =>
  forgetRecord(walletEnv, rpId, credentialId)

/** Silent probe for the in-app browser's autofill hint — no prompt, no keys. */
export const browserHasCredentialFor = (
  origin: string, rpId?: string, allowCredentials?: Uint8Array[],
): Promise<boolean> => hasCredentialFor(inAppBrowserEnv, origin, rpId, allowCredentials)
