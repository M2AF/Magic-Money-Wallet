/**
 * display-currency.spec.ts — Settings → Appearance → Currency, end to end.
 *
 * The wallet prices everything in USD and converts once, at paint time, so what
 * only the real app can prove is the two ends of that chain:
 *
 *  1. main/fx-rates.ts actually reaches the renderer — the module, the ipcMain
 *     handler, the preload bridge and the BTC-relative rebasing, in one call
 *  2. changing the picker re-denominates screens nowhere near Settings, the
 *     choice survives a reload, and a currency with no rate falls back to US
 *     dollars instead of stamping the wrong symbol on a USD figure
 *
 * Hermetic via MM_TEST_FAKE_FX (see electron-wrapper.cjs): CoinGecko's
 * /exchange_rates is the ONLY intercepted url, and it answers with round numbers
 * — USD→CAD 1.4, USD→EUR 0.9, USD→JPY 150 — so a converted figure can be
 * asserted exactly rather than against whatever the market did this morning.
 *
 * ⚠ Nothing here compares rendered money against a hardcoded symbol. Symbols are
 * the locale's business: on an en-CA machine (this repo's) CAD renders as a bare
 * "$" and USD as "US$", the reverse of en-US. Rendered text is checked against
 * what the PAGE's own `Intl` produces, so the spec pins the behaviour without
 * pinning the reader.
 *
 * Requires `npm run build` first; self-skips when out/main is missing.
 *   npx playwright test e2e/display-currency.spec.ts
 */
import { test, expect } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const MNEMONIC = 'test test test test test test test test test test test junk'.split(' ')
const PASSWORD = 'Currency-Test-2026!'

