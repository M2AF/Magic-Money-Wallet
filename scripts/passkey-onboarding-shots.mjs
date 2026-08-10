/**
 * passkey-onboarding-shots.mjs — screenshots of the passkey-provider onboarding
 *
 * Renders the REAL sheet and the REAL Settings-row copy, one state per shot, via
 * the props-only harness in scripts/passkey-preview.
 *
 * ⚠ Why not screenshot the app itself? Two dead ends, both measured:
 *   • `registerPlugin('PasskeyProvider')` declares no web implementation, and
 *     Capacitor only consults CapacitorCustomPlatform for plugins that do — so a
 *     browser stub can never make `status()` return anything but a throw.
 *   • The phone shows one state at a time and needs a real fingerprint to get
 *     past the lock screen, which makes reviewing copy impractical.
 *
 * Run:  npx vite scripts/passkey-preview --port 5199
 *       node scripts/passkey-onboarding-shots.mjs
 *
 * Output: .screenshots/passkey-onboarding-*.png
 */

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.PREVIEW_URL || 'http://localhost:5199/'
const OUT = '.screenshots'
mkdirSync(OUT, { recursive: true })

const SHOTS = [
  {
    file: '1-first-run-prompt',
    query: 'stage=not-enrolled',
    note: 'First run: the offer, the Chrome “More options” caveat, and the own-browser exemption',
  },
  {
    file: '2-enrolled-unknown',
    query: 'stage=enrolled-unknown',
    note: 'Enrolled; Android will not say whether we are selected (the normal case on Samsung)',
  },
  {
    file: '3-not-selected',
    query: 'stage=enrolled-not-selected',
    note: 'Enrolled but Android reports us unselected — “One step left”',
  },
  {
    file: '4-settings-would-not-open',
    query: 'stage=not-enrolled&landing=none',
    note: 'Deep link failed on this OEM — written directions instead of a false success',
  },
  {
    file: '5-settings-root-only',
    query: 'stage=not-enrolled&landing=settings-root',
    note: 'Only the settings root opened — tells the user where to go from there',
  },
  {
    // ⚠ The two LIGHT-accent themes. Midnight sets --accent to #ffffff and was
    // the one that broke the primary button — a hardcoded white label on a white
    // slab, invisible, caught only on a device. Midnight is the harness default
    // (so every shot above covers it); White & Gold is the other at-risk one.
    file: '7-white-gold-contrast',
    query: 'stage=not-enrolled&theme=white-gold',
    note: 'White & Gold — the other light accent; proves the button label stays readable',
  },
  {
    file: '6-unsupported-hidden',
    query: 'stage=unsupported',
    note: 'Android 13: no sheet, no row — the control is hidden, not disabled',
  },
]

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },     // Galaxy S21+ logical size
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  colorScheme: 'dark',
})

for (const shot of SHOTS) {
  const page = await ctx.newPage()
  await page.goto(`${BASE}?${shot.query}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  const path = join(OUT, `passkey-onboarding-${shot.file}.png`)
  await page.screenshot({ path })
  const dialogs = await page.locator('[role="dialog"]').count()
  console.log(`${shot.file.padEnd(28)} dialog=${dialogs}  → ${path}`)
  console.log(`  ${shot.note}`)
  await page.close()
}

await browser.close()
