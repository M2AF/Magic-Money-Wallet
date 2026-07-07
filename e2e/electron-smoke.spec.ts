/**
 * electron-smoke.spec.ts — end-to-end smoke of the built Electron wallet
 * (audit M-7): onboarding, dashboard, tab navigation, and the send-form's
 * per-chain validation, against a throwaway profile.
 *
 * Requires `npm run build` first (drives out/main/index.js) — the spec
 * self-skips when the build output is missing so the extension-only
 * `npm run test:e2e` keeps working unchanged. Run explicitly with:
 *   npm run test:e2e:app
 *
 * Gotchas encoded here (learned the hard way):
 *  - VS Code shells export ELECTRON_RUN_AS_NODE=1 → electron.app is undefined.
 *  - Dev builds auto-open detached DevTools; firstWindow() may return it, so
 *    poll for a window whose URL isn't devtools://.
 *  - DashboardPage stays MOUNTED (hidden) behind other tabs — always filter
 *    locators by visibility or text matches invisible nodes.
 */
import { test, expect } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
// Public Foundry/Anvil test mnemonic — throwaway by definition.
const MNEMONIC = 'test test test test test test test test test test test junk'.split(' ')
const PASSWORD = 'Smoke-Test-2026!'

test.describe('electron wallet smoke', () => {
  test.skip(!existsSync(MAIN), 'out/main missing — run `npm run build` first (use npm run test:e2e:app)')

  let app: ElectronApplication
  let page: Page
  let profile: string

  async function appWindow(): Promise<Page> {
    for (let i = 0; i < 60; i++) {
      for (const w of app.windows()) {
        const u = w.url()
        if (u && !u.startsWith('devtools://')) return w
      }
      await new Promise(r => setTimeout(r, 500))
    }
    throw new Error('wallet window never appeared')
  }

  const vis = (selector: string) => page.locator(selector).filter({ visible: true })

  test.beforeAll(async () => {
    profile = mkdtempSync(join(tmpdir(), 'mm-e2e-'))
    const env = { ...process.env } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    env.MM_TEST_USERDATA = profile
    env.MM_REAL_MAIN = MAIN
    app = await _electron.launch({
      args: [join(__dirname, 'electron-wrapper.cjs')],
      executablePath: join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
      env,
    })
    page = await appWindow()
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
    rmSync(profile, { recursive: true, force: true })
  })

  test('onboards, navigates every tab, and validates send recipients', async () => {
    test.setTimeout(240_000)

    // ── Onboarding: import → password → dashboard ─────────────────────────
    await expect(vis('button:has-text("Import Existing Wallet")')).toBeVisible({ timeout: 20_000 })
    await vis('button:has-text("Import Existing Wallet")').click()
    for (let i = 0; i < 12; i++) {
      await page.locator(`[placeholder="word ${i + 1}"]`).fill(MNEMONIC[i])
    }
    await vis('button:has-text("Import Wallet")').click()

    await expect(page.locator('input[type="password"]').first()).toBeVisible({ timeout: 20_000 })
    const pws = page.locator('input[type="password"]')
    for (let i = 0; i < await pws.count(); i++) await pws.nth(i).fill(PASSWORD)
    await vis('button:has-text("Encrypt & Continue")').click()

    await expect(vis('text=Portfolio').first()).toBeVisible({ timeout: 30_000 })

    // ── Tab navigation ─────────────────────────────────────────────────────
    await vis('.bottom-nav-btn:has-text("Market")').click()
    await expect(vis('text=Market Watch').first()).toBeVisible({ timeout: 30_000 })

    await vis('.bottom-nav-btn:has-text("Swap")').click()
    await expect(vis('text=YOU PAY').first()).toBeVisible({ timeout: 15_000 })

    await vis('.bottom-nav-btn:has-text("Apps")').click()
    await expect(vis('text=App Hub').first()).toBeVisible({ timeout: 15_000 })

    await vis('.bottom-nav-btn:has-text("Portfolio")').click()

    // ── Send validation (H-3): wrong-chain paste fails at the field ───────
    // Chain cards render once balances resolve; Solana's card is deterministic.
    const sendSol = vis('button:has-text("Send SOL")')
    await expect(sendSol.first()).toBeVisible({ timeout: 60_000 })
    await sendSol.first().click()

    const addr = vis('.input').first()
    await addr.fill('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')   // EVM addr into a Solana send
    await expect(vis('text=Not a valid Solana address')).toBeVisible({ timeout: 10_000 })

    // Valid recipient clears the error; over-balance amount is capped.
    await addr.fill('11111111111111111111111111111111')
    await expect(vis('text=Not a valid Solana address')).toHaveCount(0, { timeout: 10_000 })
    await vis('input[placeholder="0.0"]').fill('999999')
    await expect(vis('text=Exceeds available balance')).toBeVisible({ timeout: 10_000 })
  })
})
