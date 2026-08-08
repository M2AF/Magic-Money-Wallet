/**
 * passkey-browser.spec.ts — passkeys inside Magic Money's own browser
 *
 * The thing Phase 0 proved was impossible with someone else's password manager:
 * a full WebAuthn register + sign-in loop inside the wallet's built-in browser,
 * against a relying party running ChainLens's own passkey routes.
 *
 * What this drives, for real:
 *   the built Electron app → its dApp browser → document-start injection of the
 *   page-world shim → __mmBridge__ → the passkey:* IPC handlers (origin taken
 *   from the tab's URL, never the page) → seed-derived key → the branded
 *   approval window → @simplewebauthn/server verifying the result.
 *
 * Requires `npm run build` first; self-skips without it, like electron-smoke.
 * Run:  npx playwright test e2e/passkey-browser.spec.ts
 *
 * Biometrics are stubbed OUT at the harness level (MM_TEST_NO_BIOMETRICS, see
 * electron-wrapper.cjs): Windows Hello pops a native dialog no automation can
 * dismiss. The app then takes its documented no-biometrics path, where the
 * unlocked wallet's password is the user verification.
 */
import { test, expect } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rp = require('./chainlens-rp.cjs') as {
  start(rpId?: string): Promise<{ url: string; port: number; passkeys: unknown[]; close(): Promise<void> }>
}

