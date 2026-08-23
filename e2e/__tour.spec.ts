/**
 * Full app tour — 2x screenshots + a narrated-pace video of the Electron build.
 *
 * Two launches on ONE wallet profile:
 *   A. onboard (no video) — the seed-phrase typing is not worth filming
 *   B. relaunch with recordVideo — the film starts at the unlock screen
 *
 * Chat data is staged by swapping the chat:* ipcMain handlers in the main
 * process (window.wallet is a frozen contextBridge object, so it cannot be
 * patched from the page). Everything else is the real app against real data.
 */
import { test, expect } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { existsSync, mkdtempSync, rmSync, mkdirSync, renameSync, readdirSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const OUT = join(ROOT, '.screenshots', 'tour')
const VIDEO_DIR = join(OUT, 'video')
const MNEMONIC = 'test test test test test test test test test test test junk'.split(' ')
const PASSWORD = 'Article-Tour-2026!'
const ME = 'ec18dcf5-3271-46fd-8029-41e5b2f39eed'

const gif = (hue: number) =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><defs>` +
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="hsl(${hue} 82% 62%)"/>` +
    `<stop offset="100%" stop-color="hsl(${(hue + 55) % 360} 76% 46%)"/></linearGradient></defs>` +
    `<rect width="320" height="240" fill="url(#g)"/><text x="160" y="134" text-anchor="middle" ` +
    `font-family="Segoe UI,sans-serif" font-size="30" font-weight="700" fill="#fff">GIF</text></svg>`)

const person = (id: string, display_name: string) => ({ id, display_name, avatar_url: null })
const AVA = person('3f2c6cb8-2a43-4b69-bf5e-099ef63be79f', 'Ava Mercer')
const KOJI = person('c828bf80-3280-4c46-a8bb-503a442e0743', 'Koji Tanaka')
const PRIYA = person('9b1f0c22-5d8e-41a7-8f3b-6c2d4e5a7b19', 'Priya Raman')
const DMITRI = person('7c1e2b44-9a30-4d18-9f52-1b3c8d0e6a77', 'Dmitri Volkov')
const YOU = person(ME, 'criptoejesus')
const at = (h: number, m: number) => new Date(Date.UTC(2026, 7, 17, h, m)).toISOString()
const fid = (p: ReturnType<typeof person>, friendship_id: number) =>
  ({ ...p, friendship_id, created_at: null, accepted_at: null })

const CHAT = {
  me: ME,
  world: [
    { id: 1, message_type: 'text', content: 'gm ChainLens ☀️', created_at: at(9, 2), author: AVA },
    { id: 2, message_type: 'text', content: 'Anyone else seeing Monad confirmations land almost instantly this morning?', created_at: at(9, 4), author: KOJI },
    { id: 3, message_type: 'text', content: 'Yeah — routed a swap through in about two seconds.', created_at: at(9, 6), author: YOU },
    { id: 4, message_type: 'gif', content: gif(150), created_at: at(9, 7), author: AVA },
    { id: 5, message_type: 'text', content: 'The Messenger tab landing in the wallet is a nice touch.', created_at: at(9, 9), author: KOJI },
    { id: 6, message_type: 'text', content: 'Same name, picture and ID as my ChainLens profile — that is the part I like.', created_at: at(9, 11), author: YOU },
  ],
  dms: [
    { id: 20, message_type: 'text', content: 'Sent the ADA over for the split 👍', created_at: at(9, 14), author: AVA },
    { id: 21, message_type: 'text', content: 'Got it — receipt here: https://chainlensnft.info/tx/8f2c1a', created_at: at(9, 15), author: YOU },
    { id: 22, message_type: 'text', content: 'Links only work in DMs, right?', created_at: at(9, 16), author: AVA },
    { id: 23, message_type: 'text', content: 'Right — World Chat refuses them, so the room cannot be farmed for scams.', created_at: at(9, 17), author: YOU },
  ],
  friends: { friends: [fid(AVA, 12), fid(KOJI, 13)], incoming: [fid(PRIYA, 14)], outgoing: [fid(DMITRI, 15)] },
  unread: {
    pending_requests: 1, unread_direct: 3,
    conversations: [
      { friendship_id: 12, friend_id: AVA.id, unread: 1 },
      { friendship_id: 13, friend_id: KOJI.id, unread: 2 },
    ],
  },
  gifs: Array.from({ length: 12 }, (_, i) => ({ id: `g${i}`, title: `GIF ${i + 1}`, url: gif((i * 47) % 360), preview: gif((i * 47) % 360) })),
  status: { eligible: true, walletLinked: true, socialLinked: true, giphyAvailable: true, userId: ME, displayName: 'criptoejesus', avatarUrl: null },
}

