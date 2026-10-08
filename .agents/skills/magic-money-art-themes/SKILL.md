---
name: magic-money-art-themes
description: "Create, extend, or repair full art themes for Magic Money Wallet from project, NFT, or visual references, including textures, ornamental borders, buttons, typography, picker integration, and visual validation. Use for a complete material skin rather than a three-colour custom theme; adapting it to ChainLens requires inspecting that app's own theme system."
---

# Magic Money Art Themes

Create a selectable, reversible material skin across the wallet's shared renderer.
Use the requested project's art direction; Mallard stone/runes are an example,
not the default for every collection. Read [references/mallard-example.md](references/mallard-example.md)
when creating ornamental raster assets or investigating the known layout traps.

## Discover the current implementation

Locate the wallet checkout using its `AGENTS.md`, `package.json`, and
`src/renderer/theme.ts`; do not assume the runtime skill folder is the repo.
Read the project's instructions and current theme files before editing. In this
shared Claude/Codex project, resolve and use the local `agent-handoff` skill to
check status, Git drift, current ownership and newest journal, and claim the
appropriate scope. Preserve the user's existing work and authorizations.

The first implementation is in `docs/MALLARD-ORDER-THEME.md`. Check these seams
against current code, because this map describes the October 2026 implementation:

| File | Responsibility |
| --- | --- |
| `src/renderer/lib/builtin-themes.ts` | Theme IDs, definitions, `css`/`art` flags, palette matching and overrides |
| `src/renderer/lib/theme-tokens.ts` | Derived tokens for three-colour custom themes |
| `src/renderer/theme.ts` | Applying themes, `data-theme`/`data-derived`, persistence, preview, profile merge and window events |
| `src/renderer/pages/SettingsModal.tsx` | Built-in colours, Art themes tiles, user's colour themes |
| `src/renderer/themes/<id>.css` | Full material skin imported through `theme.ts` |
| `src/renderer/assets/themes/<id>/` | Bundled images, fonts and license notices |
| `src/renderer/components/{ChainCard,DexSwapWidget,SendModal}.tsx` | Actual portfolio, swap and send surfaces, including inline styles |
| `src/renderer/lib/builtin-themes.test.ts` | Shipped definition/token parity and custom-theme preservation |
| `e2e/art-themes.spec.ts` | Real extension selection, preview, persistence, layouts, Send and Swap journey |

Electron, extension, Android and iOS renderers share this theme manager. Use the
shared renderer rather than forking native UI or changing transaction code.

## Translate the reference into assets and materials

Inspect the actual reference or attached screenshots. Identify its surface
material, border motifs, button geometry, typography, palette and highlight level.
Make a coherent skin across portfolio cards, header/navigation, inputs, buttons,
settings and relevant dialogs/swap panels. A palette alone is insufficient.

For raster textures and carved artwork, resolve an available image-generation
capability and follow its instructions. References identify style; label an image
as an edit target only if the user actually wants that image modified. If raster
generation is unavailable, report the gap and produce useful authorized work;
do not imply assets were generated or silently switch to a credentialed API.

- Prefer separate frame and quiet surface assets; a nine-slice frame can scale
  to wallet cards without stretching corner eyes, runes, or other motifs.
- Bundle selected assets in the repository, not only a tool's output folder.
  Preserve generation provenance and prompt in a project document. Optimize
  production copies without overwriting source art unnecessarily.
- Bundle fonts locally with their licenses when allowed. Keep addresses,
  precise amounts and editable fields legible; ornamental display type is not
  automatically suitable for every financial value.
- Draw decorations inside existing boxes, or make overlay art non-interactive.
  Preserve tap targets, focus rings, scrolling, disabled states and error colours.
- Keep wallet/project brand identity unless the user requests replacement.
  Palette treatments of existing logos should be selected deliberately.

## Register and isolate the theme