const ROOT = join(__dirname, '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const MNEMONIC = 'test test test test test test test test test test test junk'.split(' ')
const PASSWORD = 'Passkey-E2E-2026!'

interface PageResult { ok?: boolean; stage?: string; verified?: boolean; error?: string; name?: string; aaguid?: string; deviceType?: string; backedUp?: boolean; userVerified?: boolean }

test.describe('passkeys in the built-in browser', () => {
  test.skip(!existsSync(MAIN), 'out/main missing — run `npm run build` first')

  let app: ElectronApplication
  let wallet: Page
  let profile: string
  let server: Awaited<ReturnType<typeof rp.start>>

  const vis = (p: Page, selector: string) => p.locator(selector).filter({ visible: true })

  async function windowMatching(pred: (u: string) => boolean, timeoutMs = 30_000): Promise<Page> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      for (const w of app.windows()) {
        const u = w.url()
        if (u && !u.startsWith('devtools://') && pred(u)) return w
      }
      await new Promise(r => setTimeout(r, 250))
    }
    throw new Error('no window matched in time')
  }

  /**
   * The approval window is our own frameless BrowserWindow on a data: URL.
   * Waiting for it and clicking its confirm button is the e2e's stand-in for the
   * human — the ceremony genuinely does not proceed without this.
   */
  async function approvalWindow(timeoutMs = 30_000): Promise<Page> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      for (const w of app.windows()) {
        if (w.url().startsWith('data:text/html')) return w
      }
      // If the page has already settled, the ceremony failed before ever asking
      // the user — surface THAT rather than a useless "no window" timeout.
      const settled = await evalInSite<{ error?: string; name?: string } | null>('window.__mmResult').catch(() => null)
      if (settled) throw new Error(`ceremony settled before any prompt: ${JSON.stringify(settled)}`)
      if (Date.now() > deadline) throw new Error('the approval window never appeared')
      await new Promise(r => setTimeout(r, 250))
    }
  }

  async function approve(expect_: 'Create passkey' | 'Sign in'): Promise<void> {
    const win = await approvalWindow()
    const button = win.locator(`button.confirm:has-text("${expect_}")`)
    await button.waitFor({ state: 'visible', timeout: 10_000 })
    await button.click()
  }

  test.beforeAll(async () => {
    // Launching Electron and onboarding a wallet is well past the 30s default.
    test.setTimeout(300_000)
    server = await rp.start('localhost')
    profile = mkdtempSync(join(tmpdir(), 'mm-passkey-e2e-'))
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
    wallet = await windowMatching(u => u.startsWith('file://') || u.includes('index.html'), 60_000)

    // Onboard: import the throwaway Foundry wallet and set a password.
    await expect(vis(wallet, 'button:has-text("Import Existing Wallet")')).toBeVisible({ timeout: 30_000 })
    await vis(wallet, 'button:has-text("Import Existing Wallet")').click()
    for (let i = 0; i < 12; i++) {
      await wallet.locator(`[placeholder="word ${i + 1}"]`).fill(MNEMONIC[i])
    }
    await vis(wallet, 'button:has-text("Import Wallet")').click()
    // Filter by visibility: the unlock page stays MOUNTED behind onboarding, so
    // an unfiltered locator matches invisible inputs too (same trap the smoke
    // spec's `vis` helper exists for).
    const pws = vis(wallet, 'input[type="password"]')
    await expect(pws.first()).toBeVisible({ timeout: 30_000 })
    for (let i = 0; i < await pws.count(); i++) await pws.nth(i).fill(PASSWORD)
    await vis(wallet, 'button:has-text("Encrypt & Continue")').click()
    await expect(vis(wallet, 'text=Portfolio').first()).toBeVisible({ timeout: 60_000 })
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
    await server?.close().catch(() => {})
    // Windows keeps the profile locked briefly after Electron exits; a stale
    // temp dir must not fail an otherwise-green run.
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* best effort */ }
  })

  /**
   * The dApp page renders inside a WebContentsView, which Playwright's
   * `app.windows()` does not surface (it lists BrowserWindows only). Reaching it
   * through the main process is the supported route — and it is also how the
   * production code addresses that view, so the test drives the real thing.
   */
  function evalInSite<T>(script: string): Promise<T> {
    return app.evaluate(({ webContents }, args) => {
      const wc = webContents.getAllWebContents().find(w => w.getURL().includes(`:${args.port}`))
      if (!wc) throw new Error('the site never opened in the built-in browser')
      return wc.executeJavaScript(args.script, true) as Promise<T>
    }, { port: server.port, script }) as Promise<T>
  }

  async function siteReady(timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      try {
        if (await evalInSite<boolean>('typeof window.__mmCaps === "function"')) return
      } catch { /* view not up yet */ }
      if (Date.now() > deadline) throw new Error('the site never opened in the built-in browser')
      await new Promise(r => setTimeout(r, 300))
    }
  }

  /** Poll for the page's ceremony result (it settles only after the approval). */
  async function pageResult(timeoutMs = 120_000): Promise<PageResult> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const v = await evalInSite<PageResult | null>('window.__mmResult')
      if (v) return v
      if (Date.now() > deadline) throw new Error('the page never settled')
      await new Promise(r => setTimeout(r, 300))
    }
  }

  test('registers and then signs in, both verified by the relying party', async () => {
    test.setTimeout(300_000)

    // Open the site in the wallet's own browser.
    await app.evaluate(({ ipcMain }, url) => { ipcMain.emit('browser:open-url', {}, url) }, server.url)
    await siteReady()

    // ── OUR shim is installed at document-start ──────────────────────────────
    // ⚠ Checking only that `navigator.credentials` exists is NOT enough: it
    // exists natively too. An earlier build silently failed to inject (the
    // sandboxed preload has no `fs`) and every ceremony fell through to Windows
    // Hello — which "passed" a weaker assertion while testing nothing at all.
    const caps = await evalInSite<Record<string, unknown>>('window.__mmCaps()')
    expect(caps.hasCredentials).toBe(true)
    expect(caps.hasPublicKeyCredential).toBe(true)
    expect(caps.uvpaa).toBe(true)
    expect(await evalInSite<boolean>('window.__MAGICMONEY_PASSKEY_INSTALLED__ === true')).toBe(true)

    // ── Register ─────────────────────────────────────────────────────────────
    await evalInSite('document.getElementById("reg").click(), null')
    await approve('Create passkey')

    const reg = await pageResult()
    expect(reg.error, `registration failed: ${reg.error ?? ''}`).toBeUndefined()
    expect(reg.ok).toBe(true)
    expect(reg.verified).toBe(true)
    // Zeroed on this path: in our own browser we are the CLIENT as well as the
    // authenticator, and blanking the AAGUID is the client's job.
    expect(reg.aaguid).toBe('00000000-0000-0000-0000-000000000000')
    // A seed-derived credential really is multi-device and really is backed up.
    expect(reg.deviceType).toBe('multiDevice')
    expect(reg.backedUp).toBe(true)
    expect(server.passkeys).toHaveLength(1)

    // ── Sign in — discoverable, no username, no credential named ─────────────
    await evalInSite('window.__mmResult = null')
    await evalInSite('document.getElementById("login").click(), null')
    await approve('Sign in')

    const login = await pageResult()
    expect(login.error, `sign-in failed: ${login.error ?? ''}`).toBeUndefined()
    expect(login.ok).toBe(true)
    expect(login.verified).toBe(true)
    expect(login.userVerified).toBe(true)
  })

  // Rejecting is exercised on SIGN-IN rather than registration: by this point the
  // RP holds our credential and sends it in excludeCredentials, so a second
  // registration correctly fails with InvalidStateError before any prompt — the
  // exclude path working, but not the path this test is about.
  test('a rejected approval surfaces as NotAllowedError and signs nobody in', async () => {
    test.setTimeout(180_000)
    await siteReady()

    await evalInSite('window.__mmResult = null')
    await evalInSite('document.getElementById("login").click(), null')

    const win = await approvalWindow()
    await win.locator('button.reject').click()

    const result = await pageResult(60_000)
    expect(result.ok).toBe(false)
    expect(result.name).toBe('NotAllowedError')
    // No session handed out.
    expect(result).not.toHaveProperty('token')
  })

  // The excludeCredentials path itself, stated as its own expectation.
  test('refuses to mint a second passkey the site already holds', async () => {
    test.setTimeout(180_000)
    await siteReady()
    const before = server.passkeys.length

    await evalInSite('window.__mmResult = null')
    await evalInSite('document.getElementById("reg").click(), null')

    const result = await pageResult(60_000)
    expect(result.ok).toBe(false)
    expect(result.name).toBe('InvalidStateError')
    expect(server.passkeys).toHaveLength(before)
  })
})

