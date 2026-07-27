/**
 * Custom-chain asset import, end to end against a local fake EVM node.
 *
 * A user-added network has no Alchemy/Moralis coverage, so its NFTs come from
 * either a Blockscout explorer or a manual import. This covers the manual path
 * (the harder one): add network -> look up -> preview artwork -> import ->
 * card rendered in the Collectibles grid, exercising the real ABI
 * encode/decode and data:-URI metadata handling.
 *
 * The node is served in-process, so this test needs no network and no funds.
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

// Account 0 of the public Foundry test mnemonic — deterministic, so the fake
// node can hard-code it as the NFT's owner.
const WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const NFT_CONTRACT = '0xcccccccccccccccccccccccccccccccccccccccc'
const CHAIN_ID = 9999

// Inline SVG artwork: exercises the data:-URI image path end to end, and makes
// a metadata mis-decode fail loudly instead of degrading to a blank tile.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#ff00aa"/><circle cx="100" cy="100" r="60" fill="#00e5ff"/><text x="100" y="112" font-size="40" text-anchor="middle" fill="#000" font-family="monospace">7</text></svg>`
const IMAGE_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`
const METADATA = {
  name: 'Test Rock #7',
  description: 'Served by the local fake node',
  image: IMAGE_DATA_URI,
  attributes: [{ trait_type: 'Hardness', value: 'Granite' }],
}
const TOKEN_URI = `data:application/json;base64,${Buffer.from(JSON.stringify(METADATA)).toString('base64')}`

const word = (v: bigint) => `0x${v.toString(16).padStart(64, '0')}`
const abiString = (s: string) => {
  const hex = Buffer.from(s, 'utf8').toString('hex')
  return `0x${word(32n).slice(2)}${word(BigInt(s.length)).slice(2)}${hex.padEnd(Math.ceil(hex.length / 64) * 64, '0')}`
}

/** Minimal EVM node: just enough for add-network validation + one ERC-721. */
function startFakeNode(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      let reply: unknown = null
      try {
        const rpc = JSON.parse(body) as { id: number; method: string; params: unknown[] }
        const respond = (result: unknown) => ({ jsonrpc: '2.0', id: rpc.id, result })

        if (rpc.method === 'eth_chainId')    reply = respond(`0x${CHAIN_ID.toString(16)}`)
        else if (rpc.method === 'eth_getBalance') reply = respond('0x0')
        else if (rpc.method === 'eth_call') {
          const data = String((rpc.params[0] as { data: string }).data)
          const sel = data.slice(0, 10)
          if (sel === '0x01ffc9a7') {
            // supportsInterface — ERC-721 yes, ERC-1155 no
            reply = respond(word(data.slice(10, 18) === '80ac58cd' ? 1n : 0n))
          } else if (sel === '0x6352211e') reply = respond(word(BigInt(WALLET)))       // ownerOf
          else if (sel === '0xc87b56dd')   reply = respond(abiString(TOKEN_URI))       // tokenURI
          else if (sel === '0x06fdde03')   reply = respond(abiString('Test Rocks'))    // name
          else if (sel === '0x70a08231')   reply = respond(word(1n))                   // balanceOf(owner)
          else if (sel === '0x2f745c59')   reply = respond(word(7n))                   // tokenOfOwnerByIndex
          else reply = respond('0x')
        } else reply = respond('0x')
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

test.describe('custom chain asset import', () => {
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

  const vis = (selector: string) => page.locator(selector).filter({ visible: true })

  test.beforeAll(async () => {
    test.setTimeout(120_000)
    node = await startFakeNode()
    profile = mkdtempSync(join(tmpdir(), 'mm-e2e-'))
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
  })

  test.afterAll(async () => {
    await app?.close().catch(() => {})
    await new Promise<void>(r => node?.server.close(() => r()))
    rmSync(profile, { recursive: true, force: true })
  })

  test('previews an NFT and adds it to the Collectibles grid', async () => {
    test.setTimeout(240_000)

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

    // Add the fake node as a custom network. No explorer URL, so Blockscout
    // auto-detect is skipped entirely — this isolates the MANUAL import path.
    await vis('button[aria-label="Add a custom network"]').click()
    await vis('input[placeholder="e.g. Monad Mainnet"]').fill('Fake Chain')
    await vis('input[placeholder="https://rpc.example.com"]').fill(node.url)
    await vis('input[placeholder="143"]').fill(String(CHAIN_ID))
    await vis('input[placeholder="MON"]').fill('FAKE')
    await vis('button:has-text("Add Network")').click()
    await expect(vis('text=Add a Network')).toHaveCount(0, { timeout: 30_000 })

    // Collectibles tab now offers "+ Import".
    await vis('button:has-text("collectibles")').click()
    const importBtn = vis('button:has-text("+ Import")')
    await expect(importBtn).toBeVisible({ timeout: 15_000 })

    await importBtn.click()
    await expect(vis('text=Import an NFT').first()).toBeVisible({ timeout: 5_000 })

    // Blank token id → the Enumerable path lists what this wallet owns.
    await vis('input[placeholder="0x…"]').fill(NFT_CONTRACT)
    await vis('button:has-text("Look up")').click()
    await expect(vis('text=Test Rocks').first()).toBeVisible({ timeout: 30_000 })
    // The artwork itself must render — that's the visual confirmation.
    await expect(vis('img[alt="Test Rock #7"]')).toBeVisible({ timeout: 15_000 })

    // Import → appears in the modal's list, then in the Collectibles grid.
    await vis('button:has-text("Import #7")').click()
    await expect(vis('text=Imported NFTs').first()).toBeVisible({ timeout: 30_000 })

    await vis('button[aria-label="Close import NFT dialog"]').click()
    await expect(vis('text=Test Rock #7').first()).toBeVisible({ timeout: 60_000 })

    // Ownership is re-checked on every fetch: an NFT that moved away disappears.
    await vis('button:has-text("+ Import")').click()
    await vis('button[aria-label="Remove token 7"]').click()
    await expect(vis('text=Imported NFTs')).toHaveCount(0, { timeout: 15_000 })
  })
})
