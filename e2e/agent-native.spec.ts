import { test, expect } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js'
import { ed25519 } from '@noble/curves/ed25519'
import { blake2b } from '@noble/hashes/blake2b'
import { bech32 } from '@scure/base'

const ROOT = join(__dirname, '..'), MAIN = join(ROOT, 'out/main/index.js'), PASSWORD = 'Agent-Test-2026!', RESOURCE = 'https://merchant.example.com/native-data'
const recipient = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey.toBase58(), sponsor = Keypair.fromSeed(new Uint8Array(32).fill(3))
const ADA_TO = bech32.encode('addr_test', bech32.toWords(new Uint8Array([0x60, ...new Uint8Array(28).fill(2)])), 1000)
// Independent, definite-length CBOR reader for the facilitator fixture.
function readCbor(bytes: Uint8Array, start = 0): { value: any; end: number } {
  const type = bytes[start] >> 5, ai = bytes[start] & 31, width = ai < 24 ? 0 : ai === 24 ? 1 : ai === 25 ? 2 : ai === 26 ? 4 : ai === 27 ? 8 : -1
  if (width < 0) throw new Error('Indefinite CBOR unsupported in fixture')
  let n = BigInt(ai < 24 ? ai : 0), end = start + width + 1
  for (let i = 1; i <= width; i++) n = n * 256n + BigInt(bytes[start + i])
  if (type === 0) return { value: n, end }
  if (type === 2) return { value: bytes.slice(end, end + Number(n)), end: end + Number(n) }
  if (type === 4 || type === 5) { const values: any[] = []; for (let i = 0; i < Number(n) * (type === 5 ? 2 : 1); i++) { const item = readCbor(bytes, end); values.push(item.value); end = item.end } return { value: type === 4 ? values : new Map(values.reduce((a, v, i) => i % 2 ? a : [...a, [v, values[i + 1]]], [])), end } }
  if (type === 7) return { value: ai === 21 ? true : null, end }
  throw new Error('Unexpected CBOR fixture type')
}

