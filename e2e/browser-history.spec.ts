/**
 * browser-history.spec.ts — browsing history, address-bar recents, and the
 * bookmarks panel's shape, end to end.
 *
 * These claims can only be proven in the real built app, because they span the
 * main-process store, the navigation handlers and the chrome renderer:
 *
 *   1. visiting pages really records them, newest first, under a day heading
 *   2. typing in the address bar offers a RECENT site AND still offers App Hub
 *      apps — the whole point of the merge; a regression that displaced the App
 *      Hub would pass a history-only assertion
 *   3. Remove drops one row and leaves the rest; Clear all empties the list
 *   4. the Tor gate: with Tor Mode on, a visit records nothing and the panel
 *      says why instead of just looking empty
 *   5. Bookmarks renders as the anchored card, not the full-bleed sheet
 *
 * Requires `npm run build` first — self-skips when the build output is missing,
 * same convention as electron-smoke.spec.ts. Run with:
 *   npm run test:e2e:app
 */
import { test, expect } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'

const ROOT = join(__dirname, '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const MNEMONIC = 'test test test test test test test test test test test junk'.split(' ')
const PASSWORD = 'History-Test-2026!'

/** Served on 127.0.0.1; the path is what makes each visit distinguishable. */
const PAGES: Record<string, string> = {
  '/alpha': 'Alpha Fixture Page',
  '/beta': 'Beta Fixture Page',
  '/gamma': 'Gamma Fixture Page',
}

interface HistoryItemLite { id: string; url: string; title: string; host: string; visits: number }

test.describe('browsing history', () => {
  test.skip(!existsSync(MAIN), 'out/main missing — run `npm run build` first (use npm run test:e2e:app)')
  // Serial: one Electron instance and one browser window, and each case builds
  // on the history the previous one left.
  test.describe.configure({ mode: 'serial' })

  let app: ElectronApplication
  let profile: string
  let server: Server
  let baseUrl: string
  let browserWin: Page

  test.beforeAll(async () => {
    // Launching Electron and onboarding a wallet does not fit the 30s default.
    test.setTimeout(180_000)

    server = createServer((req, res) => {
      const title = PAGES[req.url ?? '']
      if (!title) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(`<html><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    profile = mkdtempSync(join(tmpdir(), 'mm-history-e2e-'))
    const env = { ...process.env } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    env.MM_TEST_USERDATA = profile
    env.MM_REAL_MAIN = MAIN
    env.MM_TEST_NO_BIOMETRICS = '1'
    app = await _electron.launch({
      args: [join(__dirname, 'electron-wrapper.cjs')],
      executablePath: join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
      env,
    })

    const wallet = await anyWindow(u => !u.startsWith('devtools://') && !u.includes('browserChrome=1'))
    await vis(wallet, 'button:has-text("Import Existing Wallet")').waitFor({ timeout: 60_000 })
    await vis(wallet, 'button:has-text("Import Existing Wallet")').click()
    for (let i = 0; i < 12; i++) await wallet.locator(`[placeholder="word ${i + 1}"]`).fill(MNEMONIC[i])
    await vis(wallet, 'button:has-text("Import Wallet")').click()
    await wallet.locator('input[type="password"]').first().waitFor({ timeout: 30_000 })
    const pws = wallet.locator('input[type="password"]')
    for (let i = 0; i < await pws.count(); i++) await pws.nth(i).fill(PASSWORD)
    await vis(wallet, 'button:has-text("Encrypt & Continue")').click()
    await vis(wallet, 'text=Portfolio').first().waitFor({ timeout: 60_000 })

    await vis(wallet, '.bottom-nav-btn:has-text("Browser")').click()
    browserWin = await anyWindow(u => u.includes('browserChrome=1'))
    await browserWin.waitForLoadState('domcontentloaded')
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(profile, { recursive: true, force: true })
  })

  async function anyWindow(pred: (url: string) => boolean, timeoutMs = 30_000): Promise<Page> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      for (const w of app.windows()) {
        const u = w.url()
        if (u && pred(u)) return w
      }
      await new Promise(r => setTimeout(r, 300))
    }
    throw new Error('no matching window appeared')
  }

  const vis = (page: Page, sel: string) => page.locator(sel).filter({ visible: true })

  const navigate = (url: string) => browserWin.evaluate((u) => (window as unknown as {
    wallet: { browserNavigate: (x: string) => Promise<void> }
  }).wallet.browserNavigate(u), url)

  /** Ask main directly — used only to assert state the panel also shows. */
  const historyItems = (): Promise<HistoryItemLite[]> => browserWin.evaluate(() => (window as unknown as {
    wallet: { browserListHistory: () => Promise<{ items: HistoryItemLite[] }> }
  }).wallet.browserListHistory().then(s => s.items))

  /** Visit a fixture page and wait until main has recorded it under its title. */
  async function visit(path: string): Promise<void> {
    await navigate(`${baseUrl}${path}`)
    await expect.poll(
      async () => (await historyItems()).find(h => h.url.endsWith(path))?.title,
      { timeout: 20_000 }
    ).toBe(PAGES[path])
  }

  /** Rows carry per-item accessible names, which is the only unambiguous handle. */
  const rowButton = (action: string, name: string) =>
    browserWin.getByRole('button', { name: `${action} ${name}`, exact: true })

  /** Escape closes either floating surface — the ☰ dropdown or a panel. */
  async function closePanels(): Promise<void> {
    await browserWin.keyboard.press('Escape')
    await expect(browserWin.getByRole('button', { name: 'Clear all' })).toHaveCount(0, { timeout: 5_000 })
  }

  async function openHistory(): Promise<void> {
    await closePanels()
    await vis(browserWin, 'button[aria-label="Browser menu"]').first().click()
    await browserWin.getByText('History', { exact: true }).first().click()
    await expect(browserWin.getByText('History', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
  }

  test('records visited pages and lists them newest-first under a day heading', async () => {
    test.setTimeout(120_000)

    await visit('/alpha')
    await visit('/beta')

    const items = await historyItems()
    expect(items.map(h => h.title).slice(0, 2)).toEqual(['Beta Fixture Page', 'Alpha Fixture Page'])

    await openHistory()
    await expect(browserWin.getByText('Today')).toBeVisible()
    await expect(browserWin.getByText('Beta Fixture Page')).toBeVisible()
    await expect(browserWin.getByText('Alpha Fixture Page')).toBeVisible()
  })

  test('collapses a repeat visit onto one entry and counts it', async () => {
    test.setTimeout(120_000)
    await closePanels()

    await visit('/alpha')
    const alpha = (await historyItems()).filter(h => h.url.endsWith('/alpha'))
    expect(alpha).toHaveLength(1)
    expect(alpha[0].visits).toBe(2)
    // …and the repeat moved it back to the front.
    expect((await historyItems())[0].title).toBe('Alpha Fixture Page')
  })

  test('the address bar offers a recent site AND still offers App Hub apps', async () => {
    test.setTimeout(120_000)
    await closePanels()

    // "127" matches the fixture host; "open" is an App Hub term. Typing the host
    // fragment must not cost us the App Hub section.
    const input = browserWin.locator('input[type="text"]').first()
    await input.click()
    await input.fill('127')

    await expect(browserWin.getByText(/^Recent \(\d+\)$/)).toBeVisible({ timeout: 10_000 })
    await expect(browserWin.getByText('Alpha Fixture Page')).toBeVisible()

    // A query that hits the App Hub still shows the Apps section — the merge
    // must never displace what the bar already offered.
    await input.fill('open')
    await expect(browserWin.getByText(/^Apps \(\d+\)$/)).toBeVisible({ timeout: 10_000 })

    await browserWin.keyboard.press('Escape')
  })

  test('clicking a recent suggestion navigates to it', async () => {
    test.setTimeout(120_000)
    await closePanels()
    await visit('/gamma')

    const input = browserWin.locator('input[type="text"]').first()
    await input.click()
    await input.fill('beta')
    await browserWin.getByText('Beta Fixture Page').first().click()

    await expect.poll(async () => browserWin.evaluate(() => (window as unknown as {
      wallet: { browserGetState: () => Promise<{ url: string }> }
    }).wallet.browserGetState().then(s => s.url)), { timeout: 15_000 }).toContain('/beta')
  })

  test('Remove drops one row; Clear all empties the list', async () => {
    test.setTimeout(120_000)
    await openHistory()

    const before = await historyItems()
    expect(before.length).toBeGreaterThan(1)

    await rowButton('Remove', 'Gamma Fixture Page from history').click()
    await expect.poll(async () => (await historyItems()).some(h => h.url.endsWith('/gamma')), { timeout: 10_000 })
      .toBe(false)
    // The others survived — a Remove that cleared everything would pass a
    // "gamma is gone" assertion on its own.
    expect((await historyItems()).length).toBe(before.length - 1)

    await browserWin.getByRole('button', { name: 'Clear all' }).click()
    await browserWin.getByRole('button', { name: 'Clear all history permanently' }).click()
    await expect.poll(async () => (await historyItems()).length, { timeout: 10_000 }).toBe(0)
    await expect(browserWin.getByText('No history yet')).toBeVisible()
  })

  test('Tor Mode suppresses recording and the panel says so', async () => {
    test.setTimeout(180_000)
    await closePanels()

    // Turn Tor Mode on. It will not actually connect in this environment, which
    // is fine and is in fact the fail-closed state — what matters is that the
    // browser now considers itself proxied, so nothing may be written down.
    await browserWin.evaluate(() => (window as unknown as {
      wallet: { browserSetTorMode: (v: boolean) => Promise<unknown> }
    }).wallet.browserSetTorMode(true)).catch(() => {})
    await expect.poll(async () => browserWin.evaluate(() => (window as unknown as {
      wallet: { browserListHistory: () => Promise<{ recording: boolean }> }
    }).wallet.browserListHistory().then(s => s.recording)), { timeout: 20_000 }).toBe(false)

    await navigate(`${baseUrl}/alpha`)
    await browserWin.waitForTimeout(2_000)
    expect(await historyItems()).toHaveLength(0)

    await openHistory()
    await expect(browserWin.getByText(/Tor Mode is on/)).toBeVisible()

    await closePanels()
    await browserWin.evaluate(() => (window as unknown as {
      wallet: { browserSetTorMode: (v: boolean) => Promise<unknown> }
    }).wallet.browserSetTorMode(false)).catch(() => {})
    await expect.poll(async () => browserWin.evaluate(() => (window as unknown as {
      wallet: { browserListHistory: () => Promise<{ recording: boolean }> }
    }).wallet.browserListHistory().then(s => s.recording)), { timeout: 30_000 }).toBe(true)
  })

  test('Bookmarks renders as the anchored card, not a full-page sheet', async () => {
    test.setTimeout(120_000)
    await closePanels()

    await vis(browserWin, 'button[aria-label="Browser menu"]').first().click()
    await browserWin.getByText('Bookmarks', { exact: true }).first().click()

    const heading = browserWin.getByText('Bookmarks', { exact: true }).first()
    await expect(heading).toBeVisible({ timeout: 10_000 })

    // The card is inset from the window; the old full-bleed sheet started at the
    // very left edge of the content area and spanned its whole width.
    const card = browserWin.locator('div').filter({ has: heading }).last()
    const box = await card.boundingBox()
    const viewport = browserWin.viewportSize() ?? await browserWin.evaluate(
      () => ({ width: window.innerWidth, height: window.innerHeight }))
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThan(40)
    expect(box!.width).toBeLessThan(viewport.width * 0.75)
  })
})
