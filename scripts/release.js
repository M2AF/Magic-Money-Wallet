#!/usr/bin/env node
/**
 * Usage: node scripts/release.js [patch|minor|major|beta]
 *
 * Bumps the version in package.json, commits, tags, and pushes.
 * GitHub Actions picks up the tag and builds + publishes automatically.
 * 'beta' increments the prerelease counter (0.2.0-beta.1 → 0.2.0-beta.2,
 * or starts one: 0.2.0 → 0.2.0-beta.1). A '-' in the tag is what makes the
 * workflow publish it as a GitHub Pre-release.
 */
const { execSync } = require('child_process')
const fs = require('fs')

const type = process.argv[2] || 'patch'
if (!['patch', 'minor', 'major', 'beta'].includes(type)) {
  console.error('Usage: node scripts/release.js [patch|minor|major|beta]')
  process.exit(1)
}

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
// Split off any prerelease suffix first — numeric bumps operate on the core
// (the old code Number()'d '0-beta' to NaN on prerelease versions).
const [core, ...preParts] = pkg.version.split('-')
const pre = preParts.join('-')
const [major, minor, patch] = core.split('.').map(Number)

const betaNext = () => {
  const m = /^beta\.(\d+)$/.exec(pre)
  return m ? `${core}-beta.${Number(m[1]) + 1}` : `${core}-beta.1`
}

const next =
  type === 'beta'  ? betaNext() :
  type === 'major' ? `${major + 1}.0.0` :
  type === 'minor' ? `${major}.${minor + 1}.0` :
                     `${major}.${minor}.${patch + 1}`

pkg.version = next
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')

// Chrome Web Store rejects a re-upload with the same version — keep manifest.json
// in sync. Chrome manifests only allow dotted integers, so prerelease tags keep
// the numeric core here (betas ship via GitHub Releases, not the CWS).
const manifestPath = 'src/extension/manifest.json'
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
manifest.version = next.split('-')[0]
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

// Android: versionName tracks package.json; versionCode must strictly increase
// (Android refuses to update-install an APK with a lower/equal code).
const gradlePath = 'android/app/build.gradle'
let gradle = fs.readFileSync(gradlePath, 'utf8')
gradle = gradle.replace(/versionCode (\d+)/, (_, c) => `versionCode ${Number(c) + 1}`)
gradle = gradle.replace(/versionName "[^"]*"/, `versionName "${next}"`)
fs.writeFileSync(gradlePath, gradle)

console.log(`\n  Releasing v${next}...\n`)

const run = cmd => { console.log(`  > ${cmd}`); execSync(cmd, { stdio: 'inherit' }) }

run(`git add package.json ${manifestPath} ${gradlePath}`)
run(`git commit -m "chore: release v${next}"`)
run(`git tag v${next}`)
run('git push')
// Push ONLY this release's tag — `git push --tags` ships every stray local tag
// and can trigger phantom release builds for old versions.
run(`git push origin v${next}`)

console.log(`\n  ✓ v${next} tagged and pushed.`)
console.log('  GitHub Actions will build Windows / macOS / Linux and publish to GitHub Releases.\n')
