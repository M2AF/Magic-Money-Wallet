import { test, expect } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeFunctionData, parseAbi } from 'viem'

const ROOT = join(__dirname, '..'), MAIN = join(ROOT, 'out/main/index.js'), PASSWORD = 'Agent-Test-2026!'
const TO = '0x3333333333333333333333333333333333333333', CONTRACT = '0xC0A0808cbAF507b80df92b22feD8D3810eAB45d5'
test('Monad native approval, isolated MON and allowlisted pet calls share budgets, receipts, Stop and recovery', async () => {
  test.skip(!existsSync(MAIN), 'Build Electron first'); test.setTimeout(240_000)
  const profile = mkdtempSync(join(tmpdir(), 'mm-agent-monad-e2e-')), evidence = join(ROOT, '.local-artifacts/agent-monad')
  mkdirSync(evidence, { recursive: true }); let app: ElectronApplication | undefined
  try {
    const env = { ...process.env, MM_TEST_USERDATA: profile, MM_REAL_MAIN: MAIN, MM_TEST_NO_BIOMETRICS: '1', MAGICMONEY_X402: '0' } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ args: [join(__dirname, 'agent-monad-wrapper.cjs')], env })
    let page: Page | undefined
    for (let i = 0; i < 60 && !page; i++) { page = app.windows().find(w => w.url() && !w.url().startsWith('devtools://')); if (!page) await new Promise(r => setTimeout(r, 250)) }
    if (!page) throw new Error('No wallet window')
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
    await page.getByRole('button', { name: 'Import Existing Wallet', exact: true }).click()
    const words = 'test test test test test test test test test test test junk'.split(' ')
    for (let i = 0; i < 12; i++) await page.locator(`[placeholder="word ${i + 1}"]`).fill(words[i])
    await page.getByRole('button', { name: 'Import Wallet', exact: true }).click()
    await expect(page.locator('input[type="password"]').first()).toBeVisible({ timeout: 20_000 })
    for (const input of await page.locator('input[type="password"]').all()) await input.fill(PASSWORD)
    await page.getByRole('button', { name: 'Encrypt & Continue', exact: true }).click()
    await page.getByRole('button', { name: 'Agent Access', exact: true }).click({ timeout: 30_000 })
    const panel = page.getByRole('dialog', { name: 'Agent Access' })
    await panel.getByRole('button', { name: 'Enable access', exact: true }).click()
    await app.evaluate(({ app, dialog }, args) => { app.setAppPath(args.root); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [args.folder] }) }, { root: ROOT, folder: profile })
    await panel.getByLabel('Assistant name', { exact: true }).fill('Monad assistant')
    await panel.getByLabel('Allow transfer and swap proposals').check()
    await panel.getByRole('button', { name: 'Pair and save connection files' }).click()
    await expect(panel.getByText('Connection files saved. MCP launch command:')).toBeVisible()
    const config = JSON.parse(readFileSync(join(profile, readdirSync(profile).find(n => /^magicmoney-agent-.*\.json$/.test(n))!), 'utf8'))
    const rpc = async (tool: string, args = {}) => {
      const response = await fetch(config.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` }, body: JSON.stringify({ tool, args }) })
      return { ok: response.ok, ...await response.json() }
    }
    const request = { requestId: 'monad-approved', chain: 'monad', recipient: TO, amount: '0.1' }
    const secure = await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'))
    if (!secure) {
      expect((await rpc('wallet_request_transaction', request)).ok).toBe(false)
      expect(existsSync(join(profile, 'fixture-submissions.jsonl'))).toBe(false)
      test.info().annotations.push({ type: 'coverage', description: 'No OS secure storage: verified Monad denial; positive signing not claimed on this host.' }); return
    }
    const job = (await rpc('wallet_request_transaction', request)).result
    expect(job.chainId).toBe(143)
    const card = panel.getByTestId('agent-transaction').filter({ hasText: request.requestId })
    await card.getByRole('button', { name: 'Review transaction', exact: true }).click()
    await expect(card.getByText('0.1021 MON', { exact: true })).toBeVisible()
    await card.getByRole('button', { name: 'Approve and send', exact: true }).click()
    await expect(card.getByText('submitted', { exact: true })).toBeVisible()
    expect((await rpc('wallet_transaction_status', { transactionId: job.id })).result.state).toBe('confirmed')
    await panel.getByText('Authorize an autonomous spending account', { exact: true }).click()
    await panel.getByLabel('Spending network', { exact: true }).selectOption('monad')
    await panel.getByLabel('Allowed recipient addresses (one per line)').fill(TO)
    await panel.getByLabel('Allow Emogotchi care calls', { exact: true }).check()
    await panel.getByLabel('Allowed pet token IDs (one per line)').fill('7')
    for (const [label, value] of [['Per-send cap (MON)', '1.1'], ['Rolling 24-hour cap (MON)', '2.1'], ['Total budget (MON)', '5'], ['Maximum fee per send (MON)', '0.1']]) await panel.getByLabel(label, { exact: true }).fill(value)
    await panel.locator('details').first().getByLabel('Wallet password', { exact: true }).fill(PASSWORD)
    await panel.getByRole('button', { name: 'Authorize isolated account', exact: true }).click()
    await expect(panel.getByText('Funding address:', { exact: false })).toBeVisible()
    const policy = (await rpc('wallet_spending_accounts')).result[0]
    expect(policy.chainId).toBe(143); expect(policy.emogotchiTokenIds).toEqual(['7']); expect(policy.accountIndex).toBe(1000)
    writeFileSync(join(profile, 'fixture-funded'), 'offline MON + pet ownership fixture')
    const native = { ...request, policyId: policy.id, requestId: 'monad-autonomous', amount: '0.5' }
    const nativeJob = (await rpc('wallet_send_autonomous', native)).result
    expect(nativeJob.from).toBe(policy.address); expect(nativeJob.state).toBe('submitted')
    expect((await rpc('wallet_transaction_status', { transactionId: nativeJob.id })).result.state).toBe('confirmed')
    const care = { policyId: policy.id, requestId: 'monad-feed', chain: 'monad', contract: CONTRACT, function: 'feed', args: ['7'], value: '1' }
    expect((await rpc('wallet_call_autonomous', { ...care, args: ['8'] })).ok).toBe(false)
    expect((await rpc('wallet_call_autonomous', { ...care, function: 'revive' })).ok).toBe(false)
    expect((await rpc('wallet_call_autonomous', { ...care, data: '0xdeadbeef' })).ok).toBe(false)
    const fed = (await rpc('wallet_call_autonomous', care)).result
    expect(fed.state).toBe('submitted'); expect(fed.from).toBe(policy.address)
    expect((await rpc('wallet_call_autonomous', care)).result.txHash).toBe(fed.txHash)
    expect((await rpc('wallet_transaction_status', { transactionId: fed.id })).result.state).toBe('confirmed')
    const petted = (await rpc('wallet_call_autonomous', { ...care, requestId: 'monad-pet', function: 'pet', args: ['7', '2'], value: '0' })).result
    expect(petted.state).toBe('submitted'); expect(petted.valueRaw).toBe('0')
    expect((await rpc('wallet_transaction_status', { transactionId: petted.id })).result.state).toBe('confirmed')
    expect((await rpc('wallet_call_autonomous', { ...care, requestId: 'daily-cap' })).ok).toBe(false)
    for (const width of [400, 768, 1200]) {
      await app.evaluate(({ BrowserWindow }, width) => { const win = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().startsWith('devtools://'))!; win.setMinimumSize(380, 700); win.setSize(width, 900) }, width)
      await expect.poll(() => page!.evaluate(() => window.innerWidth)).toBe(width)
      await expect.poll(() => panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      await panel.locator('article').filter({ hasText: 'Recovery path:' }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(evidence, `policy-${width}.png`) })
    }
    await panel.getByRole('button', { name: 'Stop all autonomous sending', exact: true }).click()
    expect((await rpc('wallet_call_autonomous', { ...care, requestId: 'stopped' })).ok).toBe(false)
    await panel.getByRole('button', { name: 'Revoke Monad assistant' }).click()
    await panel.getByRole('button', { name: 'Recover MON', exact: true }).click()
    await panel.getByLabel('Recovery amount (MON)').fill('1')
    await panel.getByLabel('Wallet password', { exact: true }).last().fill(PASSWORD)
    await panel.getByRole('button', { name: 'Prepare recovery', exact: true }).click()
    const recovery = panel.getByTestId('agent-transaction').filter({ hasText: 'Wallet recovery' })
    await recovery.getByRole('button', { name: 'Approve and send', exact: true }).click()
    await expect(recovery.getByText('submitted', { exact: true })).toBeVisible()
    const submissions = readFileSync(join(profile, 'fixture-submissions.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(submissions).toHaveLength(5); expect(submissions.every(s => s.chainId === 143)).toBe(true)
    expect(decodeFunctionData({ abi: parseAbi(['function feed(uint256) payable']), data: submissions[2].input })).toEqual({ functionName: 'feed', args: [7n] })
    expect(submissions[3].value).toBe('0x0'); expect(submissions[4].from).toBe(policy.address)
    expect(errors).toEqual([])
  } finally {
    await app?.close().catch(() => {})
    expect(profile.startsWith(join(tmpdir(), 'mm-agent-monad-e2e-'))).toBe(true)
    rmSync(profile, { recursive: true, force: true })
  }
})
