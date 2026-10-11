# Palette finishes

The existing colour-theme surface is named **Glass**, now refined to feel translucent. Appearance now separates
palette selection from a local finish preference: **Glass**, **Flat**, **Fine
Grain**, or **Soft Fade**. Glass now uses palette-tinted fills at 22% opacity, 22px backdrop blur and subtle
edge reflections. Two-tone controls the tint independently of the finish.
A separate Two-tone surfaces switch works with every finish, including Glass.
It defaults on for slightly raised card colours; off uses the page colour for
neutral cards. Soft Fade has a visible smooth diagonal highlight-to-shade gradient. They preserve typography, original logos, layout, precision,
accent fills, semantic colours, inputs and disabled controls. The small-screen
toolbar uses 30px buttons / 3px gaps so the full portfolio amount fits at 360px.

The user rejected the initial regular material patterns and requested flat,
colourable finishes instead. Leather, velvet, wood, metal, stone, plaid and denim
are no longer choices in this picker. Any future realistic material skin should
have its own natural fixed palette and be presented separately as an art theme,
without recolour controls. No new realistic material skin ships in this change.

## Ownership and storage

- `src/renderer/lib/textures.ts` owns the catalogue, allowlisted IDs, preference
  (`mm.texture.v1`, `mm.surfaces.two-tone.v1`), current surface identity and same-origin window updates.
- `src/renderer/theme.ts` applies the finish after palette/preview application.
  Original art themes suspend it; recolours and custom previews can use it.
  Cancelling a preview restores the saved art/colour identity and its finish.
- `src/renderer/components/TexturePicker.tsx` exposes the independent preference.
- `src/renderer/themes/textures.css` applies presentation without changing handlers.
- `src/renderer/assets/themes/finishes/grain.svg` is an original deterministic,
  sparse neutral dot pattern; no third-party textures or new dependencies.

No profile wire schema changes. Like the active colour selection, the finish is
saved per install, not synced to a profile. Custom palette/recolour sync and its
six custom slots are unchanged. Invalid/obsolete finish IDs fall back to Glass;
blocked storage retains the session's selection.

ChainLens has the same four choices and SVG, implemented in `public/texture-engine.js`,
`public/textures.css` and the existing eligible-account theme picker. Its preference
is `cl_texture.v1`, with `cl_surfaces_two_tone.v1` for two-tone and the existing palette access gate. Light Search hero text
uses light-mode tiers when the panel adopts the light page fill.

## Validation

- Wallet: five-target `npm run typecheck`; 166 files / 2442 unit tests; extension,
  desktop, Android-web and iOS-web renderer bundles. Native apps not installed.
- `e2e/textures.spec.ts`: real isolated extension journey, all twelve colour
  palettes, all new finishes, matching/layered background/card fills, independent two-tone including Glass, 360/400/1000px
  bounds and visible amount, disabled Send, Swap, preview cancellation, original
  art suspension, selection persistence and Glass restoration.
- ChainLens: `npm run check`, 193 Node tests, `node --check public/texture-engine.js`;
  two new browser journeys across 360/900/1400px, palette/custom selection,
  reload, art/editor lifecycle and signed-out gate. Light hero contrast asserted.
  The fixture exercises the existing production precompiler to avoid an unavailable
  external Babel script; the first CDN-dependent run did not finish successfully.
- Soft Fade does not restart its gradient inside the wallet portfolio summary.
- Reviewed screenshots: `.local-artifacts/textures/`; logs `.texture-*.log`.
  No commits, deployment, package installation, signing or broadcasts.

Natural material candidates were generated with the built-in image-generation
tool during exploration, then discarded from the shipped finish set. Original
images and exact prompts remain locally in
`.local-artifacts/textures/material-exploration/` for a future fixed-palette skin;
they are ignored and not bundled. The optional textures.com reference was not used.

## Clear Glass refinement

User rejected the first frosted pass as insufficiently translucent. Glass now
uses clear 22% tinted panels, stronger curved rim highlights, layered reflections,
22px blur and saturation, with quiet palette-coloured ambient light behind the
panels so transparency is visible. Two-tone controls the underlying tint; art
skins suspend these rules. This is a CSS approximation, not Apple native optical
refraction. No SVG displacement shader or additional dependencies. Reference:
https://developer.apple.com/videos/play/wwdc2025/219/
