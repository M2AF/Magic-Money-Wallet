/**
 * passkey.ts — Android passkey wallet generation.
 *
 * Unlike Electron, no loopback helper is needed: the Capacitor WebView already
 * serves the app from https://localhost (androidScheme: 'https' in
 * capacitor.config.ts), which is a secure origin whose host matches rpId
 * 'localhost'. So the ceremony runs inline, in the page that is already open.
 *
 * The passkey is provided by Google Password Manager, which — unlike the
 * device-bound Windows Hello credential on desktop — SYNCS. That is where this
 * feature actually pays off: the same passkey on a new phone can re-derive the
 * same wallet. `reproducible` reports whether that round-trip really worked, and
 * is verified rather than assumed.
 *
 * NOT YET VERIFIED ON A DEVICE. Android WebView routes WebAuthn through
 * Credential Manager, and whether it honours an rpId of 'localhost' (which
 * cannot host the /.well-known/assetlinks.json that Android normally requires)
 * is the open question. If it refuses, createPasskeyWallet throws and the UI
 * hides the option — the wallet is unaffected either way.
 */
import {
  createPasskeyPrf,
  getPasskeyPrf,
  isPasskeySupported,
  type PasskeyCredential,
} from '../renderer/lib/passkey-prf'
import { mnemonicFromEntropy, toWordCount } from '../main/wallet-core'
import {
  hasPasskeyBackup,
  linkPasskey,
  mnemonicFromPasskeyBackup,
  removePasskeyBackup,
} from './capacitor-store'

/**
 * MUST equal the WebView's origin host, which Capacitor serves as
 * https://localhost (androidScheme: 'https').
 *
 * ⚠ A domain rpId does NOT work here, even with
 * WEB_AUTHENTICATION_SUPPORT_FOR_APP enabled in MainActivity. Measured on device:
 * rpId 'www.chainlensnft.info' fails with "The relying party ID is not a
 * registrable domain suffix of, nor equal to, the current domain". FOR_APP makes
 * WebAuthn *available* in the WebView, but Chromium still enforces the web origin
 * rule, so the rpId can only be 'localhost' (or a suffix of the page origin).
 *
 * Using a real domain would therefore require changing the WebView origin itself
 * (Capacitor `server.hostname`), which moves every other origin-scoped thing with
 * it — not worth it while 'localhost' works: it is verified to do the full PRF
 * round trip with Google Password Manager on this device.
 *
 * Changing this value invalidates every passkey created under the old rpId.
 */
const RP_ID = 'localhost'
const RP_NAME = 'MagicMoney Wallet'

/** Prompt-free: can this device offer the passkey option? */
export async function passkeySupported(): Promise<boolean> {
  return isPasskeySupported()
}

/**
 * The name shown in the OS passkey manager (Samsung Pass, Google Password
 * Manager…). MUST be unique per passkey: every passkey yields different PRF
 * bytes and therefore a DIFFERENT wallet, so identical labels leave the user
 * unable to tell which entry restores which wallet — and picking the wrong one
 * silently produces a valid, empty, wrong wallet. A date alone collided for
 * every passkey made on the same day; the time and a short random tag separate
 * them.
 */
export function passkeyLabel(): string {
  const when = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const tag = Math.random().toString(36).slice(2, 6)
  return `MagicMoney · ${when} · ${tag}`
}

/**
 * Run the ceremony and turn the PRF output into a mnemonic. Returns the words
 * for the caller to stash as the pending wallet — deliberately mirroring
 * wallet:generate so the rest of onboarding is identical.
 */
export async function createPasskeyMnemonic(words?: unknown): Promise<string> {
  const { prf, credential } = await createPasskeyPrf({
    rpId: RP_ID,
    rpName: RP_NAME,
    userName: passkeyLabel(),
    userDisplayName: 'MagicMoney wallet',
  })
  try {
    const mnemonic = mnemonicFromEntropy(prf, toWordCount(words))
    // Remembered only so the user can opt into the reproducibility check below.
    _pending = { credential, words: toWordCount(words), mnemonic }
    return mnemonic
  } finally {
    prf.fill(0)
  }
}

