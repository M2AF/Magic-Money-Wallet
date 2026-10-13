import { test, expect } from '@playwright/test'
import { _electron, type Page } from 'playwright'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const MAIN = join(ROOT, 'out/main/index.js')
const ME = 'ec18dcf5-3271-46fd-8029-41e5b2f39eed'
const AVA = '3f2c6cb8-2a43-4b69-bf5e-099ef63be79f'
const MIA = 'c828bf80-3280-4c46-a8bb-503a442e0743'
const CORA = '9b1f0c22-5d8e-41a7-8f3b-6c2d4e5a7b19'
const DORA = '7c1e2b44-9a30-4d18-9f52-1b3c8d0e6a77'

test('chat PFP menu manages friendships, profile links, blocks and explicit reports through Electron IPC', async () => {
  test.skip(!existsSync(MAIN), 'fresh Electron output required')
  test.setTimeout(240_000)
  const profile = mkdtempSync(join(tmpdir(), 'mm-chat-menu-'))
  const env = { ...process.env, MM_TEST_USERDATA: profile, MM_REAL_MAIN: MAIN, MM_TEST_NO_BIOMETRICS: '1' }
  delete (env as Record<string, string | undefined>).ELECTRON_RUN_AS_NODE
  // electron-wrapper installs the shared Worker stub for main and renderer.
  const app = await _electron.launch({ args: [join(__dirname, 'electron-wrapper.cjs')], executablePath: join(ROOT, 'node_modules/electron/dist/electron.exe'), env })
  try {
    let page: Page | undefined
    for (let attempt = 0; attempt < 60 && !page; attempt++) {
      page = app.windows().find(window => window.url() && !window.url().startsWith('devtools://'))
      if (!page) await new Promise(resolve => setTimeout(resolve, 300))
    }
    if (!page) throw new Error('Wallet window did not open')
    // Probe the real handlers before installing fixture overrides. Otherwise a
    // mocked menu journey could hide a missing main-process registration.
    const registrationErrors = await page.evaluate(async id => {
      const errors: string[] = []
      for (const invoke of [() => window.wallet.chatRelationship(id), () => window.wallet.chatSetBlocked(id, true), () => window.wallet.chatReport(id, 'spam', '')]) {
        try { await invoke(); errors.push('unexpected success before wallet setup') }
        catch (error) { errors.push(String(error)) }
      }
      return errors
    }, MIA)
    for (const error of registrationErrors) {
      expect(error).toContain('No wallet address.')
      expect(error).not.toContain('No handler registered')
    }
    await app.evaluate(({ ipcMain, BrowserWindow }, ids) => {
      type Relation = { friendship_id: number; status: 'accepted' | 'pending'; incoming: boolean }
      const peers = Object.fromEntries([['Ava', ids.AVA], ['Mia', ids.MIA], ['Cora', ids.CORA], ['Dora', ids.DORA], ['You', ids.ME]].map(([display_name, id]) => [id, { id, display_name, avatar_url: null }]))
      const state = {
        relations: { [ids.AVA]: { friendship_id: 12, status: 'accepted', incoming: false }, [ids.CORA]: { friendship_id: 14, status: 'pending', incoming: true }, [ids.DORA]: { friendship_id: 15, status: 'pending', incoming: false } } as Record<string, Relation>,
        blocked: new Set<string>(), calls: [] as Array<{ type: string; id?: string; reason?: string; details?: string; url?: string }>,
        failReport: true, failBlock: true, holdReport: false, releaseReport: null as (() => void) | null,
      }
      ;(globalThis as any).__chatMenuTest = state
      const world = [ids.AVA, ids.MIA, ids.CORA, ids.DORA, ids.ME].map((id, index) => ({ id: index + 1, message_type: 'text', content: `Hello from ${peers[id].display_name}`, author: peers[id], created_at: new Date().toISOString() }))
      const friends = () => {
        const all = Object.entries(state.relations).filter(([id]) => !state.blocked.has(id))
        const rows = (condition: (value: Relation) => boolean) => all.filter(([, value]) => condition(value)).map(([id, relation]) => ({ ...peers[id], friendship_id: relation.friendship_id, created_at: null, accepted_at: null }))
        return { friends: rows(value => value.status === 'accepted'), incoming: rows(value => value.status === 'pending' && value.incoming), outgoing: rows(value => value.status === 'pending' && !value.incoming) }
      }
      const handlers: Record<string, (...args: any[]) => unknown> = {
        'chat:status': () => ({ eligible: true, walletLinked: true, socialLinked: true, giphyAvailable: false, userId: ids.ME, displayName: 'You', avatarUrl: null }),
        'chat:world': (after?: number) => after ? [] : world.filter(message => !state.blocked.has(message.author.id)),
        'chat:friends': friends,
        'chat:relationship': (id: string) => ({ blocked: state.blocked.has(id), interactionAllowed: !state.blocked.has(id), friendship: state.relations[id] || null }),
        'chat:add-friend': (id: string) => { state.calls.push({ type: 'add', id }); state.relations[id] = { friendship_id: 50, status: 'pending', incoming: false } },
        'chat:accept-friend': (friendshipId: number) => { const [id, relation] = Object.entries(state.relations).find(([, row]) => row.friendship_id === friendshipId)!; state.calls.push({ type: 'accept', id }); relation.status = 'accepted' },
        'chat:remove-friend': (friendshipId: number) => { const id = Object.keys(state.relations).find(id => state.relations[id].friendship_id === friendshipId)!; state.calls.push({ type: 'remove', id }); delete state.relations[id] },
        'chat:set-blocked': (id: string, blocked: boolean) => { if (state.failBlock) throw new Error('Block unavailable'); state.calls.push({ type: blocked ? 'block' : 'unblock', id }); if (blocked) state.blocked.add(id); else state.blocked.delete(id) },
        'chat:report': async (id: string, reason: string, details: string) => {
          state.calls.push({ type: 'report', id, reason, details })
          if (state.holdReport) await new Promise<void>(resolve => { state.releaseReport = resolve })
          if (state.failReport) throw new Error('Daily report limit reached')
        },
        'chat:unread': () => ({ pending_requests: friends().incoming.length, unread_direct: 0, conversations: [] }),
        'chat:mark-read': () => undefined,
        'chat:direct': (id: string, after?: number) => after ? [] : [{ id: 20, message_type: 'text', content: 'Direct hello', author: peers[id], created_at: new Date().toISOString() }],
      }
      for (const [channel, handler] of Object.entries(handlers)) { ipcMain.removeHandler(channel); ipcMain.handle(channel, (_event, ...args) => handler(...args)) }
      ipcMain.removeAllListeners('browser:open-url')
      ipcMain.on('browser:open-url', (_event, url) => state.calls.push({ type: 'profile', url }))
      BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().startsWith('devtools://'))?.setSize(390, 850)
    }, { ME, AVA, MIA, CORA, DORA })
    const vis = (selector: string) => page!.locator(selector).filter({ visible: true })
    await vis('button:has-text("Import Existing Wallet")').click({ timeout: 25_000 })
    const words = 'test test test test test test test test test test test junk'.split(' ')
    for (let i = 0; i < words.length; i++) await page.locator(`[placeholder="word ${i + 1}"]`).fill(words[i])
    await vis('button:has-text("Import Wallet")').click()
    await expect(page.locator('input[type=password]').first()).toBeVisible({ timeout: 25_000 })
    for (const password of await page.locator('input[type=password]').all()) await password.fill('Chat-Menu-Test-2026!')
    await vis('button:has-text("Encrypt & Continue")').click()
    await expect(vis('.bottom-nav-btn:has-text("Portfolio")')).toBeVisible({ timeout: 30_000 })
    await vis('button[title*="ChainLens Messenger"]').first().click()
    await expect(page.getByText('Hello from Mia', { exact: true })).toBeVisible({ timeout: 15_000 })
    const open = async (name: string) => {
      await page!.getByRole('button', { name: `Open ${name} options`, exact: true }).first().click()
      const menu = page!.getByRole('menu', { name: `${name} options`, exact: true })
      await expect(menu).toBeVisible()
      return menu
    }
    let menu = await open('Ava')
    await menu.getByRole('menuitem', { name: 'Remove Friend', exact: true }).click()
    await expect(menu.getByRole('menuitem', { name: 'Add Friend', exact: true })).toBeEnabled()
    await menu.getByRole('menuitem', { name: 'Add Friend', exact: true }).click()
    await expect(menu.getByRole('menuitem', { name: 'Cancel Request', exact: true })).toBeEnabled()
    await menu.getByRole('menuitem', { name: 'Cancel Request', exact: true }).click()
    await expect(menu.getByRole('menuitem', { name: 'Add Friend', exact: true })).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Open Ava options', exact: true })).toBeFocused()
    menu = await open('Cora')
    await menu.getByRole('menuitem', { name: 'Accept Request', exact: true }).click()
    await expect(menu.getByRole('menuitem', { name: 'Remove Friend', exact: true })).toBeEnabled()
    await page.keyboard.press('Escape')
    menu = await open('Dora')
    await menu.getByRole('menuitem', { name: 'Cancel Request', exact: true }).click()
    await expect(menu.getByRole('menuitem', { name: 'Add Friend', exact: true })).toBeEnabled()
    await page.keyboard.press('Escape')
    await app.evaluate(({ }, id) => { (globalThis as any).__chatMenuTest.relations[id] = { friendship_id: 15, status: 'pending', incoming: true } }, DORA)
    menu = await open('Dora')
    await menu.getByRole('menuitem', { name: 'Decline Request', exact: true }).click()
    await expect(menu.getByRole('menuitem', { name: 'Add Friend', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'World Chat', exact: true }).click()
    await expect(menu).toBeHidden()
    menu = await open('You')
    await expect(menu.getByRole('menuitem')).toHaveCount(1)
    const box = await menu.boundingBox()
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    expect(box!.x).toBeGreaterThanOrEqual(12); expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width - 11)
    expect(box!.y).toBeGreaterThanOrEqual(12); expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - 11)
    await page.keyboard.press('Escape')
    menu = await open('Mia')
    await expect(menu.getByRole('menuitem', { name: 'Add Friend', exact: true })).toBeEnabled()
    await page.keyboard.press('ArrowDown')
    await expect(menu.getByRole('menuitem', { name: 'Add Friend', exact: true })).toBeFocused()
    await page.keyboard.press('End')
    await expect(menu.getByRole('menuitem', { name: 'Report', exact: true })).toBeFocused()
    await page.keyboard.press('Home')
    await expect(menu.getByRole('menuitem', { name: 'View Profile', exact: true })).toBeFocused()
    await expect(menu.getByRole('menuitem', { name: 'View Profile' })).toHaveAttribute('href', `https://www.chainlensnft.info/${MIA}`)
    await page.screenshot({ path: 'test-results/chat-avatar-menu.png' })
    await menu.getByRole('menuitem', { name: 'Report', exact: true }).click()
    const report = page.getByRole('dialog', { name: 'Report Mia', exact: true })
    await expect(report.getByLabel('Report reason')).toBeFocused()
    expect(await app.evaluate(() => (globalThis as any).__chatMenuTest.calls.filter((call: any) => call.type === 'report').length)).toBe(0)
    await report.getByLabel('Report reason').selectOption('harassment')
    await report.getByLabel('Report details').fill('World Chat context')
    await page.screenshot({ path: 'test-results/chat-report-form.png' })
    await app.evaluate(() => { (globalThis as any).__chatMenuTest.holdReport = true })
    await report.getByRole('button', { name: 'Submit Report', exact: true }).click()
    await expect(report).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(report).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(report).toBeFocused()
    await app.evaluate(() => { const state = (globalThis as any).__chatMenuTest; state.holdReport = false; state.releaseReport() })
    await expect(report.getByRole('alert')).toHaveText('Daily report limit reached')
    await expect(report).toBeVisible()
    await app.evaluate(() => { (globalThis as any).__chatMenuTest.failReport = false })
    await page.screenshot({ path: 'test-results/chat-report-error.png' })
    await report.getByRole('button', { name: 'Submit Report', exact: true }).click()
    await expect(menu.getByRole('status')).toHaveText('Report submitted')
    await menu.getByRole('menuitem', { name: 'Block', exact: true }).click()
    await expect(menu.getByRole('alert')).toHaveText('Block unavailable')
    await expect(page.getByText('Hello from Mia', { exact: true })).toBeVisible()
    await app.evaluate(() => { (globalThis as any).__chatMenuTest.failBlock = false })
    await menu.getByRole('menuitem', { name: 'Block', exact: true }).click()
    await expect(menu.getByRole('menuitem', { name: 'Unblock', exact: true })).toBeEnabled()
    await expect(page.getByText('Hello from Mia', { exact: true })).toHaveCount(0)
    await menu.getByRole('menuitem', { name: 'Unblock', exact: true }).click()
    await expect(page.getByText('Hello from Mia', { exact: true })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Block', exact: true })).toBeEnabled()
    await menu.getByRole('menuitem', { name: 'View Profile', exact: true }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as any).__chatMenuTest.calls.filter((call: any) => call.type === 'profile').at(-1)?.url)).toBe(`https://www.chainlensnft.info/${MIA}`)
    await page.getByRole('button', { name: /^Friends/ }).click()
    menu = await open('Cora')
    await expect(menu.getByRole('menuitem', { name: 'Remove Friend', exact: true })).toBeEnabled()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Cora', exact: true }).click()
    await expect(page.getByText('Direct hello', { exact: true })).toBeVisible()
    menu = await open('Cora')
    await menu.getByRole('menuitem', { name: 'Remove Friend', exact: true }).click()
    await expect(page.getByTestId('direct-message-feed')).toHaveCount(0)
    await expect(menu.getByRole('menuitem', { name: 'Add Friend', exact: true })).toBeEnabled()
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    const reports = await app.evaluate(() => (globalThis as any).__chatMenuTest.calls.filter((call: any) => call.type === 'report'))
    expect(reports.at(-1)).toEqual({ type: 'report', id: MIA, reason: 'harassment', details: 'World Chat context' })
  } finally {
    await app.close()
    // This is the exact temporary profile allocated above, outside the repo.
    if (!profile.startsWith(join(tmpdir(), 'mm-chat-menu-'))) throw new Error('Unexpected test profile path')
    rmSync(profile, { recursive: true, force: true })
  }
})
