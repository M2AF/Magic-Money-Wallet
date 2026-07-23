/**
 * magic-guard.spec.ts — end-to-end proof that Magic Guard actually blocks
 * requests in the real built Electron app (MAGIC_GUARD_IMPLEMENTATION_PLAN.md
 * Batch B, section 8's "Electron E2E fixture server").
 *
 * A tiny local HTTP server stands in for a dApp page: one ordinary script that
 * must load, one ad-pattern script that must not reach the server. The test
 * points the app at a small deterministic fixture filter list (via the
 * MM_MAGIC_GUARD_TEST_RESOURCES env override in magic-guard.ts's findResource)
 * instead of the real bundled EasyList/EasyPrivacy — those are fetched live and
 * evolve over time, which would make a committed E2E test flaky.
 *
 * Requires `npm run build` first — self-skips when the build output is missing,
 * same convention as electron-smoke.spec.ts. Run explicitly with:
 *   npm run test:e2e:app
 */
import { test, expect } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'

const ROOT = join(__dirname, '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const MNEMONIC = 'test test test test test test test test test test test junk'.split(' ')
const PASSWORD = 'Smoke-Test-2026!'

interface MagicGuardStateLite {
  enabled: boolean
  siteEnabled: boolean
  blockedThisPage: number
  blockedThisTab: number
}

test.describe('Magic Guard — live request blocking', () => {
  test.skip(!existsSync(MAIN), 'out/main missing — run `npm run build` first (use npm run test:e2e:app)')

  let app: ElectronApplication
  let profile: string
  let fixtureResources: string
  let server: Server
  let baseUrl: string
  let okHits = 0
  let adHits = 0

  test.beforeAll(async () => {
    // ── Fixture ad server: one page, one ordinary script, one ad-pattern script ──
    server = createServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body><script src="/ok.js"></script><script src="/fixture-ad.js"></script></body></html>')
      } else if (req.url === '/ok.js') {
        okHits++
        res.writeHead(200, { 'content-type': 'application/javascript' })
        res.end('// ok')
      } else if (req.url === '/fixture-ad.js') {
        adHits++
        res.writeHead(200, { 'content-type': 'application/javascript' })
        res.end('// should never be reached')
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${port}`

    // Deterministic fixture list — NOT the real bundled EasyList/EasyPrivacy.
    fixtureResources = mkdtempSync(join(tmpdir(), 'mm-magicguard-fixture-'))
    writeFileSync(join(fixtureResources, 'easylist.txt'), '[Adblock Plus 2.0]\n/fixture-ad.js^\n')
    writeFileSync(join(fixtureResources, 'easyprivacy.txt'), '[Adblock Plus 2.0]\n')

    profile = mkdtempSync(join(tmpdir(), 'mm-magicguard-e2e-'))
    const env = { ...process.env } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    env.MM_TEST_USERDATA = profile
    env.MM_REAL_MAIN = MAIN
    env.MM_MAGIC_GUARD_TEST_RESOURCES = fixtureResources
    app = await _electron.launch({
      args: [join(__dirname, 'electron-wrapper.cjs')],
      executablePath: join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
      env,
    })
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(profile, { recursive: true, force: true })
    rmSync(fixtureResources, { recursive: true, force: true })
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

  async function guardState(browserWin: Page): Promise<MagicGuardStateLite> {
    return browserWin.evaluate(() => (window as unknown as {
      wallet: { browserGetMagicGuardState: () => Promise<MagicGuardStateLite> }
    }).wallet.browserGetMagicGuardState())
  }

  async function waitForPageBlocked(browserWin: Page, expected: number, timeoutMs = 15_000): Promise<MagicGuardStateLite> {
    const start = Date.now()
    let last: MagicGuardStateLite | null = null
    while (Date.now() - start < timeoutMs) {
      last = await guardState(browserWin)
      if (last.blockedThisPage === expected) return last
      await new Promise(r => setTimeout(r, 200))
    }
    throw new Error(`blockedThisPage never reached ${expected} (last: ${JSON.stringify(last)})`)
  }

  test('blocks the ad-pattern script, allows the ordinary one, and counts correctly', async () => {
    test.setTimeout(180_000)

    const wallet = await anyWindow(u => !u.startsWith('devtools://') && !u.includes('browserChrome=1'))
    const vis = (sel: string) => wallet.locator(sel).filter({ visible: true })

    await vis('button:has-text("Import Existing Wallet")').waitFor({ timeout: 20_000 })
    await vis('button:has-text("Import Existing Wallet")').click()
    for (let i = 0; i < 12; i++) await wallet.locator(`[placeholder="word ${i + 1}"]`).fill(MNEMONIC[i])
    await vis('button:has-text("Import Wallet")').click()

    await wallet.locator('input[type="password"]').first().waitFor({ timeout: 20_000 })
    const pws = wallet.locator('input[type="password"]')
    for (let i = 0; i < await pws.count(); i++) await pws.nth(i).fill(PASSWORD)
    await vis('button:has-text("Encrypt & Continue")').click()
    await vis('text=Portfolio').first().waitFor({ timeout: 30_000 })

    await vis('.bottom-nav-btn:has-text("Browser")').click()
    const browserWin = await anyWindow(u => u.includes('browserChrome=1'))
    await browserWin.waitForLoadState('domcontentloaded')

    // ── Tab 1: navigate to the fixture page ─────────────────────────────────
    await browserWin.evaluate((url) => (window as unknown as {
      wallet: { browserNavigate: (u: string) => Promise<void> }
    }).wallet.browserNavigate(url), baseUrl)

    const s1 = await waitForPageBlocked(browserWin, 1)
    expect(s1.enabled).toBe(true)
    expect(s1.siteEnabled).toBe(true)
    expect(s1.blockedThisTab).toBe(1)
    expect(okHits).toBeGreaterThanOrEqual(1)
    expect(adHits).toBe(0) // the ad-pattern request never reached the server

    // ── Reload proves the PAGE counter resets (stays 1, not 2) while the TAB
    //    counter accumulates (2) ────────────────────────────────────────────
    await browserWin.evaluate(() => (window as unknown as {
      wallet: { browserReload: () => void }
    }).wallet.browserReload())
    const s2 = await waitForPageBlocked(browserWin, 1)
    expect(s2.blockedThisTab).toBe(2)
    expect(adHits).toBe(0)

    // ── Tab isolation: a second tab starts at zero and blocking in it does not
    //    affect tab 1's already-established counts ─────────────────────────
    await browserWin.evaluate(() => (window as unknown as {
      wallet: { browserNewTab: (u?: string) => void }
    }).wallet.browserNewTab())
    await browserWin.evaluate((url) => (window as unknown as {
      wallet: { browserNavigate: (u: string) => Promise<void> }
    }).wallet.browserNavigate(url), baseUrl)
    const tab2State = await waitForPageBlocked(browserWin, 1)
    expect(tab2State.blockedThisTab).toBe(1) // fresh tab, not 3

    // Switch back to tab 1 and confirm its counts are exactly what they were —
    // tab 2's activity did not leak into tab 1's counters.
    const tabs = await browserWin.evaluate(() => (window as unknown as {
      wallet: { browserGetState: () => Promise<{ tabs: Array<{ id: number }> }> }
    }).wallet.browserGetState())
    const tab1Id = tabs.tabs[0].id
    await browserWin.evaluate((id) => (window as unknown as {
      wallet: { browserSetActiveTab: (id: number) => void }
    }).wallet.browserSetActiveTab(id), tab1Id)
    const backToTab1 = await guardState(browserWin)
    expect(backToTab1.blockedThisTab).toBe(2)
  })
})