async function stubChat(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }, f) => {
    const h: Record<string, (...a: unknown[]) => unknown> = {
      'chat:status': () => f.status,
      'chat:reset': () => true,
      'chat:world': (a?: unknown) => (a ? [] : f.world),
      'chat:send-world': (_t: unknown, c: unknown) => {
        if (/https?:\/\/|www\.|\b[a-z0-9-]+\.[a-z]{2,}\b/i.test(String(c))) {
          throw new Error('Links can only be sent in direct messages.')
        }
        return { id: 90, message_type: 'text', content: String(c), created_at: new Date().toISOString(), author: { id: f.me, display_name: 'criptoejesus', avatar_url: null } }
      },
      'chat:delete-world': () => undefined,
      'chat:friends': () => f.friends,
      'chat:add-friend': () => undefined,
      'chat:accept-friend': () => undefined,
      'chat:remove-friend': () => undefined,
      'chat:direct': (_i: unknown, a?: unknown) => (a ? [] : f.dms),
      'chat:send-direct': () => f.dms[f.dms.length - 1],
      'chat:delete-direct': () => undefined,
      'chat:unread': () => f.unread,
      'chat:mark-read': () => undefined,
      'chat:gifs': () => f.gifs,
    }
    for (const [c, fn] of Object.entries(h)) { ipcMain.removeHandler(c); ipcMain.handle(c, (_e: unknown, ...a: unknown[]) => fn(...a)) }
  }, CHAT)
}

/** Put the window on a display whose DIP work area can fit it at full height. */
async function fitWindow(app: ElectronApplication, w: number, h: number) {
  await app.evaluate(({ BrowserWindow, screen }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    const displays = screen.getAllDisplays()
    const fits = displays.find(d => d.workArea.width >= size.w + 20 && d.workArea.height >= size.h + 20)
      ?? displays[0]
    win.setBounds({
      x: Math.round(fits.workArea.x + (fits.workArea.width - size.w) / 2),
      y: Math.round(fits.workArea.y + Math.max(0, (fits.workArea.height - size.h) / 2)),
      width: size.w, height: size.h,
    })
  }, { w, h })
}

