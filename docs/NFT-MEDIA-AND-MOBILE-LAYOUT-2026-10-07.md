# NFT media and mobile layout follow-up

Changes are local after `d4c781f`; no commit, push, release or deployment.

## NFT artwork

Imageless NFTs whose on-chain URI is a recognized HTTPS IPFS gateway or an Arweave transaction now enter the existing bounded metadata repair queue. Previously only `ipfs://`, `ar://` and `data:` qualified, excluding the HTTPS Pinata pointers used by Robinhood Pengs. CID validation and a public gateway allowlist preserve the restriction against automatically fetching arbitrary tracking hosts. Existing previews and successful indexer data are retained on RPC/gateway failure.

Live read-only check: Peng #3845 metadata was recovered through Blockfrost after Pinata timed out. Its published PNG returned HTTP 200, `image/png`, 37,161 bytes. Evidence: ignored `.oct7-media-probe.log`. This verifies a public token's media, not a new wallet ownership scan.

Some placeholders cannot be replaced with token artwork today. On October 7, the standard `uri(uint256)` calls returned an empty string for Monad contracts `0xC04698790deB7Eb4Df8419De19A428424c0944f2` (#247), `0xE94823A59d741EF4BB0aC74ac793459bfE0a3dA5` (#157), `0xf19725Ee6744fe1c6452Dd8A28F21fB6Be4003bB` (#178) and `0xf7123a3f3ea0Cdf76336eFe0DA2Bd25BAB89b299` (#120). Their `tokenURI` calls reverted. Robinhood `0xE4914FC4Af55505Fb3d373bbFfb85001Ffd66F75` (#6411) returned empty `tokenURI`; `uri` reverted. Evidence: `.oct7-uri-probe.log` (keyless RPCs).

Successfully decoded empty pointers are now distinguished from unavailable RPCs. With no usable provider artwork, the gallery/detail/mosaic labels the token **No artwork published**. A subsequent portfolio refresh checks again; collection logos are not substituted for token-specific artwork.

## Portfolio header

The existing red/green seven-day percentage moved from beside the balance to beside the Updated timestamp, per the user's final placement correction. The percentage stays visible when the balance is hidden, wrapping within its own column on narrow layouts rather than overlapping buttons. The native portfolio toolbar is raised 12px independently of the chart. The toolbar reserves its width; the balance column can shrink, with large values ellipsized and their full value available as a tooltip. The chart keeps a fixed 150px width, position and plotted points across balance visibility changes. No price, portfolio arithmetic or action logic changed.

The user authorized updating only the main Android package on the connected SM-G996W. The signed release APK was verified against the installed app's signer and installed with `adb install -r`, preserving the original first-install time. The final corrected APK was installed and launched at 21:39 on October 7. No debug package was installed; visual device QA remains with the user.

## Android browser

The overlay measures the real wallet navigation rectangle rather than assuming a 54px strip. Native page margins now subtract the native parent's window origin instead of counting a status-bar offset twice. Each embedded WebView receives only the system-bar/cutout/keyboard insets overlapping its own screen rectangle, including zero updates after keyboard dismissal. Fullscreen video uses its existing separate container.

This follows [Android's WebView inset guidance](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets), which describes duplicate padding when both native layout and web content handle full window insets. Website CSS is not rewritten and wallet provider/approval boundaries are unchanged.

## Validation and limits

- Five TypeScript targets and 165 files / 2,436 unit tests pass (`.oct7-final-*.log`).
- Desktop, extension, Android and iOS Vite bundles pass; Capacitor Android sync passes.
- `android/gradlew.bat assembleDebug testDebugUnitTest` passes. Four new native inset tests cover bounded pages, partial overlap, keyboard overlap/dismissal, and side cutouts. Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`.
- Four extension journeys pass, covering header position at 360/400/1000px, balance privacy and PnL placement, plus existing media/detail/favorite/spam/mosaic workflows. The final header rerun also verifies the unpublished-artwork label. Screenshots: `test-results/portfolio-header-{400,1000}.png` and `test-results/nft-unpublished-metadata.png`.
- One mobile browser fixture passes: actual overlay/native bounds meet the measured wallet navigation strip after navigation-height changes, menu expansion, rotation and a keyboard-sized viewport. Only the native bridge is mocked; this checks layout, not device WebView rendering (`.oct7-mobile-browser-final.log`).
- ADB reported no connected phone and no emulator/system image is installed. Actual Android X/Minswap/dApp page behavior requires a phone check after installing the debug build. Browser fixtures and JVM tests do not prove Android WebView behavior on a device. Native iOS remains a CI validation step.
- No lint script is configured. Logs, APKs and screenshots are already gitignored.

## Changed files

Runtime: `src/main/{onchain-tokens,token-fetcher}.ts`; `src/renderer/types/wallet.ts`; `src/renderer/components/{NftImage.tsx,NftImage.css,NftMosaic.tsx}`; `src/renderer/pages/{DashboardPage.tsx,DashboardPage.css,ProfilePage.tsx}`; `src/capacitor/BrowserOverlay.tsx`; `android/app/src/main/java/info/chainlens/magicmoney/{DappBrowserPlugin,DappViewportInsets}.java`.

Tests: `src/main/token-fetcher.stale-metadata.test.ts`; `e2e/{nft-gallery,mobile-browser-viewport}.spec.ts`; `android/app/src/test/java/info/chainlens/magicmoney/DappViewportInsetsTest.java`. Coordination: `HANDOFF.md`, `HANDOFF_LOG.md`; this document and the NFT gallery overview.
