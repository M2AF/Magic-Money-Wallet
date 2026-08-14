/**
 * passkey.ts (iOS) — WebAuthn-PRF wallet generation is NOT available.
 *
 * Aliased over src/capacitor/passkey.ts in vite.ios.config.ts. Two independent
 * blockers, either of which alone would be fatal:
 *
 *  1. ORIGIN. src/capacitor/passkey.ts pins `RP_ID = 'localhost'` because
 *     Android serves the WebView from https://localhost. iOS serves from
 *     capacitor://localhost and CANNOT be moved — Capacitor's
 *     CAPInstanceDescriptor.normalize() silently discards `iosScheme: 'https'`
 *     since WKWebView already claims that scheme (see capacitor.config.ts).
 *     A ceremony with rp.id 'localhost' at a capacitor:// origin fails with a
 *     SecurityError.
 *
 *  2. ENTITLEMENT. Passkeys in a WKWebView require the Associated Domains
 *     entitlement, which needs a paid Apple Developer account. MagicMoney is
 *     self-distributed as an unsigned .ipa that users re-sign with a free
 *     Apple ID, so that entitlement will never be present.
 *
 * Reporting `passkeySupported() → false` is what hides the affordance: the
 * "Generate with Passkey" / "Import with Passkey" buttons in WelcomePage.tsx
 * and ImportPage.tsx, and the recovery link/unlink row in SettingsModal.tsx,
 * are all gated on it. Without this stub the shared feature-detect
 * (isSecureContext + isUserVerifyingPlatformAuthenticatorAvailable) may well
 * report TRUE on iOS — WKWebView does treat capacitor://localhost as a secure
 * context — leaving a visible button on the wallet-CREATION path that always
 * throws. An unreachable feature is bad; a button that looks real and fails at
 * the moment someone is making a wallet is much worse.
 *
 * NOT the same thing as the wallet-as-authenticator provider
 * (src/capacitor/passkey-provider.ts), which lets dApps in our own browser make
 * passkeys backed by the wallet seed. That works on iOS and is untouched here.
 *
 * The remaining functions are unreachable while passkeySupported() is false;
 * they throw rather than return junk so a future regression in the gating is
 * loud instead of silently producing a wrong wallet.
 */

const UNAVAILABLE =
  'Passkey wallets aren’t available on iOS. Use your recovery phrase — Face ID unlock still works.'

export async function passkeySupported(): Promise<boolean> {
  return false
}

export function passkeyLabel(): string {
  return 'MagicMoney'
}

export async function createPasskeyMnemonic(_words?: unknown): Promise<string> {
  throw new Error(UNAVAILABLE)
}

export async function importPasskeyMnemonic(_words?: unknown): Promise<string> {
  throw new Error(UNAVAILABLE)
}

/** No passkey can ever be linked on iOS, so the Settings row stays hidden. */
export async function passkeyLinked(): Promise<boolean> {
  return false
}

export async function passkeyUnlink(): Promise<boolean> {
  return false
}

export async function linkPasskeyToWallet(): Promise<boolean> {
  throw new Error(UNAVAILABLE)
}

export async function verifyPasskeyWallet(): Promise<boolean> {
  throw new Error(UNAVAILABLE)
}
