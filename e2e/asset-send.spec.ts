/**
 * Sending a token / NFT from the Tokens and Collectibles tabs, end to end.
 *
 * Before this feature both tabs were read-only: the only Send button in the app
 * lived on the Networks tab and could move the native coin only. This drives the
 * two new entry points — the Send action in a token row's hover cluster, and the
 * primary Send button in the NFT detail modal — through to the real SendModal,
 * and checks that the amount guard compares EXACT base units rather than the
 * rounded display string (the reason WalletToken.rawBalance exists).
 *
 * Runs against an in-process fake EVM node, so no network and no funds. The
 * custom-chain path is what makes that possible: a user-added network has no
 * indexer, so its assets come from manual imports read straight off the RPC —
 * which means a local node can supply a real ERC-20 and a real ERC-721.
 *
 * Requires `npm run build` (drives out/main/index.js) and self-skips without it.
 */
import { test, expect } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { createServer, type Server } from 'http'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const MAIN = join(ROOT, 'out', 'main', 'index.js')
const MNEMONIC = 'test test test test test test test test test test test junk'.split(' ')
const PASSWORD = 'Smoke-Test-2026!'

const WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const NFT_CONTRACT = '0xcccccccccccccccccccccccccccccccccccccccc'
const ERC20_CONTRACT = '0xdddddddddddddddddddddddddddddddddddddddd'
const CHAIN_ID = 9998

/**
 * 1234.5678901 tokens at 9 decimals. Chosen so the DISPLAY string rounds to
 * "1,234.568" while the true holding is 1234.5678901 — sending the displayed
 * figure would overdraw. The over-balance assertion below pins that.
 */
const ERC20_DECIMALS = 9
const ERC20_RAW = 1_234_567_890_100n

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#3311bb"/><circle cx="100" cy="100" r="60" fill="#00e5ff"/></svg>`
const METADATA = {
  name: 'Sendable Rock #3',
  description: 'Served by the local fake node',
  image: `data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`,
  attributes: [],
}
const TOKEN_URI = `data:application/json;base64,${Buffer.from(JSON.stringify(METADATA)).toString('base64')}`

const word = (v: bigint) => `0x${v.toString(16).padStart(64, '0')}`
const abiString = (s: string) => {
  const hex = Buffer.from(s, 'utf8').toString('hex')
  return `0x${word(32n).slice(2)}${word(BigInt(s.length)).slice(2)}${hex.padEnd(Math.ceil(hex.length / 64) * 64, '0')}`
}

/** Minimal EVM node: add-network validation, one ERC-721 and one ERC-20. */
function startFakeNode(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      let reply: unknown = null
      try {
        const rpc = JSON.parse(body) as { id: number; method: string; params: unknown[] }
        const respond = (result: unknown) => ({ jsonrpc: '2.0', id: rpc.id, result })

        if (rpc.method === 'eth_chainId')         reply = respond(`0x${CHAIN_ID.toString(16)}`)
        else if (rpc.method === 'eth_getBalance') reply = respond('0x2386f26fc10000')  // 0.01 native
        else if (rpc.method === 'eth_call') {
          const params = rpc.params[0] as { to: string; data: string }
          const to = String(params.to).toLowerCase()
          const data = String(params.data)
          const sel = data.slice(0, 10)
          const isErc20 = to === ERC20_CONTRACT.toLowerCase()

          if (sel === '0x01ffc9a7') {
            // supportsInterface — the NFT is ERC-721, never ERC-1155.
            reply = respond(word(!isErc20 && data.slice(10, 18) === '80ac58cd' ? 1n : 0n))
          }
          else if (sel === '0x6352211e') reply = respond(word(BigInt(WALLET)))            // ownerOf
          else if (sel === '0xc87b56dd') reply = respond(abiString(TOKEN_URI))            // tokenURI
          else if (sel === '0x06fdde03') reply = respond(abiString(isErc20 ? 'Fake Dollar' : 'Sendable Rocks'))
          else if (sel === '0x95d89b41') reply = respond(abiString('FUSD'))               // symbol
          else if (sel === '0x313ce567') reply = respond(word(BigInt(ERC20_DECIMALS)))    // decimals
          else if (sel === '0x70a08231') reply = respond(word(isErc20 ? ERC20_RAW : 1n))  // balanceOf
          else if (sel === '0x2f745c59') reply = respond(word(3n))                        // tokenOfOwnerByIndex
          else reply = respond('0x')
        }
        else reply = respond('0x')
      } catch {
        reply = { jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'bad request' } }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(reply))
    })
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({ server, url: `http://127.0.0.1:${port}` })
    })
  })
}

