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
  /**
   * Fingerprint of the root that minted this credential — hex of the first 8
   * bytes of SHA-256(webauthnRoot), matching `PasskeyVault.rootFingerprint`.
   *
   * The provider service has no UI and so can never unwrap a root to verify a
   * credentialId's MAC at offer time. This is what lets it tell, without a
   * prompt, that a row belongs to the root it actually holds. Rows without one
   * are not offered, so this field is required in practice.
   */
  rootFp: string
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

    // One derivation per distinct account, not per row: a wallet with many
    // passkeys on one account would otherwise redo the same HKDF for each.
    const fingerprints = new Map<number, string>()
    const fingerprintFor = async (accountIndex: number): Promise<string> => {
      const cached = fingerprints.get(accountIndex)
      if (cached !== undefined) return cached
      const fp = await rootFingerprint(await deriveWebauthnRoot(mnemonic, accountIndex))
      fingerprints.set(accountIndex, fp)
      return fp
    }

    const out: DiscoveryRecord[] = []
    for (const r of records as PasskeyCredentialRecord[]) {
      out.push({
        rpId: r.rpId,
        credentialId: r.credentialId,
        userName: r.userName,
        userHandle: r.userHandle,
        accountIndex: r.accountIndex,
        rootFp: await fingerprintFor(r.accountIndex),
      })
    }
    return out
  } catch (e) {
    if (e instanceof Error && e.message === PASSKEY_INDEX_UNREADABLE) return []
    throw e
  }
}

/**
 * Hex of the first 8 bytes of SHA-256(root).
 *
 * ⚠ Must stay byte-identical to `PasskeyVault.rootFingerprint` in Java. If the
 * two ever disagree the provider silently offers nothing, which looks exactly
 * like "no passkeys registered" — so there is a test pinning the value.
 */
export async function rootFingerprint(root: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', root as BufferSource))
  return Array.from(digest.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('')
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

/**
 * Keep the provider on the account the wallet is showing.
 *
 * ⚠ WHY THIS ENROLS RATHER THAN JUST MOVING A POINTER. The frozen spec puts
 * accountIndex in the HKDF info, so every account has its OWN webauthnRoot.
 * `PasskeyActivity` mints under `PasskeyPrefs.currentAccount`, and that pointer
 * is only ever written by `enrol`. Left alone after an account switch it does
 * not fail — it silently mints the new passkey under the PREVIOUS account's
 * key, producing a credential that works while quietly belonging to the wrong
 * account. A wrong-but-working credential is worse than a refusal, because
 * nothing ever surfaces it.
 *
 * Moving the pointer alone is not enough either: an account with no enrolled
 * root cannot be signed for at all, so passkeys created in the in-app browser
 * under that account would be silently skipped by the provider's offer path
 * (`hasRoot`) and never appear in Chrome.
 *
 * Handing over one more root is a real widening of what the provider holds, and
 * it is the coherent one: the user enabled the provider for THIS WALLET, each
 * root is auth-bound in Keystore, and a root only ever costs logins for its own
 * account — never funds. See the header for why the seed itself never crosses.
 *
 * Best-effort by design: a locked wallet, a device below Android 14 or a
 * provider that was never enabled must not break switching accounts.
 */
export async function syncPasskeyAccount(accountIndex: number): Promise<void> {
  try {
    const status = await passkeyProviderStatus()
    if (!status.supported || !status.enrolled) return
    const mnemonic = await loadMnemonic()      // throws when the wallet is locked
    // enrol() sets currentAccount to what it just enrolled, so this is one call.
    await PasskeyProvider.enrol({
      rootHex: toHex(await deriveWebauthnRoot(mnemonic, accountIndex)),
      accountIndex,
    })
  } catch { /* best effort — never break an account switch over this */ }
}
