#!/usr/bin/env node
/**
 * patch-ios-native.js — bring the generated ios/ project in line with what
 * MagicMoney actually needs. Runs before `cap sync ios` (i.e. before
 * `pod install`) as part of `npm run build:ios`.
 *
 * Two jobs:
 *
 * 1. DEPLOYMENT TARGET. Capacitor's template pins iOS 14.0 in both the Podfile
 *    and project.pbxproj. That is too low to resolve dependencies:
 *      GoogleMLKit/BarcodeScanning 7.0.0 (via @capacitor-mlkit/barcode-scanning,
 *      which powers the QR scanner) requires iOS 15.5+, so `pod install` fails
 *      with "Specs satisfying the dependency were found, but they required a
 *      higher minimum deployment target."
 *    Capacitor's own `assertDeploymentTarget` post_install hook does NOT help —
 *    it only raises pods that are BELOW 14.0; it never propagates a higher
 *    project target downward. So both files must be set explicitly.
 *
 *    17.0 rather than the 15.5 minimum: Phase 3 routes the dApp browser through
 *    Tor using WKWebView's proxyConfigurations, which is iOS 17+. Choosing 17
 *    now avoids migrating the floor twice, and by 2026 it excludes only the
 *    iPhone 8/8 Plus/X. If Tor is ever dropped, 15.5 is the real minimum.
 *
 * 2. THE LOCAL PLUGIN POD. Registers ios-plugins/ (see MagicMoneyPlugins.podspec)
 *    with the App target. That pod's globbed source_files is what lets a new
 *    Swift file compile without anyone editing project.pbxproj by hand — this
 *    project is built exclusively on GitHub Actions macOS runners and nobody
 *    on the team has Xcode.
 *
 * ios-plugins/ deliberately lives OUTSIDE ios/, because `cap add ios` refuses to
 * scaffold into a non-empty ios/.
 *
 * Idempotent, and a no-op (exit 0) when ios/ does not exist, so the Windows
 * build:ios pipeline still completes its bundling stages.
 */

const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

/** Single source of truth. Also mirrored in ios-plugins/MagicMoneyPlugins.podspec. */
const DEPLOYMENT_TARGET = '17.0'

const VERSION = require('../package.json').version

const IOS = join(__dirname, '..', 'ios')
const PODFILE = join(IOS, 'App', 'Podfile')
const PBXPROJ = join(IOS, 'App', 'App.xcodeproj', 'project.pbxproj')

const POD_NAME = 'MagicMoneyPlugins'
// Relative to ios/App/, where the Podfile lives.
const POD_LINE = `  pod '${POD_NAME}', :path => '../../ios-plugins'`

