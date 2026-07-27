/**
 * Custom networks in the REAL extension (MV3 service worker).
 *
 * The "Add a Network" feature was Electron-only at first; the handlers live in
 * the shared switch and the rules in custom-chains.ts, so this proves the
 * extension actually reaches them: the "+" button exists, the RPC chain-id
 * probe runs inside the service worker, the network card renders, and an
 * ERC-20 import resolves off that chain's RPC.
 *
 * Android rides the same handler switch and renderer, so this covers that
 * plumbing too (its only extra layer is the native fetch router, which sends
 * unlisted hosts — i.e. any user RPC — over the CORS-free native path).
 *
 * The node is served in-process: no network, no funds. Requires
 * `npm run build:extension` first.
 */
import { expect, test, chromium, type BrowserContext, type Worker } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const distExtension = resolve(process.cwd(), 'dist-extension')
const MNEMONIC = 'test test test test test test test test test test test junk'.split(' ')
const WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const TOKEN = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const CHAIN_ID = 9931

const word = (v: bigint) => `0x${v.toString(16).padStart(64, '0')}`
const abiString = (s: string) => {
  const hex = Buffer.from(s, 'utf8').toString('hex')
  return `0x${word(32n).slice(2)}${word(BigInt(s.length)).slice(2)}${hex.padEnd(Math.ceil(hex.length / 64) * 64, '0')}`
}

function startFakeNode(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    // The SW fetches cross-origin; allow it explicitly.
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      let reply: unknown = null
      try {
        const rpc = JSON.parse(body) as { id: number; method: string; params: unknown[] }
        const ok = (result: unknown) => ({ jsonrpc: '2.0', id: rpc.id, result })
        if (rpc.method === 'eth_chainId') reply = ok(`0x${CHAIN_ID.toString(16)}`)
        else if (rpc.method === 'eth_getBalance') reply = ok('0x0')
        else if (rpc.method === 'eth_call') {
          const data = String((rpc.params[0] as { data: string }).data)
          const sel = data.slice(0, 10)
          if (sel === '0x06fdde03')      reply = ok(abiString('Fake Token'))
          else if (sel === '0x95d89b41') reply = ok(abiString('FAKE'))
          else if (sel === '0x313ce567') reply = ok(word(18n))
          else if (sel === '0x70a08231') reply = ok(word(5n * 10n ** 18n))
          else reply = ok('0x')
        } else reply = ok('0x')
      } catch {
        reply = { jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'bad' } }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(reply))
    })
  })
  return new Promise(r => server.listen(0, '127.0.0.1', () => {
    const a = server.address()
    r({ server, url: `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}` })
  }))
}

async function launchWithExtension(): Promise<{ ctx: BrowserContext; sw: Worker }> {
  expect(existsSync(join(distExtension, 'manifest.json')), 'run npm run build:extension first').toBe(true)
  const userDir = mkdtempSync(join(tmpdir(), 'mm-ext-custom-'))
  const ctx = await chromium.launchPersistentContext(userDir, {
    headless: false,
    args: [`--disable-extensions-except=${distExtension}`, `--load-extension=${distExtension}`],
  })
  const sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker', { timeout: 15_000 })
  return { ctx, sw }
}

test.describe('extension custom chains (real extension)', () => {
  test('adds a custom network and imports a token on it', async () => {
    test.setTimeout(300_000)
    const node = await startFakeNode()
    const { ctx, sw } = await launchWithExtension()
    try {
      const extId = new URL(sw.url()).host
      const page = await ctx.newPage()
      await page.goto(`chrome-extension://${extId}/popup.html`)

      await page.getByText('Import Existing Wallet').click()
      for (let i = 0; i < 12; i++) await page.locator(`[placeholder="word ${i + 1}"]`).fill(MNEMONIC[i])
      await page.getByRole('button', { name: /Import Wallet/i }).click()
      await page.getByPlaceholder(/Password \(min/).fill('e2e-test-password-1')
      await page.getByPlaceholder('Confirm password').fill('e2e-test-password-1')
      await page.getByText('Encrypt & Continue').click()
      await expect(page.getByText('Portfolio').first()).toBeVisible({ timeout: 30_000 })

      const vis = (sel: string) => page.locator(sel).filter({ visible: true })

      // The "+" button must exist here now — that's the whole point of the port.
      const plus = vis('button[aria-label="Add a custom network"]')
      await expect(plus).toBeVisible({ timeout: 20_000 })
      await plus.click()

      await vis('input[placeholder="e.g. Monad Mainnet"]').fill('Ext Chain')
      await vis('input[placeholder="https://rpc.example.com"]').fill(node.url)
      await vis('input[placeholder="143"]').fill(String(CHAIN_ID))
      await vis('input[placeholder="MON"]').fill('EXT')
      await vis('button:has-text("Add Network")').click()
      await expect(vis('text=Add a Network')).toHaveCount(0, { timeout: 40_000 })

      // Network card renders in the popup's Networks tab.
      await expect(page.locator('.chain-card').filter({ hasText: 'Ext Chain' })).toBeVisible({ timeout: 60_000 })

      // Token import on that network.
      await vis('button:has-text("tokens")').click()
      await vis('button:has-text("+ Import")').click()
      await expect(vis('text=Import a Token').first()).toBeVisible({ timeout: 10_000 })
      await vis('input[placeholder="0x…"]').fill(TOKEN)
      await expect(vis('text=FAKE').first()).toBeVisible({ timeout: 40_000 })
      await vis('button:has-text("Import Token")').click()
      await expect(vis('text=Imported Tokens').first()).toBeVisible({ timeout: 40_000 })
    } finally {
      await ctx.close()
      await new Promise<void>(r => node.server.close(() => r()))
    }
  })
})
