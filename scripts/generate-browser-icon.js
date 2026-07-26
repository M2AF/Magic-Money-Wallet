/**
 * Generate the icon Windows shows for MagicMoney in Settings → Default apps.
 *
 *   node scripts/generate-browser-icon.js [sourceImage]
 *
 * Produces resources/browser-icon.ico (16…256px).
 *
 * Why a separate file from build/icon.ico: the registry needs a REAL filesystem
 * path, and build/icon.ico is consumed by electron-builder (it ends up embedded
 * in the exe, not shipped as a standalone file). This one is copied next to the
 * packaged app via the `extraResources` entry in package.json, so it sits
 * outside app.asar where Windows can actually read it. See main/default-browser.ts.
 *
 * Default source is logo_variant2.png — the neon wand mark the user picked for
 * the browser listing. Kept out of `npm run icons` on purpose: that script
 * regenerates the APP icon from a different source and would clobber this.
 */
const fs = require('fs');
const path = require('path');
const { buildIco, pngBuffer, ICO_SIZES } = require('./generate-icons.js');

const SRC = process.argv[2] || 'logo_variant2.png';
const RES_DIR = path.resolve(__dirname, '..', 'resources');

async function main() {
  const src = path.resolve(SRC);
  if (!fs.existsSync(src)) {
    console.error(`Source image not found: ${src}`);
    process.exit(1);
  }
  fs.mkdirSync(RES_DIR, { recursive: true });

  const images = [];
  for (const size of ICO_SIZES) {
    images.push({ size, buf: await pngBuffer(src, size) });
  }
  const out = path.join(RES_DIR, 'browser-icon.ico');
  fs.writeFileSync(out, buildIco(images));

  console.log(`Source: ${path.relative(process.cwd(), src)}`);
  console.log(`Wrote  resources/browser-icon.ico  (${ICO_SIZES.join(', ')})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