test.describe('display currency', () => {
  test.skip(!existsSync(MAIN), 'out/main missing — run `npm run build` first')
  // Serial, one wallet: each case inherits the currency the last one chose.
  // The generous timeout is onboarding plus a ~20-chain portfolio fetch, which
  // the chain cards this spec reads have to wait out.
  test.describe.configure({ mode: 'serial', timeout: 180_000 })

  let app: ElectronApplication
  let page: Page
  let profile: string

  // DashboardPage stays MOUNTED (hidden) behind the other tabs, so every
  // selector has to be filtered down to what is actually on screen.
  const vis = (selector: string) => page.locator(selector).filter({ visible: true })

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

  /** What the PAGE's own Intl makes of `value` in `code` — the locale's answer. */
  const intlFormat = (value: number, code: string): Promise<string> =>
    page.evaluate(({ v, c }) => new Intl.NumberFormat(navigator.language || 'en-US', {
      style: 'currency', currency: c,
    }).format(v), { v: value, c: code.toUpperCase() })

  /** The digits of a rendered money string, whichever convention wrote them. */
  const amountOf = (text: string): number => {
    const m = text.replace(/[^\d.,-]/g, '')
    const dec = Math.max(m.lastIndexOf('.'), m.lastIndexOf(','))
    const whole = (dec < 0 ? m : m.slice(0, dec)).replace(/[.,]/g, '')
    const frac = dec < 0 ? '' : m.slice(dec + 1)
    return parseFloat(frac ? `${whole}.${frac}` : whole)
  }

  /**
   * Everything in a rendered figure that is NOT the number — the symbol and any
   * spacing around it. This is what identifies the currency without the spec
   * having to know that en-CA writes CAD as "$" and USD as "US$".
   */
  const marker = (text: string) => text.replace(/[\d.,\s -]/g, '')

  /** The currency marker this locale uses for `code`, from the page's own Intl. */
  const markerFor = async (code: string) => marker(await intlFormat(0, code))

  const subLabel = () => vis('.settings-row:has(.settings-select) .settings-row-sub').first()

  const openSettings = async () => {
    if (await vis('.settings-select').count() > 0) return
    await vis('button[title="Settings"]').first().click()
    await expect(vis('.settings-select').first()).toBeVisible({ timeout: 15_000 })
  }

  const closeSettings = async () => {
    if (await vis('.settings-select').count() === 0) return
    await vis('.settings-close').first().click()
    await expect(vis('.settings-select')).toHaveCount(0)
  }

  /** Choose a currency and wait for its rate to actually land. */
  const pick = async (code: string) => {
    await openSettings()
    await vis('.settings-select').first().selectOption(code)
    // The row's own copy is the readback: it keeps saying "Rates unavailable"
    // until a real rate for the pick is in hand.
    await expect(subLabel()).not.toContainText('Rates unavailable', { timeout: 15_000 })
  }

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    profile = mkdtempSync(join(tmpdir(), 'mm-currency-e2e-'))
    const env = { ...process.env } as Record<string, string>
    // VS Code sets this, and it makes Electron boot as plain node.
    delete env.ELECTRON_RUN_AS_NODE
    env.MM_TEST_USERDATA = profile
    env.MM_REAL_MAIN = MAIN
    env.MM_TEST_NO_BIOMETRICS = '1'
    env.MM_TEST_FAKE_FX = '1'
    app = await _electron.launch({
      args: [join(__dirname, 'electron-wrapper.cjs')],
      executablePath: join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
      env,
    })
    page = await appWindow()

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
    await expect(vis('text=Portfolio').first()).toBeVisible({ timeout: 60_000 })
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
    rmSync(profile, { recursive: true, force: true })
  })

  test('serves a USD-based rate table over the bridge', async () => {
    // One call proves fx-rates.ts, the ipcMain handler and the preload bridge —
    // and that CoinGecko's BTC-relative response really was rebased onto USD.
    const table = await page.evaluate(() => window.wallet.getFxRates!())
    expect(table.base).toBe('usd')
    expect(table.rates.usd).toBe(1)
    expect(table.rates.cad).toBeCloseTo(1.4, 10)
    expect(table.rates.eur).toBeCloseTo(0.9, 10)
    expect(table.rates.jpy).toBeCloseTo(150, 10)
    // btc is in the response and is a real rate, but it is not a display
    // currency — it must not reach the picker as one.
    expect(table.rates.btc).toBeUndefined()
  })

  test('offers the picker above the theme grid, not buried under it', async () => {
    await openSettings()
    const select = vis('.settings-select').first()
    await expect(select).toHaveValue('usd')                    // USD is the default
    await expect(page.locator('optgroup[label="Europe"]')).toHaveCount(1)
    await expect(select.locator('option[value="cad"]')).toHaveCount(1)

    // A control below eighteen theme tiles is a control nobody finds — this is
    // the mistake the biometric enable row shipped with.
    const gridComesAfter = await page.evaluate(() => {
      const sel = document.querySelector('.settings-select')
      const grid = document.querySelector('.theme-picker')
      if (!sel || !grid) return null
      return !!(sel.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING)
    })
    expect(gridComesAfter).toBe(true)
  })

  test('re-denominates the dashboard, matching the platform Intl output', async () => {
    // Every chain card carries a fiat figure, so this needs no market feed — and
    // it is on a screen the picker does not live on.
    await closeSettings()
    const cell = () => vis('.chain-usd').first()
    await expect(cell()).toBeVisible({ timeout: 120_000 })

    // If this locale wrote both currencies the same way the case would pass
    // without proving anything.
    expect(await markerFor('cad')).not.toBe(await markerFor('usd'))

    const usdText = (await cell().textContent()) ?? ''
    expect(marker(usdText)).toBe(await markerFor('usd'))

    await pick('cad')
    await closeSettings()
    await expect.poll(async () => marker((await cell().textContent()) ?? ''), { timeout: 15_000 })
      .toBe(await markerFor('cad'))

    // Converted, not merely relabelled: 1.4 CAD per USD, off the served table.
    // Tolerance of a cent or two — the rendered USD figure is already rounded,
    // so it cannot reproduce the full-precision value the app multiplied.
    const cadText = (await cell().textContent()) ?? ''
    expect(amountOf(cadText)).toBeCloseTo(amountOf(usdText) * 1.4, 1)
  })

  test('converts market prices at the served rate', async () => {
    await vis('.bottom-nav-btn:has-text("Market")').click()
    await expect(vis('text=Market Watch').first()).toBeVisible({ timeout: 30_000 })

    // The top row's price cell. Read through the DOM because the row is a plain
    // grid of divs with no handle of its own — and the column HEADER shares that
    // same grid template, so a row only counts once its price cell holds digits.
    const topPrice = () => page.evaluate(() => {
      const row = [...document.querySelectorAll<HTMLElement>('div')]
        .filter(d => d.style.gridTemplateColumns?.startsWith('20px') && d.children.length === 6)
        .find(d => /\d/.test(d.children[2].textContent ?? ''))
      return row ? row.children[2].textContent ?? '' : ''
    })

    for (let i = 0; i < 60 && !(await topPrice()); i++) await page.waitForTimeout(500)
    const cadText = await topPrice()
    // The market list is live data. If the feed is down there is nothing on
    // screen to convert — say so rather than passing vacuously. The arithmetic
    // itself is covered by renderer/lib/currency.test.ts.
    test.skip(!cadText, 'market feed returned no rows — nothing on screen to convert')

    await pick('usd')
    await closeSettings()
    const usdText = await topPrice()

    // Same cached coin, same price, two currencies: 1.4 CAD per USD.
    expect(amountOf(cadText) / amountOf(usdText)).toBeCloseTo(1.4, 1)
  })

  test('keeps the choice, and the rates, across a reload', async () => {
    await pick('eur')
    await closeSettings()
    await page.reload()
    await expect(vis('text=Portfolio').first()).toBeVisible({ timeout: 60_000 })

    // The cached table is read before the first paint, so the app comes back in
    // euros rather than flashing dollars and correcting itself.
    await expect.poll(async () => marker((await vis('.chain-usd').first().textContent()) ?? ''),
      { timeout: 120_000 }).toBe(await markerFor('eur'))
    await openSettings()
    await expect(vis('.settings-select').first()).toHaveValue('eur')
    await expect(subLabel()).not.toContainText('Rates unavailable')
  })

  test('falls back to US dollars rather than mislabelling a USD figure', async () => {
    // A currency the served table has nothing for. The numbers on screen are
    // still USD, so they must be SHOWN as USD and the row must say why.
    await openSettings()
    await vis('.settings-select').first().selectOption('inr')
    await expect(subLabel()).toContainText('Rates unavailable', { timeout: 10_000 })
    await closeSettings()
    await expect.poll(async () => marker((await vis('.chain-usd').first().textContent()) ?? ''),
      { timeout: 15_000 }).toBe(await markerFor('usd'))
  })
})