test.describe('send a token / NFT from its tab', () => {
  test.skip(!existsSync(MAIN), 'build first')

  let app: ElectronApplication
  let page: Page
  let profile: string
  let node: { server: Server; url: string }

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

  // DashboardPage stays mounted behind other tabs, so text collides across
  // hidden copies — always filter to what's actually on screen.
  const vis = (selector: string) => page.locator(selector).filter({ visible: true })

  test.beforeAll(async () => {
    test.setTimeout(120_000)
    node = await startFakeNode()
    profile = mkdtempSync(join(tmpdir(), 'mm-e2e-send-'))
    const env = { ...process.env } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    env.MM_TEST_USERDATA = profile
    env.MM_REAL_MAIN = MAIN
    app = await _electron.launch({
      args: [join(__dirname, 'electron-wrapper.cjs')],
      executablePath: join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
      env,
    })
    page = await appWindow()

    // Onboard with the Foundry mnemonic so WALLET is the active address.
    await expect(vis('button:has-text("Import Existing Wallet")')).toBeVisible({ timeout: 20_000 })
    await vis('button:has-text("Import Existing Wallet")').click()
    for (let i = 0; i < 12; i++) await page.locator(`[placeholder="word ${i + 1}"]`).fill(MNEMONIC[i])
    await vis('button:has-text("Import Wallet")').click()
    await expect(page.locator('input[type="password"]').first()).toBeVisible({ timeout: 20_000 })
    const pws = page.locator('input[type="password"]')
    for (let i = 0; i < await pws.count(); i++) await pws.nth(i).fill(PASSWORD)
    await vis('button:has-text("Encrypt & Continue")').click()
    await expect(vis('text=Portfolio').first()).toBeVisible({ timeout: 30_000 })

    // Add the fake node as a custom network (no explorer → manual import path).
    await vis('button[aria-label="Add a custom network"]').click()
    await vis('input[placeholder="e.g. Monad Mainnet"]').fill('Send Test Chain')
    await vis('input[placeholder="https://rpc.example.com"]').fill(node.url)
    await vis('input[placeholder="143"]').fill(String(CHAIN_ID))
    await vis('input[placeholder="MON"]').fill('FAKE')
    await vis('button:has-text("Add Network")').click()
    await expect(vis('text=Add a Network')).toHaveCount(0, { timeout: 30_000 })
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
    await new Promise<void>(r => node?.server.close(() => r()))
    rmSync(profile, { recursive: true, force: true })
  })

  test('sends an ERC-20 from the Tokens tab, validating against the exact balance', async () => {
    test.setTimeout(240_000)

    await vis('button:has-text("tokens")').click()
    await vis('button:has-text("+ Import")').click()
    await expect(vis('text=Import a Token').first()).toBeVisible({ timeout: 10_000 })
    // The token form resolves the contract on its own (debounced) — no lookup button.
    await vis('input[placeholder="0x…"]').fill(ERC20_CONTRACT)
    await expect(vis('text=Fake Dollar').first()).toBeVisible({ timeout: 30_000 })
    await vis('button:has-text("Import Token")').click()
    await expect(vis('text=Imported Tokens').first()).toBeVisible({ timeout: 30_000 })

    // Close the import dialog and find the row in the Tokens list.
    await vis('button[aria-label="Close import token dialog"]').click()
    const row = vis('text=Fake Dollar').first()
    await expect(row).toBeVisible({ timeout: 60_000 })

    // The Send action only mounts on hover on a fine pointer — that's the
    // COARSE_POINTER branch in TokenRow.
    await row.hover()
    const sendBtn = vis('button[aria-label="Send this token"]').first()
    await expect(sendBtn).toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: 'test-results/asset-send-token-row.png' })
    await sendBtn.click()

    // SendModal opens in token mode: header names the token, not the chain coin.
    await expect(vis('text=Send FUSD').first()).toBeVisible({ timeout: 10_000 })

    // Per-chain address validation still applies on the token path.
    const addr = vis('.input').first()
    await addr.fill('not-an-address')
    await expect(vis('text=/Invalid|not a valid/i').first()).toBeVisible({ timeout: 15_000 })

    await addr.fill('0x2222222222222222222222222222222222222222')
    await expect(vis('text=/Invalid|not a valid/i')).toHaveCount(0, { timeout: 15_000 })

    // The whole point of rawBalance: the row DISPLAYS ~1,234.568 but truly holds
    // 1234.5678901. An amount above the true holding must be rejected...
    await vis('input[placeholder="0.0"]').fill('1234.5678902')
    await expect(vis('text=Exceeds available balance')).toBeVisible({ timeout: 10_000 })

    // ...while the exact holding, which is MORE than the rounded display string,
    // must be accepted. Comparing against `balance` would wrongly reject this.
    await vis('input[placeholder="0.0"]').fill('1234.5678901')
    await expect(vis('text=Exceeds available balance')).toHaveCount(0, { timeout: 10_000 })

    // MAX fills the exact holding, never the rounded one.
    await vis('button:has-text("MAX")').click()
    await expect(vis('input[placeholder="0.0"]')).toHaveValue('1234.5678901')

    // More decimal places than the token has is refused rather than truncated.
    await vis('input[placeholder="0.0"]').fill('1.0123456789')
    await expect(vis('text=/at most 9 decimal places/i')).toBeVisible({ timeout: 10_000 })

    await page.screenshot({ path: 'test-results/asset-send-token.png' })
    await page.keyboard.press('Escape')
  })

  test('offers Send on an imported NFT and opens the modal for it', async () => {
    test.setTimeout(240_000)

    await vis('button:has-text("collectibles")').click()
    await vis('button:has-text("+ Import")').click()
    await expect(vis('text=Import an NFT').first()).toBeVisible({ timeout: 10_000 })
    await vis('input[placeholder="0x…"]').fill(NFT_CONTRACT)
    await vis('button:has-text("Look up")').click()
    await expect(vis('text=Sendable Rocks').first()).toBeVisible({ timeout: 30_000 })
    await vis('button:has-text("Import #3")').click()
    await expect(vis('text=Imported NFTs').first()).toBeVisible({ timeout: 30_000 })
    await vis('button[aria-label="Close import NFT dialog"]').click()

    // Open the card's detail modal.
    const card = vis('text=Sendable Rock #3').first()
    await expect(card).toBeVisible({ timeout: 60_000 })
    await card.click()

    // ERC-721 is sendable, so the modal offers Send rather than a blocked notice.
    const nftSend = vis('button:has-text("Send")').first()
    await expect(nftSend).toBeVisible({ timeout: 15_000 })
    await expect(vis('text=/isn.t supported for this asset type/i')).toHaveCount(0)
    await page.screenshot({ path: 'test-results/asset-send-nft-detail.png' })
    await nftSend.click()

    // SendModal opens in NFT mode: named after the NFT, and with NO amount field
    // — a 1-of-1 has nothing to choose.
    await expect(vis('text=Send Sendable Rock #3').first()).toBeVisible({ timeout: 10_000 })
    await expect(vis('text=1 of 1').first()).toBeVisible({ timeout: 10_000 })
    await expect(vis('input[placeholder="0.0"]')).toHaveCount(0)

    await page.screenshot({ path: 'test-results/asset-send-nft.png' })
  })
})