function patchPodfile() {
  let podfile = readFileSync(PODFILE, 'utf8')
  let changed = false

  // ── platform line ──
  const platformRe = /^(\s*platform\s+:ios\s*,\s*)['"]([\d.]+)['"]/m
  const platformMatch = podfile.match(platformRe)
  if (!platformMatch) {
    console.error(
      `patch-ios-native: no \`platform :ios, 'x.y'\` line in ${PODFILE}.\n` +
      `The Capacitor iOS template must have changed — refusing to guess.`
    )
    process.exit(1)
  }
  if (platformMatch[2] !== DEPLOYMENT_TARGET) {
    podfile = podfile.replace(platformRe, `$1'${DEPLOYMENT_TARGET}'`)
    changed = true
    console.log(`  ✓ Podfile platform :ios ${platformMatch[2]} → ${DEPLOYMENT_TARGET}`)
  }

  // ── local plugin pod ──
  if (podfile.includes(`pod '${POD_NAME}'`) || podfile.includes(`pod "${POD_NAME}"`)) {
    console.log(`  · Podfile already declares ${POD_NAME}`)
  } else {
    // Insert before the App target block's `end`, so the pod is scoped to the
    // app target rather than the whole project.
    const targetRe = /^(target\s+['"]App['"]\s+do\b[\s\S]*?)^(end\s*$)/m
    if (!targetRe.test(podfile)) {
      console.error(
        `patch-ios-native: could not find a \`target 'App' do ... end\` block in\n` +
        `  ${PODFILE}\nAdd this line to the App target by hand:\n${POD_LINE}`
      )
      process.exit(1)
    }
    podfile = podfile.replace(targetRe, `$1${POD_LINE}\n$2`)
    changed = true
    console.log(`  ✓ Podfile += ${POD_NAME} (local pod, globbed sources)`)
  }

  if (changed) writeFileSync(PODFILE, podfile)
}

function patchPbxproj() {
  if (!existsSync(PBXPROJ)) {
    console.log('  · project.pbxproj not present — skipping deployment-target patch')
    return
  }
  const pbxproj = readFileSync(PBXPROJ, 'utf8')

  // A plain build-setting value substitution — safe to do textually, unlike
  // adding file references (which needs generated UUIDs and build phases, and
  // is exactly what the plugin pod exists to avoid).
  const re = /IPHONEOS_DEPLOYMENT_TARGET = [\d.]+;/g
  const found = pbxproj.match(re) ?? []
  if (found.length === 0) {
    console.error(`patch-ios-native: no IPHONEOS_DEPLOYMENT_TARGET in ${PBXPROJ}`)
    process.exit(1)
  }

  const target = `IPHONEOS_DEPLOYMENT_TARGET = ${DEPLOYMENT_TARGET};`
  let out = pbxproj
  if (found.every(f => f === target)) {
    console.log(`  · project.pbxproj already targets iOS ${DEPLOYMENT_TARGET}`)
  } else {
    out = out.replace(re, target)
    console.log(`  ✓ project.pbxproj IPHONEOS_DEPLOYMENT_TARGET → ${DEPLOYMENT_TARGET} (${found.length} configs)`)
  }

  // ── version ──
  // Info.plist stores $(MARKETING_VERSION) / $(CURRENT_PROJECT_VERSION), so the
  // build settings are the real source of truth. The template hardcodes 1.0,
  // which would make src/ios/update-check.ts believe every release is newer
  // than the running build, forever.
  //
  // MARKETING_VERSION carries the FULL package.json version including any
  // prerelease suffix, matching Android's versionName so the updater's semver
  // comparison against the git tag is exact. (App Store Connect would reject a
  // non-numeric CFBundleShortVersionString — irrelevant here, as this app is
  // sideloaded and never submitted. Strip the suffix if that ever changes.)
  const mkRe = /MARKETING_VERSION = [^;]+;/g
  const mk = `MARKETING_VERSION = ${VERSION};`
  if ((out.match(mkRe) ?? []).every(f => f === mk)) {
    console.log(`  · project.pbxproj already at version ${VERSION}`)
  } else {
    out = out.replace(mkRe, mk)
    console.log(`  ✓ project.pbxproj MARKETING_VERSION → ${VERSION}`)
  }

  // CFBundleVersion must be a monotonically increasing integer. Derived from
  // the semver core so it never regresses across releases.
  const [maj, min, pat] = VERSION.split('-')[0].split('.').map(n => parseInt(n, 10) || 0)
  const build = maj * 10000 + min * 100 + pat
  const cpRe = /CURRENT_PROJECT_VERSION = [^;]+;/g
  const cp = `CURRENT_PROJECT_VERSION = ${build};`
  if (!(out.match(cpRe) ?? []).every(f => f === cp)) {
    out = out.replace(cpRe, cp)
    console.log(`  ✓ project.pbxproj CURRENT_PROJECT_VERSION → ${build}`)
  }

  if (out !== pbxproj) writeFileSync(PBXPROJ, out)
}

function main() {
  if (!existsSync(PODFILE)) {
    console.log('  · ios/ not present — skipping native project patch')
    return
  }
  patchPodfile()
  patchPbxproj()
}

main()
