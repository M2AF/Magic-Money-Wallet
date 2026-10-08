# Sealuminati art theme

User-approved October 8, 2026: darker purple pixel robes, embroidered gold rune
trim, violet-flame torch corners, and a small hooded seal crest. Select it in
Settings > Appearance > Art themes. This is a full material skin, separate from
the existing Sappy Seals colour theme and the user's six custom colour slots.

## Implementation

- `src/renderer/themes/sealuminati.css`: scoped tokens, nine-slice torch frame,
  cloth surfaces, square beveled buttons, pixel type, settings, Send and Swap.
- `src/renderer/assets/themes/sealuminati/`: lossless WebP artwork and locally
  hosted Pixelify Sans regular/bold fonts with the SIL OFL notice.
- `src/renderer/lib/builtin-themes.ts` and `src/renderer/theme.ts`: registration,
  stylesheet import, existing persistence and preview lifecycle.
- Art tiles have per-theme descriptions and preview materials; Mallard keeps
  its stone artwork regardless of the selected theme.

Default palette: background `#120b24`, panels `#1b1033`, buttons `#251640`,
gold `#ffd34d`, primary text `#f4e9f6`. Success and loss remain green/red.
Addresses and editable financial fields retain the practical monospace font.
Original Magic Money and Magic Swap artwork keeps smooth image rendering;
CSS uses Mallard-style grayscale/sepia gold toning that preserves the original
shading and highlights. The initial solid alpha tint flattened the swap emblem;
user feedback restored its original dimensional artwork with a warm gold tone.
Pixel rendering of the branded wordmark
caused missing strokes in the initial preview and was corrected following
the user's running-wallet screenshot.

Frames draw inside existing panel bounds. Crest decorations ignore pointer
events. Theme rules opt out of `data-derived`, allowing custom colour previews
and other themes to restore their own material and typography. No transaction,
signing, provider, or native code changes.

## Artwork provenance

Built-in image generation used the approved darker mockup as a visual reference.
Originals remain in `C:/Users/balla/.codex/generated_images/01a11d2c-bf18-7e32-9d61-a1bc7f76ec57/`:

- Approved mockup: `exec-edb1801b-89ca-4eee-8be9-1ce972c87ee3.png`.
- Generated frame: `exec-6c3c5d8b-dbe4-49db-935e-f5ef0aaf1f10.png`.
- Generated transparent crest: `exec-7667d260-6487-4664-aeea-5543a1081a2d.png`.

Frame prompt: one square, straight-on, edge-to-edge UI frame; authentic chunky
low-resolution pixel art; quiet dark aubergine robe fabric center; gold
embroidered geometric rune trim on four edges; small violet flame torches
entirely within outer 15 percent at four corners; quiet inner 70 percent;
repeatable thin gold rune braid; no text, logos, characters, UI, perspective,
rounded curves or smooth gradients; flat pixel texture and square geometry.

Crest prompt: recreate only the small friendly hooded seal head from the
approved reference; transparent background, centered square, crisp pixels,
front-facing off-white smiling face, black eyes, deep indigo-purple hood and
thick yellow-gold embroidered trim, cropped shoulders; no torch, text, coins,
UI, outer frame or glow; flat palette with dark outlines; usable at 32–48px.

Production conversion uses nearest-neighbor resizing: frame 256 square,
crest alpha-bounds crop to 128 square, quiet middle 50-percent crop of frame
to 128 square cloth tile; all encoded lossless WebP. Originals are preserved.

Fonts: Pixelify Sans from Google Fonts, regular/bold TTF, license from
`https://github.com/google/fonts/blob/main/ofl/pixelifysans/OFL.txt`.
No runtime font or artwork requests.

## Validation

- `npm run typecheck`: all five target configurations passed.
- `npm test`: 165 files, 2439 tests passed.
- Extension, Electron renderer, Android web and iOS web builds passed.
- `npx playwright test e2e/art-themes.spec.ts --workers=1`: Mallard and
  Sealuminati journeys, including selection, reload persistence, custom preview
  cancel, switching both art skins and Midnight, Send disabled state, Swap,
  total/chart bounds and no page errors.
- Reviewed `test-results/sealuminati-{portfolio-360,portfolio-400,portfolio-1000,
  settings-400,send-400,swap-400,titlebar-400}.png`. Titlebar screenshot exposes
  the shared desktop header in the extension fixture to inspect its wordmark;
  this does not constitute Electron or installed-device QA.

These are local renderer and browser checks. No native build/install, commit,
push or deployment performed. Native-device review remains separate.

October 8 follow-up: removed the under-logo gold divider from both shared
header variants (titlebar and extension brand banner); navigation trim remains.
Desktop/extension builds and both browser theme journeys passed; screenshots
reviewed after removal.

October 8 seal placement follow-up: browser crest peeks above the left side of
the URL field, with the field covering its lower robe pixels. User approved
that placement. Wallet crest now peeks above Collectibles and is mirrored
horizontally;24px of space keeps it clear of the portfolio chart. Original
corner Magic Money logo is restored with smooth rendering. Decorations ignore
pointer events; browser chrome height and native viewport logic are unchanged.
