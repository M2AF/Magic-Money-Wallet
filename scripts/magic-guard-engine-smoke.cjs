/**
 * Manual Electron smoke test for the adblock-rs native module (Batch A spike,
 * MAGIC_GUARD_IMPLEMENTATION_PLAN.md section 7). Confirms the addon loads and
 * matches correctly under the actual Electron binary, not just Node — the two
 * ABIs are not guaranteed compatible for a native addon.
 */
const { app } = require('electron')
const { FilterSet, Engine } = require('adblock-rs')

function main() {
  const filterSet = new FilterSet()
  filterSet.addFilters('||ads.example.com^')
  const engine = new Engine(filterSet)

  const blocked = engine.check('https://ads.example.com/tracker.js', 'https://publisher.com', 'script')
  const allowed = engine.check('https://safe.example.com/app.js', 'https://publisher.com', 'script')
  console.log('[magic-guard-engine-smoke] blocked:', blocked, 'allowed:', allowed)

  if (blocked !== true || allowed !== false) {
    throw new Error(`unexpected match result: blocked=${blocked} allowed=${allowed}`)
  }
  console.log(
    '[magic-guard-engine-smoke] OK — adblock-rs loaded and matched correctly under Electron',
    process.versions.electron, '/ Node', process.versions.node
  )
}

app.whenReady().then(
  () => { main(); app.exit(0) },
  error => { console.error('[magic-guard-engine-smoke] failed', error); app.exit(1) }
)
