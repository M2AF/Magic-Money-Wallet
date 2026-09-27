/**
 * grant-recheck.ts — desktop's last gate before a dApp signature or transaction.
 *
 * A signing/transaction prompt can sit open past an auto-revoke deadline (or a
 * manual disconnect). After the user approves, and before any key is loaded,
 * ipc-handlers.ts calls this to re-check that the site still holds its grant.
 *
 * Fails closed: if enforcing the deadline itself fails, the request is refused
 * outright. The cached deadline and stored grant are NOT consulted in that case,
 * because neither can be trusted while the revoke that should have changed them
 * is in an unknown state.
 *
 * Kept free of Electron imports so it can be unit-tested directly.
 */

import { isOverdue, normalizeAutoRevokeState } from './auto-revoke'

export const SITE_DISCONNECTED_MESSAGE =
  'This site was disconnected while the request was open. Reconnect and try again.'

export function siteDisconnectedError(): Error & { code: number } {
  return Object.assign(new Error(SITE_DISCONNECTED_MESSAGE), { code: 4100 })
}

/**
 * Desktop's synchronous grant gate, used by every dApp handler — including
 * address-only reads such as eth_accounts and CIP-30 getUsedAddresses.
 *
 * Refuses when:
 *  - the last-read deadline is overdue (`overdue`), or
 *  - the settings file exists but cannot be read or parsed: a countdown may be
 *    armed in it, so the stored grant cannot be trusted, or
 *  - the freshly read settings are overdue (covers the window before the
 *    controller has read anything).
 * `enforce` asks the controller to run the expiry; it is not called for an
 * unreadable file, where it could only fail again.
 */
export function desktopGrantActive(deps: {
  overdue: () => boolean
  readSettings: () => unknown
  hasGrant: () => boolean
  enforce: () => void
  now?: () => number
}): boolean {
  if (deps.overdue()) { deps.enforce(); return false }
  let settings: unknown
  try {
    settings = deps.readSettings()
  } catch {
    return false
  }
  if (isOverdue(normalizeAutoRevokeState(settings), (deps.now ?? Date.now)())) { deps.enforce(); return false }
  return deps.hasGrant()
}

export async function recheckGrantBeforeSigning(
  reconcile: () => Promise<unknown>,
  hasGrant: () => boolean,
  log: (message: string, error: unknown) => void = (m, e) => console.error(m, e),
): Promise<void> {
  try {
    await reconcile()
  } catch (e) {
    log('[auto-revoke] reconcile failed; refusing the request:', e)
    throw siteDisconnectedError()
  }
  if (!hasGrant()) throw siteDisconnectedError()
}
