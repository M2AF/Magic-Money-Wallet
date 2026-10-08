# Mallard Order art theme

Select **Settings → Appearance → Art themes → Mallard Order** in a build containing this change.

This first art theme uses charcoal stone, carved bronze runes and corner eyes,
antique gold, ivory text, Cinzel headings and Garamond body text. It changes
portfolio cards, navigation, settings, Send dialogs, DEX Pay/Receive panels,
buttons and fields. Addresses and editable amounts retain practical fonts.
The wallet brand remains Magic Money. The reference is the user's screenshots
of https://trial.mallardorder.io/; this is original generated artwork rather
than a copy of that site's assets.

Art themes are separate from editable colour themes. They use the same saved
selection and window synchronization, consume no custom slots, and are removed
cleanly during colour previews and when another theme is selected. A custom
colour theme with the same palette is preserved: palette equality cannot prove
that it duplicates an art theme. No ChainLens theme is added in this change.

## Implementation

- `src/renderer/lib/builtin-themes.ts`: `art` theme classification and shipped entry.
- `src/renderer/theme.ts`: imports the isolated theme stylesheet.
- `src/renderer/pages/SettingsModal.tsx`: separate full-width art-theme tiles.
- `src/renderer/themes/mallard-order.css`: scoped tokens, materials and component treatments.
- `src/renderer/components/{DexSwapWidget,SendModal}.tsx`: presentation hooks for inline-styled surfaces.
- `src/renderer/assets/themes/mallard-order/`: generated WebP frame/stone and local OFL fonts/licenses.
- `src/renderer/lib/builtin-themes.test.ts`: table/token parity and preservation of colour-only customs.
- `e2e/art-themes.spec.ts`: real extension journey using a disposable test wallet and fixture balances/profile replies.

The generated frame uses CSS nine-slice borders, with no interactive overlays.
Every material selector is guarded by the theme ID and `:not([data-derived])`.
Theme assets are bundled through Vite. Neither artwork nor the new fonts need
a network request at runtime. Existing wallet transaction logic is unchanged.

## Validation and previews

Run `npm run typecheck`, `npm test`, `npm run build:extension`, then
`npx playwright test e2e/art-themes.spec.ts --workers=1`.
Other renderer checks use `npx electron-vite build` and
`npx vite build --config vite.{capacitor,ios}.config.ts`.
There is no lint script in this project.

Browser checks cover selection, reload persistence, preview cancel, switching
to Midnight, Send dialog fields/disabled fee estimate, and swap navigation.
At 360px the header stacks to preserve the full total, and the complete chain
SVG scales to stay inside its frame; browser assertions guard both bounds.
Screenshots wait for local fonts and finite animations. Test data is simulated;
these checks do not sign or broadcast transactions or validate native apps.

Local screenshots: `test-results/mallard-portfolio-{360,400,1000}.png`,
`test-results/mallard-settings-400.png`, `test-results/mallard-send-400.png`,
`test-results/mallard-swap-400.png`. Check logs: ignored `.rune-*.log`.

## Artwork provenance and prompt

Generated using the built-in imagegen tool. The source is retained at
`C:/Users/balla/.codex/generated_images/01a11d2c-bf18-7e32-9d61-a1bc7f76ec57/exec-ae0af1b2-6548-46aa-845e-72b207c2b657.png`.
WebP conversion and a center texture crop prepare it for the wallet.
Fonts come from Google Fonts; their OFL notices are beside the assets.

Prompt: Use case: stylized-concept. Asset type: production UI nine-slice frame
texture for a dark fantasy rune wallet theme inspired by ancient occult carved
stone game UI. Generate one perfectly square flat orthographic frame, fills the
entire image edge to edge, no outside margin. A narrow ornamental border exactly
within the outer 10 percent on each of the four sides; the central 80 percent is
uninterrupted finely textured very dark charcoal slate, nearly black, quiet enough
to lay readable UI text over it. Symmetric weathered black stone carved interlaced
vines, angular rune glyphs incised in aged dull bronze, small carved watching-eye
motifs ONLY in the four corners. Shallow sculpted bevel relief, restrained warm
gold highlights from above, deep shadowed incisions. NO perspective, NO scene,
NO text, NO letters, NO logos, NO objects inside center, NO bright colors, NO glossy
metal, NO floating border. The straight middle portions of every border must tile
cleanly for CSS border-image repeat; keep all elaborate corner details within the
outer 10-percent square corner regions. Matte realistically textured hand carved
dark stone with subtle aged bronze. Game UI material, crisp border detail.

October 8 follow-up: removed the under-logo gold divider from both shared
header variants (titlebar and extension brand banner); navigation trim remains.
Desktop/extension builds and both browser theme journeys passed; screenshots
reviewed after removal.
