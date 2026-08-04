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

const RP_ID = 'localhost'
const RP_NAME = 'MagicMoney Wallet'

/** Prompt-free: can this device offer the passkey option? */
export async function passkeySupported(): Promise<boolean> {
  return isPasskeySupported()
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
    userName: `MagicMoney wallet · ${new Date().toISOString().slice(0, 10)}`,
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