let _pending: { credential: PasskeyCredential; words: 12 | 24; mnemonic: string } | null = null

/**
 * Opt-in check: can this passkey rebuild the wallet just created? Prompts again,
 * so it is never run automatically — on stacks that refuse PRF at assertion it
 * surfaces an OS error, and a false answer is information, not a failure.
 * Compares derived phrases so no raw entropy is retained.
 */
/**
 * Recover a wallet from a passkey. No credential is passed, so Credential
 * Manager offers whichever discoverable passkeys it holds and the user picks —
 * necessary when restoring on a device that has no wallet and so no stored id.
 *
 * `words` must match the length used at creation: 12 truncates the PRF to its
 * leading 128 bits, so the same passkey produces a different wallet at 12 vs 24.
 */
export async function importPasskeyMnemonic(words?: unknown): Promise<string> {
  const prf = await getPasskeyPrf({ rpId: RP_ID })
  try {
    // Two ways a passkey reaches a wallet, and they are not interchangeable:
    // LINKED (an existing seed wrapped under this passkey) or GENERATED (the
    // wallet came from these bytes). Try unwrapping first — if a blob exists it
    // is authoritative, and deriving instead would open a DIFFERENT wallet.
    if (await hasPasskeyBackup()) {
      try {
        return await mnemonicFromPasskeyBackup(prf)
      } catch {
        // A linked wallet exists but THIS passkey cannot open it. Deriving
        // instead would hand back a real, empty, DIFFERENT wallet that looks
        // like a successful restore — the worst possible outcome, since funds
        // could be sent to it. Fail loudly instead.
        throw new Error(
          'That passkey does not match the wallet linked on this device. Try the passkey you linked, or import your seed phrase.'
        )
      }
    }
    return mnemonicFromEntropy(prf, toWordCount(words))
  } finally {
    prf.fill(0)
  }
}

/** Is this wallet linked to a passkey on this device? */
export async function passkeyLinked(): Promise<boolean> {
  return hasPasskeyBackup()
}

/** Unlink. The passkey itself stays on the device for the user to remove. */
export async function passkeyUnlink(): Promise<boolean> {
  await removePasskeyBackup()
  return true
}

/**
 * Link the unlocked wallet to a NEW passkey, then immediately prove the round
 * trip by unwrapping once. On platforms that mint PRF at registration but refuse
 * it at assertion the check fails and the blob is deleted, rather than leaving
 * the user believing they have a recovery factor that can never be opened.
 */
export async function linkPasskeyToWallet(): Promise<boolean> {
  const { prf, credential } = await createPasskeyPrf({
    rpId: RP_ID,
    rpName: RP_NAME,
    userName: passkeyLabel(),
    userDisplayName: 'MagicMoney wallet',
  })
  try {
    await linkPasskey(prf)
  } finally {
    prf.fill(0)
  }

  let ok = false
  try {
    const again = await getPasskeyPrf({ rpId: RP_ID, credential })
    try {
      ok = !!(await mnemonicFromPasskeyBackup(again))
    } finally {
      again.fill(0)
    }
  } catch { ok = false }

  if (!ok) {
    await removePasskeyBackup()
    throw new Error(
      'This device can’t read keys back from its passkeys, so a passkey could never restore this wallet. ' +
      'Nothing was changed and your wallet is unaffected — your seed phrase remains your backup.'
    )
  }
  return true
}

export async function verifyPasskeyWallet(): Promise<boolean> {
  if (!_pending) return false
  try {
    const prf = await getPasskeyPrf({ rpId: RP_ID, credential: _pending.credential })
    try {
      return mnemonicFromEntropy(prf, _pending.words) === _pending.mnemonic
    } finally {
      prf.fill(0)
    }
  } catch {
    return false
  }
}
