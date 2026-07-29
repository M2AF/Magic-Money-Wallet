#!/usr/bin/env node
/**
 * generate-ios-icons.js — iOS app icon + launch screen from logo_variant2.png
 *
 * Xcode 14+ (and the Capacitor 7 iOS template) takes a SINGLE 1024×1024 app
 * icon and downscales every other size at build time, so unlike the Android
 * script there is no density ladder to write — just one icon and the splash.
 *
 * The one hard rule: **an iOS app icon must be fully opaque**. App Store
 * Connect rejects an icon that carries an alpha channel, and the logo PNG has
 * one, so every icon here is flattened onto the logo's edge color first.
 *
 * Must run AFTER the ios/ project exists. `cap add ios` refuses to scaffold
 * into a non-empty ios/, so creating the asset catalog first would permanently
 * block the platform from being added — hence the hard check in main().
 *
 * Usage: npm run icons:ios   (rerun whenever the logo changes, then rebuild)
 */
const sharp = require('sharp')
const { mkdirSync, writeFileSync, existsSync } = require('fs')
const { join } = require('path')

const SRC = join(__dirname, '..', 'logo_variant2.png')
const ASSETS = join(__dirname, '..', 'ios', 'App', 'App', 'Assets.xcassets')
const BG = '#000000'

const ICON_PX = 1024
// The Capacitor template's launch screen is a single square image centered on
// a solid background and scaled to fill, so it has to be big enough for the
// largest iPad in either orientation.
const SPLASH_PX = 2732

/** Flatten onto BG — removes the alpha channel App Store review rejects. */
async function appIcon() {
  return sharp(SRC)
    .resize(ICON_PX, ICON_PX, { fit: 'contain', background: BG })
    .flatten({ background: BG })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/** Logo at ~28% of the canvas — matches the launch screen's centered mark. */
async function splash() {
  const logoSize = Math.round(SPLASH_PX * 0.28)
  const logo = await sharp(SRC).resize(logoSize, logoSize).png().toBuffer()
  return sharp({
    create: { width: SPLASH_PX, height: SPLASH_PX, channels: 4, background: BG },
  })
    .composite([{ input: logo, gravity: 'centre' }])
    .flatten({ background: BG })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

const ICON_CONTENTS = {
  images: [{ filename: 'AppIcon-512@2x.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
  info: { author: 'xcode', version: 1 },
}

const SPLASH_CONTENTS = {
  images: [
    { idiom: 'universal', filename: 'splash-2732x2732.png', scale: '1x' },
    { idiom: 'universal', filename: 'splash-2732x2732-1.png', scale: '2x' },
    { idiom: 'universal', filename: 'splash-2732x2732-2.png', scale: '3x' },
  ],
  info: { author: 'xcode', version: 1 },
}

async function main() {
  // Refuse to create ios/ as a side effect: a half-populated ios/ makes
  // `cap add ios` fail ("platform already exists") with no obvious cause, and
  // the recovery is to delete a directory the user may think is their project.
  const project = join(__dirname, '..', 'ios', 'App', 'App.xcodeproj')
  if (!existsSync(project)) {
    console.error(
      'generate-ios-icons: ios/App/App.xcodeproj not found.\n' +
      'Add the platform first (on macOS: node scripts/cap.js add ios), then rerun.\n' +
      'Writing icons now would create a partial ios/ that blocks `cap add ios`.'
    )
    process.exit(1)
  }

  const iconDir = join(ASSETS, 'AppIcon.appiconset')
  const splashDir = join(ASSETS, 'Splash.imageset')
  mkdirSync(iconDir, { recursive: true })
  mkdirSync(splashDir, { recursive: true })

  writeFileSync(join(iconDir, 'AppIcon-512@2x.png'), await appIcon())
  writeFileSync(join(iconDir, 'Contents.json'), JSON.stringify(ICON_CONTENTS, null, 2) + '\n')
  console.log(`  ✓ AppIcon: ${ICON_PX}px, opaque`)

  // The template references three scales; the same 2732px image serves all of
  // them (it is already larger than any device needs).
  const img = await splash()
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    writeFileSync(join(splashDir, name), img)
  }
  writeFileSync(join(splashDir, 'Contents.json'), JSON.stringify(SPLASH_CONTENTS, null, 2) + '\n')
  console.log(`  ✓ Splash: ${SPLASH_PX}px ×3 scales`)

  console.log('\nDone. Rebuild to apply (npm run build:ios, then Xcode/CI).')
}

main().catch(e => { console.error(e); process.exit(1) })
