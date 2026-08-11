/**
 * agw-panel-shots.mjs — screenshots of the Abstract Global Wallet panel
 *
 * Renders the REAL AgwPanel, one shot per view, via the props-only harness in
 * scripts/agw-preview.
 *
 * ⚠ Why not screenshot the app itself? Every state that matters needs a real
 * AGW on Abstract mainnet AND the signer key the portal exports for it. The
 * panel is pure (props in, window.wallet out), so the harness shows the same
 * pixels the app does without holding live key material to take a picture.
 *
 * Run:  npx vite scripts/agw-preview --port 5198
 *       node scripts/agw-panel-shots.mjs
 *
 * Output: .screenshots/agw-panel-*.png
 */

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.PREVIEW_URL || 'http://localhost:5198/'
const OUT = '.screenshots'
mkdirSync(OUT, { recursive: true })

const SHOTS = [
  {
    file: '1-states',
    query: '',
    note: 'All four resolution states: watch-only, signer-connected, unlinked, EOA-owned',
  },
  {
    // Opens the importer on the watch-only card — the copy a user reads before
    // pasting a key that can move every asset in the smart wallet.
    file: '2-importer-open',
    query: '',
    open: true,
    note: 'Signer importer: portal directions, the plain-language warning, masked field',
  },
  {
    // The rejection path. A key that owns nothing must be refused and erased,
    // not stored — this is what that failure looks like to the user.
    file: '3-import-rejected',
    query: '',
    open: true,
    submit: true,
    note: 'Rejected import: backend error surfaced in the form, which stays open',
  },
  {
    // ⚠ The light-accent theme that has broken a primary button before (--accent
    // is #ffffff on Midnight; White & Gold is the other at-risk one).
    file: '4-white-gold-contrast',
    query: 'theme=white-gold',
    open: true,
    note: 'White & Gold — proves the green import button and its label stay readable',
  },
  {
    file: '5-legacy-bridge',
    query: 'legacy=1',
    note: 'A bridge without importAgwSigner: falls back to the portal button, no dead control',
  },
]

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 520, height: 1400 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
})

for (const shot of SHOTS) {
  const page = await ctx.newPage()
  await page.goto(`${BASE}?${shot.query}`, { waitUntil: 'networkidle' })
  // Scope to the first card: several states render an "Import signer key" action,
  // and once one card's form is open its own action button reads "Cancel" — so
  // inside a single card the name is unambiguous at every step.
  const card = page.locator('.chain-card').first()
  if (shot.open) {
    await card.getByRole('button', { name: 'Import signer key', exact: true }).click()
  }
  if (shot.submit) {
    await card.locator('input[type="password"]').fill('0x' + 'ab'.repeat(32))
    await card.getByRole('button', { name: 'Import signer key', exact: true }).click()
    await card.getByText('doesn’t own an Abstract smart wallet').waitFor()
  }
  await page.waitForTimeout(300)
  const path = join(OUT, `agw-panel-${shot.file}.png`)
  await page.screenshot({ path, fullPage: true })
  console.log(`${shot.file.padEnd(24)} → ${path}`)
  console.log(`  ${shot.note}`)
  await page.close()
}

await browser.close()
