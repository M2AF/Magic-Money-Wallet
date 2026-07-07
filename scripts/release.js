#!/usr/bin/env node
/**
 * Usage: node scripts/release.js [patch|minor|major]
 *
 * Bumps the version in package.json, commits, tags, and pushes.
 * GitHub Actions picks up the tag and builds + publishes automatically.
 */
const { execSync } = require('child_process')
const fs = require('fs')

const type = process.argv[2] || 'patch'
if (!['patch', 'minor', 'major'].includes(type)) {
  console.error('Usage: node scripts/release.js [patch|minor|major]')
  process.exit(1)
}

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const [major, minor, patch] = pkg.version.split('.').map(Number)

const next =
  type === 'major' ? `${major + 1}.0.0` :
  type === 'minor' ? `${major}.${minor + 1}.0` :
                     `${major}.${minor}.${patch + 1}`

pkg.version = next
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')

// Chrome Web Store rejects a re-upload with the same version — keep manifest.json in sync
const manifestPath = 'src/extension/manifest.json'
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
manifest.version = next
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

console.log(`\n  Releasing v${next}...\n`)

const run = cmd => { console.log(`  > ${cmd}`); execSync(cmd, { stdio: 'inherit' }) }

run(`git add package.json ${manifestPath}`)
run(`git commit -m "chore: release v${next}"`)
run(`git tag v${next}`)
run('git push')
// Push ONLY this release's tag — `git push --tags` ships every stray local tag
// and can trigger phantom release builds for old versions.
run(`git push origin v${next}`)

console.log(`\n  ✓ v${next} tagged and pushed.`)
console.log('  GitHub Actions will build Windows / macOS / Linux and publish to GitHub Releases.\n')
