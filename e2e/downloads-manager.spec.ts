/**
 * downloads-manager.spec.ts — the browser's downloads tray, end to end.
 *
 * Everything here is a claim that can only be proven in the real built app,
 * because it spans Chromium's download stack, the main-process record store and
 * the chrome renderer:
 *
 *   1. a link that downloads really produces a tray row, and the bytes really
 *      land on disk under the recorded name
 *   2. "Delete" deletes the FILE, not just the row (the one destructive action
 *      in the panel)
 *   3. "Retry" really re-requests through a dApp tab — the fixture counts its
 *      hits, so a Retry that only rewrote the row would fail the assertion. It
 *      is driven from a row whose file was deleted behind the app's back, which
 *      is deterministic in a way "make Chromium fail a download" is not:
 *      Chromium retries an interrupted transfer on its own
 *   4. "Cancel" stops an in-flight download and the partial file does not
 *      survive as a completed row
 *
 * Downloads are redirected into the temp profile by MM_TEST_DOWNLOADS_DIR (see
 * electron-wrapper.cjs) — this spec deletes files, and must never be pointed at
 * a real Downloads folder.
 *
 * Requires `npm run build` first — self-skips when the build output is missing,
 * same convention as electron-smoke.spec.ts. Run with:
 *   npm run test:e2e:app
 */
import { test, expect } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'

