# r3tards art theme for Magic Money

The shared wallet renderer now includes `r3tards` in **Settings → Appearance → Art themes**. It matches the ChainLens collab: the exact purple doodle background, Schoolbell headings, IBM Plex Mono labels, black outlines and white pill buttons. Existing Magic Money/Magic Swap line art remains smooth, with a neutral grayscale treatment for the wordmarks and swap icon. The original corner logo is retained.

## Implementation and assets

- `src/renderer/lib/builtin-themes.ts`: registers `r3tards` with `css: true`, `art: true` and the same `#493259 / #ffffff / #ffffff` palette as ChainLens.
- `src/renderer/theme.ts`: imports `themes/r3tards.css` through the existing shared theme seam.
- `src/renderer/themes/r3tards.css`: scoped token/material rules, independent picker preview, quiet purple Portfolio/Settings/Send/Swap surfaces, pill controls, navigation and smooth logos.
- `src/renderer/assets/themes/r3tards/`: byte-identical copies of ChainLens's approved background, project icon, three font files and license notices. Background originally supplied as `C:/Users/balla/Downloads/PC.webp`; fonts/icon are from the project's public site. See [ChainLens provenance](../../chainlens/docs/R3TARDS-THEME.md) for original URLs and provenance.

Schoolbell uses Apache 2.0 (`LICENSE-Schoolbell.txt`); IBM Plex Mono uses SIL OFL (`OFL-IBMPlexMono.txt`). Assets are bundled locally in all renderer targets; no runtime request to the project site is needed. No art was generated or edited during this port.

All material rules opt out with `:not([data-derived])`. Custom-colour preview/recolour uses the existing derived palette; cancelling/reverting restores the saved skin. Colour-only custom themes with matching palettes remain distinct and are not absorbed. Both products now recognize the same built-in ID and reserved recolour key through their existing profile theme wire format.

Precision amounts/addresses use monospace. Chain artwork, NFTs and success/error meaning remain intact. This changes shared presentation only; signing, vaults, transactions, browser viewport logic and platform-native sources are untouched.

## Verification

`builtin-themes.test.ts` covers all 15 definitions, default CSS/palette parity and custom-theme preservation. `e2e/art-themes.spec.ts` includes all three skins, with r3tards checks for selection, reload, Settings, 360/400/1000px Portfolio, Send, Swap, original smooth logos, custom preview cancellation and switching back to other themes.

Final checks on 2026-10-08: five-target `npm run typecheck`; all 165 files/2,440 unit tests; desktop, extension, Android-web and iOS-web renderer bundles; all three art-theme browser journeys passed. The r3tards journey passed again after the final balance-width/tab-shape refinement. The full balance and chart bounds were checked at each width, and screenshots were reviewed. Copied assets byte-match ChainLens's originals; `git diff --check` passes.

Reviewed screenshots are retained under `.local-artifacts/r3tards/`. Renderer bundle/browser verification is local; it does not prove an installed Android/iOS app or live profile synchronization. No commit, installation or release is performed by this task.


## Portfolio position refinement

The portfolio keeps the stock summary on the left and toolbar/chart on the right at every viewport width. The theme no longer stacks the header below 600px or creates a separate lower toolbar row. Its black 3px border has an 8px inner inset and 8px bottom margin to keep text and controls away from the edges.

Only narrow fit adjustments remain: responsive 11-22px amount text; below 400px the toolbar buttons are 30px wide rather than 34px, gaps are 3px rather than 5px, and update text is 10px. No action order, handlers or chart placement changed. `HeaderToolbar.tsx` adds a presentation class for targeting the icon row without affecting the network selector or other themes.

The art-theme browser journey asserts side-by-side summary/tool geometry and full visible balances at 360/400/1000px. Portfolio, Send, Swap, theme switching and persistence are reviewed through local fixtures. Rebuilt renderer bundles do not install or update a running native app automatically.


## Transparent brand bar

The wallet titlebar and extension brand banner are transparent. The separate browser shell carries the same local collage so its transparent titlebar reveals artwork too; the address bar and bottom navigation retain their readable surfaces. Original smooth Magic Money logos have full opacity and modest brightness/soft highlight and dark shadow to stay visible against the collage. Custom-colour previews and other themes remain excluded by the existing selectors.

The existing art journey checks transparent header backgrounds. A local isolated Electron browser fixture confirms the actual browser renderer has transparent titlebar colour and collage shell material, with its header screenshot saved in `.local-artifacts/r3tards/r3tards-browser-transparent-topbar.png`. No real wallet profile is used or modified.
