# NFT gallery loading improvements

Implemented locally on 2026-10-05. ChainLens website code was not changed.

## Behavior

- Gallery and profile-photo picker prefer provider previews: Alchemy thumbnails, Moralis medium images, and Helius CDN media when supplied. Full artwork URLs remain separate for detail views, downloads and saved profile photos.
- Image elements are mounted only when their card intersects the viewport/nearby region. Native lazy loading and asynchronous decoding are also enabled. Offscreen placeholders do not animate.
- Square card space stays reserved. Visible loading placeholders fade into artwork; reduced-motion preferences disable the animation and transition.
- Failed previews fall back to full artwork. IPFS URLs retain their supplied gateway before bounded alternatives. Each visible candidate has a 12-second deadline; exhausted candidates produce a stable accessible placeholder.
- Metadata changes reset image state. On-chain metadata repair clears a stale indexer thumbnail so a collection reveal cannot keep displaying old art.
- Ready ownership sources push partial results through the existing collectibles update bridge. The gallery can appear before the slowest chain finishes. The complete result and background floor valuation retain their existing roles.
- Refresh progress keeps existing cards and cached display prices until the complete result arrives. Complete results can remove sold assets. Old refreshes/account pushes are rejected; Electron listeners are correctly removed on unsubscribe.

## Verification

- `npm run typecheck`: all five TypeScript target configurations pass.
- `npm test`: 144 files, 2,115 tests pass.
- Builds pass: `npm run build`, `npm run build:extension`, `npx vite build --config vite.capacitor.config.ts`, `npx vite build --config vite.ios.config.ts`.
- `npx playwright test e2e/nft-gallery.spec.ts --workers=1`: real unpacked extension test passes with synthetic holdings and intercepted media responses.
- The 240-NFT fixture made **3 initial media requests**. The complete journey, including scrolling to the last item, details, download URL verification, failed/revealed artwork and a deliberately stalled preview, made 17 requests. This is request-count evidence, not a measured production load-time improvement.
- Screenshots reviewed: loading gallery, detail view, search, final fallback, compact extension viewport and larger browser viewport. Evidence: `test-results/nft-gallery-*.png`; command logs: `.nft-gallery-*.log`.
- `git diff --check` passes. No lint script is configured.

## Files

Runtime changes: `src/main/token-fetcher.ts`, `src/main/collectibles-progress.ts`, `src/preload/index.ts`, `src/renderer/types/wallet.ts`, `src/renderer/pages/DashboardPage.tsx`, `src/renderer/pages/ProfilePage.tsx`, `src/renderer/components/NftImage.tsx`, `src/renderer/components/NftImage.css`, `src/renderer/lib/nft-media.ts`, `src/renderer/lib/collectibles-updates.ts`.

Tests: `src/main/token-fetcher.nft-gallery.test.ts`, `src/main/collectibles-progress.test.ts`, `src/main/token-fetcher.monad-nfts.test.ts`, `src/main/token-fetcher.stale-metadata.test.ts`, `src/renderer/lib/nft-media.test.ts`, `src/renderer/lib/collectibles-updates.test.ts`, `e2e/nft-gallery.spec.ts`.

Handoff state and checkpoints: root `HANDOFF.md` and `HANDOFF_LOG.md`.

## Limits

This uses the providers' existing media/CDN services; it does not deploy a new shared resizing/cache service. Media without a provider preview still falls back to its original source/gateway. No live wallet performance benchmark or Android/iOS native-device validation was performed. No dependencies, commits, release version changes or deployments were added. Existing xReserve changes were preserved.

## Favorites (2026-10-05)

The gallery now has an always-visible star at the top-left of each image. A filled gold star marks a favorite; clicking it does not open the detail view. Favorites appear first, with both favorites and remaining NFTs sorted by descending existing USD value. Equal-value ordering is stable and unpriced items follow priced items. The displayed price and currency preference are unchanged; search and spam filtering still apply before rendering.

Favorites are persisted locally per public EVM owner and mainnet/testnet mode, using canonical NFT identity (chain, contract, token ID). This separates accounts and wallets and avoids mainnet/testnet collisions. Favorites are not synced to ChainLens or across devices. Sorting is memoized so hovering does not repeatedly sort a large collection.

Files: `src/renderer/pages/DashboardPage.tsx`, `src/renderer/lib/nft-favorites.ts`, `src/renderer/lib/use-nft-favorites.ts`, `src/renderer/lib/nft-favorites.test.ts`, `e2e/nft-gallery.spec.ts`, and handoff/docs.

Verification: five-target typecheck and 146 files/2,139 unit tests pass. All four web builds pass. Both extension tests pass, covering top-left position, star/unstar ordering, displayed values, persisted favorites after a full page reload/unlock, search, click isolation and gallery regressions. Evidence: `.nft-favorites-*.log`, `test-results/nft-gallery-favorites.png`. Native-device QA remains unverified.