const ROOT = join(__dirname, '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const MNEMONIC = 'test test test test test test test test test test test junk'.split(' ')
const PASSWORD = 'Downloads-Test-2026!'

const REPORT_BODY = 'MagicMoney downloads-tray fixture\n'.repeat(64)

test.describe('downloads manager', () => {
  test.skip(!existsSync(MAIN), 'out/main missing — run `npm run build` first (use npm run test:e2e:app)')
  // Serial: these share ONE app instance and one browser window, and each case
  // builds on the tray state the previous one left. The config's fullyParallel
  // would otherwise fan them out across workers, re-launching Electron (and
  // re-onboarding) four times.
  test.describe.configure({ mode: 'serial' })

  let app: ElectronApplication
  let profile: string
  let downloadsDir: string
  let server: Server
  let baseUrl: string
  let browserWin: Page

  /** Hits on /retry.txt — Retry has to produce exactly one more. */
  let retryHits = 0
  /** Held open so /slow.bin is still in flight when Cancel is clicked. */
  let slowResponses: Array<() => void> = []

  test.beforeAll(async () => {
    // Launching Electron and onboarding a wallet does not fit the 30s default.
    test.setTimeout(180_000)
    server = createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body><h1>fixture</h1></body></html>')
        return
      }
      if (req.url === '/report.txt') {
        res.writeHead(200, {
          'content-type': 'text/plain',
          'content-length': String(Buffer.byteLength(REPORT_BODY)),
          'content-disposition': 'attachment; filename="report.txt"',
        })
        res.end(REPORT_BODY)
        return
      }
      if (req.url === '/retry.txt') {
        retryHits++
        const body = `hit ${retryHits}`
        res.writeHead(200, {
          'content-type': 'text/plain',
          'content-length': String(Buffer.byteLength(body)),
          'content-disposition': 'attachment; filename="retry.txt"',
        })
        res.end(body)
        return
      }
      if (req.url === '/slow.bin') {
        // Declares a size it never finishes sending, so the row sits at
        // "progressing" until the test cancels it.
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': String(8 * 1024 * 1024),
          'content-disposition': 'attachment; filename="slow.bin"',
        })
        res.write(Buffer.alloc(4096))
        slowResponses.push(() => { try { res.destroy() } catch { /* already gone */ } })
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    profile = mkdtempSync(join(tmpdir(), 'mm-downloads-e2e-'))
    downloadsDir = join(profile, 'Downloads')
    const env = { ...process.env } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    env.MM_TEST_USERDATA = profile
    env.MM_TEST_DOWNLOADS_DIR = downloadsDir
    env.MM_REAL_MAIN = MAIN
    env.MM_TEST_NO_BIOMETRICS = '1'
    app = await _electron.launch({
      args: [join(__dirname, 'electron-wrapper.cjs')],
      executablePath: join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
      env,
    })

    // ── Onboard, then open the browser window every case works in ──────────
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

    // Park the tab on a real page. A Content-Disposition: attachment response
    // downloads WITHOUT navigating, so every case below leaves this page up —
    // which is also what a user sees, and what the chrome's overlay machinery
    // needs (opening any menu snapshots the live view first).
    await navigate(`${baseUrl}/`)
    await expect.poll(async () => (await browserState()).url, { timeout: 20_000 })
      .toContain('127.0.0.1')
  })

  test.afterAll(async () => {
    for (const end of slowResponses) end()
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

  const browserState = () => browserWin.evaluate(() => (window as unknown as {
    wallet: { browserGetState: () => Promise<{ url: string }> }
  }).wallet.browserGetState())

  /**
   * One row's action button. Every row repeats the same three or four labels, so
   * the panel gives them per-file accessible names — which is both the a11y fix
   * and the only unambiguous handle here.
   */
  const rowButton = (action: string, fileName: string) =>
    browserWin.getByRole('button', { name: `${action} ${fileName}`, exact: true })

  /**
   * Open the tray from the ☰ — deliberately through the menu rather than the
   * toolbar button, because the menu row is the path that exists even before
   * anything has been downloaded.
   */
  async function openTray(): Promise<void> {
    await closeTray()
    await vis(browserWin, 'button[aria-label="Browser menu"]').first().click()
    await browserWin.getByText('Downloads', { exact: true }).first().click()
    // "Open folder" exists only inside the panel, so it is the unambiguous
    // signal that the tray (not the still-open menu) is on screen.
    await expect(browserWin.getByRole('button', { name: 'Open folder' }))
      .toBeVisible({ timeout: 10_000 })
  }

  /** Escape closes either floating surface — the ☰ dropdown or the panel. */
  async function closeTray(): Promise<void> {
    await browserWin.keyboard.press('Escape')
    await expect(browserWin.getByRole('button', { name: 'Open folder' }))
      .toHaveCount(0, { timeout: 5_000 })
  }

  /** Files actually on disk in the redirected Downloads folder. */
  const savedFiles = (): string[] => {
    try { return readdirSync(downloadsDir) } catch { return [] }
  }

  async function waitForFile(name: string, timeoutMs = 20_000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (savedFiles().includes(name)) return
      await new Promise(r => setTimeout(r, 200))
    }
    throw new Error(`${name} never appeared in ${downloadsDir} (saw: ${savedFiles().join(', ')})`)
  }

  /** Ask main directly — used only to assert state the UI also shows. */
  async function trayItems(): Promise<Array<{ fileName: string; state: string; exists: boolean }>> {
    return browserWin.evaluate(() => (window as unknown as {
      wallet: { browserListDownloads: () => Promise<{ items: Array<{ fileName: string; state: string; exists: boolean }> }> }
    }).wallet.browserListDownloads().then(s => s.items))
  }

  test('records a real download, then Delete removes the file from disk', async () => {
    test.setTimeout(120_000)

    await navigate(`${baseUrl}/report.txt`)

    await waitForFile('report.txt')
    expect(readFileSync(join(downloadsDir, 'report.txt'), 'utf8')).toBe(REPORT_BODY)

    // ── The tray shows it ──────────────────────────────────────────────────
    await openTray()
    await expect(browserWin.getByText('report.txt').first()).toBeVisible({ timeout: 10_000 })
    const items = await trayItems()
    expect(items.some(i => i.fileName === 'report.txt' && i.state === 'completed' && i.exists)).toBe(true)

    // ── Delete: two-step, and it takes the file with it ────────────────────
    await rowButton('Delete', 'report.txt').click()
    await expect(browserWin.getByText('Delete file?')).toBeVisible()
    await browserWin.getByRole('button', { name: 'Delete report.txt permanently' }).click()

    await expect.poll(() => savedFiles().includes('report.txt'), { timeout: 10_000 }).toBe(false)
    expect((await trayItems()).some(i => i.fileName === 'report.txt')).toBe(false)
  })

  test('Retry re-requests a download whose file has gone missing', async () => {
    test.setTimeout(120_000)
    await closeTray()

    await navigate(`${baseUrl}/retry.txt`)
    await waitForFile('retry.txt')
    expect(retryHits).toBe(1)

    // Delete it behind the app's back, the way a user tidying their Downloads
    // folder would. The row must notice on the next read rather than offering
    // an Open button that fails.
    rmSync(join(downloadsDir, 'retry.txt'))
    await expect.poll(
      async () => (await trayItems()).find(i => i.fileName === 'retry.txt')?.exists,
      { timeout: 10_000 }
    ).toBe(false)

    await openTray()
    await expect(rowButton('Open', 'retry.txt')).toHaveCount(0)
    await rowButton('Retry', 'retry.txt').click()

    await waitForFile('retry.txt')
    // The fixture's body carries its hit number, so this proves a REAL second
    // request went out rather than the row being rewritten.
    expect(readFileSync(join(downloadsDir, 'retry.txt'), 'utf8')).toBe('hit 2')
    expect(retryHits).toBe(2)
    // The old row is replaced, not duplicated. Polled, not read once: the file
    // appears on disk slightly BEFORE the item's `done` event settles the
    // record, so an instant read can still catch it mid-flight.
    await expect.poll(
      async () => (await trayItems()).find(i => i.fileName.startsWith('retry'))?.state,
      { timeout: 10_000 }
    ).toBe('completed')
    expect((await trayItems()).filter(i => i.fileName.startsWith('retry'))).toHaveLength(1)
  })

  test('Cancel stops an in-flight download', async () => {
    test.setTimeout(120_000)
    await closeTray()

    await navigate(`${baseUrl}/slow.bin`)

    await expect.poll(
      async () => (await trayItems()).find(i => i.fileName.startsWith('slow'))?.state,
      { timeout: 20_000 }
    ).toBe('progressing')

    await openTray()
    await rowButton('Cancel', 'slow.bin').click()

    await expect.poll(
      async () => (await trayItems()).find(i => i.fileName.startsWith('slow'))?.state,
      { timeout: 15_000 }
    ).toBe('cancelled')
    // A cancelled download leaves nothing behind to open.
    expect(savedFiles().some(f => f.startsWith('slow.bin'))).toBe(false)
  })

  test('Clear list forgets the finished rows but keeps the files', async () => {
    test.setTimeout(120_000)
    await closeTray()

    await navigate(`${baseUrl}/report.txt`)
    await waitForFile('report.txt')

    await openTray()
    await browserWin.getByRole('button', { name: 'Clear list' }).click()

    await expect.poll(async () => (await trayItems()).length, { timeout: 10_000 }).toBe(0)
    // The point of Clear vs Delete: the file survives.
    expect(savedFiles()).toContain('report.txt')
  })
})