Add a unique, CSS-safe `BuiltinThemeId` and `THEMES` entry with `css: true`,
`art: true`, `swatch`, and `colors`. The palette's `bg`, `accent`, and `text` must
match `--bg-deep`, `--accent`, and `--text-primary` in the default stylesheet.
Set the remaining RGB pairs, aliases, contrast tiers, radii and fonts coherently.

Import its CSS through the existing shared theme-loading seam. Scope material
and token rules to the selected ID and opt out of colour derivation:

```css
:root[data-theme='your-theme-id']:not([data-derived]) {
  /* Default tokens. */
}
:root[data-theme='your-theme-id']:not([data-derived]) .art-panel {
  /* Selected theme's material treatment. */
}
```

`data-derived` is set for custom-colour previews and recoloured built-ins. Let
the existing apply/clear/endPreview machinery restore the saved skin; leaking
textures, fonts or inline variables into another theme is a regression.

Present art skins separately from editable colour themes. They must not consume
custom slots. Preserve `matchingBuiltin()`'s exclusion of `art` definitions:
identical three colours do not prove a user's custom theme duplicates a full skin,
so such a theme must not be tombstoned or migrated automatically.

Art picker tiles need `grid-column: 1 / -1`, a selectable state, and accessible
selection semantics such as `aria-pressed`. For additional skins, keep common
layout in `.art-theme-card` but scope preview artwork/fonts to `.art-theme-<id>`.
The first tile hardcodes Mallard's descriptor and frame; generalize those parts
when adding another theme rather than letting every new tile preview Mallard.
The tile may preview its own art while another theme is active; this is distinct
from material rules for the app itself.

Inspect rendered component styles. Many wallet surfaces use inline CSS, so
global tokens alone may not change their materials. Reuse the existing
`.art-panel`, `.art-overlay` and `.art-swap` hooks or add narrowly scoped
presentation hooks. Use targeted `!important` only for inline properties that
actually need overriding. Preserve handlers, amount presets, validation and
approval semantics. Do not select panels by fragile serialized `style` strings.

## Validate the skin and preserve the existing wallet

Read current package scripts and tests. In this checkout the baseline commands are:

```text
npm run typecheck
npm test
npm run build:extension
npx playwright test e2e/art-themes.spec.ts --workers=1
npx electron-vite build
npx vite build --config vite.capacitor.config.ts
npx vite build --config vite.ios.config.ts
```

Update shipped-theme count/token-parity tests for the new registration and CSS
file. Test custom-palette preservation when changing absorption logic. The
project has no lint script in this snapshot; inspect current scripts instead of
inventing a lint result. Browser testing requires a fresh extension bundle.

Exercise real selection, selected-state display, reload persistence, switching
back to an existing theme, opening a custom-colour preview, cancelling it, and
returning to the saved art skin. Inspect portfolio/settings/Send/swap and other
surfaces materially changed by the reference. Fixtures may mock balances and
profile/provider replies; keep them offline/local where possible and never use
real signing or broadcasts to validate a visual theme.

Capture and review narrow-phone, normal-phone, and desktop screenshots (the
Mallard baseline uses 360, 400 and 1000px). Wait for fonts and finite animations.
Check full balances, addresses, labels, disabled/focus states, navigation,
scrolling and frame/content bounds. Assert important clipping/overflow fixes,
not just that the theme name or asset exists. Recheck other themes after changes.

Static success is not visual acceptance. Compare screenshots with the reference,
fix material discrepancies and repeat the affected checks. Distinguish renderer
bundles, browser fixtures, native builds, installed-device QA and user acceptance.
If native sources change, follow the project's real native-build gates.

## Leave a portable result

Record implementation paths, asset/font provenance and prompts, reviewed
screenshots, exact checks and remaining limitations. Update the handoff board's
skill mapping and journal through the resolved handoff workflow, then release
ownership when finished. Skill use does not itself authorize commits, pushes,
deployments, app installation, signing or broadcasts. For ChainLens adaptation,
inspect its own theme engine and persistence before applying the visual language.