test('SOL/ADA agents: native approval/autonomy/receipts and x402 with offline testnet facilitator', async () => {
  test.skip(!existsSync(MAIN), 'Build Electron first'); test.setTimeout(300000)
  const profile = mkdtempSync(join(tmpdir(), 'mm-agent-native-')), evidence = join(ROOT, '.local-artifacts/agent-non-evm'); mkdirSync(evidence, { recursive: true })
  const consumed = new Set<string>(); let settled = 0
  const server = createServer((req, res) => {
    try {
      const payment = JSON.parse(Buffer.from(String(req.headers['payment-signature']), 'base64').toString()), accepted = payment.accepted
      expect(payment.x402Version).toBe(2); expect(payment.resource.url).toBe(RESOURCE); expect(accepted.amount).toBe(accepted.network.startsWith('solana:') ? '10000' : '2000000')
      let identity: string
      if (accepted.network.startsWith('solana:')) {
        const tx = VersionedTransaction.deserialize(Buffer.from(payment.payload.transaction, 'base64')), message = tx.message, sender = message.staticAccountKeys[1]
        expect(message.staticAccountKeys[0].toBase58()).toBe(sponsor.publicKey.toBase58()); expect(tx.signatures[0].every(b => b === 0)).toBe(true)
        expect(ed25519.verify(tx.signatures[1], message.serialize(), sender.toBytes())).toBe(true)
        const transfer = message.compiledInstructions[2]; expect(Buffer.from(transfer.data).readBigUInt64LE(1)).toBe(10000n)
        identity = Buffer.from(message.serialize()).toString('base64'); tx.sign([sponsor])
      } else {
        const raw = Buffer.from(payment.payload.transaction, 'base64'), body = readCbor(raw, 1), decoded = readCbor(raw).value, witness = decoded[1].get(0n)[0], digest = blake2b(raw.slice(1, body.end), { dkLen: 32 })
        expect(ed25519.verify(witness[1], digest, witness[0])).toBe(true)
        const input = body.value.get(0n)[0]; expect(payment.payload.nonce).toBe(Buffer.from(input[0]).toString('hex') + '#' + input[1])
        const output = body.value.get(1n)[0]; expect(output[1]).toBe(2000000n)
        expect(bech32.encode('addr_test', bech32.toWords(output[0]), 1000)).toBe(ADA_TO)
        expect(body.value.get(3n)).toBeLessThanOrEqual(1300n); identity = Buffer.from(digest).toString('hex')
      }
      if (consumed.has(identity)) { res.writeHead(402); res.end('replay'); return }
      consumed.add(identity); settled++; res.writeHead(200, { 'content-type': 'application/json', 'PAYMENT-RESPONSE': Buffer.from(JSON.stringify({ success: true, network: accepted.network, fixture: true })).toString('base64') }); res.end('{"offline":true}')
    } catch { res.writeHead(402); res.end('invalid payment') }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No facilitator fixture')
  let app: ElectronApplication | undefined
  try {
    const env = { ...process.env, MM_TEST_USERDATA: profile, MM_REAL_MAIN: MAIN, MM_TEST_NO_BIOMETRICS: '1', MAGICMONEY_X402: '1' } as Record<string, string>; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ args: [join(__dirname, 'agent-native-wrapper.cjs')], env })
    let page: Page | undefined
    for (let i = 0; i < 60 && !page; i++) { page = app.windows().find(w => w.url() && !w.url().startsWith('devtools://')); if (!page) await new Promise(r => setTimeout(r, 250)) }
    if (!page) throw new Error('No wallet window')
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
    await page.getByRole('button', { name: 'Import Existing Wallet', exact: true }).click()
    for (const [i, word] of 'test test test test test test test test test test test junk'.split(' ').entries()) await page.locator(`[placeholder="word ${i + 1}"]`).fill(word)
    await page.getByRole('button', { name: 'Import Wallet', exact: true }).click()
    await expect(page.locator('input[type="password"]').first()).toBeVisible({ timeout: 20000 }); for (const input of await page.locator('input[type="password"]').all()) await input.fill(PASSWORD)
    await page.getByRole('button', { name: 'Encrypt & Continue', exact: true }).click(); await page.getByRole('button', { name: 'Agent Access', exact: true }).waitFor({ timeout: 30000 })
    await page.evaluate(() => window.wallet.setTestnetMode(true)); await page.reload(); await page.getByRole('button', { name: 'Agent Access', exact: true }).click({ timeout: 30000 })
    const panel = page.getByRole('dialog', { name: 'Agent Access' }), native = page.getByRole('region', { name: 'Solana and Cardano agents' })
    await panel.getByRole('button', { name: 'Enable access', exact: true }).click()
    const secure = await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'))
    if (!secure) {
      await expect(page.evaluate(() => window.wallet.agentNative!.snapshot())).rejects.toThrow('secure storage')
      test.info().annotations.push({ type: 'coverage', description: 'Real OS secure storage unavailable: verified native denial, not positive signing.' }); return
    }
    await app.evaluate(({ app, dialog }, args) => { app.setAppPath(args.root); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [args.folder] }) }, { root: ROOT, folder: profile })
    await panel.getByLabel('Assistant name', { exact: true }).fill('Native payments assistant'); await panel.getByLabel('Allow transfer and swap proposals').check(); await panel.getByRole('button', { name: 'Pair and save connection files' }).click()
    await expect(panel.getByText('Connection files saved. MCP launch command:')).toBeVisible()
    const connection = JSON.parse(readFileSync(join(profile, readdirSync(profile).find(n => /^magicmoney-agent-.*\.json$/.test(n))!), 'utf8'))
    const rpc = async (tool: string, args = {}) => { const response = await fetch(connection.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.token}` }, body: JSON.stringify({ tool, args }) }); return { ok: response.ok, ...await response.json() } }
    expect(await page.evaluate(async ({ recipient, password }) => {
      const grant = (await window.wallet.agentAccess!.snapshot()).grants[0]
      const pending = window.wallet.agentNative!.createPolicy({ clientId: grant.id, chain: 'solana', recipients: [recipient], perSend: '1', daily: '2', total: '3', maxFee: '0.1', minutes: 60 }, password).then(() => false, () => true)
      await window.wallet.agentNative!.kill(); return pending
    }, { recipient, password: PASSWORD })).toBe(true)
    expect(await app.evaluate(async ({ BrowserWindow }) => {
      const attacker = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } })
      await attacker.loadURL('about:blank')
      try { return await attacker.webContents.executeJavaScript("Promise.all(['agent-native:snapshot','agent-native:kill','agent-native:prepare','agent-native:approve','agent-native:configure-x402','agent-native:create-policy','agent-native:recovery'].map(c=>require('electron').ipcRenderer.invoke(c,{}).then(()=>false,()=>true)))") }
      finally { attacker.destroy() }
    })).toEqual([true, true, true, true, true, true, true])
    const policies: any[] = []
    await native.getByText('Authorize SOL/ADA spending account', { exact: true }).click()
    for (const chain of ['solana', 'cardano'] as const) {
      await native.getByLabel('Native spending network', { exact: true }).selectOption(chain)
      const symbol = chain === 'solana' ? 'SOL' : 'ADA'
      await native.getByLabel('Allowed SOL/ADA recipients (one per line)', { exact: true }).fill(chain === 'solana' ? recipient : ADA_TO)
      await native.getByLabel(`Per-send cap (${symbol})`, { exact: true }).fill('5'); await native.getByLabel(`24-hour cap (${symbol})`, { exact: true }).fill('20'); await native.getByLabel(`Total budget (${symbol})`, { exact: true }).fill('30'); await native.getByLabel(`Maximum fee (${symbol})`, { exact: true }).fill('0.5')
      if (chain === 'solana') {
        await native.getByLabel('Password for native account', { exact: true }).fill('wrong-password'); await native.getByRole('button', { name: 'Authorize SOL/ADA account', exact: true }).click()
        await expect(native.getByRole('alert')).toContainText('password is incorrect'); await expect(native.getByTestId('agent-native-account')).toHaveCount(0)
      }
      await native.getByLabel('Password for native account', { exact: true }).fill(PASSWORD); await native.getByRole('button', { name: 'Authorize SOL/ADA account', exact: true }).click()
      await expect(native.getByTestId('agent-native-account')).toHaveCount(policies.length + 1)
      const policy = (await rpc('wallet_spending_accounts')).result.find((p: any) => p.network?.startsWith(chain + ':')); expect(policy.accountIndex).toBe(1000 + policies.length); policies.push(policy)
      const request = { requestId: `${chain}-approved`, chain, recipient: chain === 'solana' ? recipient : ADA_TO, amount: chain === 'solana' ? '0.01' : '2' }
      const requested = await rpc('wallet_request_transaction', request); expect(requested.ok, JSON.stringify(requested)).toBe(true)
      const txCard = native.getByTestId('agent-native-transaction').filter({ hasText: request.requestId })
      await txCard.getByRole('button', { name: 'Review SOL/ADA request', exact: true }).click(); await expect(txCard.getByRole('button', { name: 'Approve SOL/ADA send', exact: true })).toBeVisible()
      await txCard.getByRole('button', { name: 'Approve SOL/ADA send', exact: true }).click(); await expect(txCard.getByText('submitted', { exact: true })).toBeVisible()
      const status = await rpc('wallet_transaction_status', { transactionId: requested.result.id }); expect(status.result.state, JSON.stringify(status)).toBe('confirmed')
      const sent = await rpc('wallet_send_autonomous', { ...request, requestId: `${chain}-automatic`, policyId: policy.id }); expect(sent.result.state, JSON.stringify(sent)).toBe('submitted')
      expect((await rpc('wallet_send_autonomous', { ...request, requestId: `${chain}-automatic`, policyId: policy.id })).result.txHash).toBe(sent.result.txHash)
      const account = native.getByTestId('agent-native-account').filter({ hasText: policy.id }), assetSymbol = chain === 'solana' ? 'USDC' : 'ADA'
      await account.getByText(`${assetSymbol} x402 rules on ${chain === 'solana' ? 'Solana Devnet' : 'Cardano Preprod'}`, { exact: true }).click(); await account.getByRole('button', { name: `Configure ${assetSymbol} x402`, exact: true }).click()
      await account.getByLabel('Exact resource URLs', { exact: true }).fill(RESOURCE); await account.getByLabel(`x402 per-payment cap (${assetSymbol})`, { exact: true }).fill('3'); await account.getByLabel(`x402 daily cap (${assetSymbol})`, { exact: true }).fill('5'); await account.getByLabel(`x402 total budget (${assetSymbol})`, { exact: true }).fill('10')
      await account.getByLabel('Password for native x402', { exact: true }).fill(PASSWORD); await account.getByRole('button', { name: 'Authorize native x402 rules', exact: true }).click(); await expect(account.getByText('Authorized:', { exact: false })).toBeVisible()
      const required = { x402Version: 2, resource: { url: RESOURCE }, accepts: [{ scheme: 'exact', network: policy.network, asset: chain === 'solana' ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' : 'lovelace', amount: chain === 'solana' ? '10000' : '2000000', payTo: request.recipient, maxTimeoutSeconds: 300, extra: chain === 'solana' ? { feePayer: sponsor.publicKey.toBase58() } : {} }] }
      const paymentArgs = { policyId: policy.id, requestId: `${chain}-x402`, resourceUrl: RESOURCE, paymentRequired: required }, payment = await rpc('wallet_propose_x402_payment', paymentArgs)
      expect(payment.result.state, JSON.stringify(payment)).toBe('authorized'); expect(payment.result.x402.automatic).toBe(true)
      if (chain === 'solana') expect((await rpc('wallet_propose_x402_payment', paymentArgs)).result.id).toBe(payment.result.id)
      const delivered = await rpc('wallet_x402_payment', { proposalId: payment.result.id, requestId: paymentArgs.requestId, resourceUrl: RESOURCE }); expect(delivered.ok, JSON.stringify(delivered)).toBe(true)
      const response = await fetch(`http://127.0.0.1:${address.port}`, { headers: { 'PAYMENT-SIGNATURE': delivered.result.headerValue } }); expect(response.status).toBe(200)
      expect((await fetch(`http://127.0.0.1:${address.port}`, { headers: { 'PAYMENT-SIGNATURE': delivered.result.headerValue } })).status).toBe(402)
      expect((await rpc('wallet_x402_payment', { proposalId: payment.result.id, requestId: paymentArgs.requestId, resourceUrl: RESOURCE + '?changed=1' })).ok).toBe(false)
      const exceptionUrl = RESOURCE + '?exception=1', exceptionArgs = { ...paymentArgs, requestId: `${chain}-exception`, resourceUrl: exceptionUrl, paymentRequired: { ...required, resource: { url: exceptionUrl } } }, exception = await rpc('wallet_propose_x402_payment', exceptionArgs)
      expect(exception.ok, JSON.stringify(exception)).toBe(true)
      expect(exception.result.state, JSON.stringify(exception)).toBe('prepared'); expect(exception.result.x402.automatic).toBe(false)
      const card = native.getByTestId('agent-native-transaction').filter({ hasText: exceptionArgs.requestId })
      for (const width of [400, 768, 1200]) {
        await app.evaluate(({ BrowserWindow }, width) => { const win = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().startsWith('devtools://'))!; win.setMinimumSize(380, 700); win.setSize(width, 900) }, width)
        await expect.poll(() => page!.evaluate(() => window.innerWidth)).toBe(width); await expect.poll(() => native.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
        await card.scrollIntoViewIfNeeded(); await page.screenshot({ path: join(evidence, `${chain}-${width}.png`) })
      }
      await card.getByRole('button', { name: 'Approve one x402 exception', exact: true }).click(); await expect(card.getByText('authorized', { exact: true })).toBeVisible()
    }
    expect(settled).toBe(2); await panel.getByRole('button', { name: 'Stop all autonomous sending', exact: true }).click()
    expect((await rpc('wallet_send_autonomous', { policyId: policies[0].id, requestId: 'after-stop', chain: 'solana', recipient, amount: '0.01' })).ok).toBe(false)
    expect(errors).toEqual([])
    const audit = readFileSync(join(profile, 'agent-access/activity.json'), 'utf8'); expect(audit).not.toContain(RESOURCE); expect(audit).not.toContain(connection.token); expect(audit).not.toContain('PAYMENT-SIGNATURE')
  } finally {
    await app?.close().catch(() => {}); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    expect(profile.startsWith(join(tmpdir(), 'mm-agent-native-'))).toBe(true); rmSync(profile, { recursive: true, force: true })
  }
})
