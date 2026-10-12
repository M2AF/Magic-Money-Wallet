# Mint & Money colour preset

On October 12, 2026, the user requested removal of the default Sappy Seals colour theme in both products, reserving that project for a future art design. Its default slot is now **Mint & Money** (`mint-money`).

The palette was read directly, read-only, from `public.cl_themes.entries` for the requested ChainLens ID `ec18dcf5-3271-46fd-8029-41e5b2f39eed`. The live source is `custom-7aovlrf0py`, named Mint & Money:

| Token | Hex |
| --- | --- |
| Background | `#0c1e19` |
| Accent | `#30ffae` |
| Text | `#e8f4ff` |

`src/renderer/lib/builtin-themes.ts` and ChainLens `public/theme-engine.js` ship this same palette as a normal, recolourable colour preset. It supports the existing colour finishes and two-tone rules. No collection ownership gate or art/material flag is attached. The shipped count remains 24; colour presets remain 12. The Sappy Seals project/app entry and assets were not removed.

Saved `mm.theme` and `cl_theme` selections of the retired `sappy-seals` palette migrate to `mint-money`. The wallet also handles the old ID arriving from another window; ChainLens's main and docs pickers use the same ID migration. Retired built-in recolours do not overwrite the new Mint palette. The wallet's existing exact-colour custom-copy promotion migration advances to version2, so cached duplicates of the now-shipped Mint palette can use the standard absorption flow. Unrelated custom themes remain unaffected. No database records were edited during this task.

The old palette ID is retained only as a migration input. A future Sappy Seals art design should use a distinct ID, such as `sappy-seals-art`, so legacy palette selections do not silently activate an art theme.

Validation logs: `.mint-money-typecheck.log`, `.mint-money-unit.log`, `.mint-money-extension.log`, `.mint-money-desktop.log`, `.mint-money-android-web.log`, `.mint-money-ios-web.log`, `.mint-money-browser.log`; ChainLens `.mint-money-check.log`, `.mint-money-unit.log`, `.mint-money-browser.log`. Screenshots: `.local-artifacts/mint-money/` in each product. Tests verify the exact palette, preset removal/count, legacy selection persistence, no old override carry-over, colour editing/revert and wallet theme switching.

Changes are local. No commit, deployment, release or phone installation was performed. All users receive the replacement after their updated client/frontend is released.
