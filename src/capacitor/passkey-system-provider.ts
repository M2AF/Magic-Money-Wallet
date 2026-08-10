/**
 * passkey-system-provider.ts — the wallet's side of the Android passkey provider
 *
 * Phase 4: the same seed-derived passkeys the in-app browser uses, offered to
 * Chrome, Brave and Samsung Internet through Credential Manager.
 *
 * ⚠ THE SEED NEVER CROSSES THIS BOUNDARY. Enabling the provider derives
 * `webauthnRoot` for an account here, where the wallet is unlocked, and hands
 * ONLY that to native — which immediately wraps it in an auth-bound Keystore
 * key. The provider is a background service any app's sign-in prompt can cause
 * the system to bind; giving it the mnemonic would put fund-spending authority
 * behind that binder. A full compromise of the service costs logins, not money.
 *
 * Android 14 (API 34) is the floor. `status()` reports it and the UI hides the
 * control below that rather than offering one that cannot work.
 */

import { registerPlugin } from '@capacitor/core'
import { deriveWebauthnRoot, toHex } from '../main/webauthn-authenticator'
import { loadIndex, PASSKEY_INDEX_UNREADABLE, type PasskeyCredentialRecord } from '../main/passkey-index'
import { capacitorPasskeyStorage } from './passkey-provider'
import { loadMnemonic, loadAddresses } from './capacitor-store'

/** One row the system credential sheet may show. No key material. */
export interface DiscoveryRecord {
  rpId: string
  credentialId: string
  userName: string
  userHandle: string
  accountIndex: number
}

export interface PasskeyProviderStatus {
  /** Android 14+ — below this the system never binds a provider service. */
  supported: boolean
  androidVersion: number
  /** A root has been handed over, so the provider can actually sign. */
  enrolled: boolean
  /**
   * Whether the user has selected us in Settings. `null` means Android would not
   * tell us — the UI must say "we can't tell" rather than nag someone who has
   * already turned it on.
   */
  enabledInSettings: boolean | null
  /** SHA-256 of this build's signing cert, for debugging allowlist mismatches. */
  fingerprint?: string | null
}

interface PasskeyProviderPlugin {
  status(): Promise<PasskeyProviderStatus>
  enrol(options: { rootHex: string; accountIndex: number; discovery?: DiscoveryRecord[] }): Promise<void>
  syncDiscovery(options: { discovery: DiscoveryRecord[] }): Promise<void>
  setCurrentAccount(options: { accountIndex: number }): Promise<void>
  disable(): Promise<void>
  // No openSettings here on purpose — SystemSettings owns that, see below.
}

const PasskeyProvider = registerPlugin<PasskeyProviderPlugin>('PasskeyProvider')

const UNAVAILABLE: PasskeyProviderStatus = {
  supported: false, androidVersion: 0, enrolled: false, enabledInSettings: null,
}

export async function passkeyProviderStatus(): Promise<PasskeyProviderStatus> {
  try {
    return await PasskeyProvider.status()
  } catch {
    // Web/dev context without the native plugin.
    return UNAVAILABLE
  }
}

/**
 * The discovery projection: what the system sheet may offer, derived from the
 * wallet's own encrypted index.
 *
 * An unreadable index yields an EMPTY list, never a guess. The provider then
 * offers nothing, which costs username-less sign-in and nothing else — the
 * credentialId MAC remains the only thing that can authorise a signature.
 */
export async function currentDiscovery(mnemonic: string): Promise<DiscoveryRecord[]> {
  try {
    const indexKey = await deriveWebauthnRoot(mnemonic, 0)
    const records = await loadIndex(capacitorPasskeyStorage, indexKey)
    return records.map((r: PasskeyCredentialRecord) => ({
      rpId: r.rpId,
      credentialId: r.credentialId,
      userName: r.userName,
      userHandle: r.userHandle,
      accountIndex: r.accountIndex,
    }))
  } catch (e) {
    if (e instanceof Error && e.message === PASSKEY_INDEX_UNREADABLE) return []
    throw e
  }
}

/**
 * Turn the provider on for the wallet's current account.
 *
 * Enrols account 0 as well when the current account is not 0: the credential
 * index is encrypted under account 0's root (the wallet's stable identity), and
 * without it the provider could serve credentials but never enumerate them.
 */
