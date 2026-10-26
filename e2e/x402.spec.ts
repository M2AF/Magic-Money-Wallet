import { test, expect } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recoverTypedDataAddress } from 'viem'
// Independent facilitator-side EIP-3009 schema, without importing privileged
// Electron wallet code into the test runner.
const X402_AUTH_TYPES = { TransferWithAuthorization: [
  { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
  { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
] } as const

const ROOT = join(__dirname, '..'), MAIN = join(ROOT, 'out/main/index.js'), PASSWORD = 'Agent-Test-2026!'
const RESOURCE = 'https://merchant.example.com/weather?city=Halifax'
const TO = '0x3333333333333333333333333333333333333333', ASSET = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'

test('x402 reuses isolated account rules: stubbed testnet facilitator, automatic signing, approval exceptions, replay and Stop', async () => {
  test.skip(!existsSync(MAIN), 'Build Electron first'); test.setTimeout(240_000)
  const profile = mkdtempSync(join(tmpdir(), 'mm-x402-e2e-')), evidence = join(ROOT, '.local-artifacts/x402')
  mkdirSync(evidence, { recursive: true })
  const spent = new Set<string>(); let settled = 0; let from = ''
  const paymentRequired = (large: boolean) => ({ x402Version: 2,
    resource: { url: RESOURCE + (large ? '&bill=large' : ''), description: 'Offline weather fixture', mimeType: 'application/json' },
    accepts: [{ scheme: 'exact', network: 'eip155:84532', amount: large ? '200000' : '10000', asset: ASSET, payTo: TO, maxTimeoutSeconds: 300, extra: { name: 'USDC', version: '2' } }],
  })
  // Local HTTP stands in for the logical HTTPS merchant and facilitator. Wallet
  // validation always sees RESOURCE; this test never contacts that hostname.
  const server = createServer(async (request, response) => {
    const large = request.url?.includes('bill=large') ?? false, requirements = paymentRequired(large)
    const encoded = request.headers['payment-signature']
    const reply = (status: number, value: unknown, headers = {}) => { response.writeHead(status, { 'content-type': 'application/json', ...headers }); response.end(JSON.stringify(value)) }
    if (!encoded) { reply(402, {}, { 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(requirements)).toString('base64') }); return }
    try {
      const payment = JSON.parse(Buffer.from(String(encoded), 'base64').toString()), auth = payment.payload.authorization
      expect(payment.x402Version).toBe(2); expect(payment.accepted).toEqual(requirements.accepts[0]); expect(payment.resource).toEqual(requirements.resource)
      expect(auth.from).toBe(from); expect(auth.to).toBe(TO); expect(auth.value).toBe(requirements.accepts[0].amount)
      expect(Number(auth.validBefore) - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(300)
      expect(Number(auth.validBefore)).toBeGreaterThan(Date.now() / 1000); expect(Number(auth.validAfter)).toBeLessThan(Date.now() / 1000)
      const recovered = await recoverTypedDataAddress({ domain: { name: 'USDC', version: '2', chainId: 84532, verifyingContract: ASSET }, types: X402_AUTH_TYPES,
        primaryType: 'TransferWithAuthorization', message: { from: auth.from, to: auth.to, value: BigInt(auth.value), validAfter: BigInt(auth.validAfter), validBefore: BigInt(auth.validBefore), nonce: auth.nonce }, signature: payment.payload.signature })
      expect(recovered).toBe(from)
      if (spent.has(auth.nonce)) { reply(402, { error: 'authorization_used' }); return }
      spent.add(auth.nonce); settled++
      reply(200, { weather: 'stubbed', testnet: true }, { 'PAYMENT-RESPONSE': Buffer.from(JSON.stringify({ success: true, network: 'eip155:84532', transaction: `0x${'aa'.repeat(32)}`, payer: from })).toString('base64') })
    } catch { reply(402, { error: 'invalid_payment' }) }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const serverAddress = server.address(); if (!serverAddress || typeof serverAddress === 'string') throw new Error('No fixture server')
  const stubUrl = `http://127.0.0.1:${serverAddress.port}/weather?city=Halifax`
  let app: ElectronApplication | undefined
  try {
    const env = { ...process.env, MM_TEST_USERDATA: profile, MM_REAL_MAIN: MAIN, MM_TEST_NO_BIOMETRICS: '1', MAGICMONEY_X402: '1' } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ args: [join(__dirname, 'x402-wrapper.cjs')], env })
    let page: Page | undefined
    for (let i = 0; i < 60 && !page; i++) { page = app.windows().find(w => w.url() && !w.url().startsWith('devtools://')); if (!page) await new Promise(r => setTimeout(r, 250)) }
    if (!page) throw new Error('No wallet window')
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
    await page.getByRole('button', { name: 'Import Existing Wallet', exact: true }).click()
    const phrase = 'test test test test test test test test test test test junk'.split(' ')
    for (let i = 0; i < 12; i++) await page.locator(`[placeholder="word ${i + 1}"]`).fill(phrase[i])
    await page.getByRole('button', { name: 'Import Wallet', exact: true }).click()
    await expect(page.locator('input[type="password"]').first()).toBeVisible({ timeout: 20_000 })
    for (const input of await page.locator('input[type="password"]').all()) await input.fill(PASSWORD)
    await page.getByRole('button', { name: 'Encrypt & Continue', exact: true }).click()
    await page.getByRole('button', { name: 'Agent Access', exact: true }).waitFor({ timeout: 30_000 })
    await page.evaluate(() => window.wallet.setTestnetMode(true)); await page.reload()
    await page.getByRole('button', { name: 'Agent Access', exact: true }).click({ timeout: 30_000 })
    const panel = page.getByRole('dialog', { name: 'Agent Access' })
    await panel.getByRole('button', { name: 'Enable access', exact: true }).click()
    await app.evaluate(({ app, dialog }, args) => { app.setAppPath(args.root); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [args.folder] }) }, { root: ROOT, folder: profile })
    await panel.getByLabel('Assistant name', { exact: true }).fill('Payments assistant')
    await panel.getByLabel('Allow transfer and swap proposals').check()
    await panel.getByRole('button', { name: 'Pair and save connection files' }).click()
    await expect(panel.getByText('Connection files saved. MCP launch command:')).toBeVisible()
    const connection = JSON.parse(readFileSync(join(profile, readdirSync(profile).find(n => /^magicmoney-agent-.*\.json$/.test(n))!), 'utf8'))
    const rpc = async (tool: string, args = {}) => {
      const response = await fetch(connection.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.token}` }, body: JSON.stringify({ tool, args }) })
      return { ok: response.ok, ...await response.json() }
    }
    const secure = await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'))
    if (!secure) {
      await expect(page.evaluate(() => window.wallet.agentX402!.snapshot())).rejects.toThrow()
      test.info().annotations.push({ type: 'coverage', description: 'OS secure storage unavailable: verified x402 denial, not positive signing.' }); return
    }
    await panel.getByText('Authorize an autonomous spending account', { exact: true }).click()
    await panel.getByLabel('Allowed recipient addresses (one per line)').fill(TO)
    await panel.locator('details').first().getByLabel('Wallet password', { exact: true }).fill(PASSWORD)
    await panel.getByRole('button', { name: 'Authorize isolated account', exact: true }).click()
    await expect.poll(async () => (await rpc('wallet_spending_accounts')).result?.length).toBe(1)
    const policy = (await rpc('wallet_spending_accounts')).result[0]; from = policy.address
    expect(policy.accountIndex).toBe(1000)
    const controls = panel.getByTestId('x402-account-controls')
    await controls.getByText('USDC x402 on this account', { exact: true }).click()
    await controls.getByLabel('Allowed x402 resource URLs (one per line)').fill(RESOURCE)
    await controls.getByLabel('Wallet password for x402').fill(PASSWORD)
    await controls.getByRole('button', { name: 'Authorize USDC x402 rules', exact: true }).click()
    await expect(controls.getByText('Authorized USDC caps:', { exact: false })).toBeVisible()
    for (const width of [400, 768, 1200]) {
      await app.evaluate(({ BrowserWindow }, width) => { const win = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().startsWith('devtools://'))!; win.setMinimumSize(380, 700); win.setSize(width, 900) }, width)
      await expect.poll(() => page!.evaluate(() => window.innerWidth)).toBe(width)
      await expect.poll(() => panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      await controls.scrollIntoViewIfNeeded(); await page.screenshot({ path: join(evidence, `account-${width}.png`) })
    }
    const challenge = await fetch(stubUrl); expect(challenge.status).toBe(402)
    const required = JSON.parse(Buffer.from(challenge.headers.get('payment-required')!, 'base64').toString())
    const request = { policyId: policy.id, requestId: 'weather-001', resourceUrl: RESOURCE, paymentRequired: required }
    const automaticResponse = await rpc('wallet_propose_x402_payment', request)
    expect(automaticResponse.ok).toBe(true)
    const automatic = automaticResponse.result
    expect(automatic.state).toBe('authorized'); expect(automatic.automatic).toBe(true); expect(automatic.from).toBe(policy.address)
    expect(JSON.stringify(automatic)).not.toContain('signature')
    expect((await rpc('wallet_propose_x402_payment', request)).result.authorization.nonce).toBe(automatic.authorization.nonce)
    expect((await rpc('wallet_x402_payment', { proposalId: automatic.id, requestId: request.requestId, resourceUrl: RESOURCE + '&wrong=1' })).ok).toBe(false)
    const delivery = (await rpc('wallet_x402_payment', { proposalId: automatic.id, requestId: request.requestId, resourceUrl: RESOURCE })).result
    const resource = await fetch(stubUrl, { headers: { [delivery.headerName]: delivery.headerValue } })
    expect(resource.status).toBe(200); expect(await resource.json()).toEqual({ weather: 'stubbed', testnet: true })
    expect(JSON.parse(Buffer.from(resource.headers.get('payment-response')!, 'base64').toString()).success).toBe(true)
    expect((await fetch(stubUrl, { headers: { [delivery.headerName]: delivery.headerValue } })).status).toBe(402)
    expect(settled).toBe(1)
    expect((await rpc('wallet_x402_payment', { proposalId: automatic.id, requestId: request.requestId, resourceUrl: RESOURCE })).result.headerValue).toBe(delivery.headerValue)
    const largeUrl = RESOURCE + '&bill=large', largeChallenge = await fetch(stubUrl + '&bill=large')
    const exception = (await rpc('wallet_propose_x402_payment', { ...request, requestId: 'weather-large', resourceUrl: largeUrl,
      paymentRequired: JSON.parse(Buffer.from(largeChallenge.headers.get('payment-required')!, 'base64').toString()) })).result
    expect(exception.state).toBe('pending-approval'); expect(exception.reasons.length).toBeGreaterThan(0)
    const card = panel.getByTestId('x402-payment').filter({ hasText: 'weather-large' })
    await card.getByRole('button', { name: 'Review USDC exception', exact: true }).click()
    await expect(card.getByText('This authorizes exactly', { exact: false })).toBeVisible()
    await card.scrollIntoViewIfNeeded(); await page.screenshot({ path: join(evidence, 'exception-review.png') })
    await card.getByRole('button', { name: 'Approve one USDC payment', exact: true }).click()
    await expect(card.getByText('authorized', { exact: true })).toBeVisible()
    const approved = (await rpc('wallet_x402_payment', { proposalId: exception.id, requestId: 'weather-large', resourceUrl: largeUrl })).result
    expect((await fetch(stubUrl + '&bill=large', { headers: { [approved.headerName]: approved.headerValue } })).status).toBe(200)
    expect(settled).toBe(2)
    await panel.getByRole('button', { name: 'Stop all autonomous sending', exact: true }).click()
    expect((await rpc('wallet_propose_x402_payment', { ...request, requestId: 'after-stop' })).ok).toBe(false)
    expect((await rpc('wallet_x402_payment', { proposalId: automatic.id, requestId: request.requestId, resourceUrl: RESOURCE })).ok).toBe(false)
    expect(errors).toEqual([])
    const audit = readFileSync(join(profile, 'agent-access/activity.json'), 'utf8')
    expect(audit).not.toContain(RESOURCE); expect(audit).not.toContain(delivery.headerValue); expect(audit).not.toContain(connection.token)
  } finally {
    await app?.close().catch(() => {}); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    expect(profile.startsWith(join(tmpdir(), 'mm-x402-e2e-'))).toBe(true); rmSync(profile, { recursive: true, force: true })
  }
})
