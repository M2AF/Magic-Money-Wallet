import { expect, test, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Real-extension auto-revoke — Settings → Security → "Auto-revoke site access".
 *  - Off by default with no timer control; On reveals the 1–60 min slider and
 *    one-minute arrows, which clamp at both ends and persist across reloads.
 *  - Expiry runs in the MV3 service worker from chrome.alarms with no wallet UI
 *    open, revoking grants on every chain.
 *
 * Same harness as extension-privacy-mode.spec.ts. Requires npm run build:extension.
 */

const distExtension = resolve(process.cwd(), 'dist-extension')
const MNEMONIC = 'test test test test test test test test test test test junk'.split(' ')

async function launchWithExtension(): Promise<{ ctx: BrowserContext; sw: Worker }> {
  expect(existsSync(join(distExtension, 'manifest.json')), 'run npm run build:extension first').toBe(true)
  const userDir = mkdtempSync(join(tmpdir(), 'mm-ext-autorevoke-'))
  const ctx = await chromium.launchPersistentContext(userDir, {
    headless: false,
    args: [`--disable-extensions-except=${distExtension}`, `--load-extension=${distExtension}`],
  })
  const sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker', { timeout: 15_000 })
  return { ctx, sw }
}

async function importWallet(page: Page): Promise<void> {
  await page.getByText('Import Existing Wallet').click()
  for (let i = 0; i < 12; i++) await page.locator(`[placeholder="word ${i + 1}"]`).fill(MNEMONIC[i])
  await page.getByRole('button', { name: /Import Wallet/i }).click()
  await page.getByPlaceholder(/Password \(min/).fill('e2e-test-password-1')
  await page.getByPlaceholder('Confirm password').fill('e2e-test-password-1')
  await page.getByText('Encrypt & Continue').click()
  await expect(page.getByText('Portfolio').first()).toBeVisible({ timeout: 30_000 })
}

const openSettings = (page: Page) => page.locator('button[title="Settings"]').first().click()

test.describe('extension auto-revoke (real extension)', () => {
  test('toggle, slider and arrows; persisted; alarm-driven expiry in the service worker', async () => {
    test.setTimeout(240_000)
    const { ctx, sw } = await launchWithExtension()
    try {
      const extId = new URL(sw.url()).host
      const page = await ctx.newPage()
      await page.goto(`chrome-extension://${extId}/popup.html`)
      await importWallet(page)

      // ── Default Off: no timer control ──────────────────────────────────────
      await openSettings(page)
      const toggle = page.getByRole('switch', { name: /Auto-revoke site access/ })
      await expect(toggle).toHaveText(/Auto-revoke site access — Off/)
      await expect(toggle).toHaveAttribute('aria-checked', 'false')
      await expect(page.locator('#auto-revoke-minutes')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'One minute more' })).toHaveCount(0)

      // ── On: slider + arrows ────────────────────────────────────────────────
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-checked', 'true')
      const slider = page.locator('#auto-revoke-minutes')
      await expect(slider).toBeVisible()
      await expect(slider).toHaveAttribute('min', '1')
      await expect(slider).toHaveAttribute('max', '60')
      const value = page.locator('output[for="auto-revoke-minutes"]')
      await expect(value).toHaveText('15 min')
      await page.getByRole('button', { name: 'One minute more' }).click()
      await expect(value).toHaveText('16 min')
      await page.getByRole('button', { name: 'One minute less' }).click()
      await page.getByRole('button', { name: 'One minute less' }).click()
      await expect(value).toHaveText('14 min')

      await slider.fill('1')
      await expect(value).toHaveText('1 min')
      await expect(page.getByRole('button', { name: 'One minute less' })).toBeDisabled()
      await slider.fill('60')
      await expect(value).toHaveText('1 hour')
      await expect(page.getByRole('button', { name: 'One minute more' })).toBeDisabled()
      await page.getByRole('button', { name: 'One minute less' }).click()
      await expect(value).toHaveText('59 min')
      await expect(page.getByText('The timer starts when you next connect')).toBeVisible()
      await page.screenshot({ path: 'test-results/auto-revoke-settings-on.png' })
      // Phone width (the Android/iOS apps render this same component).
      await page.setViewportSize({ width: 360, height: 740 })
      await page.getByRole('switch', { name: /Auto-revoke site access/ }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: 'test-results/auto-revoke-settings-phone.png' })
      await page.setViewportSize({ width: 1280, height: 720 })

      // ── Persisted in the service worker, survives a reload ─────────────────
      await expect.poll(async () => sw.evaluate(async () =>
        (await chrome.storage.local.get('wallet.auto_revoke'))['wallet.auto_revoke']?.durationMinutes
      ), { timeout: 5_000 }).toBe(59)
      await page.reload()
      await openSettings(page)
      await expect(page.getByRole('switch', { name: /Auto-revoke site access — On/ })).toBeVisible()
      await expect(page.locator('output[for="auto-revoke-minutes"]')).toHaveText('59 min')

      // ── Alarm-driven expiry, no wallet UI open ─────────────────────────────
      // Two grants on different chains and a 1-minute countdown that started
      // 50 s ago, so the deadline is ~10 s out.
      await sw.evaluate(async () => {
        await chrome.storage.local.set({
          'wallet.approved_origins': [
            { origin: 'https://evm.example', chains: ['evm'], addedAt: Date.now() },
            { origin: 'https://ada.example', chains: ['cardano'], addedAt: Date.now() },
          ],
          'wallet.auto_revoke': { enabled: true, durationMinutes: 1, startedAt: Date.now() - 50_000, pendingWc: null },
        })
      })
      // Reading the setting reconciles and (re)schedules the alarm.
      await page.reload()
      await openSettings(page)
      await expect(page.getByText(/Next automatic disconnect in/)).toBeVisible()
      const alarm = await sw.evaluate(async () => chrome.alarms.get('mm-auto-revoke'))
      expect(alarm?.scheduledTime).toBeGreaterThan(Date.now() - 1_000)
      await page.close()   // nothing but the alarm may trigger the expiry now

      await expect.poll(async () => sw.evaluate(async () => {
        const r = await chrome.storage.local.get(['wallet.approved_origins', 'wallet.auto_revoke'])
        return { origins: r['wallet.approved_origins'], startedAt: r['wallet.auto_revoke']?.startedAt, enabled: r['wallet.auto_revoke']?.enabled }
      }), { timeout: 90_000, intervals: [2_000] }).toEqual({ origins: [], startedAt: null, enabled: true })

      // The wallet UI agrees once reopened.
      const again = await ctx.newPage()
      await again.goto(`chrome-extension://${extId}/popup.html`)
      // (Still unlocked: the session key outlives the closed page.)
      await expect(again.getByText('Portfolio').first()).toBeVisible({ timeout: 30_000 })
      await openSettings(again)
      await expect(again.getByText('No sites connected')).toBeVisible({ timeout: 15_000 })
      await expect(again.getByText('The timer starts when you next connect')).toBeVisible()
      await again.screenshot({ path: 'test-results/auto-revoke-after-expiry.png' })
    } finally {
      await ctx.close()
    }
  })
})
