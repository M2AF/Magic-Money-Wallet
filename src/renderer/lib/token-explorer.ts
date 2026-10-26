/**
 * token-explorer.ts — vetted explorer links for a token, and the wallet's own
 * link-opening path.
 *
 * Only templates that were opened and confirmed are listed here. The host and
 * path are FIXED; token metadata never supplies any part of the URL beyond a
 * validated hex unit. Unlisted networks/modes return null (no link), never a
 * guess.
 *
 * Vetted: Cardanoscan, Cardano mainnet — https://cardanoscan.io/token/<unit>,
 * with ?tab=programmable for a CIP-113 holding (see docs/CIP113-C3-HANDOFF.md).
 */

import type { TokenDetailsMode } from '../../shared/token-details'

/** 56 hex policy chars + 0–64 hex asset-name chars (even length), lowercase. */
const CARDANO_UNIT = /^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$/

export function tokenExplorerUrl(
  token: { chain: string; contractAddress: string; source?: string },
  mode: TokenDetailsMode,
): string | null {
  // Testnet (Preprod/Preview) tokens must never route to the mainnet explorer.
  if (mode !== 'mainnet' && mode !== 'privacy') return null
  if (token.chain !== 'cardano') return null
  if (!CARDANO_UNIT.test(token.contractAddress)) return null
  const base = `https://cardanoscan.io/token/${token.contractAddress}`
  return token.source === 'cip113' ? `${base}?tab=programmable` : base
}

/**
 * Open a link in the wallet's OWN browser — never the system one. Same routing
 * as the Messenger links (extension tabs, then the in-app browser).
 */
export function openWalletLink(url: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tabs = (globalThis as any).chrome?.tabs
  if (tabs?.create) { tabs.create({ url }); return }
  if (window.wallet.openBrowserInNewTab) { window.wallet.openBrowserInNewTab(url); return }
  window.wallet.openBrowser()
  setTimeout(() => window.wallet.browserNavigate(url), 400)
}
