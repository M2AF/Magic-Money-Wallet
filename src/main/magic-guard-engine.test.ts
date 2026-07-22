/**
 * magic-guard-engine.test.ts — Batch A native-module compatibility spike.
 *
 * This is the disposable proof step from MAGIC_GUARD_IMPLEMENTATION_PLAN.md
 * section 7: confirm the adblock-rs native addon loads and matches correctly
 * under Node. It is NOT the Magic Guard service (that's Batch B) and has no
 * user-facing behavior — src/main/magic-guard.ts does not import adblock-rs yet.
 *
 * Electron-specific loading is verified separately via
 * `npm run test:magic-guard-engine` (scripts/magic-guard-engine-smoke.cjs),
 * since Node module resolution passing does not guarantee the native addon
 * loads under Electron's ABI.
 */
import { describe, expect, it } from 'vitest'
import { FilterSet, Engine } from 'adblock-rs'

describe('adblock-rs native module (Batch A spike)', () => {
  it('loads and matches a two-rule in-memory list', () => {
    const filterSet = new FilterSet()
    filterSet.addFilters('||ads.example.com^')
    const engine = new Engine(filterSet)

    expect(engine.check('https://ads.example.com/tracker.js', 'https://publisher.com', 'script')).toBe(true)
    expect(engine.check('https://safe.example.com/app.js', 'https://publisher.com', 'script')).toBe(false)
  })
})
