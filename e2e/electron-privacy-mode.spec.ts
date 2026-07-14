/**
 * electron-privacy-mode.spec.ts — end-to-end smoke of Privacy Mode: enable the
 * toggle in Settings, verify the portfolio filters down to the privacy chains
 * (Monero / Zcash / Midnight) with derived receive addresses, Swap is gated,
 * and the mode round-trips back off to the full portfolio.
 *
 * Same harness/gotchas as electron-smoke.spec.ts (wrapper main for a throwaway
 * profile, devtools-window filtering, visibility-filtered locators). Requires
 * `npm run build` first; self-skips otherwise.
 */
import { test, expect } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
// Public Foundry/Anvil test mnemonic — throwaway by definition. Its Monero
// address is pinned in wallet-core.test.ts (verified against monero-ts).
const MNEMONIC = 'test test test test test test test test test test test junk'.split(' ')
const PASSWORD = 'Smoke-Test-2026!'
const XMR_ADDR = '48Xucn75vn7aEEPSksVh3VY1SZEToLh56gbiHKEybgkAMgxr4ehqxaeSF7HzX9e1rAbCXV4Snr8Vwicae6kgX58fHnidf65'

test.describe('electron privacy mode', () => {
  test.skip(!existsSync(MAIN), 'out/main missing — run `npm run build` first')

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
    profile = mkdtempSync(join(tmpdir(), 'mm-e2e-privacy-'))
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

  test('toggles privacy mode, shows only privacy chains with addresses, and round-trips off', async () => {
    test.setTimeout(300_000)

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

    // ── Enable Privacy Mode from Settings (renderer reloads) ──────────────
    await vis('button[title="Settings"]').first().click()
    await expect(vis('text=Privacy Mode — Off').first()).toBeVisible({ timeout: 15_000 })
    await vis('text=Privacy Mode — Off').first().click()

    // The toggle reloads the renderer; the PRIVACY badge is the ready signal.
    await expect(vis('text=PRIVACY').first()).toBeVisible({ timeout: 60_000 })

    // ── Portfolio is filtered to exactly the privacy chains ───────────────
    await expect(vis('text=Monero').first()).toBeVisible({ timeout: 30_000 })
    await expect(vis('text=Zcash').first()).toBeVisible()
    await expect(vis('text=Midnight').first()).toBeVisible()
    // Hidden mainnet chains must NOT render.
    await expect(vis('text=Ethereum')).toHaveCount(0)
    await expect(vis('text=Solana')).toHaveCount(0)

    // Derived receive addresses render on the cards (t1… for ZEC, 4… for XMR).
    await expect(vis(`text=${XMR_ADDR.slice(0, 8)}`).first()).toBeVisible({ timeout: 30_000 })
    // Midnight renders its Lace-verified unshielded + shielded receive
    // addresses, but no Send button (sends need DUST + a proof server).
    await expect(vis('text=Unshielded · NIGHT').first()).toBeVisible({ timeout: 30_000 })
    // The AGW smart-wallet panel must not leak into the filtered view.
    await expect(vis('text=Abstract Smart Wallet')).toHaveCount(0)
    // Zcash card has a live Send button; Midnight must not.
    await expect(vis('button:has-text("Send ZEC")').first()).toBeVisible({ timeout: 60_000 })
    await expect(vis('button:has-text("Send NIGHT")')).toHaveCount(0)

    // ── Zcash send-form validation uses the new validator ─────────────────
    await vis('button:has-text("Send ZEC")').first().click()
    const addr = vis('.input').first()
    await addr.fill('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
    await expect(vis('text=Not a valid Zcash transparent address')).toBeVisible({ timeout: 10_000 })
    await addr.fill('t1KFBrLNZzu7f4RgUrTAdhKhBWU5m7GkGov')
    await expect(vis('text=Not a valid Zcash transparent address')).toHaveCount(0, { timeout: 10_000 })
    await page.keyboard.press('Escape')

    // ── Swap tab is gated in Privacy Mode ──────────────────────────────────
    await vis('.bottom-nav-btn:has-text("Swap")').click()
    await expect(vis('text=Not available in Privacy Mode').first()).toBeVisible({ timeout: 15_000 })
    await vis('.bottom-nav-btn:has-text("Portfolio")').click()

    // ── Round-trip: toggle back off restores the full portfolio ───────────
    await vis('button[title="Settings"]').first().click()
    await expect(vis('text=Privacy Mode — On').first()).toBeVisible({ timeout: 15_000 })
    await vis('text=Privacy Mode — On').first().click()
    await expect(vis('text=Ethereum').first()).toBeVisible({ timeout: 60_000 })
    await expect(vis('text=PRIVACY')).toHaveCount(0)
  })
})
