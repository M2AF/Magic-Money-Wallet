# The Ape Society

Fixed-palette art theme immediately below Sovereign. The supplied Roch Edwards painting sets the emerald brushwork/background, warm ivory typography and antique gold palette. The three original transparent frame PNGs are bundled unchanged: slim gold for portfolio/Send/swap panels, bronze for secondary Settings groups, carved grand gold for the picker. Original Magic Money/Magic Swap line art remains smooth and receives a restrained warm gold treatment. No titlebar divider is added.

The portrait appears in the picker and behind readable opaque emerald panels; their texture references the painting's quieter upper brushwork through CSS sizing/tint. EB Garamond headings and Inter amounts/addresses reuse existing local OFL fonts. No proprietary gallery font is bundled. `src/renderer/assets/themes/ape-society/provenance.json` records supplied filenames and hashes. Reference: https://www.theapesociety.io/gallery/.

Decorations are drawn inside existing boxes with nine-slice border images. The stock portfolio summary/tools positions and native layout remain intact; compact narrow icon spacing/width keeps full totals visible. The new theme resizes sparklines to fit inside its frames. A shared SVG viewBox makes the resized viewport scale every point rather than clip the endpoint; the default300×50 geometry/data remains unchanged for other themes.

Registered in builtin-themes.ts, imported through theme.ts, isolated in themes/ape-society.css. Fixed palette preserves its identity and uses no custom slots. The theme now has its own Ethereum Ape Society holder gate and owned-portrait selector; see [APE-SOCIETY-HOLDER-ACCESS.md](APE-SOCIETY-HOLDER-ACCESS.md). Sovereign retains its separate REDACTED rule. No signing, provider or transaction code changes.

Validation: five TypeScript targets,169 test files/2485 tests; extension/Electron/Android renderer/iOS renderer bundles. All5 art journeys pass selection, preview/cancel, persistence, theme switching, full amounts/chart geometry at360/400/1000, Send and Swap. Additional Ape journey measures the actual final polyline point in screen coordinates to confirm it remains inside the frame. Screenshots reviewed and saved in `.local-artifacts/ape-society/`; logs `.ape-*.log`. Local fixtures use disposable wallets/mocked providers; no real funds used.

Implemented locally, followed by the ChainLens port. No commit, deployment or device installation performed for this theme.
