/**
 * passkey-reconcile-chainlens.ts — MagicMoney Wallet
 *
 * The one concrete reconciliation the wallet performs today: ChainLens.
 *
 * Platform-neutral, so Electron main and the Android WebView bundle share it —
 * the same reason `passkey-ceremony.ts` is shaped this way. The caller supplies
 * the environment and the mnemonic loader; everything else lives here.
 *
 * ⚠ WHAT THIS FIXES, AND WHAT IT DOES NOT. It removes local rows the relying
 * party no longer has — the "Passkey not recognised" failure, where the
 * authenticator signs correctly with a credential the server has forgotten. It
 * does NOT make a passkey created on another device discoverable here; that is
 * a MISSING row, not a stale one, and it waits on the index sync.
 */

import { privateKeyToAccount } from 'viem/accounts'

import { reconcileChainLens } from './passkey-reconcile'
import type { PasskeyEnvironment } from './passkey-ceremony'
import { getEvmPrivateKey } from './wallet-core'
import type { WalletSigner } from './chainlens-auth'

/** Where the API lives. The rpId is the registrable domain; this is the host. */
export const CHAINLENS_ORIGIN = 'https://www.chainlensnft.info'
export const CHAINLENS_RP_ID = 'chainlensnft.info'

/**
 * Sign with the account's EVM key.
 *
 * viem's `signMessage({ message })` is EIP-191 over the UTF-8 string, which is
 * exactly what the server's `verifyMessage(message, signature)` recovers.
 */
export async function evmSigner(mnemonic: string, accountIndex: number): Promise<WalletSigner> {
  const account = privateKeyToAccount(await getEvmPrivateKey(mnemonic, accountIndex))
  return {
    address: account.address,
    signMessage: (message: string) => account.signMessage({ message }),
  }
}

/**
 * Prune ChainLens rows the server has disowned. Returns how many went.
 *
 * Best-effort and silent: a locked wallet, no network, or an account with no
 * ChainLens passkeys all return 0 without touching anything. Never called from
 * a ceremony path — a sign-in must not wait on the network, which is precisely
 * the regression v0.7.1 shipped to fix.
 */
export async function reconcileChainLensPasskeys(
  env: PasskeyEnvironment, fetchImpl: typeof fetch = fetch,
): Promise<number> {
  try {
    const mnemonic = await env.loadMnemonic()        // throws when locked
    const { accountIndex } = await env.currentAccount()
    const signer = await evmSigner(mnemonic, accountIndex)
    return await reconcileChainLens(env, CHAINLENS_ORIGIN, CHAINLENS_RP_ID, signer, fetchImpl)
  } catch {
    return 0
  }
}
