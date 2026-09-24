/**
 * ChainLens runs a GENERATED copy of the shared swap core
 * (scripts/build-swap-core.mjs → chainlens/public/swap-core.js). This fails
 * when that copy no longer matches these sources, so a change here cannot
 * silently leave ChainLens validating swaps with older rules.
 *
 * Needs the sibling ChainLens checkout; without it the comparison is skipped
 * and says so (ChainLens's own test still checks the bundle against its
 * manifest there).
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
// @ts-expect-error -- untyped ESM build script
import { generateSwapCore } from '../../scripts/build-swap-core.mjs'

const chainlensPublic = resolve(__dirname, '../../../chainlens/public')
const present = existsSync(join(chainlensPublic, 'swap-core.js'))

describe('shared swap core bundle', () => {
  it.skipIf(!present)('ChainLens carries the bundle generated from these sources', async () => {
    const { bundle, manifest } = await generateSwapCore()
    const committed = JSON.parse(readFileSync(join(chainlensPublic, 'swap-core.manifest.json'), 'utf8'))
    expect(committed.sources).toEqual(manifest.sources)
    expect(readFileSync(join(chainlensPublic, 'swap-core.js'), 'utf8')).toBe(bundle)
  }, 60_000)

  it('bundles only platform-neutral code (no Node, Electron or web3 imports)', async () => {
    const { bundle, manifest } = await generateSwapCore()
    for (const source of Object.keys(manifest.sources)) {
      expect(source.startsWith('src/shared/')).toBe(true)
    }
    expect(bundle).not.toMatch(/\brequire\(|from ['"]node:|@solana\/web3|electron/)
  }, 60_000)
})
