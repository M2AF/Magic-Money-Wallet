# Liquid Glass material skin

A separate built-in material theme with a fixed atmospheric palette. It cannot
be recoloured. The colourable Glass finish is still independent and unchanged,
except its portfolio summary now has a transparent fill so no rectangle interrupts
the backdrop. Liquid Glass suspends palette finishes and the two-tone preference;
returning to a colour theme restores those preferences.

Original local SVG scene, clear lenses, edge reflections, translucent controls,
10px backdrop blur, and local SVG displacement of backdrop pixels. Financial
text and original logos stay sharp. Fixed background #102039, accent #cae8ff,
text #f6f9ff; both apps share byte-identical scene/filter assets. No new dependency
or external asset. Colour edit controls and overrides are disabled for this skin;
custom slots and profile wire schema are unchanged. Wallet and browser brand bars
are completely transparent with no dividing border or reflection bezel.

Apple's reference uses native platform glass APIs. This shared web renderer uses
a browser approximation; it is not Apple's native rendering implementation.
Reference: https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass
Web filter syntax: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter
SVG filter support and appearance may differ between WebViews; native devices
have not been installed or visually validated in this local change.

Verification and previews: .liquid-*.log and .local-artifacts/textures/.
All work remains local: no commit, deployment, signing or transaction broadcasts.

Checks: wallet five-target typecheck,166files/2444tests, four renderer bundles;
all three existing art journeys and final finish/material journey pass across runs.
ChainLens193Node tests/check; all three final browser checks pass (lifecycle, signed-out gate and optics);
optics probe verifies the SVG filter changes backdrop pixels versus plain blur.
Wallet portfolio/Send/Swap and360/400/1000px screenshots reviewed; ChainLens
360/1400px screenshots retained. No native optical/rendering validation.
