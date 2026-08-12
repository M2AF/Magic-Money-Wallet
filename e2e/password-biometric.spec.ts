/**
 * password-biometric.spec.ts — biometric unlock for the browser's password vault
 *
 * Drives the real built app end to end: onboarding → Settings → Windows Hello
 * unlock for the WALLET → the dApp browser's ☰ → Password manager → turn Hello
 * on for the VAULT → lock it → unlock it with Hello. Everything below the OS
 * consent dialog is production code (IPC, HKDF wrap, AES-GCM, safeStorage, the
 * files on disk); only the dialog itself is stubbed, via MM_TEST_FAKE_HELLO in
 * electron-wrapper.cjs, because no automation can dismiss a native Hello prompt.
 *
 * ⚠ The load-bearing assertions are the last two:
 *   1. every bridge call the password manager makes names MagicMoneyPasswordGate
 *      and never MagicMoneyWalletVault, and
 *   2. wallet.hello.enc is byte-identical afterwards and still unlocks the wallet.
 * Sharing the wallet's key would route a password-manager prompt into
 * secure-store's NotFound self-heal, which DELETES wallet.hello.enc — silently
 * disabling biometric unlock for the wallet itself. Unit-level twin:
 * src/main/password-vault.test.ts.
 *
 * Requires `npm run build` first; self-skips without it, like electron-smoke.
 * Run:  npx playwright test e2e/password-biometric.spec.ts
 */
import { test, expect } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const MNEMONIC = 'test test test test test test test test test test test junk'.split(' ')
const PASSWORD = 'PwBio-E2E-2026!'

const WALLET_KEY = 'MagicMoneyWalletVault'
const VAULT_KEY = 'MagicMoneyPasswordGate'

