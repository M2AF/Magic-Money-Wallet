/**
 * wallet-isolation.spec.ts — a new wallet must not inherit the previous
 * wallet's dApp connections.
 *
 * Regression: approved origins were stored per-INSTALL and only ever cleared by
 * the user's own "Disconnect all" button. Creating a fresh wallet therefore
 * showed every site the old wallet had connected to, and — worse than cosmetic —
 * those origins were still granted, so they could read the brand-new address
 * without any approval prompt.
 *
 * Seeds approved-origins.json into a throwaway profile, onboards a NEW wallet,
 * and asserts the grants are gone.
 *
 * Requires `npm run build` (drives out/main/index.js); self-skips otherwise.
 */
import { test, expect } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const PASSWORD = 'Isolation-Test-2026!'

// Shaped exactly like a real approved-origins.json written by secure-store.
const SEEDED = [
  { origin: 'https://opensea.io', chains: ['evm'], addedAt: Date.now() },
  { origin: 'https://magiceden.io', chains: ['solana'], addedAt: Date.now() },
  { origin: 'https://app.dexhunter.io', chains: ['cardano'], addedAt: Date.now() },
]

test.describe('wallet isolation', () => {
  test.skip(!existsSync(MAIN), 'out/main missing — run `npm run build` first')

  test('a newly created wallet inherits no dApp connections', async () => {
    test.setTimeout(240_000)
    // electron-wrapper.cjs points userData straight at this dir, so the app's
    // JSON files sit at its root.
    const profile = mkdtempSync(join(tmpdir(), 'mm-iso-'))
    const originsFile = join(profile, 'approved-origins.json')
    writeFileSync(originsFile, JSON.stringify(SEEDED, null, 2))

    const env = { ...process.env } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    env.MM_TEST_USERDATA = profile
    env.MM_REAL_MAIN = MAIN

    let app: ElectronApplication | undefined
    try {
      app = await _electron.launch({
        args: [join(__dirname, 'electron-wrapper.cjs')],
        executablePath: join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
        env,
      })

      let page: Page | undefined
      for (let i = 0; i < 60 && !page; i++) {
        page = app.windows().find(w => w.url() && !w.url().startsWith('devtools://'))
        if (!page) await new Promise(r => setTimeout(r, 500))
      }
      if (!page) throw new Error('wallet window never appeared')
      const vis = (s: string) => page!.locator(s).filter({ visible: true })

      // Sanity: the seeded grants really are visible to the app before onboarding.
      const before = await page.evaluate(() => window.wallet.getConnectedSites())
      expect(before.length, 'seeded grants should be loaded').toBe(3)

      // Onboard a brand-new wallet.
      await page.getByText('Create New Wallet').first().click()
      await expect(vis('.seed-word')).toHaveCount(12, { timeout: 30_000 })
      await page.getByText(/Reveal phrase/).click()
      await page.getByRole('button', { name: /Written It Down/ }).click()
      await page.getByRole('button', { name: /Save Wallet & Continue/ }).click({ timeout: 30_000 })

      const pw = vis('input[type="password"]')
      await pw.first().fill(PASSWORD)
      await pw.nth(1).fill(PASSWORD)
      await page.getByRole('button', { name: /Create Wallet|Continue|Set Password/ })
        .first().click({ timeout: 30_000 })

      // The new wallet must start with a clean slate.
      await expect.poll(
        () => page!.evaluate(() => window.wallet.getConnectedSites().then(s => s.length)),
        { timeout: 30_000, message: 'new wallet must inherit no dApp grants' },
      ).toBe(0)

      // And it must be gone from disk, not merely hidden in the UI.
      expect(JSON.parse(readFileSync(originsFile, 'utf-8'))).toEqual([])
    } finally {
      await app?.close().catch(() => {})
      rmSync(profile, { recursive: true, force: true })
    }
  })
})
