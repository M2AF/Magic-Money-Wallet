/**
 * Generate the electron-builder app icons from a single square source image.
 *
 *   node scripts/generate-icons.js [sourceImage]
 *
 * Produces:
 *   build/icon.png      (1024x1024)  -> macOS .icns + Linux set are derived from this by electron-builder.
 *   build/icon.ico      (16,24,32,48,64,128,256)  -> Windows nsis target.
 *   resources/icon.png  (512x512)    -> runtime BrowserWindow icon (see src/main/index.ts).
 *
 * Default source is magicmoneyPFP.png (the square badge artwork). Pass a different
 * path to use another logo, e.g. `node scripts/generate-icons.js logo_variant.png`.
 *
 * No extra dependencies: uses sharp (already a devDependency) and assembles the .ico
 * by hand (PNG-payload ICONDIR, supported on Windows Vista+).
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC = process.argv[2] || 'magicmoneyPFP.png';
const OUT_DIR = path.resolve(__dirname, '..', 'build');
const RES_DIR = path.resolve(__dirname, '..', 'resources');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

async function pngBuffer(src, size) {
  return sharp(src)
    .resize(size, size, { fit: 'contain', background: TRANSPARENT })
    .png()
    .toBuffer();
}

/** Assemble a multi-image .ico whose entries are full PNG payloads. */
function buildIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // image type: 1 = icon
  header.writeUInt16LE(count, 4); // number of images

  const directory = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const payloads = [];

  images.forEach((img, i) => {
    const e = directory.subarray(i * 16, i * 16 + 16);
    e.writeUInt8(img.size >= 256 ? 0 : img.size, 0); // width  (0 means 256)
    e.writeUInt8(img.size >= 256 ? 0 : img.size, 1); // height (0 means 256)
    e.writeUInt8(0, 2); // palette colour count
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(img.buf.length, 8); // size of PNG payload
    e.writeUInt32LE(offset, 12); // offset to PNG payload
    offset += img.buf.length;
    payloads.push(img.buf);
  });

  return Buffer.concat([header, directory, ...payloads]);
}

async function main() {
  const src = path.resolve(SRC);
  if (!fs.existsSync(src)) {
    console.error(`Source image not found: ${src}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1024 master -> macOS (.icns) + Linux set are generated from this by electron-builder.
  await sharp(src)
    .resize(1024, 1024, { fit: 'contain', background: TRANSPARENT })
    .png()
    .toFile(path.join(OUT_DIR, 'icon.png'));

  // Windows .ico (multi-resolution).
  const images = [];
  for (const size of ICO_SIZES) {
    images.push({ size, buf: await pngBuffer(src, size) });
  }
  fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), buildIco(images));

  // Runtime BrowserWindow icon (referenced by src/main/index.ts).
  fs.mkdirSync(RES_DIR, { recursive: true });
  await sharp(src)
    .resize(512, 512, { fit: 'contain', background: TRANSPARENT })
    .png()
    .toFile(path.join(RES_DIR, 'icon.png'));

  console.log(`Source: ${path.relative(process.cwd(), src)}`);
  console.log(`Wrote  build/icon.png      (1024x1024)`);
  console.log(`Wrote  build/icon.ico      (${ICO_SIZES.join(', ')})`);
  console.log(`Wrote  resources/icon.png  (512x512)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
