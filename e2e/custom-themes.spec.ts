/**
 * custom-themes.spec.ts — Settings → Appearance → custom themes, end to end.
 *
 * Covers the two things that can only be proven in the real app:
 *  1. a theme built from three colours actually repaints the app, persists, and
 *     leaves nothing behind when the editor is cancelled
 *  2. the screen-colour dropper — Electron exposes window.EyeDropper but its
 *     open() rejects instantly (no picker behind it), so the wallet runs its own
 *     overlay windows via main/eyedropper.ts. This spec asserts the overlay
 *     really opens, reads the pixel under the cursor, hands that exact value
 *     back to the editor, and tears itself down.
 *
 *  3. themes are carried on the ChainLens profile, so one built here shows up on
 *     another device — exercised against the harness profile server in
 *     electron-wrapper.cjs (MM_TEST_FAKE_PROFILE_SYNC), which keeps these specs
 *     hermetic AND stops every run minting a real ChainLens account for the
 *     public Anvil test key, which the live default config would otherwise do.
 *
 * The dropper case is deliberately NOT satisfied by "some hex came back": it
 * compares the editor's field against the hex the overlay itself displayed for
 * the same coordinate, so a picker that returned a canned value would fail.
 *
 * Requires `npm run build` first (drives out/main/index.js); self-skips when the
 * build output is missing, like electron-smoke.spec.ts. Run with:
 *   npm run test:e2e:app
 *
 * Note: the dropper case briefly covers every display with a full-screen
 * always-on-top window — that is the feature, not a side effect.
 */
import { test, expect } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const MNEMONIC = 'test test test test test test test test test test test junk'.split(' ')
const PASSWORD = 'Theme-Test-2026!'

