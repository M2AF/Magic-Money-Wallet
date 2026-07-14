import { expect, test, chromium, type BrowserContext, type Worker } from '@playwright/test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Real-extension Privacy Mode smoke — proves the MV3 parity plumbing:
 *  - the Settings toggle round-trips through the SW handlers,
 *  - the portfolio filters to Monero/Zcash/Midnight,
 *  - Midnight address derivation runs the ledger-v9 WASM in the OFFSCREEN
 *    document (the SW can't host it), via the offscreen-rpc bridge,
 *  - the Monero backend reports its offscreen sync status instead of erroring.
 *
 * Same harness as extension-create-wallet.spec.ts (unpacked dist-extension,
 * headed Chromium). Requires npm run build:extension first.
 */

const distExtension = resolve(process.cwd(), 'dist-extension')
// Public Foundry/Anvil test mnemonic — Midnight/Monero vectors for it are
// pinned in wallet-core.test.ts.
const MNEMONIC = 'test test test test test test test test test test test junk'.split(' ')

async function launchWithExtension(): Promise<{ ctx: BrowserContext; sw: Worker }> {
  expect(existsSync(join(distExtension, 'manifest.json')), 'dist-extension should exist; run npm run build:extension first').toBe(true)
  const userDir = mkdtempSync(join(tmpdir(), 'mm-ext-priv-'))
  const ctx = await chromium.launchPersistentContext(userDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${distExtension}`,
      `--load-extension=${distExtension}`,
    ],
  })
  const sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker', { timeout: 15_000 })
  return { ctx, sw }
}

test.describe('extension privacy mode (real extension)', () => {
  test('imports, toggles privacy mode, and shows privacy chains with offscreen-derived addresses', async () => {
    test.setTimeout(300_000)
    const { ctx, sw } = await launchWithExtension()
    try {
      const extId = new URL(sw.url()).host
      const page = await ctx.newPage()
      await page.goto(`chrome-extension://${extId}/popup.html`)

      // ── Import the test wallet ──────────────────────────────────────────
      await page.getByText('Import Existing Wallet').click()
      for (let i = 0; i < 12; i++) {
        await page.locator(`[placeholder="word ${i + 1}"]`).fill(MNEMONIC[i])
      }
      await page.getByRole('button', { name: /Import Wallet/i }).click()
      await page.getByPlaceholder(/Password \(min/).fill('e2e-test-password-1')
      await page.getByPlaceholder('Confirm password').fill('e2e-test-password-1')
      await page.getByText('Encrypt & Continue').click()
      await expect(page.getByText('Portfolio').first()).toBeVisible({ timeout: 30_000 })

      // ── Toggle Privacy Mode in Settings (renderer reloads) ──────────────
      await page.locator('button[title="Settings"]').first().click()
      await expect(page.getByText('Privacy Mode — Off')).toBeVisible({ timeout: 15_000 })
      await page.getByText('Privacy Mode — Off').click()
      await expect(page.getByText('PRIVACY').first()).toBeVisible({ timeout: 60_000 })

      // ── Privacy chains render; normal chains hidden ─────────────────────
      const vis = (t: string) => page.getByText(t).locator('visible=true')
      await expect(vis('Monero').first()).toBeVisible({ timeout: 30_000 })
      await expect(vis('Zcash').first()).toBeVisible()
      await expect(vis('Midnight').first()).toBeVisible()
      await expect(page.locator('.chain-name', { hasText: /^Ethereum$/ })).toHaveCount(0)

      // Midnight's unshielded address label proves the ledger-v9 WASM ran in
      // the offscreen document (derivation is impossible in the SW itself).
      await expect(vis('Unshielded · NIGHT').first()).toBeVisible({ timeout: 60_000 })

      // Monero card: either a live sync status or a balance — NOT a module
      // failure like "not a function"/"Offscreen document did not respond".
      await expect(page.getByText(/not a function|did not respond|Unknown offscreen/i)).toHaveCount(0)

      // ── Round-trip off ───────────────────────────────────────────────────
      await page.locator('button[title="Settings"]').first().click()
      await expect(page.getByText('Privacy Mode — On')).toBeVisible({ timeout: 15_000 })
      await page.getByText('Privacy Mode — On').click()
      await expect(page.locator('.chain-name', { hasText: /^Ethereum$/ }).first()).toBeVisible({ timeout: 60_000 })
    } finally {
      await ctx.close()
    }
  })
})
