/// <reference lib="dom" />
/**
 * popup-connect.ts — preload for the dApp-opened auth/connect popup windows.
 *
 * The dApp browser opens a frameless popup for OAuth / wallet-connect / Abstract
 * Global Wallet "Login with Wallet" flows. Previously this popup loaded only
 * `popup-chrome` (the branded titlebar), so it had NO `window.ethereum` / EIP-6963
 * provider — meaning MagicMoney could not be detected or sign INSIDE the popup.
 * Abstract's Privy "Login with Wallet" runs its auth in exactly such a popup, so
 * the wallet never appeared in its list and the SIWE signature could not complete
 * ("Could not log in with wallet").
 *
 * This combined preload runs the full web3 provider injection AND the titlebar,
 * so the popup behaves like the main dApp view for wallet detection + signing.
 * Both imports are side-effect modules (they run their injection on load).
 */
import './web3-inject'
import './popup-chrome'