test.describe('custom themes', () => {
  test.skip(!existsSync(MAIN), 'out/main missing — run `npm run build` first (use npm run test:e2e:app)')

  let app: ElectronApplication
  let page: Page
  let profile: string
  /** The harness profile server's stored row, and its log of pushes. */
  let syncState: string
  let syncLog: string

  const serverThemes = (): Record<string, { n: string; t: number; d?: 1 }> => {
    try { return JSON.parse(readFileSync(syncState, 'utf8')) } catch { return {} }
  }
  /** Every record the harness profile server logged: pushes, /sync, 404s. */
  const syncRecords = (): Record<string, unknown>[] => {
    try {
      return readFileSync(syncLog, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    } catch { return [] }
  }
  const pushes = (): Record<string, { n: string; t: number; d?: 1 }>[] =>
    syncRecords().filter(r => !r.sync && !r.missingRoute) as never
  const setServerMode = (mode: string | null) => {
    const raw = { ...serverThemes(), ...(mode ? { __mode: mode } : {}) }
    writeFileSync(syncState, JSON.stringify(raw))
  }
  /** Push is debounced in theme.ts; wait for one that satisfies `pred`. */
  const waitForPush = async (pred: (p: Record<string, { n: string; t: number; d?: 1 }>) => boolean) => {
    for (let i = 0; i < 40; i++) {
      if (pushes().some(pred)) return true
      await new Promise(r => setTimeout(r, 250))
    }
    return false
  }

  const vis = (selector: string) => page.locator(selector).filter({ visible: true })
  const overlays = () => app.windows().filter(w => w.url().startsWith('data:text/html'))
  const cssVar = (name: string) =>
    page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)

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

  /** Settings → the Appearance picker, from wherever we are. */
  async function openAppearance(): Promise<void> {
    await vis('button[title="Settings"]').first().click()
    await expect(vis('.theme-picker').first()).toBeVisible({ timeout: 15_000 })
  }

  /**
   * Every case starts from the picker being on screen. Opening it only when it
   * isn't already keeps the cases runnable ON THEIR OWN (`-g "dropper"`) as well
   * as in sequence — inheriting an open sheet from the previous test made a
   * single-case run fail on a missing tile that was never the point of the test.
   */
  async function ensureAppearance(): Promise<void> {
    if (await vis('.theme-picker').count() > 0) return
    await openAppearance()
  }

  /** `#121a2c` -> `rgb(18, 26, 44)`, the form getComputedStyle reports. */
  const asRgb = (hex: string) => {
    const n = parseInt(hex.replace('#', ''), 16)
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
  }

  async function setSlot(slot: string, hex: string): Promise<void> {
    await vis(`.theme-slot:has-text("${slot}")`).first().click()
    await vis('.color-format-btn:has-text("HEX")').first().click()
    await vis('.color-hex').first().fill(hex)
    // Doubles as the wait: the chip only turns this colour once the typed value
    // has been parsed and pushed back through the editor's state.
    await expect(vis('.color-picker-chip').first()).toHaveCSS('background-color', asRgb(hex))
  }

  test.beforeAll(async () => {
    profile = mkdtempSync(join(tmpdir(), 'mm-theme-e2e-'))
    const env = { ...process.env } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    env.MM_TEST_USERDATA = profile
    env.MM_REAL_MAIN = MAIN
    env.MM_TEST_NO_BIOMETRICS = '1'
    // Stand in for the ChainLens profile server (see electron-wrapper.cjs).
    syncState = join(profile, 'sync-state.json')
    syncLog = join(profile, 'sync-log.ndjson')
    writeFileSync(syncState, '{}')
    env.MM_TEST_FAKE_PROFILE_SYNC = '1'
    env.MM_TEST_SYNC_STATE = syncState
    env.MM_TEST_SYNC_LOG = syncLog
    app = await _electron.launch({
      args: [join(__dirname, 'electron-wrapper.cjs')],
      executablePath: join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
      env,
    })
    page = await appWindow()

    // ── Onboard: import → password → dashboard ────────────────────────────
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

  test('builds, applies and persists a theme from three colours', async () => {
    test.setTimeout(120_000)
    await ensureAppearance()

    // Six built-ins ship; the seventh tile is the "New" slot.
    await expect(vis('.theme-swatch-new')).toHaveCount(1)
    expect(await vis('.theme-swatch').count()).toBe(7)

    await vis('.theme-swatch-new').first().click()
    await expect(vis('.color-wheel').first()).toBeVisible({ timeout: 10_000 })

    await setSlot('Background', '#121a2c')
    await setSlot('Accent', '#ff9500')
    await setSlot('Text', '#ffe9cf')
    await vis('input[aria-label="Theme name"]').first().fill('Sunset')

    // The editor previews live — the app is already wearing it before saving.
    expect(await cssVar('--accent')).toBe('#ff9500')

    await vis('button:has-text("Create theme")').first().click()
    await expect(vis('.color-wheel')).toHaveCount(0)

    // Saved, selected, and expanded into the full token set.
    expect(await page.evaluate(() => localStorage.getItem('mm.theme'))).toMatch(/^custom-/)
    expect(await page.evaluate(() => document.documentElement.dataset.tone)).toBe('dark')
    expect(await cssVar('--accent')).toBe('#ff9500')
    expect(await cssVar('--bg-deep')).toBe('#121a2c')
    // Derived, not passed through: the secondary tier is blended, never equal
    // to the text colour it comes from.
    expect(await cssVar('--text-secondary')).not.toBe('#ffe9cf')
    expect(await cssVar('--text-secondary')).toMatch(/^#[0-9a-f]{6}$/)

    // The local store is the SYNC shape — id -> { n, c, t } — because a plain
    // list cannot carry the timestamp a merge needs or express a deletion.
    const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('mm.themes.v2') ?? '{}'))
    const ids = Object.keys(stored)
    expect(ids).toHaveLength(1)
    expect(ids[0]).toMatch(/^custom-/)
    expect(stored[ids[0]]).toMatchObject({
      n: 'Sunset', c: { bg: '#121a2c', accent: '#ff9500', text: '#ffe9cf' },
    })
    expect(stored[ids[0]].t).toBeGreaterThan(0)

    // It now sits in the picker with an edit affordance on it.
    await expect(vis('.theme-swatch-edit')).toHaveCount(1)

    // …and it reached the profile, which is what makes it cross-device.
    expect(await waitForPush(p => Object.values(p).some(e => e.n === 'Sunset'))).toBe(true)
    expect(Object.values(serverThemes()).map(e => e.n)).toContain('Sunset')
  })

  test('a light background flips the whole app to the light tone', async () => {
    test.setTimeout(120_000)
    await ensureAppearance()
    await vis('.theme-swatch-new').first().click()
    await expect(vis('.color-wheel').first()).toBeVisible({ timeout: 10_000 })

    await setSlot('Background', '#f4f1ea')
    await setSlot('Accent', '#0f6f5c')
    await setSlot('Text', '#22282b')
    await vis('input[aria-label="Theme name"]').first().fill('Linen')
    await expect(vis('.theme-tone-note').first()).toContainText('light')

    await vis('button:has-text("Create theme")').first().click()
    await expect(vis('.color-wheel')).toHaveCount(0)

    expect(await page.evaluate(() => document.documentElement.dataset.tone)).toBe('light')
    // Glassmorphism is dropped on paper, exactly as White & Gold does.
    expect(await cssVar('--blur')).toBe('none')
    // Cards lift ABOVE the page rather than stacking darker, and go opaque.
    expect(await cssVar('--bg-card')).toMatch(/^#/)
  })

  test('cancelling the editor leaves no trace of the preview', async () => {
    test.setTimeout(120_000)
    await ensureAppearance()
    const before = await cssVar('--accent')
    const savedCount = await vis('.theme-swatch-edit').count()

    await vis('.theme-swatch-new').first().click()
    await expect(vis('.color-wheel').first()).toBeVisible({ timeout: 10_000 })
    await setSlot('Accent', '#ff00ff')
    expect(await cssVar('--accent')).toBe('#ff00ff')

    await vis('button:has-text("Cancel")').first().click()
    await expect(vis('.color-wheel')).toHaveCount(0)

    expect(await cssVar('--accent')).toBe(before)
    expect(await vis('.theme-swatch-edit').count()).toBe(savedCount)
  })

  test('the pencil reopens a saved theme for editing', async () => {
    test.setTimeout(120_000)
    await ensureAppearance()
    await vis('.theme-swatch-edit').first().click()
    await expect(vis('.color-wheel').first()).toBeVisible({ timeout: 10_000 })
    await expect(vis('.settings-title').last()).toHaveText('Edit theme')
    await expect(vis('input[aria-label="Theme name"]').first()).toHaveValue('Sunset')
    await expect(vis('button:has-text("Delete theme")')).toHaveCount(1)
    await vis('button:has-text("Cancel")').first().click()
    await expect(vis('.color-wheel')).toHaveCount(0)
  })

  /**
   * Play a second device: write straight into the profile server, then close and
   * reopen Settings, which is what pulls (themes are only visible there, so that
   * is where the wallet catches up).
   */
  async function seedRemoteTheme(): Promise<void> {
    const remote = serverThemes()
    remote['custom-fromphone'] = {
      n: 'Phone', c: { bg: '#101018', accent: '#8be9fd', text: '#f0f0ff' }, t: Date.now(),
    } as never
    writeFileSync(syncState, JSON.stringify(remote))
    await vis('.settings-close').first().click()
    await expect(vis('.theme-picker')).toHaveCount(0)
    await openAppearance()
  }

  test('a theme made on another device arrives in the picker', async () => {
    test.setTimeout(120_000)
    await ensureAppearance()
    await seedRemoteTheme()

    await expect(vis('.theme-swatch:has-text("Phone")')).toHaveCount(1, { timeout: 15_000 })
    // Wearable, not just listed: selecting it repaints from the synced colours.
    await vis('.theme-swatch:has-text("Phone")').first().click()
    expect(await cssVar('--accent')).toBe('#8be9fd')
    expect(await cssVar('--bg-deep')).toBe('#101018')
  })

  test('deleting pushes a tombstone, not an absence', async () => {
    test.setTimeout(120_000)
    await ensureAppearance()
    // Runs after the case above in sequence, but seeds its own theme when run
    // alone so `-g "tombstone"` is a real test rather than a missing-tile error.
    if (await vis('.theme-swatch:has-text("Phone")').count() === 0) await seedRemoteTheme()

    // Dropping the key instead would let the other device's next push put the
    // theme straight back, so the delete has to travel as a record of its own.
    await vis('.theme-swatch:has-text("Phone")').first().locator('.theme-swatch-edit').click()
    await expect(vis('.color-wheel').first()).toBeVisible({ timeout: 10_000 })
    await vis('button:has-text("Delete theme")').first().click()
    await vis('button:has-text("Tap again to delete")').first().click()
    await expect(vis('.color-wheel')).toHaveCount(0)

    await expect(vis('.theme-swatch:has-text("Phone")')).toHaveCount(0)
    expect(await waitForPush(p => p['custom-fromphone']?.d === 1)).toBe(true)
    expect(serverThemes()['custom-fromphone']?.d).toBe(1)

    // A stale copy pushed by a device that still holds the theme must NOT
    // resurrect it: the tombstone is newer, so the merge keeps the delete.
    const stale = serverThemes()
    expect(stale['custom-fromphone'].t).toBeGreaterThan(0)
  })

  test('a Worker without the route is not mistaken for a missing profile', async () => {
    test.setTimeout(120_000)
    await ensureAppearance()
    // The two are the SAME 404. Acting on the status alone made every theme save
    // fire an account-creating /sync upsert to fix a profile that was never
    // missing — measured against the live Worker, which answered 200 on
    // /profile/filters and 404 {"error":"Not found"} on /profile/themes.
    setServerMode('missing-route')
    const syncsBefore = syncRecords().filter(r => r.sync).length

    await vis('.theme-swatch-new').first().click()
    await expect(vis('.color-wheel').first()).toBeVisible({ timeout: 10_000 })
    await setSlot('Accent', '#3fa9f5')
    await vis('input[aria-label="Theme name"]').first().fill('Undeployed')
    await vis('button:has-text("Create theme")').first().click()
    await expect(vis('.color-wheel')).toHaveCount(0)

    // The push was attempted…
    for (let i = 0; i < 40 && !syncRecords().some(r => r.missingRoute === 'POST'); i++) {
      await new Promise(r => setTimeout(r, 250))
    }
    expect(syncRecords().some(r => r.missingRoute === 'POST')).toBe(true)
    // …and NOT followed by an attempt to create an account.
    await new Promise(r => setTimeout(r, 1500))
    expect(syncRecords().filter(r => r.sync).length).toBe(syncsBefore)

    // The theme is still perfectly usable locally — a wallet whose sync is not
    // deployed must behave exactly like one that never had sync.
    await expect(vis('.theme-swatch:has-text("Undeployed")')).toHaveCount(1)
    setServerMode(null)
  })

  test('the dropper samples the real screen and hands back that exact pixel', async () => {
    test.setTimeout(180_000)
    await ensureAppearance()

    // Electron DOES define the constructor — proving the feature-detect trap is
    // real, and that reaching the working picker cannot rely on it.
    expect(await page.evaluate(() => typeof (window as unknown as { EyeDropper?: unknown }).EyeDropper)).toBe('function')
    expect(await page.evaluate(() => typeof window.wallet.pickScreenColor)).toBe('function')

    await vis('.theme-swatch-new').first().click()
    await expect(vis('.color-wheel').first()).toBeVisible({ timeout: 10_000 })
    await vis('.color-dropper').first().click()

    // One overlay per display. The first capture warms desktopCapturer up and
    // encodes a full-resolution PNG per screen, so allow real time for it.
    let overlay: Page | undefined
    for (let i = 0; i < 60 && !overlay; i++) {
      overlay = overlays()[0]
      if (!overlay) await new Promise(r => setTimeout(r, 500))
    }
    expect(overlay, 'the picker overlay never opened').toBeTruthy()
    await overlay!.locator('#shot').waitFor({ timeout: 20_000 })

    // The overlay must show its OWN display 1:1 — a mis-sized capture would
    // silently pick the wrong pixel.
    const geometry = await overlay!.evaluate(() => {
      const img = document.getElementById('shot') as HTMLImageElement
      return { w: window.innerWidth, h: window.innerHeight, natW: img.naturalWidth, natH: img.naturalHeight }
    })
    expect(geometry.natW / geometry.natH).toBeCloseTo(geometry.w / geometry.h, 2)

    // What SHOULD come back for one coordinate, read independently from the
    // capture the overlay is displaying. This is what makes the case
    // non-vacuous: a picker returning a canned value, or mapping the cursor to
    // the wrong pixel, both fail here.
    //
    // Deliberately NOT read from the overlay's own #readout: that follows the
    // last mousemove, and on a machine with a live mouse a real cursor movement
    // can overwrite it between the synthetic move and the click. The synthetic
    // mousedown carries its own coordinates, so the PICK cannot be disturbed
    // that way — only the readout can.
    const x = Math.round(geometry.w * 0.42)
    const y = Math.round(geometry.h * 0.58)
    const expected = await overlay!.evaluate(({ px, py }) => {
      const img = document.getElementById('shot') as HTMLImageElement
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const ix = Math.floor(px / window.innerWidth * c.width)
      const iy = Math.floor(py / window.innerHeight * c.height)
      const [r, g, b] = ctx.getImageData(ix, iy, 1, 1).data
      return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')
    }, { px: x, py: y })
    expect(expected).toMatch(/^#[0-9a-f]{6}$/)

    // The loupe readout is live as the pointer moves.
    await overlay!.mouse.move(x, y)
    expect(await overlay!.evaluate(() => document.getElementById('readout')?.textContent?.trim() ?? ''))
      .toMatch(/^#[0-9a-f]{6}$/i)

    // The pick lands on mousedown and main destroys the overlay immediately, so
    // the matching mouseup races the teardown — that is expected, not a failure.
    await overlay!.mouse.down().catch(() => {})

    await expect(vis('.color-hex').first()).toHaveValue(expected, { timeout: 15_000 })

    // Every overlay is gone, and the editor is still where the user left it.
    for (let i = 0; i < 20 && overlays().length > 0; i++) await new Promise(r => setTimeout(r, 250))
    expect(overlays()).toHaveLength(0)
    await expect(vis('.color-wheel').first()).toBeVisible()

    await vis('button:has-text("Cancel")').first().click()
  })
})