export async function enablePasskeyProvider(): Promise<PasskeyProviderStatus> {
  const status = await passkeyProviderStatus()
  if (!status.supported) throw new Error('Android 14 or newer is required for system passkeys')

  const mnemonic = await loadMnemonic()          // throws when the wallet is locked
  const addresses = await loadAddresses()
  const accountIndex = addresses?.accountIndex ?? 0
  const discovery = await currentDiscovery(mnemonic)

  await PasskeyProvider.enrol({
    rootHex: toHex(await deriveWebauthnRoot(mnemonic, accountIndex)),
    accountIndex,
    discovery,
  })
  if (accountIndex !== 0) {
    await PasskeyProvider.enrol({ rootHex: toHex(await deriveWebauthnRoot(mnemonic, 0)), accountIndex: 0 })
    await PasskeyProvider.setCurrentAccount({ accountIndex })
  }
  return passkeyProviderStatus()
}

/**
 * Withdraw this device's system-wide access.
 *
 * The passkeys themselves survive: they are a function of the seed, still work
 * in the wallet's own browser, and return on any device where the words are
 * restored. The UI must say that rather than implying deletion.
 */
export async function disablePasskeyProvider(): Promise<void> {
  try {
    await PasskeyProvider.disable()
  } catch { /* nothing enrolled, or no native plugin */ }
}

interface SystemSettingsPlugin {
  openCredentialProviderSettings(): Promise<{ opened: boolean; via: string }>
  canOpenCredentialProviderSettings(): Promise<{ opened: boolean; via: string }>
}

const SystemSettings = registerPlugin<SystemSettingsPlugin>('SystemSettings')

/**
 * Open Settings → Passwords, passkeys & accounts.
 *
 * ⚠ Goes through SystemSettings, NOT PasskeyProvider.openSettings(). That older
 * path uses `Settings.ACTION_CREDENTIAL_PROVIDER` alone, which was measured NOT
 * to resolve on a Galaxy S21+ (Android 15) — Samsung ships the picker as a bare
 * component and never registered the AOSP action. SystemSettings tries the
 * concrete component first and reports which rung worked, so the caller can give
 * written directions instead of pretending a screen opened.
 *
 * Returns the outcome rather than throwing: "nothing opened" is a real answer on
 * an OEM build nobody has tested, and the UI has copy for it.
 */
export async function openPasskeyProviderSettings(): Promise<{ opened: boolean; via: string }> {
  try {
    return await SystemSettings.openCredentialProviderSettings()
  } catch {
    // No native plugin (web/dev) — or an OEM that rejected every rung.
    return { opened: false, via: 'none' }
  }
}

/**
 * Push the current credential list to native. Cheap and idempotent; call it
 * after every in-app registration so a passkey made in Magic Money's browser is
 * immediately offered in Chrome — that hand-off IS the feature.
 *
 * Silent when the provider was never enabled.
 */
export async function syncPasskeyDiscovery(mnemonic: string): Promise<void> {
  try {
    const status = await passkeyProviderStatus()
    if (!status.supported || !status.enrolled) return
    await PasskeyProvider.syncDiscovery({ discovery: await currentDiscovery(mnemonic) })
  } catch { /* discovery is a convenience; never fail a ceremony over it */ }
}

// ─── First-run prompt state ─────────────────────────────────────────────────

const DISMISSED_KEY = 'passkey.provider.prompted'

/**
 * Has the user already been shown (and dismissed) the first-run prompt?
 *
 * Stored, not derived: "Not now" has to stick, and the alternative — re-deriving
 * from enrolment state — would re-prompt on every launch of anyone who declined.
 */
export async function passkeyPromptDismissed(): Promise<boolean> {
  try {
    const { Preferences } = await import('@capacitor/preferences')
    return (await Preferences.get({ key: DISMISSED_KEY })).value === '1'
  } catch {
    return true   // no Preferences (web/dev) — never prompt
  }
}

export async function dismissPasskeyPrompt(): Promise<void> {
  try {
    const { Preferences } = await import('@capacitor/preferences')
    await Preferences.set({ key: DISMISSED_KEY, value: '1' })
  } catch { /* nothing to remember it with */ }
}

/** Keep provider-side registrations on the account the wallet is showing. */
export async function syncPasskeyAccount(accountIndex: number): Promise<void> {
  try {
    const status = await passkeyProviderStatus()
    if (!status.supported || !status.enrolled) return
    await PasskeyProvider.setCurrentAccount({ accountIndex })
  } catch { /* best effort */ }
}
