/**
 * dapp-chain.ts — active EVM network for the built-in dApp browser
 *
 * The injected provider is multi-chain: a connected dApp selects the active network
 * via wallet_switchEthereumChain, and the user can switch manually from the browser
 * toolbar. This is the SINGLE source of truth for that selection, shared by
 * ipc-handlers (RPC: eth_chainId, read forwarding, sends) and browser-manager
 * (resets it to the default when navigating to a new dApp origin).
 *
 * It is a tiny dependency-free state holder ON PURPOSE — both of those modules need
 * it, and putting it here avoids an ipc-handlers ↔ browser-manager import cycle.
 *
 * NOTE: state only. The chainChanged EVENT (emitDappEvent) and the toolbar push
 * (notifyBrowserChrome) are fired by the callers, which own those channels.
 */

export const DEFAULT_CHAIN_ID = 1 // Ethereum mainnet — the safe default most dApps expect

// Sepolia — the equivalent safe default while Testnet Mode is on. Callers pick
// via defaultDappChainId(cfg) in chain-config (kept out of here to stay dep-free).

let _chainId = DEFAULT_CHAIN_ID

/** Numeric chainId currently active for the dApp browser (e.g. 1, 137, 143). */
export function getDappChainId(): number {
  return _chainId
}

/** Set the active dApp chain. Returns the value actually stored. */
export function setDappChainId(chainId: number): number {
  if (Number.isFinite(chainId) && chainId > 0) _chainId = chainId
  return _chainId
}
