#!/usr/bin/env node
/**
 * patch-ios-podfile.js — wire the local MagicMoneyPlugins pod into ios/App/Podfile.
 *
 * Why a pod at all: this project has no Mac. Every iOS build runs on a GitHub
 * Actions macOS runner, so nobody can open Xcode to add a source file to the
 * target. A local pod with a globbed `source_files` (see
 * ios-plugins/MagicMoneyPlugins.podspec) means `pod install` discovers new
 * Swift files by itself and project.pbxproj is never hand-edited.
 *
 * Why ios-plugins/ lives OUTSIDE ios/: `cap add ios` refuses to scaffold into
 * a non-empty ios/, so anything committed under ios/ before the platform is
 * added would permanently block it. (Same trap as scripts/generate-ios-icons.js.)
 *
 * Idempotent, and runs before `cap sync ios` — which is what invokes
 * `pod install`. Capacitor rewrites only the region between its own markers,
 * so an addition at the end of the target block survives every sync.
 *
 * No-ops (exit 0) when ios/ does not exist, so the Windows build:ios pipeline
 * still completes its bundling stages.
 */

const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const PODFILE = join(__dirname, '..', 'ios', 'App', 'Podfile')
const POD_NAME = 'MagicMoneyPlugins'
// Relative to ios/App/, where the Podfile lives.
const POD_LINE = `  pod '${POD_NAME}', :path => '../../ios-plugins'`

function main() {
  if (!existsSync(PODFILE)) {
    console.log('  · ios/ not present — skipping Podfile patch')
    return
  }

  const podfile = readFileSync(PODFILE, 'utf8')

  if (podfile.includes(`pod '${POD_NAME}'`) || podfile.includes(`pod "${POD_NAME}"`)) {
    console.log(`  · Podfile already declares ${POD_NAME}`)
    return
  }

  // Capacitor's template defines the app target as `target 'App' do`. Insert
  // just before that block's `end` so the pod is scoped to the app target and
  // not to the whole project.
  const targetRe = /^(target\s+['"]App['"]\s+do\b[\s\S]*?)^(end\s*$)/m
  const match = podfile.match(targetRe)

  if (!match) {
    console.error(
      `patch-ios-podfile: could not find a \`target 'App' do ... end\` block in\n` +
      `  ${PODFILE}\n` +
      `The Capacitor iOS template must have changed. Refusing to guess — add\n` +
      `this line to the App target by hand:\n${POD_LINE}`
    )
    process.exit(1)
  }

  const patched = podfile.replace(targetRe, `$1${POD_LINE}\n$2`)
  writeFileSync(PODFILE, patched)
  console.log(`  ✓ Podfile += ${POD_NAME} (local pod, globbed sources)`)
}

main()
