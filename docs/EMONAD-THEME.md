# Emonad tarot art theme

Emonad is immediately above r3tards in the Art themes picker. Deep muted purple, antique ivory/silver, flat black roses, thorn vines, crescents and eight-point stars follow the supplied tarot back. Stock portfolio positions and smooth original wallet/swap brand artwork are preserved. Quiet framed interiors keep balances, addresses and controls legible. Existing colours/custom slots and unrelated NFT themes remain independent.

## Artwork

- Official project: https://emonad.lol/emo.html
- Tarot reference: https://emonad.lol/tarot/
- Exact original supplied card and character: https://emonad.lol/tarot/card-back.jpg. Bundled unmodified as card-back.jpg; darkened via CSS in the backdrop and displayed in the picker thumbnail. Third-party collaboration reference supplied/selected by the user; no additional license claim.
- Adapted frame generated from this reference using imagegen, source: C:/Users/balla/.codex/generated_images/01a11d2c-bf18-7e32-9d61-a1bc7f76ec57/exec-2574e9e3-3152-490c-b7b0-e0ae82d031bc.png. Production copy resized to768x768 WebP quality91. Nine-slice22%, painted20-22px inside panel bounds.
- Fonts reuse locally bundled Cinzel (existing OFL notice); financial values and fields retain readable mono/sans typography.

## Implementation

Wallet: src/renderer/themes/emonad.css; src/renderer/assets/themes/emonad/; builtin-themes.ts and theme.ts. ChainLens: public/themes/emonad/; public/theme-engine.js, public/art-themes.css and public/index.html. Existing application lifecycle removes the skin for derived colour previews and restores it on cancel/revert. No transaction/provider handlers changed.

## Validation

Order checked in both shipped tables and real pickers. Browser journeys cover selection/reload, phone and desktop bounds, Search/Portfolio, Send/Scanner, Swap, smooth logo rendering and transition to/from colour themes. Results and reviewed screenshots: .emonad-*.log and .local-artifacts/emonad/. Build/test status will be appended after verification. Local renderer implementation only; no deployment, commit or installed native-device validation.

## Frame generation prompt

Use case: production UI asset, not a screenshot. Emonad tarot card STYLE REFERENCE ONLY. Perfectly square flat orthographic nine-slice ornamental border, edge to edge. Narrow border; flat hand-drawn ink: muted dusty purple, near-black print, aged ivory-silver lines, twisting thorn vines, black roses, crescent sequences, small eight-point silver stars in black corner medallions. Quiet dark desaturated plum centre with subtle paper grain. No character, letters, logo, skulls, neon, gold, relief bevel, perspective or scenery. Fine legible wallet card borders; straight edges scale cleanly and ornaments stay out of the usable centre.

Verified Oct10: Wallet five-target typecheck;166 files/2451 unit tests; extension, Electron, Android renderer and iOS renderer bundles; Emonad real extension journey at360/400/1000px. ChainLens193 unit tests, npm check, production JSX precompile, full14 picker tests; final silver-logo and expanded Profile/App Hub/Market checks rerun. Screenshots inspected; no native app install or live deployment.

Final ChainLens correction: silver brand filters and Emonad Profile/App Hub/Market coverage pass. One access-loss reload exceeded the prior5s fixture expectation; the existing async control expectation now allows30s like the initial reload. Final Emonad journey passes in21.8s (.emonad-browser-reload.log). No application behavior change for this test timing adjustment.
