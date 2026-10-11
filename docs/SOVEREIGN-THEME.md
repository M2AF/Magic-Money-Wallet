# Sovereign — premium kinetic wallet theme

A fixed palette art theme at the top of Art & material themes: obsidian, smoked crystal, champagne metal and a restrained cool iridescent cast. Financial content stays crisp; original smooth logos and stock summary/tools positions are retained. No transaction or provider behavior changes.

Sovereign is now REDACTED holder-only on Robinhood mainnet. See [SOVEREIGN-HOLDER-ACCESS.md](SOVEREIGN-HOLDER-ACCESS.md) for eligibility, account lifecycle and current gate verification. The motion controller remains presentation-only; the separate ownership reader performs read-only RPC checks.

## Visual system

- Original local orbital SVG: three elliptical tracks, a faceted central prism and three small celestial marks. Slowly rotates behind translucent cards, with a separate ambient conic light field.
- Original crown crest SVG in the picker; geometric and spare rather than ornamental stone/pixel art.
- Smoked card lenses, thin champagne/cool-metal highlights, warm primary actions, editorial Garamond headings and precise Inter/tabular balances. Existing bundled OFL fonts reused.
- Swap asset lenses are individually framed; the outer widget remains transparent.
- Brand chrome matches its background without an under-logo divider.

## Motion and interaction

Browser follow-up: the production detached BrowserApp uses a `browser-toolbar` hook with translucent pointer-local reflections. Ambient orbit/light remains visible through the chrome. `e2e/sovereign-browser.spec.ts` serves the actual Electron renderer bundle with mocked bridge and ownership RPC; verifies holder gating, pointer response, enabled-button press rings, live reduced motion and scene removal on wallet lock. Screenshot `.local-artifacts/sovereign/browser.png`. This covers wallet-owned chrome, not third-party web page contents or native WebContentsView composition.

The renderer's presentation-only controller creates exactly one inert, aria-hidden, pointer-transparent scene. Pointer movement is coalesced into one animation-frame callback and updates the ambient light plus the nearest card's local reflection. Touch scrolling remains native. Pressing an enabled button creates a650ms noninteractive ring, bounded to six concurrent rings. No click handlers, timers, network or wallet data access are added.

Motion uses CSS transform/opacity animation. Reduced-motion is observed live; the static material remains, and scene/entry/hero animations and press rings stop. Browser visibility pauses ambient motion and removes pointer listeners. Theme changes, derived previews and cancellation remove/restore the scene and clear styles/listeners. Init is idempotent; it exposes a disposer for lifecycle cleanup. All material CSS opts out of data-derived. Existing fixed-palette and custom-slot rules apply.

## Source paths

- src/renderer/themes/sovereign.css
- src/renderer/lib/sovereign-motion.ts
- src/renderer/assets/themes/sovereign/{orbit,crest}.svg (original vectors created for this theme; no remote artwork)
- src/renderer/lib/builtin-themes.ts and theme.ts
- e2e/sovereign.spec.ts; existing art journeys remain regression coverage

## QA

The real extension journey uses a disposable local wallet and mocked balances/providers. It checks360/400/1000px layout, full balances, chart and logo bounds, pointer-light movement, a press ring, disabled Send fee estimation, Swap, live reduced-motion, simulated browser visibility, custom preview cleanup/restoration, switching to Grape, and reload persistence. No signing or transaction submission is tested or authorized. Runtime screenshots/motion frames in .local-artifacts/sovereign/; logs .sovereign-*.log.

Wallet only in this iteration. Renderer bundles do not prove installed native-device performance. No commit, app installation or deployment performed.

Verified Oct10: five TypeScript targets;166 files/2452 unit tests; extension/Electron/Android renderer/iOS renderer final bundles; all5 browser journeys (four existing NFT skins plus Sovereign) pass. Screenshots reviewed after the Swap/heading refinement. Browser fixture proves motion/lifecycle, not native-device frame rate. GIF is actual pointer-light screenshots, not a fabricated rendering. No lint script exists in this checkout.
