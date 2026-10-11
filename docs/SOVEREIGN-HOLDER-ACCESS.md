# Sovereign holder access

Sovereign is available only to the active wallet account holding at least one REDACTED NFT on Robinhood mainnet (chain ID 4663).

Contract: `0x0351566C7e98780A591c08000576a01801241B31`.
Public RPC: `https://rpc.mainnet.chain.robinhood.com`.

## Eligibility

`src/renderer/lib/sovereign-access.ts` validates the RPC chain ID, reads a block number, and calls ERC721 `balanceOf(activeAccount)` against the exact contract at that block. Strict ABI decoding preserves the full uint256 count. The current account is confirmed through the wallet bridge before publishing a result. NFT indexer caches and collectible display filters are not used as access evidence.

Access is held in renderer memory, expires after 90 seconds, and is rechecked every 60 seconds while Sovereign is selected and the window is visible. Focus/visibility changes also refresh it. Account changes, wallet lock, zero balances, malformed responses and RPC failures remove access. Checks have a 10-second timeout; stale responses cannot unlock another account. Detached desktop browser chrome binds its own current account and rejects account synchronization completed after a lock event.

A saved Sovereign preference waits for verified ownership and otherwise renders the default theme. Settings shows Locked/Checking/Unlocked status and Recheck ownership. Exact NFT counts respect the existing balance privacy setting. Other themes remain available.

This is a client-side cosmetic access gate, not a server-side entitlement or asset encryption system. All operations are read-only: no signatures, approvals or transactions.

## Verification

Live production-reader probes recorded in `.local-artifacts/sovereign-holder/live-probe.json`: chain 4663, ERC721 support confirmed, positive balance 5 and empty balance 0 at block 85436316. The positive address is the contract's public owner; no user wallet was unlocked for this probe.

Local browser fixture uses a disposable wallet and mocked financial/provider/RPC results. It covers locked selection, holder application, reload, zero balance revocation, RPC failure, account switching, motion, reduced motion, theme cleanup and 360/400/1000px geometry. Unit tests also cover wrong-chain/malformed responses, uint256 precision, expiry, timeout and stale responses, including detached-browser locking.

Final logs: `.holder-typecheck-reviewed.log`, `.holder-tests-reviewed.log`, `.holder-browser-reviewed.log`, `.holder-build-reviewed.log`, `.holder-desktop-reviewed.log`, `.holder-android-reviewed.log`, `.holder-ios-reviewed.log`. Earlier `.holder-browser-final.log` covers all four existing art skins plus Sovereign. Five TypeScript targets and all 167 test files/2460 tests pass. Extension, Electron, Android renderer and iOS renderer bundles pass. Native installed-device behavior and detached Electron browser UI have not been manually exercised for this gate.

Implemented locally in Magic Money Wallet; no ChainLens changes, commit, installation or deployment.