/**
 * Read-only compatibility probe against the DEPLOYED site.
 *
 * The local RP above runs ChainLens's ceremony code, but only the real
 * deployment can confirm the options it hands out today are the ones the shim
 * consumes. This asks for a login challenge — a public, unauthenticated route
 * that writes nothing — and checks the shape. Registration is deliberately NOT
 * attempted here: it needs a real session and would add a row to the production
 * cl_passkeys table.
 */
test.describe('chainlensnft.info deployed passkey routes', () => {
  test('hands out login options the shim can consume', async ({ request }) => {
    test.setTimeout(60_000)

    let available: { available?: boolean } | null = null
    try {
      const res = await request.get('https://www.chainlensnft.info/api/auth/passkey/available', { timeout: 20_000 })
      available = await res.json()
    } catch {
      test.skip(true, 'chainlensnft.info unreachable from this machine')
    }
    test.skip(!available?.available, 'passkeys are not enabled on the deployment right now')

    const res = await request.post('https://www.chainlensnft.info/api/auth/passkey/login-options', { timeout: 20_000 })
    expect(res.ok()).toBe(true)
    const body = await res.json()

    expect(typeof body.ceremony).toBe('string')
    expect(typeof body.options?.challenge).toBe('string')
    // The rpId must be a registrable domain the origin owns, or our own
    // passkey-protocol check would (correctly) refuse the ceremony.
    expect(body.options.rpId).toBe('chainlensnft.info')
    // Discoverable sign-in: no credential list, which is the path the account
    // chooser exists for.
    expect(body.options.allowCredentials ?? []).toHaveLength(0)
  })
})
