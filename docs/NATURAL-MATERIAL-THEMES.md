# Natural material themes

Approved comparison: `exec-5f421c4b-422f-4503-803d-7d02867c41ec.png`, generated with the built-in imagegen tool. User approved all five and changed silk to royal blue.

Five standalone fixed-palette skins in Art & material themes: Brushed Metal, Leather, Velvet, Walnut, Royal Blue Silk. Shared generated raster surfaces, coordinated lightly raised cards, recessed inputs and restrained edges. No palette recolouring; existing colour finishes and two-tone preference are remembered while suspended. Stock portfolio geometry and smooth original logos retained; brand chrome and portfolio summary remain transparent with no dividing line.

Wallet: `src/renderer/themes/materials.css`, imported by theme.ts, definitions in builtin-themes.ts; raster assets in `src/renderer/assets/themes/materials/`. ChainLens: `public/themes/materials/theme.css`, registered in theme-engine.js and index.html. Generic ornamental art selectors now explicitly select the original three art IDs, preventing frame padding from affecting material layouts.

## Asset provenance

Built-in imagegen, October 10 2026. Original PNGs preserved under `C:/Users/balla/.codex/generated_images/01a11d2c-bf18-7e32-9d61-a1bc7f76ec57/`. Production copies converted to RGB, resized to768square and encoded WebP quality86; byte-identical in both applications. No external texture source.

Exact full prompts and source filenames: `provenance.json` beside each application's material assets. Rendering uses `cover` without repetition to prevent generated edge seams.

## Generation direction / prompt set

All five: production square full-bleed orthographic realistic material scan, seamless tileable edges, evenly lit, no objects/borders/UI/text; quiet low-contrast surface suitable behind financial typography.
- Brushed Metal: dark satin titanium, fine horizontal authentic machining micrograin, blue charcoal steel around #202e38, restrained silver sheen, no scratches/glare.
- Leather: premium dark espresso fine-grain leather around #352215, small irregular pores, light pebbling, subtle patina and soft diffuse matte sheen, no seams/stitching in raster.
- Velvet: deep aubergine plush velvet around #270e2d, incredibly fine dense soft pile, gentle nap variation, tiny plum highlights, no obvious weave or folds, matte rather than satin.
- Walnut: dark walnut around #382313, small horizontal flowing natural grain, warm brown/cocoa bands, softly oiled satin finish, no planks/knots/joins.
- Silk: rich royal blue silk satin around #122b72 and #234daa, fine woven silk, subtle broad diagonal flowing lustre, shallow natural drape, no large folds or bright highlights/purple/cyan.

## Validation

Wallet: `npm run typecheck` passes all five targets; `npm test` passes166files/2449tests. Extension, Electron, Android and iOS renderer bundles pass (`.materials-*-final.log`, extension `.materials-extension-last.log`). All5 art/material/finish journeys pass (`.materials-browser-last.log`); final material journey after the narrow logo correction passes (`.materials-browser-final.log`). All five skins reviewed at360/400/1000px with populated portfolios and Send/Swap; no horizontal/full-balance clipping, smooth non-cropped banner logos, transparent summary, no top brand divider. Custom preview cancellation/reload and restoration of palette finishes verified.

ChainLens:193Node tests and `npm run check` pass. All18 final browser tests pass in `.materials-browser-final.log`: all5skins Search/Scanner/Swap at360/1400, fixed palette rejecting supplied overrides, editor unavailable, reload, signed-out gate, palette/custom editor lifecycle and original Mallard/Sealuminati/r3tards regressions. Updated old picker tests to current21theme count, explicit Flat for palette-only assertions and production precompile rather than runtime CDN Babel.

Screenshots in `.local-artifacts/materials/`, including wallet `materials-wallet-comparison.png`. All5 production WebP assets hash-identical between apps. No signing/broadcasts used. Local renderer/browser validation only, no native-device, installation or deployment claim.