test.describe('biometric unlock for the password manager', () => {
  test.skip(!existsSync(MAIN), 'out/main missing — run `npm run build` first')

  let app: ElectronApplication
  let wallet: Page
  let profile: string
  let helloLog: string

  const vis = (selector: string) => wallet.locator(selector).filter({ visible: true })
  const bridgeCalls = (): string[] =>
    (existsSync(helloLog) ? readFileSync(helloLog, 'utf-8') : '').split('\n').filter(Boolean)

  /**
   * The browser chrome (toolbar, ☰, and every panel including the password
   * manager) is its OWN BrowserWindow on index.html?browserChrome=1 — not part
   * of the wallet window. The site itself renders in a WebContentsView below it,
   * which Playwright does not surface at all; nothing here needs that.
   */
  async function browserChrome(timeoutMs = 30_000): Promise<Page> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      for (const w of app.windows()) {
        if (w.url().includes('browserChrome')) return w
      }
      if (Date.now() > deadline) throw new Error('the browser chrome window never appeared')
      await new Promise(r => setTimeout(r, 250))
    }
  }

  test.beforeAll(async () => {
    test.setTimeout(300_000)
    profile = mkdtempSync(join(tmpdir(), 'mm-pwbio-e2e-'))
    helloLog = join(profile, 'hello-calls.log')
    writeFileSync(helloLog, '')

    const env = { ...process.env } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    env.MM_TEST_USERDATA = profile
    env.MM_REAL_MAIN = MAIN
    env.MM_TEST_FAKE_HELLO = '1'
    env.MM_TEST_HELLO_LOG = helloLog

    app = await _electron.launch({
      args: [join(__dirname, 'electron-wrapper.cjs')],
      executablePath: join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
      env,
    })

    for (let i = 0; i < 120 && !wallet; i++) {
      for (const w of app.windows()) {
        const u = w.url()
        if (u && !u.startsWith('devtools://')) { wallet = w; break }
      }
      if (!wallet) await new Promise(r => setTimeout(r, 500))
    }
    if (!wallet) throw new Error('wallet window never appeared')

    // Onboard with the throwaway Foundry wallet.
    await expect(vis('button:has-text("Import Existing Wallet")')).toBeVisible({ timeout: 30_000 })
    await vis('button:has-text("Import Existing Wallet")').click()
    for (let i = 0; i < 12; i++) {
      await wallet.locator(`[placeholder="word ${i + 1}"]`).fill(MNEMONIC[i])
    }
    await vis('button:has-text("Import Wallet")').click()
    const pws = vis('input[type="password"]')
    await expect(pws.first()).toBeVisible({ timeout: 30_000 })
    for (let i = 0; i < await pws.count(); i++) await pws.nth(i).fill(PASSWORD)
    await vis('button:has-text("Encrypt & Continue")').click()
    await expect(vis('text=Portfolio').first()).toBeVisible({ timeout: 60_000 })
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* best effort */ }
  })

  test('opens the vault with Hello without disturbing the wallet’s own enrollment', async () => {
    test.setTimeout(300_000)

    // ── 1. Enroll the WALLET's biometric unlock, so there is something to break ─
    await vis('button[title="Settings"]').first().click()
    const enableWalletHello = vis('text=Enable Windows Hello unlock').first()
    await expect(enableWalletHello).toBeVisible({ timeout: 20_000 })
    await enableWalletHello.click()
    await expect(vis('text=Windows Hello unlock — On').first()).toBeVisible({ timeout: 30_000 })

    const walletHelloPath = join(profile, 'wallet.hello.enc')
    expect(existsSync(walletHelloPath)).toBe(true)
    const walletHelloBefore = readFileSync(walletHelloPath)

    // Everything from here on is the password manager's business.
    const callsBefore = bridgeCalls().length
    expect(bridgeCalls().some(c => c.endsWith(`:${WALLET_KEY}`))).toBe(true)

    await vis('button.settings-close').first().click()

    // ── 2. Open the dApp browser and its password manager ─────────────────────
    await vis('text=Browser').last().click()
    const chrome = await browserChrome(60_000)
    const cvis = (selector: string) => chrome.locator(selector).filter({ visible: true })

    await cvis('[aria-label="Browser menu"]').first().click({ timeout: 30_000 })
    await cvis('text=Password manager').first().click()

    // ── 3. Create/open the vault with the password (the only way in, first time) ─
    const vaultPassword = cvis('input[type="password"]').first()
    await expect(vaultPassword).toBeVisible({ timeout: 20_000 })
    await vaultPassword.fill(PASSWORD)
    await cvis('button[type="submit"]').first().click()
    await expect(cvis('text=Import passwords from').first()).toBeVisible({ timeout: 30_000 })

    // ── 4. Turn Hello ON for the vault ────────────────────────────────────────
    // Fill the vault first. A real one holds hundreds of logins, and the enable
    // control originally sat BELOW that list — present, but scrolled hundreds of
    // rows off-screen, which is how it shipped unfindable the first time. It now
    // lives in the panel header (flexShrink: 0, outside the scroll area), and
    // toBeInViewport is what actually holds it there.
    await chrome.evaluate(async () => {
      for (let i = 0; i < 60; i++) {
        await window.wallet.passwordsSave?.({
          url: `https://site-${i}.example`, username: `user${i}`, password: `pw-${i}`,
        })
      }
    })
    // Saving through the bridge does not touch the panel's own React state, so
    // re-open it to load the list for real. (Skipping this is why an earlier
    // version of this test passed against an empty list and proved nothing.)
    await cvis('[aria-label="Close"]').first().click()
    await cvis('[aria-label="Browser menu"]').first().click()
    await cvis('text=Password manager').first().click()
    await expect(cvis('text=site-59.example').first()).toBeVisible({ timeout: 30_000 })

    const turnOn = cvis('button:has-text("Turn on Windows Hello")').first()
    await expect(turnOn).toBeVisible()
    await expect(turnOn).toBeInViewport()

    await turnOn.click()
    await expect(cvis('text=/Windows Hello will now open your saved passwords/').first())
      .toBeVisible({ timeout: 30_000 })
    await expect(cvis('button:has-text("Windows Hello — On")').first()).toBeInViewport()
    expect(existsSync(join(profile, 'passwords.hello.enc'))).toBe(true)

    // ── 5. Lock it, then unlock it with Hello instead of the password ─────────
    await cvis('button:has-text("Lock")').first().click()
    const helloButton = cvis('button:has-text("Unlock with Windows Hello")').first()
    await expect(helloButton).toBeVisible({ timeout: 20_000 })
    // The password field is still offered alongside it — biometrics are additive.
    await expect(cvis('input[type="password"]').first()).toBeVisible()

    await helloButton.click()
    await expect(cvis('text=Import passwords from').first()).toBeVisible({ timeout: 30_000 })

    // ── 6. ⚠ The regression guards ────────────────────────────────────────────
    const passwordManagerCalls = bridgeCalls().slice(callsBefore)
    expect(passwordManagerCalls.length).toBeGreaterThan(0)
    expect(passwordManagerCalls.some(c => c === `enroll:${VAULT_KEY}`)).toBe(true)
    expect(passwordManagerCalls.some(c => c === `sign:${VAULT_KEY}`)).toBe(true)

    // Nothing the password manager does may OPEN, SIGN WITH or DELETE the
    // wallet's TPM key — those are the three commands that can reach
    // secure-store's self-heal. ('supported' is a machine-wide
    // KeyCredentialManager.IsSupportedAsync probe that ignores the key name it
    // is handed, so it is not a use of the key and is excluded deliberately.)
    const touchedWalletKey = passwordManagerCalls
      .filter(c => c.endsWith(`:${WALLET_KEY}`) && !c.startsWith('supported:'))
    expect(touchedWalletKey, `password manager reached the wallet key: ${touchedWalletKey.join(', ')}`).toEqual([])

    expect(readFileSync(walletHelloPath)).toEqual(walletHelloBefore)

    // …and the file still WORKS, not just still exists: lock the wallet for
    // real and get back in with Hello alone. This is the failure the separate
    // key exists to prevent, observed the way the user would.
    // Lock, then reload the renderer: App re-reads isUnlocked() on boot, so this
    // is the same unlock screen a relaunch shows — the scenario that matters.
    await wallet.evaluate(() => window.wallet.lock())
    await wallet.reload()
    const walletHelloButton = vis('button:has-text("Unlock with Windows Hello")').first()
    await expect(walletHelloButton).toBeVisible({ timeout: 30_000 })
    await walletHelloButton.click()
    await expect(vis('text=Portfolio').first()).toBeVisible({ timeout: 60_000 })
  })
})
