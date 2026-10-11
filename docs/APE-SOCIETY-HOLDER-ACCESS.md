# Owned Ape Society portraits

The Ape Society theme is now holder-only on Ethereum mainnet (chain1), contract `0xF08Acc2f16Ddf2f5d047fcc4D39A6c528A9645af`. Magic Money checks the active EVM account. ChainLens checks only verified EVM wallets returned by a fresh authenticated profile request; watch-only addresses are excluded. The art palette/frames stay fixed, while the holder can select their own portrait.

## Discovery and proof

The contract reports no ERC721Enumerable support, so `tokenOfOwnerByIndex` cannot enumerate its holdings. The portable reader validates Ethereum chain ID, gets a block, reads `balanceOf` and discovers candidate IDs through Blockscout's collection instances endpoint filtered by holder. It follows pagination with repeated-cursor/bounds checks. Every candidate is checked with `ownerOf` against the exact contract at the same measured block before `tokenURI` is read. Indexed ownership and image metadata are not trusted as proof.

Metadata comes from the contract's ABI-decoded token URI, including its on-chain base64 JSON. IPFS image candidates use Pinata, dweb and ipfs.io gateways, or validated HTTPS URLs. The chosen image must actually load before the theme unlocks. It replaces the painting in the backdrop, framed picker thumbnail and card surface crop through `--ape-portrait`, retaining the original gold/bronze frames and typography. Missing/failed artwork does not substitute somebody else's ape.

Results expire90seconds after the measured read and the foreground selected skin rechecks every30seconds plus focus/visibility. A45second hard timeout removes access even if a request hangs. Account/session changes clear candidates and image immediately and invalidate late responses. The wallet also reconfirms the active bridge address before publishing results. Zero ownership/error/expired proof disables the skin and uses the base theme, retaining a saved theme preference for later valid verification. If a chosen token has left the wallet but other apes remain, the selector falls back to another verified owned ape.

Only token-ID preferences are persisted, keyed by owner and active verified owner set. A selection in another verified linked wallet wins over earlier preferences. Stored IDs cannot grant entitlement or select a token absent from the newly verified list. Portrait preference remains local to each product; no profile schema migration or cross-product preference sync was introduced.

The compact refresh icons live on the Sovereign and Ape Society tiles as sibling controls, with accessible labels `Recheck ownership` and `Refresh owned apes`. There are no nested buttons or separate ownership panels. The native `Theme ape` dropdown appears only beneath the selected, verified Ape Society tile. No color editor is enabled.

This is a cosmetic client-side gate matching Sovereign, not a server authorization system or encrypted art. All probes are read-only; no signatures, approvals, transfers or real-funds actions. Discovery/gateway outages fail closed with a retry indication. Incomplete discovery shows verified items only and can lag recent transfers.

## Shared implementation

Canonical reader/access lifecycle: `src/shared/ape-theme-{core,access}.ts`; entry `ape-theme-entry.ts`. Wallet binding/UI: `src/renderer/lib/ape-access.ts`, `components/ApeThemePicker.tsx`, SettingsModal.tsx, App.tsx and theme.ts. ChainLens consumes a generated dependency-free IIFE `public/ape-theme-core.js` and `public/ape-holder.js`; regenerate from the wallet checkout with:

```
npx esbuild src/shared/ape-theme-entry.ts --bundle --format=iife --global-name=ChainLensApeAccess --outfile="../chainlens/public/ape-theme-core.js"
```

The canonical source must be regenerated after changes before ChainLens validation. The standalone docs page disables both holder themes and directs verification to the main app.

## Evidence

Production reader live probe discovered token6637 for public owner `0x01faf6dfc230d755141d84d7cb980dd68f5efe13`, verified its `ownerOf`, and decoded **Roch Edwards** with image `ipfs://bafybeiczgve33eflcmnqch74o5aobheaxodgboimqxxaqni674paxhhb4a/6637.jpg`. Downloaded on-chain artwork visually matches the supplied reference. Positive discovery/image evidence: `.local-artifacts/ape-holder/live-discovery.json`, `token-6637.json`, `onchain-6637.jpg`. No user wallet was unlocked or signed for that public-address probe. Blockscout CORS verified; Pinata returned200, other image gateways returned429 during research.

Final wallet checks: five TypeScript targets;170files/2492tests;7 ownership/preference tests; extension/Electron/Android renderer/iOS renderer bundles. All6 wallet art/Sovereign journeys pass, plus final two-ape selection/reload/revocation/compact-button/chart journey after the multi-wallet preference fix. ChainLens npm check/198Node tests and all18 picker journeys pass, plus the final owned-selection/watch-only/error rerun. Financial/provider/profile/RPC values in browser journeys are controlled fixtures, distinct from the live probe.

Reviewed picker screenshots: `.local-artifacts/ape-holder/wallet-picker.png` and ChainLens `.local-artifacts/ape-holder/chainlens-picker.png`; they show a simulated second token to test multi-ape selection, not a claim that the public owner holds it. Logs `.ape-holder-*.log` in each checkout. No native APK/device install or deployment performed for this feature; installed-device/browser native composition remains unverified.
