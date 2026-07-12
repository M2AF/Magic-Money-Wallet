import { expect, test, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Real-extension smoke for the create-wallet flow — the exact path a Chrome
 * Web Store reviewer walks. Loads dist-extension unpacked and drives
 * Welcome → seed phrase → confirm → password → dashboard in BOTH contexts the
 * popup can run in:
 *  - a regular tab (sender.tab set — regression guard for the sender-kind gate
 *    that classified our own pages as hostile web pages)
 *  - the windowed approval popup (chrome.windows.create, also has sender.tab)
 *
 * Requires a built extension: npm run build:extension (test:e2e does this).
 * Extensions can't load in classic headless, so this launches headed.
 */

const distExtension = resolve(process.cwd(), 'dist-extension')

async function launchWithExtension(): Promise<{ ctx: BrowserContext; sw: Worker }> {
  expect(existsSync(join(distExtension, 'manifest.json')), 'dist-extension should exist; run npm run build:extension first').toBe(true)
  const userDir = mkdtempSync(join(tmpdir(), 'mm-ext-e2e-'))
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

async function createWalletToDashboard(page: Page) {
  await page.getByText('Create New Wallet').click()

  // Seed phrase must render (this is where a broken wallet:generate hangs the spinner)
  await expect(page.locator('.seed-grid')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.seed-word')).toHaveCount(12)

  await page.getByText('Reveal phrase').click()
  await page.getByText("I've Written It Down — Continue").click()

  // Confirm Backup checkboxes
  await expect(page.getByText('Confirm Backup')).toBeVisible()
  for (const cb of await page.locator('input[type="checkbox"]').all()) await cb.check()
  await page.getByRole('button', { name: /Save Wallet/i }).click()

  // Extension-only password step
  await page.getByPlaceholder(/Password \(min/).fill('e2e-test-password-1')
  await page.getByPlaceholder('Confirm password').fill('e2e-test-password-1')
  await page.getByText('Encrypt & Continue').click()

  await expect(page.getByText('Portfolio').first()).toBeVisible({ timeout: 30_000 })
}

test.describe('extension create wallet (real extension)', () => {
  test('creates a wallet from popup.html opened in a tab', async () => {
    const { ctx, sw } = await launchWithExtension()
    try {
      const extId = new URL(sw.url()).host
      const page = await ctx.newPage()
      await page.goto(`chrome-extension://${extId}/popup.html`)
      await createWalletToDashboard(page)
    } finally {
      await ctx.close()
    }
  })

  test('creates a wallet in the windowed approval popup', async () => {
    const { ctx, sw } = await launchWithExtension()
    try {
      const pagePromise = ctx.waitForEvent('page', { timeout: 10_000 })
      // String form: the SW's chrome.* globals aren't typed in the test project
      await sw.evaluate(`chrome.windows.create({
        url: chrome.runtime.getURL('popup.html'),
        type: 'popup', width: 380, height: 620, focused: true,
      })`)
      const page = await pagePromise
      await page.waitForLoadState('domcontentloaded')
      await createWalletToDashboard(page)
    } finally {
      await ctx.close()
    }
  })
})
