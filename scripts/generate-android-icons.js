#!/usr/bin/env node
/**
 * generate-android-icons.js — Android launcher icons from the MagicMoney logo
 *
 * Writes every mipmap density the Capacitor template expects:
 *  - ic_launcher.png / ic_launcher_round.png  (legacy, API < 26)
 *  - ic_launcher_foreground.png               (adaptive, API 26+; the launcher
 *    masks it to circle/squircle, so the logo sits in the centre safe zone)
 *  - ic_launcher_monochrome.png               (themed icons, API 33+)
 * plus values/ic_launcher_background.xml pinned to the logo's edge colour and
 * both mipmap-anydpi-v26 descriptors.
 *
 * TWO SOURCES, on purpose:
 *   logo_variant2.png — fully OPAQUE (3 channels, no alpha). Right for the
 *     legacy icons, which are each a finished tile the launcher just draws.
 *   logo.png — carries an alpha channel. Right for every ADAPTIVE layer: a
 *     foreground must be transparent outside the artwork so the launcher can
 *     composite it over the background and shift the two independently for
 *     parallax. This script used to feed the opaque source into the foreground,
 *     which produced a 100%-opaque black plate — it looked correct only because
 *     the background colour happens to be the same black.
 *
 * The monochrome layer is what Android 13+ themed icons draw. A launcher that
 * themes icons — Samsung One UI among them — has nothing to work with when it
 * is absent, which is the leading suspect for a blank icon on the home screen.
 * It is the logo's silhouette in white; Android applies the wallpaper tint
 * itself, so colour here is discarded.
 *
 * Usage: npm run icons:android   (rerun whenever the logo changes, then rebuild)
 */
const sharp = require('sharp')
const { mkdirSync, writeFileSync } = require('fs')
const { join } = require('path')

// Opaque source — legacy icons only (see the header note).
const SRC = join(__dirname, '..', 'logo_variant2.png')
// Alpha-carrying source — every adaptive layer.
const SRC_ALPHA = join(__dirname, '..', 'logo.png')
const RES = join(__dirname, '..', 'android', 'app', 'src', 'main', 'res')
const BG = '#000000'

// density → scale factor (mdpi = 1x)
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }
const LEGACY_DP = 48      // legacy launcher icon
const ADAPTIVE_DP = 108   // adaptive canvas (safe zone = centre 72dp, i.e. 66%)
// Fraction of the adaptive canvas the artwork occupies. 0.66 IS the safe zone:
// the launcher crops to the inner 72 of 108dp and masks inside that, so
// anything beyond this is not guaranteed to survive on any given launcher.
const SAFE_FRACTION = 0.66

async function legacySquare(size) {
  return sharp(SRC).resize(size, size).png().toBuffer()
}

async function legacyRound(size) {
  const circle = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`
  )
  return sharp(SRC)
    .resize(size, size)
    .composite([{ input: circle, blend: 'dest-in' }])
    .png()
    .toBuffer()
}

/** Adaptive foreground: artwork in the safe zone, transparent everywhere else. */
async function adaptiveForeground(size) {
  const logoSize = Math.round(size * SAFE_FRACTION)
  const logo = await sharp(SRC_ALPHA).resize(logoSize, logoSize).png().toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background: TRANSPARENT } })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toBuffer()
}

/**
 * Themed-icon layer: the logo's silhouette in white on transparent. Android
 * tints it to the wallpaper palette, so only the SHAPE carries over — the
 * source's alpha channel is the entire input and its colours are discarded.
 */
async function adaptiveMonochrome(size) {
  const logoSize = Math.round(size * SAFE_FRACTION)
  const { data, info } = await sharp(SRC_ALPHA)
    .resize(logoSize, logoSize)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  // Paint every pixel white, keeping the source's alpha as the stencil.
  const stencil = Buffer.alloc(data.length)
  for (let i = 0; i < data.length; i += 4) {
    stencil[i] = 255
    stencil[i + 1] = 255
    stencil[i + 2] = 255
    stencil[i + 3] = data[i + 3]
  }
  const silhouette = await sharp(stencil, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png().toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background: TRANSPARENT } })
    .composite([{ input: silhouette, gravity: 'centre' }])
    .png()
    .toBuffer()
}

// Written here rather than hand-maintained so a layer can never be added to one
// descriptor and forgotten in the other.
const ADAPTIVE_XML = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
  '    <background android:drawable="@color/ic_launcher_background"/>',
  '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>',
  '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>',
  '</adaptive-icon>',
  '',
].join('\n')

async function main() {
  for (const [density, scale] of Object.entries(DENSITIES)) {
    const dir = join(RES, `mipmap-${density}`)
    mkdirSync(dir, { recursive: true })
    const legacy = Math.round(LEGACY_DP * scale)
    const adaptive = Math.round(ADAPTIVE_DP * scale)
    writeFileSync(join(dir, 'ic_launcher.png'), await legacySquare(legacy))
    writeFileSync(join(dir, 'ic_launcher_round.png'), await legacyRound(legacy))
    writeFileSync(join(dir, 'ic_launcher_foreground.png'), await adaptiveForeground(adaptive))
    writeFileSync(join(dir, 'ic_launcher_monochrome.png'), await adaptiveMonochrome(adaptive))
    console.log(`  ✓ mipmap-${density}: ${legacy}px legacy, ${adaptive}px adaptive (fg + monochrome)`)
  }

  writeFileSync(
    join(RES, 'values', 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`
  )
  console.log(`  ✓ ic_launcher_background → ${BG}`)

  const anydpi = join(RES, 'mipmap-anydpi-v26')
  mkdirSync(anydpi, { recursive: true })
  writeFileSync(join(anydpi, 'ic_launcher.xml'), ADAPTIVE_XML)
  writeFileSync(join(anydpi, 'ic_launcher_round.xml'), ADAPTIVE_XML)
  console.log('  ✓ adaptive descriptors (background + foreground + monochrome)')

  console.log('\nDone. Rebuild the APK to apply (npm run android:apk).')
}

main().catch(e => { console.error(e); process.exit(1) })