test.describe('app tour', () => {
  test.skip(!existsSync(MAIN), 'out/main missing — run `npm run build` first')

  test('capture the full tour', async () => {
    test.setTimeout(900_000)
    mkdirSync(OUT, { recursive: true })
    mkdirSync(VIDEO_DIR, { recursive: true })
    const profile = mkdtempSync(join(tmpdir(), 'mm-tour-'))

    const env = { ...process.env } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    env.MM_TEST_USERDATA = profile
    env.MM_REAL_MAIN = MAIN
    env.MM_TEST_NO_BIOMETRICS = '1'

    const launch = (record: boolean) => _electron.launch({
      args: ['--force-device-scale-factor=2', join(__dirname, 'electron-wrapper.cjs')],
      executablePath: join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
      env,
      ...(record ? { recordVideo: { dir: VIDEO_DIR, size: { width: 840, height: 1800 } } } : {}),
    })

    const windowOf = async (app: ElectronApplication): Promise<Page> => {
      for (let i = 0; i < 60; i++) {
        for (const w of app.windows()) if (w.url() && !w.url().startsWith('devtools://')) return w
        await new Promise(r => setTimeout(r, 500))
      }
      throw new Error('no window')
    }

    // ── A. Onboard off-camera ────────────────────────────────────────────
    let app = await launch(false)
    let page = await windowOf(app)
    let vis = (s: string) => page.locator(s).filter({ visible: true })
    await vis('button:has-text("Import Existing Wallet")').click({ timeout: 40_000 })
    for (let i = 0; i < 12; i++) await page.locator(`[placeholder="word ${i + 1}"]`).fill(MNEMONIC[i])
    await vis('button:has-text("Import Wallet")').click()
    const pw = page.locator('input[type="password"]')
    await pw.first().waitFor({ timeout: 30_000 })
    for (let i = 0; i < await pw.count(); i++) await pw.nth(i).fill(PASSWORD)
    await vis('button:has-text("Encrypt & Continue")').click()
    await expect(vis('text=Portfolio').first()).toBeVisible({ timeout: 45_000 })
    await app.close()

    // ── B. The filmed tour ───────────────────────────────────────────────
    app = await launch(true)
    page = await windowOf(app)
    vis = (s: string) => page.locator(s).filter({ visible: true })
    await fitWindow(app, 420, 900)
    await page.waitForTimeout(1200)

    const shot = async (name: string, settle = 900) => {
      await page.waitForTimeout(settle)
      await page.screenshot({ path: join(OUT, `${name}.png`) })
    }
    const beat = (ms = 1400) => page.waitForTimeout(ms)

    // 01 unlock
    await expect(page.locator('input[type="password"]').first()).toBeVisible({ timeout: 40_000 })
    await shot('01-unlock')
    await page.locator('input[type="password"]').first().fill(PASSWORD)
    await beat(600)
    await vis('button:has-text("Unlock")').first().click()
    await expect(vis('text=Portfolio').first()).toBeVisible({ timeout: 45_000 })
    await stubChat(app)
    // Balances arrive per chain; the total shows "Calculating…" until they are
    // all in, which reads as a broken app in a screenshot.
    await page.locator('text=Calculating').first()
      .waitFor({ state: 'hidden', timeout: 90_000 }).catch(() => {})
    await page.waitForTimeout(2500)

    // 02 portfolio
    await shot('02-portfolio-networks', 1500)
    await beat()
    await page.mouse.wheel(0, 700); await shot('03-portfolio-scrolled', 800)
    await page.mouse.wheel(0, -700); await beat(800)

    // 04 tokens / 05 collectibles
    await vis('button:has-text("Tokens")').first().click()
    await shot('04-portfolio-tokens', 3500)
    await beat()
    await vis('button:has-text("Collectibles")').first().click()
    await shot('05-portfolio-collectibles', 4000)
    await beat()
    await vis('button:has-text("Networks")').first().click()
    await beat(800)

    // 06 send
    await vis('button:has-text("Send SOL")').first().click()
    await shot('06-send', 1500)
    await beat()
    await page.keyboard.press('Escape').catch(() => {})
    await vis('button:has-text("×")').first().click().catch(() => {})
    await beat(700)

    // 07 market + 08 coin chart
    await vis('.bottom-nav-btn:has-text("Market")').click()
    await expect(vis('text=Market Watch').first()).toBeVisible({ timeout: 40_000 })
    await shot('07-market', 4000)
    await beat()
    await page.locator('tr, [role="row"]').filter({ visible: true }).nth(1).click().catch(() => {})
    await shot('08-market-chart', 2500)
    await page.keyboard.press('Escape').catch(() => {})
    await beat(800)

    // 09 swap + 10 cross-chain
    await vis('.bottom-nav-btn:has-text("Swap")').click()
    await expect(vis('text=YOU PAY').first()).toBeVisible({ timeout: 25_000 })
    await shot('09-swap-dex', 2000)
    await beat()
    await vis('button:has-text("Cross-Chain")').first().click().catch(() => {})
    await shot('10-swap-crosschain', 2500)
    await vis('button:has-text("DEX Swap")').first().click().catch(() => {})
    await beat(800)

    // 11 app hub
    await vis('.bottom-nav-btn:has-text("Apps")').click()
    await expect(vis('text=App Hub').first()).toBeVisible({ timeout: 25_000 })
    await shot('11-app-hub', 2500)
    await beat()
    await page.getByPlaceholder('Search apps…').fill('swap')
    await shot('12-app-hub-search', 1500)
    await page.getByPlaceholder('Search apps…').fill('')
    await beat(800)

    // 13 profile
    await vis('button[title="Profile"]').first().click()
    await shot('13-profile', 3000)
    await beat()

    // 14-18 messenger. Profile has no header toolbar (same as Messenger), so
    // return to a main tab before reaching for the chat button.
    await vis('.bottom-nav-btn:has-text("Portfolio")').click()
    await beat(1000)
    await vis('button[title*="ChainLens Messenger"]').first().click()
    await expect(page.getByText('gm ChainLens ☀️')).toBeVisible({ timeout: 25_000 })
    await shot('14-messenger-world', 1500)
    await beat()
    await page.getByRole('button', { name: 'Open GIPHY picker' }).click()
    await shot('15-messenger-giphy', 1500)
    await page.getByRole('button', { name: 'Open GIPHY picker' }).click()
    await beat(700)
    await page.getByRole('button', { name: /^Friends/ }).click()
    await shot('16-messenger-friends', 1500)
    await beat()
    await page.getByRole('button', { name: /^Ava Mercer/ }).click()
    await expect(page.getByText('Sent the ADA over for the split 👍')).toBeVisible({ timeout: 20_000 })
    await shot('17-messenger-dm', 1500)
    await beat()

    // 19 back to portfolio, badge now populated
    await vis('.bottom-nav-btn:has-text("Portfolio")').click()
    await shot('18-header-toolbar-badge', 2000)
    await beat()

    // 20 walletconnect
    await vis('button[title="WalletConnect"]').first().click()
    await shot('19-walletconnect', 1800)
    await page.keyboard.press('Escape').catch(() => {})
    await vis('button:has-text("×")').first().click().catch(() => {})
    await beat(800)

    // 21-24 settings + themes
    await vis('button[title="Settings"]').first().click()
    await shot('20-settings', 1800)
    await beat()
    for (const [theme, name] of [['Crimson', '21-theme-crimson'], ['Matrix', '22-theme-matrix'], ['White & Gold', '23-theme-white-gold']] as const) {
      await vis(`button:has-text("${theme}")`).first().click().catch(() => {})
      await shot(name, 1600)
      await beat(900)
    }
    await vis('button:has-text("Moonlight")').first().click().catch(() => {})
    await beat(1200)
    await page.keyboard.press('Escape').catch(() => {})
    await vis('button:has-text("×")').first().click().catch(() => {})
    await beat(1500)

    // 24-25 the built-in browser, opened on ChainLens. It is a separate
    // BrowserWindow, so it arrives as a new Playwright page.
    const before = new Set(app.windows().map(w => w.url()))
    await vis('.bottom-nav-btn:has-text("Browser")').click().catch(() => {})
    let browser: Page | null = null
    for (let i = 0; i < 40 && !browser; i++) {
      for (const w of app.windows()) {
        const u = w.url()
        if (u && !u.startsWith('devtools://') && !before.has(u)) { browser = w; break }
      }
      if (!browser) await page.waitForTimeout(500)
    }
    if (browser) {
      await browser.waitForLoadState('domcontentloaded').catch(() => {})
      await browser.waitForTimeout(6000)
      await browser.screenshot({ path: join(OUT, '24-browser-chainlens.png') }).catch(() => {})
      await browser.waitForTimeout(1500)
    }

    // Save the video under a friendly name.
    await app.close().catch(() => {})
    // The app can open more than one window (each gets its own recording), so
    // pick the largest file rather than trusting order.
    const clips = readdirSync(VIDEO_DIR)
      .filter(f => f.endsWith('.webm') && f !== 'magic-money-tour.webm')
      .map(f => ({ f, size: statSync(join(VIDEO_DIR, f)).size }))
      .sort((a, b) => b.size - a.size)
    if (clips.length) {
      renameSync(join(VIDEO_DIR, clips[0].f), join(VIDEO_DIR, 'magic-money-tour.webm'))
      // The next-largest is the detached browser window, worth keeping.
      if (clips[1] && clips[1].size > 300_000) {
        renameSync(join(VIDEO_DIR, clips[1].f), join(VIDEO_DIR, 'magic-money-browser.webm'))
      }
      for (const extra of clips.slice(2)) rmSync(join(VIDEO_DIR, extra.f), { force: true })
    }
    rmSync(profile, { recursive: true, force: true })
  })
})
