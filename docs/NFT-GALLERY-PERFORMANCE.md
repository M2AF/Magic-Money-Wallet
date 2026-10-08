# NFT gallery loading improvements

October 7 follow-up: [remaining token artwork and mobile layout fixes](NFT-MEDIA-AND-MOBILE-LAYOUT-2026-10-07.md), including recognized HTTPS content-addressed metadata, confirmed empty token URIs, portfolio percentage placement and Android embedded-page insets.

## ChainLens media coverage and mosaics (2026-10-06)

Implemented locally after HEAD `02bea62`. No commit, push or deployment.

- Dashboard Collectibles has a **Mosaic** toggle immediately left of Search. The view preference persists locally. Grouping uses chain and contract/policy identity, rather than collection names alone. Every NFT appears in consecutive four-item tiles; two-item tiles stack vertically at half width, and three-item tiles use one larger image. Available gallery width determines two, four or six full-width columns. The existing individual-card view remains available.
- Search and shared ChainLens-ID favorites/spam decisions apply before grouping; existing USD/favorite ordering and displayed currency remain. Each mosaic NFT has its own detail, favorite and spam controls. Switching layouts uses loaded holdings and does not call the ownership API again.
- The shared media helper carries the ChainLens gateway fixes into provider mapping and the renderer: Blockfrost/Pinata/Filebase alternatives, supplied working gateways, retired-gateway replacement, raw CID validation, subdomain IPFS, Arweave, split CIP-25 strings and complete CBOR text/byte strings. Cardano image files and `image_url` are accepted; arbitrary website URLs and video files are not used as NFT artwork. CIP-68 reference/fungible labels are excluded from NFT classification.
- Alchemy, Moralis, Helius and Cardano retain additional exact artwork candidates alongside previews. The displayed image element owns each request, with six shared slots, a twelve-second candidate deadline, bounded attempts and a session cache of successful sources. Failed artwork exposes Retry artwork. Detail downloads use the successfully decoded full-view source.
- Metadata JSON repair tries at most three exact-content gateways with 3.5-second deadlines and a 1 MiB streamed size limit. It never invents `.json` suffixes or token paths. Existing restrictions on automatically fetching unknown HTTPS metadata are retained. Cached repairs are applied before spending the refresh budget, allowing larger collections to progress beyond the first 25 repaired records.
- Monad metadata verification now uses the wallet's existing Monad RPC list (previously absent from the generic public RPC map). NFT URI reads use ten-item Monad chunks with spacing, eight-second per-endpoint deadlines, and retain earlier results if a later chunk fails. An exhausted chunk stops the pass instead of repeatedly exhausting the endpoints. ERC-20 reads retain their existing behavior.

Validation: five TypeScript targets, 165 unit-test files / 2,433 tests, three extension browser journeys, desktop and extension builds, and Android/iOS Vite bundles. The browser fixture covers all ten items of one collection, vertical pairs, responsive side-panel width, per-token detail/favorite/spam, search, exact artwork fallback/download and no new ownership request on toggling. The 240-item regression made three initial media requests and sixteen across its full journey. Screenshots reviewed: `test-results/nft-mosaic-compact.png` and `test-results/nft-mosaic-desktop.png`.

Actual media recheck: the ten Lil Sappys ownership records captured during the ChainLens investigation were mapped into a local unpacked-wallet fixture. All ten real public images decoded using the new wallet loader, across three mosaic tiles, with no page errors. Evidence: `test-results/nft-mosaic-lil-sappys-live.{png,json}`; ignored harness `.screenshots/nft-live.cjs`. This proves local display/media behavior with those records, not a new production ownership scan or native Android/iOS runtime. Logs, screenshots and harness files are already ignored by `.gitignore`; no credentials were added.

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

Favorites now sync through the ChainLens profile shared with the website and other Magic Money installations. Owner/network-scoped local caches retain offline decisions; namespaced profile entries retain dated favorite and unfavorite decisions. Existing local favorites migrate without overriding newer profile choices. Sorting is memoized so hovering does not repeatedly sort a large collection. See [shared favorites architecture and deployment notes](../../chainlens/docs/PROFILE-NFT-FAVORITES.md).

Files: `src/renderer/pages/DashboardPage.tsx`, `src/renderer/lib/nft-favorites.ts`, `src/renderer/lib/use-nft-favorites.ts`, `src/renderer/lib/nft-favorites.test.ts`, `e2e/nft-gallery.spec.ts`, and handoff/docs.

Current verification: five-target typecheck and 159 files/2,327 unit tests pass. All four web/desktop bundles pass. Both extension tests pass, covering top-left position, star/unstar ordering, displayed values, persisted favorites after a full page reload/unlock, search, click isolation and gallery regressions. ChainLens browser integration checks use both real hooks with mocked profile transport. Evidence: `.favorites-*.log`, `test-results/nft-gallery-favorites.png`. Live profile sync and native-device QA remain unverified; the existing local server database credential returned `Unregistered API key`. No deployment performed.
