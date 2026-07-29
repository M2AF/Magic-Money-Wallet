#!/usr/bin/env node
/**
 * cap.js — Capacitor CLI wrapper that selects the per-platform webDir.
 *
 * The Capacitor CLI has no --config flag, so both native targets share one
 * capacitor.config.ts and differ only by webDir. That file reads CAP_WEB_DIR;
 * this wrapper sets it from the platform argument before spawning the CLI.
 *
 * A wrapper rather than an inline `CAP_WEB_DIR=... npx cap` in package.json
 * because npm scripts run through cmd.exe on Windows, where the inline
 * env-var prefix is a syntax error — and this repo is developed on Windows.
 * A cross-env dependency would do the same job; this is one file and no dep.
 *
 * Usage: node scripts/cap.js sync ios
 *        node scripts/cap.js run ios
 * Android is left on plain `npx cap` (capacitor.config.ts defaults to
 * dist-capacitor), so the working Android path is untouched.
 */

const { spawnSync } = require('node:child_process')

const WEB_DIRS = {
  ios: 'dist-ios',
  android: 'dist-capacitor',
}

const args = process.argv.slice(2)
const platform = args.find(a => a in WEB_DIRS)

if (!platform) {
  console.error(
    `scripts/cap.js: no platform in arguments (${args.join(' ') || '<none>'}).\n` +
    `Pass one of: ${Object.keys(WEB_DIRS).join(', ')} — the webDir depends on it.`
  )
  process.exit(1)
}

const res = spawnSync('npx', ['cap', ...args], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, CAP_WEB_DIR: WEB_DIRS[platform] },
})

process.exit(res.status ?? 1)
