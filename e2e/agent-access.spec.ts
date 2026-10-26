import { test, expect } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { validAppFee, calldataWithFeeRecipient } from '../src/main/swap-fixtures'

const ROOT = join(__dirname, '..')
const MAIN = join(ROOT, 'out/main/index.js')
const PHRASE = 'test test test test test test test test test test test junk'.split(' ')

test('desktop agent pairing, real CLI/MCP, proposal review, revocation and default-off restart', async () => {
  test.skip(!existsSync(MAIN), 'Build Electron first')
  test.setTimeout(240_000)
  const profile = mkdtempSync(join(tmpdir(), 'mm-agent-e2e-'))
  const evidence = join(ROOT, '.local-artifacts/agent-access')
  mkdirSync(evidence, { recursive: true })
  let app: ElectronApplication | undefined
  const launch = async () => {
    const env = { ...process.env, MM_TEST_USERDATA: profile, MM_REAL_MAIN: MAIN, MM_TEST_NO_BIOMETRICS: '1', MAGICMONEY_X402: '0' } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    const instance = await _electron.launch({ args: [join(__dirname, 'electron-wrapper.cjs')], env })
    let page: Page | undefined
    for (let i = 0; i < 60 && !page; i++) {
      page = instance.windows().find(w => w.url() && !w.url().startsWith('devtools://'))
      if (!page) await new Promise(r => setTimeout(r, 250))
    }
    if (!page) throw new Error('No wallet window')
    return { instance, page }
  }
  try {
    const first = await launch(); app = first.instance
    const page = first.page
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const visible = (selector: string) => page.locator(selector).filter({ visible: true })
    await visible('button:has-text("Import Existing Wallet")').click()
    for (let i = 0; i < 12; i++) await page.locator(`[placeholder="word ${i + 1}"]`).fill(PHRASE[i])
    await visible('button:has-text("Import Wallet")').click()
    await expect(page.locator('input[type="password"]').first()).toBeVisible({ timeout: 20_000 })
    for (const input of await page.locator('input[type="password"]').all()) await input.fill('Agent-Test-2026!')
    await visible('button:has-text("Encrypt & Continue")').click()
    await expect(page.getByRole('button', { name: 'Agent Access', exact: true })).toBeVisible({ timeout: 30_000 })
    for (const width of [380, 420, 768, 1200]) {
      await app.evaluate(({ BrowserWindow }, width) => {
        const win = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().startsWith('devtools://'))!
        win.setSize(width, 900)
      }, width)
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
      await expect.poll(async () => {
        const mark = await page.locator('.titlebar-wordmark').boundingBox()
        const trigger = await page.getByRole('button', { name: 'Agent Access', exact: true }).boundingBox()
        return !!mark && !!trigger && mark.x + mark.width <= trigger.x
      }).toBe(true)
      await page.screenshot({ path: join(evidence, `titlebar-${width}.png`) })
    }
    await page.screenshot({ path: join(evidence, 'titlebar-desktop.png') })
    await page.getByRole('button', { name: 'Agent Access', exact: true }).click()
    const panel = page.getByRole('dialog', { name: 'Agent Access' })
    await expect(panel.getByText('Access is off', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'Enable access', exact: true }).click()
    // Test-only native dialog replacement; export uses the production implementation.
    await app.evaluate(({ app, dialog }, args) => {
      app.setAppPath(args.root)
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [args.folder] })
    }, { root: ROOT, folder: profile })
    await panel.getByLabel('Assistant name', { exact: true }).fill('Research assistant')
    await panel.getByLabel('Allow transfer and swap proposals').check()
    await panel.getByRole('button', { name: 'Pair and save connection files' }).click()
    await expect(panel.getByText('Connection files saved. MCP launch command:')).toBeVisible()
    const configName = readdirSync(profile).find(n => /^magicmoney-agent-.*\.json$/.test(n))!
    const configPath = join(profile, configName)
    const adapterPath = configPath.replace(/\.json$/, '.mjs')
    const connection = JSON.parse(readFileSync(configPath, 'utf8')) as { token: string; endpoint: string }
    expect(readFileSync(adapterPath, 'utf8')).toBe(readFileSync(join(ROOT, 'resources/agent-access.mjs'), 'utf8'))
    const rpc = async (tool: string, args = {}) => fetch(connection.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.token}` },
      body: JSON.stringify({ tool, args }),
    })
    const run = (command: string, input = '') => new Promise<{ code: number | null; output: string }>((resolveRun, reject) => {
      const proc = spawn(process.execPath, [adapterPath, '--connection', configPath, command], { stdio: 'pipe' })
      let output = ''
      proc.stdout.on('data', data => { output += data })
      proc.once('error', reject); proc.once('close', code => resolveRun({ code, output })); proc.stdin.end(input)
    })
    const cli = await run('addresses')
    expect(cli.code).toBe(0)
    expect(JSON.parse(cli.output).evm).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(cli.output).not.toMatch(/mnemonic|privateViewKey|moneroViewKey|password|token/i)
    const mcp = await run('mcp', [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ].map(value => JSON.stringify(value)).join('\n') + '\n')
    expect(mcp.code).toBe(0)
    expect(mcp.output.trim().split('\n').map(line => JSON.parse(line))[1].result.tools.some((t: { name: string }) => t.name === 'wallet_propose_transfer')).toBe(true)
    expect(mcp.output.trim().split('\n').map(line => JSON.parse(line))[1].result.tools.some((t: { name: string }) => t.name.includes('x402'))).toBe(false)
    await expect(panel.getByRole('heading', { name: 'USDC x402 payments', exact: true })).toHaveCount(0)
    expect((await rpc('wallet_sign')).ok).toBe(false)
    const args = { requestId: 'send-draft-1', chain: 'base', recipient: '0x000000000000000000000000000000000000dEaD', amount: '0.001' }
    const firstProposal = await (await rpc('wallet_propose_transfer', args)).json()
    const duplicate = await (await rpc('wallet_propose_transfer', args)).json()
    expect(firstProposal.result.id).toBe(duplicate.result.id)
    await expect(panel.getByText('Send 0.001 ETH on Base', { exact: true })).toBeVisible({ timeout: 12_000 })
    await expect(panel.locator('.agent-proposal')).toHaveCount(1)
    for (const invalid of [{ ...args, requestId: 'bad1', recipient: 'not-an-address' },
      { ...args, requestId: 'bad2', amount: '1e3' }, { ...args, requestId: 'bad3', chain: 'polkadot' },
      { ...args, requestId: 'bad4', amount: '0.0000000000000000001' }]) {
      expect((await rpc('wallet_propose_transfer', invalid)).ok).toBe(false)
    }
    for (const width of [400, 768, 1200]) {
      await app.evaluate(({ BrowserWindow }, width) => {
        const win = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().startsWith('devtools://'))!
        win.setMinimumSize(380, 700); win.setSize(width, 900)
      }, width)
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
      await expect.poll(() => panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      await panel.locator('.agent-proposal').scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(evidence, `inbox-${width}.png`) })
    }
    await panel.getByRole('button', { name: 'Review in wallet', exact: true }).click()
    await expect(page.locator('input[placeholder="0x..."]')).toHaveValue(args.recipient)
    await expect(page.locator('input[placeholder="0.0"]').filter({ visible: true }).first()).toHaveValue(args.amount)
    await expect(visible('button:has-text("Confirm Send")')).toHaveCount(0)
    await expect(visible('button:has-text("Estimate Fee")')).toBeVisible()
    await page.getByRole('button', { name: 'Close send dialog' }).click()
    expect((await (await rpc('wallet_proposals')).json()).result[0].state).toBe('opened')
    // Stub only the quote provider in the disposable app. All wallet validation, IPC,
    // local RPC, proposal creation and fresh-review UI remain production code.
    const sell = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    const buy = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    const raw = '1000000000000000'
    const quoteFixture = {
      provider: '0x', fromChain: 'base', toChain: 'base', fromTokenAddress: sell, toTokenAddress: buy,
      fromTokenSymbol: 'ETH', toTokenSymbol: 'USDC', sellAmountRaw: raw, buyAmountRaw: '2000000', minBuyAmountRaw: '1990000',
      minReceivedSource: 'provider', estimatedGasRaw: '21000', slippageBps: 50, priceImpactPct: 0.1, rate: 2000,
      expiresAt: Date.now() + 300_000, isCrossChain: false,
      appFee: validAppFee('0x', 'base', raw), txData: { to: '0x1111111111111111111111111111111111111111', data: calldataWithFeeRecipient(), value: raw },
    }
    await app.evaluate(({ net }, quote) => {
      const original = net.fetch.bind(net)
      net.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
        if (url.hostname === 'api.magicmoney.dev' && url.pathname === '/quote') return new Response(JSON.stringify({ quote }), { status: 200, headers: { 'content-type': 'application/json' } })
        return original(input, init)
      }
    }, quoteFixture)
    const estimated = await (await rpc('wallet_quote', { fromChain: 'base', toChain: 'base', fromToken: sell, toToken: buy, sellAmountRaw: raw, slippageBps: 50 })).json()
    expect(estimated.result?.quoteId).toBeTruthy()
    expect(estimated.result.executable).toBe(false)
    expect(JSON.stringify(estimated)).not.toMatch(/txData|intentId/)
    const swapProposal = await (await rpc('wallet_propose_swap', { requestId: 'swap-1', quoteId: estimated.result.quoteId })).json()
    expect(swapProposal.result.draft.swap.amount).toBe('0.001')
    await expect(panel.getByRole('button', { name: 'Review in wallet', exact: true })).toBeVisible({ timeout: 12_000 })
    await panel.getByRole('button', { name: 'Review in wallet', exact: true }).click()
    await expect(panel.locator('input[placeholder="0.0"]')).toHaveValue('0.001')
    await expect(panel.getByRole('button', { name: 'Get Quote', exact: true })).toBeVisible()
    await expect(panel.getByText('Minimum received', { exact: true })).toHaveCount(0)
    await page.screenshot({ path: join(evidence, 'swap-fresh-review.png') })
    await panel.getByRole('button', { name: 'Back to Agent Access', exact: true }).click()
    await panel.getByRole('button', { name: 'Revoke Research assistant' }).click()
    expect((await rpc('wallet_addresses')).ok).toBe(false)
    // A dApp WebContents must not be able to manage pairings through privileged IPC.
    const denied = await app.evaluate(async ({ BrowserWindow, ipcMain }) => {
      const attacker = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } })
      await attacker.loadURL('about:blank')
      try {
        return await attacker.webContents.executeJavaScript("require('electron').ipcRenderer.invoke('agent:enable', true).then(() => false, () => true)")
      } finally { attacker.destroy() }
    })
    expect(denied).toBe(true)
    expect(errors).toEqual([])
    await app.close(); app = undefined
    const restarted = await launch(); app = restarted.instance
    const p2 = restarted.page
    await expect(p2.locator('input[type="password"]').first()).toBeVisible({ timeout: 30_000 })
    await p2.locator('input[type="password"]').first().fill('Agent-Test-2026!')
    await p2.getByRole('button', { name: 'Unlock', exact: true }).click()
    await p2.getByRole('button', { name: 'Agent Access', exact: true }).click()
    await expect(p2.getByText('Access is off', { exact: true })).toBeVisible()
    expect((await run('addresses')).code).not.toBe(0)
  } finally {
    await app?.close().catch(() => {})
    // Exact mkdtemp path, never a user profile or computed workspace ancestor.
    expect(profile.startsWith(join(tmpdir(), 'mm-agent-e2e-'))).toBe(true)
    rmSync(profile, { recursive: true, force: true })
  }
})
