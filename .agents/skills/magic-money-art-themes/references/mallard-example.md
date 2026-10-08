# Mallard Order example and failure lessons

This is a working example from October 8, 2026, not a universal aesthetic or a
substitute for current source inspection. The user approved the look and shared
a running-wallet screenshot. Native QA is not inferred from that screenshot.

## Reference and art direction

The user provided https://trial.mallardorder.io/ and screenshots showing dark
stone panels, broad carved borders, watching eyes and runes, ivory serif text,
weathered bronze/gold accents and beveled stone buttons. The web tool could not
read the site, so the provided screenshots supplied the visual reference.
Magic Money kept its own wallet brand and chain/token identities.

Example palette: background `#10100e`, accent `#c6a75e`, text `#eee8d5`.
Headings use local Cinzel; prose uses local EB Garamond. Financial inputs and
addresses retain practical sans/mono fonts. Both font families include OFL
notices beside their assets. Green/red financial and status signals remain
distinct from decorative gold.

Find the implementation in the wallet checkout:

- `docs/MALLARD-ORDER-THEME.md`: exact original prompt and artifact provenance.
- `src/renderer/themes/mallard-order.css`: token and material rules.
- `src/renderer/assets/themes/mallard-order/{frame,stone}.webp`: production art.
- `e2e/art-themes.spec.ts`: interaction and screenshot journey.
- `test-results/mallard-*.png`: local generated previews, if still present.

## Reusable frame prompt pattern

Adapt the material, motifs and proportions to the requested reference. Explicit
layout constraints helped produce a usable asset rather than a mockup containing
unwanted text or scenery:

> Production UI nine-slice frame texture. One perfectly square, flat orthographic
> frame, filling the image edge to edge with no outside margin. A narrow ornamental
> border within the outer 10 percent of all four sides. The central 80 percent is
> uninterrupted finely textured, very dark charcoal slate, quiet enough for UI
> text. Symmetric weathered black stone, interlaced carved vines and angular rune
> glyphs incised in dull bronze, with watching-eye motifs only in the four corners.
> Shallow sculpted bevels, restrained warm gold highlights and deep incisions.
> No perspective, scene, text, logos, center objects, bright colours, glossy metal
> or floating border. Keep elaborate corner details within the corner regions;
> straight middle border portions should tile cleanly. Matte hand-carved stone.

The generated original was converted to WebP; its quiet center provided a cropped
stone texture. This was asset preparation, not an attempt to change the reference
image. Generation tools and their asset-preparation rules differ; use the current
capability's supported workflow. Preserve a project-referenced local asset and
prompt even when the original generation output lives elsewhere.

## Nine-slice implementation

Mallard used a measured `11%` slice and `round` repeat. These values are specific
to the generated asset; inspect the next asset before choosing its slice.

```css
border-image: url('../assets/themes/mallard-order/frame.webp')
  11% fill / 19px / 0 round;
```

`fill` paints the quiet center as well as the border. `round` repeats border
segments across different panel dimensions. Preserve carved corners with
appropriate slicing, rather than stretching a full-frame PNG behind every card.
Make content padding large enough for the painted border. Mallard portfolio
cards ended at 19px painted borders and 24px padding; smaller settings/picker
frames and inline swap/Send panels use their own dimensions.

## Failures that changed the implementation

- **Colour-only architecture was insufficient.** A shipped `art: true` skin and
  separate Art themes group preserve the distinction from three-colour customs.
- **Picker tile collapsed into a swatch column.** The picker is a multi-column
  grid. `width: 100%` alone fills one column; the full tile needs
  `grid-column: 1 / -1`.
- **Inline Send button styles won over the stylesheet.** Inspect actual styles;
  add presentation hooks or tightly scoped overrides rather than broad rules on
  all wallet buttons. Retain warning, disabled and focus behavior.
- **Larger borders reduced content width.** A fixed 300px chain SVG crossed the
  new frame at 360px. Mallard scales the complete SVG to `.82` below 380px, and
  asserts its bounding box is inside the frame. This retains every plotted point.
  Do not fix a financial chart by hiding overflow, dropping points or narrowing
  the viewport without a suitable viewBox. Measure a fresh theme's layout rather
  than copying the scale blindly.
- **The narrow header truncated the total.** Mallard stacks summary/tools below
  380px and asserts the total's `scrollWidth <= clientWidth`. Reducing font size
  until the clipped string looks plausible is not a full-value verification.
- **Immediate screenshots looked dim.** Existing fade animations were still
  running. Await local fonts and finite animation completion before review;
  exclude infinite spinners/pulses from that wait.
- **Headless extension startup stalled on this machine.** The existing harness
  succeeded with `chromium.launchPersistentContext({ headless: false, ... })`.
  Reuse the current project's known working configuration; this is not a claim
  that all Chromium headless extension sessions fail.
- **A fixture response crashed the mounted wallet.** `journeyList()` expects
  `{ ok: true, value: { active: [], unreadable: [] } }`, not a raw array or
  `{ journeys: [] }`. Read the current API/types when mocking; capture page errors
  so a fixture problem is not mistaken for a theme regression.
- **An exact palette could destroy a custom theme.** `matchingBuiltin()` excludes
  `art` entries. Palette equality alone cannot justify tombstoning a user's
  colour-only custom theme or moving their selection onto a material skin.

## Evidence boundaries

The initial final checks passed five TypeScript targets, 165 unit-test files /
2,438 tests, one real-extension art-theme browser journey, and desktop,
extension, Android-renderer and iOS-renderer bundles. These counts are historical,
not acceptance targets for the next theme. Browser checks used a disposable test
wallet and mocked balances/profile/provider replies; they did not validate
native apps, deployed code, quote execution or settlement. No app install,
commit, push, signing, broadcast or deployment was part of this theme task.
