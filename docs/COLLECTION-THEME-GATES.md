# Collection art-theme access

Magic Money and ChainLens now gate the remaining collection art skins, alongside the existing Sovereign and Ape Society gates.

| Theme | Network | Contract or policy | Required holding |
| --- | --- | --- | --- |
| Mallard Order | Cardano mainnet | `901ba6e9831b078e131a1cc403d6139af21bda255cea6c9f770f4834` | Positive policy quantity at the current payment address or its associated key stake account (including linked staking/script holdings) |
| Sealuminati | Monad mainnet 143 | `0xaEAA920165fD7ce58a0E0772Ffc97F06626572cD` | At least one ERC-721 |
| r3tards | Monad mainnet 143 | `0x200723A706de0013316E5cd8EBa2b3f53DD90c29` | At least one ERC-721 |
| Emonad | Monad mainnet 143 | `0x81A224F8A62f52BdE942dBF23A56df77A10b7777` | At least 10,000 EMONAD in one owned address |

The supplied Emonad address is a fungible token: live `name()` returned emonad, `decimals()` returned 18, and the ERC-721 interface/ownerOf calls reverted. The user explicitly chose a 10,000-token minimum. The exact raw threshold is `10000 * 10^18`; a balance one raw unit below it remains locked. Linked-address balances are not added together.

## Shared code and trust boundary

- `src/shared/collection-theme-access.ts` is the canonical reader and access controller. ChainLens uses its generated `public/collection-theme-core.js` bundle plus `public/collection-holder.js`.
- Wallet binding uses only the unlocked account's EVM and mainnet Cardano payment addresses. Detached browser chrome has its own unlocked-session binding and lock listener. Account changes discard pending responses; current bridge addresses are checked again before publishing proof.
- ChainLens binding uses a fresh authenticated `/api/profile` result and only `watch_only === false` EVM/Cardano wallets. No wallet in a cached profile, watch-only wallet, standalone stake address, or saved theme preference grants access.
- Monad checks chain ID, block number, exact ABI words and the supplied contract. Every interface/decimals/balance call is pinned to the same measured block. Sealuminati and r3tards must also support ERC-721.
- The wallet reads Mallard directly through its privileged `getMallardOwnership()` bridge (Electron main / extension background / Capacitor native-fetch path), using only the unlocked account's mainnet payment address. It does not depend on a deployed ChainLens endpoint. ChainLens's website uses its fixed-policy `/api/theme-holder/mallard?address=...` endpoint because Koios does not send browser CORS headers. The reader first checks current payment-address assets, then the locally decoded key stake account if the direct quantity is zero. It filters the fixed policy and validates response address or derived stake address/policy/name/quantity, paginates with duplicate detection, and rejects incomplete/malformed/provider-failed responses. It accepts no arbitrary provider URL, policy, or signing operation. Its read budget is 12 seconds and the existing server rate limiter applies.
- Proof is memory-only, valid for 90 seconds, with foreground refresh every 30 seconds for the active gated theme and focus/visibility refresh. Checks have a 15-second timeout. Failed, zero, expired or stale-account proofs cannot apply the art skin. A saved selection remains a preference and can restore after a new successful proof.
- Both pickers have compact refresh buttons on each gated tile, locked/checking/retry status and accessible names. Art palettes remain immutable. The docs-only ChainLens picker cannot activate these holder skins.

These are cosmetic application gates; the shipped public CSS/assets are not encrypted or a server authorization mechanism for financial actions. No signing, transaction approvals, transfers or broadcasts are used.

## Regenerate the ChainLens reader

From the wallet checkout:

```
npx esbuild src/shared/collection-theme-access.ts --bundle --format=iife --global-name=ChainLensCollectionAccess --outfile=../chainlens/public/collection-theme-core.js
```

## Verification and release boundary

Live read-only checks on October 11, 2026 verified Monad chain143, both NFT interfaces, Emonad decimals18, and successful production access reads for all three Monad collections at the public address associated with Roch Edwards#6637. A public Mallard policy holder returned 41 matching units through the production reader; this validates the policy path, not the user's Cardano holdings. Real browser fetch also confirmed Monad RPC CORS.

Validation logs: `.collection-typecheck.log`, `.collection-unit.log`, `.collection-extension.log`, `.collection-desktop.log`, `.collection-android-web.log`, `.collection-ios-web.log`, `.collection-browser-reviewed.log`, `.collection-live.log`. ChainLens logs: `.collection-check.log`, `.collection-unit.log`, `.collection-browser.log`, `.collection-gates-browser.log`. Browser fixtures cover selection/reload, threshold boundary, zero/revocation, retry, provider failure and watch-only rejection. Unit tests cover wrong chains/response bindings, exact policy/address matching, stale responses, timeout, expiry and pagination.

