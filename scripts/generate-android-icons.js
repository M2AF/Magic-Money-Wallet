#!/usr/bin/env node
/**
 * generate-android-icons.js — Android launcher icons from logo_variant2.png
 *
 * Writes every mipmap density the Capacitor template expects:
 *  - ic_launcher.png / ic_launcher_round.png  (legacy, API < 26)
 *  - ic_launcher_foreground.png               (adaptive, API 26+; the launcher
 *    masks it to circle/squircle, so the logo sits in the centre safe zone)
 * and pins values/ic_launcher_background.xml to the logo's edge color (#000000)
 * so the adaptive background blends seamlessly with the artwork.
 *
 * Usage: npm run icons:android   (rerun whenever the logo changes, then rebuild)
 */
const sharp = require('sharp')
const { mkdirSync, writeFileSync } = require('fs')
const { join } = require('path')

const SRC = join(__dirname, '..', 'logo_variant2.png')
const RES = join(__dirname, '..', 'android', 'app', 'src', 'main', 'res')
const BG = '#000000'

// density → scale factor (mdpi = 1x)
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
const LEGACY_DP = 48      // legacy launcher icon
const ADAPTIVE_DP = 108   // adaptive foreground canvas (safe zone = centre 66dp)

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

async function adaptiveForeground(size) {
  // Logo at ~66% of the canvas: fills the adaptive safe zone, and the black
  // canvas matches both the logo edges and the background color resource.
  const logoSize = Math.round(size * 0.66)
  const logo = await sharp(SRC).resize(logoSize, logoSize).png().toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toBuffer()
}

async function main() {
  for (const [density, scale] of Object.entries(DENSITIES)) {
    const dir = join(RES, `mipmap-${density}`)
    mkdirSync(dir, { recursive: true })
    const legacy = Math.round(LEGACY_DP * scale)
    const adaptive = Math.round(ADAPTIVE_DP * scale)
    writeFileSync(join(dir, 'ic_launcher.png'), await legacySquare(legacy))
    writeFileSync(join(dir, 'ic_launcher_round.png'), await legacyRound(legacy))
    writeFileSync(join(dir, 'ic_launcher_foreground.png'), await adaptiveForeground(adaptive))
    console.log(`  ✓ mipmap-${density}: ${legacy}px legacy, ${adaptive}px foreground`)
  }

  writeFileSync(
    join(RES, 'values', 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`
  )
  console.log(`  ✓ ic_launcher_background → ${BG}`)
  console.log('\nDone. Rebuild the APK to apply (npm run android:apk).')
}

main().catch(e => { console.error(e); process.exit(1) })
