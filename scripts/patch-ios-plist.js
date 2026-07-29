#!/usr/bin/env node
/**
 * patch-ios-plist.js — apply MagicMoney's required Info.plist keys.
 *
 * The Capacitor iOS template ships a minimal Info.plist. Three of the keys
 * below are not optional: iOS **terminates the app** the first time it touches
 * the camera or Face ID without the matching usage-description string, so a
 * missing key is a crash on the QR scanner and on biometric unlock, not a
 * warning.
 *
 * This runs as part of `npm run build:ios` rather than being a one-time hand
 * edit because ios/ is generated on a macOS runner (see .github/workflows/
 * build.yml) — the project is developed on Windows, where `cap add ios` cannot
 * run. It is idempotent: once ios/ is committed with these keys present, every
 * subsequent run is a no-op, and hand edits to other keys are preserved.
 *
 * No-ops (exit 0) when ios/ does not exist, so the Windows build:ios pipeline
 * still succeeds through the vite + esbuild stages.
 */

const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const PLIST = join(__dirname, '..', 'ios', 'App', 'App', 'Info.plist')

/**
 * key → XML value. Strings are the user-facing permission prompts; Apple
 * rejects vague ones, so each says specifically what the app does with the
 * capability and why.
 */
const KEYS = {
  NSCameraUsageDescription:
    '<string>MagicMoney uses the camera to scan QR codes for wallet addresses and WalletConnect pairing. Nothing is recorded or uploaded.</string>',

  NSFaceIDUsageDescription:
    '<string>MagicMoney uses Face ID to unlock your wallet. Your recovery phrase never leaves this device, and your password always works as an alternative.</string>',

  // Registers magicmoney:// and, more importantly, wc:// so WalletConnect
  // pairing links from other apps open here — the iOS counterpart of the
  // Android manifest's <data android:scheme="wc" /> intent filter.
  CFBundleURLTypes: `<array>
		<dict>
			<key>CFBundleURLName</key>
			<string>info.chainlens.magicmoney</string>
			<key>CFBundleURLSchemes</key>
			<array>
				<string>magicmoney</string>
				<string>wc</string>
			</array>
		</dict>
	</array>`,
}

// NOTE deliberately NOT set here:
//   ITSAppUsesNonExemptEncryption — an export-compliance declaration, not a
//   build setting. Answer it in App Store Connect; hardcoding a wrong value is
//   a false legal declaration.
//   NSPhotoLibraryAddUsageDescription / UIFileSharingEnabled — land with the
//   Downloader plugin (Phase 1), not before there is code that needs them.

function main() {
  if (!existsSync(PLIST)) {
    console.log('  · ios/ not present — skipping Info.plist patch')
    return
  }

  let xml = readFileSync(PLIST, 'utf8')
  const added = []

  for (const [key, value] of Object.entries(KEYS)) {
    if (xml.includes(`<key>${key}</key>`)) continue

    // Insert before the closing </dict> of the root dict. Matching the LAST
    // </dict></plist> pair rather than the first keeps nested dicts intact.
    const anchor = xml.lastIndexOf('</dict>')
    if (anchor === -1) {
      console.error(`  ✗ ${PLIST} has no closing </dict> — refusing to patch`)
      process.exit(1)
    }
    xml = xml.slice(0, anchor) + `\t<key>${key}</key>\n\t${value}\n` + xml.slice(anchor)
    added.push(key)
  }

  if (added.length === 0) {
    console.log('  · Info.plist already has every required key')
    return
  }

  writeFileSync(PLIST, xml)
  for (const k of added) console.log(`  ✓ Info.plist += ${k}`)
}

main()