Implementation is local. The new ChainLens server endpoint and frontend must be deployed together before Mallard verification works on the ChainLens website. Wallet builds read Koios through the native/background bridge and need no ChainLens server deployment. Android/iOS web bundles are not installed-device or native compilation evidence. No deployment or phone installation was performed in this change.

Provider references: [Monad network documentation](https://docs.monad.xyz/developer-essentials/network-information), [Koios API specification](https://api.koios.rest/koiosapi.yaml).

## Picker categories

The appearance picker now has independent, keyboard-operable native disclosure sections: **Art Designs** and **Material Designs**. Both start expanded; each can collapse without changing the active theme. All holder refresh buttons and the Ape portrait selector remain in Art Designs. Sovereign and the five collection skins are art designs. Liquid Glass, Brushed Metal, Leather, Velvet, Walnut and Royal Blue Silk are materials. The `material: true` flag on each built-in definition supplies this grouping in both products; theme IDs, palette restrictions and ownership rules remain unchanged. Validation logs are `.design-sections-*.log`; screenshots `.local-artifacts/design-sections/` and the wallet Mallard holder screenshot.

## Mallard endpoint regression fix

The live web endpoint returned HTML (the homepage fallback), not a JSON ownership proof, on October 11. This caused the wallet's previous web-based check to stay locked. `src/shared/mallard-policy.ts` is now the canonical fixed-policy reader; it is called directly by `wallet:get-mallard-ownership` in Electron and the shared extension/mobile handler. Locked accounts are rejected before reading, and lock/account changes during reading invalidate the result. `src/renderer/lib/collection-access.ts` adapts the bridge proof into the existing gate without calling the web endpoint. ChainLens's `mallard-policy-core.js` is generated from the same source and used by `theme-holder-cardano.js`.

Regenerate the server reader from the wallet with `npx esbuild src/shared/mallard-policy.ts --bundle --platform=node --format=cjs --outfile=../chainlens/mallard-policy-core.js`. Logs: `.mallard-native-*.log`; the wallet browser test simulates an undeployed HTML endpoint and asserts that it is never requested. The policy ID has not changed. A running wallet needs the rebuilt main/preload/renderer or updated mobile build; no phone installation is implied.

## Stake-account coverage regression

On October 11 the user provided their actual mainnet Cardano payment address. Production reads returned zero direct Mallards, while Koios `account_assets` returned MallardOrder3348 (quantity1) under its key stake account. The NFT is at a script-payment/key-stake base address with the same stake credential; the user identified this as Mallard staking. The existing NFT scanner already includes stake-account assets, so its displayed collection coverage exceeded the first version of the gate.

`mallardStakeAddress()` now validates Bech32 checksum, mainnet address prefix/network/type/length and derives a key reward address from the base address's embedded credential following CIP-19. It does not accept a provider-selected or caller-supplied stake identifier. After a zero direct result the reader paginates current `account_assets` for that exact derived account, validates returned stake/policy/name/quantity, and includes account-associated staking/script holdings in cosmetic theme eligibility. Enterprise addresses use direct holdings only; pointer/script-stake addresses are not expanded. Account assets are not transaction-spendability proof and do not authorize sends. No unrelated stake account or policy grants access.

The actual user's production gate now returns quantity1. Six focused tests cover session locking/switches, stake-only3348 coverage, wrong stake/policy and checksum/network rejection. The Mallard extension journey uses a stake-only fixture with direct quantity0 and the missing web endpoint returning HTML. `.mallard-stake-*.log` records verification. Source and regenerated ChainLens backend reader are shared. This change is local; restart/update the wallet to load the rebuilt code, and deploy ChainLens separately when authorized.

Address format reference: [CIP-19](https://cips.cardano.org/cip/CIP-0019).

Wallet disclosure follow-up: builtin/custom colours/New grouped before Art Designs/Material Designs; both default collapsed. White rounded label pills/black text join a white rail to the right chevron, matching ChainLens. Native keyboard/independent toggling and ownership controls retained. Five TS targets/172files2510tests/four renderer bundles/two full Sappy-Mallard journeys pass in `.wallet-pill-*.log`; screenshot `.local-artifacts/design-sections/wallet-collapsed.png`. No phone install or deployment.
