import { test, expect } from '@playwright/test'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(__dirname, '..'), MAIN = join(ROOT, 'out/main/index.js')
const TO = '0x3333333333333333333333333333333333333333', PASSWORD = 'Agent-Test-2026!'
test('approved ETH request, bounded isolated sending, kill switch and recovery through native wallet and local agent RPC', async () => {
  test.skip(!existsSync(MAIN), 'Build Electron first')
  test.setTimeout(240_000)
  const profile = mkdtempSync(join(tmpdir(), 'mm-agent-execution-e2e-'))
  const evidence = join(ROOT, '.local-artifacts/agent-execution'); mkdirSync(evidence, { recursive: true })
  let app: ElectronApplication | undefined
  try {
    const env = { ...process.env, MM_TEST_USERDATA: profile, MM_REAL_MAIN: MAIN, MM_TEST_NO_BIOMETRICS: '1', MAGICMONEY_X402: '0' } as Record<string, string>
    delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ args: [join(__dirname, 'agent-execution-wrapper.cjs')], env })
    let page: Page | undefined
    for (let i = 0; i < 60 && !page; i++) {
      page = app.windows().find(w => w.url() && !w.url().startsWith('devtools://'))
      if (!page) await new Promise(resolve => setTimeout(resolve, 250))
    }
    if (!page) throw new Error('No wallet window')
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
    await page.getByRole('button', { name: 'Import Existing Wallet', exact: true }).click()
    const phrase = 'test test test test test test test test test test test junk'.split(' ')
    for (let i = 0; i < 12; i++) await page.locator(`[placeholder="word ${i + 1}"]`).fill(phrase[i])
    await page.getByRole('button', { name: 'Import Wallet', exact: true }).click()
    await expect(page.locator('input[type="password"]').first()).toBeVisible({ timeout: 20_000 })
    for (const input of await page.locator('input[type="password"]').all()) await input.fill(PASSWORD)
    await page.getByRole('button', { name: 'Encrypt & Continue', exact: true }).click()
    await page.getByRole('button', { name: 'Agent Access', exact: true }).click({ timeout: 30_000 })
    const panel = page.getByRole('dialog', { name: 'Agent Access' })
    await panel.getByRole('button', { name: 'Enable access', exact: true }).click()
    await app.evaluate(({ app, dialog }, args) => {
      app.setAppPath(args.root); dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [args.folder] })
    }, { root: ROOT, folder: profile })
    await panel.getByLabel('Assistant name', { exact: true }).fill('Execution assistant')
    await panel.getByLabel('Allow transfer and swap proposals').check()
    await panel.getByRole('button', { name: 'Pair and save connection files' }).click()
    await expect(panel.getByText('Connection files saved. MCP launch command:')).toBeVisible()
    const config = JSON.parse(readFileSync(join(profile, readdirSync(profile).find(n => /^magicmoney-agent-.*\.json$/.test(n))!), 'utf8'))
    const rpc = async (tool: string, args = {}) => {
      const response = await fetch(config.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` }, body: JSON.stringify({ tool, args }) })
      return { ok: response.ok, ...await response.json() }
    }
    const request = { requestId: 'approved-1', chain: 'ethereum', recipient: TO, amount: '0.001' }
    const secureStorage = await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable()
      && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'))
    if (!secureStorage) {
      // Headless Linux may have no OS secret service. Verify the production
      // denial instead of bypassing secure storage or claiming sends were tested.
      expect((await rpc('wallet_request_transaction', request)).ok).toBe(false)
      expect(existsSync(join(profile, 'fixture-submissions.jsonl'))).toBe(false)
      await expect(panel.getByRole('alert')).toContainText('journal unavailable')
      test.info().annotations.push({ type: 'coverage', description: 'OS secure storage unavailable: verified fail-closed denial; positive execution is covered by offline signer tests and supported desktop hosts.' })
      return
    }
    const job = (await rpc('wallet_request_transaction', request)).result
    expect(job.state).toBe('pending-approval'); expect(existsSync(join(profile, 'fixture-submissions.jsonl'))).toBe(false)
    const tx = panel.getByTestId('agent-transaction').filter({ hasText: 'approved-1' })
    await tx.getByRole('button', { name: 'Review transaction', exact: true }).click()
    await expect(tx.getByText('Maximum network fee:', { exact: false })).toBeVisible()
    await expect(tx.getByText('0.001021 ETH', { exact: true })).toBeVisible()
    await page.screenshot({ path: join(evidence, 'approved-review.png') })
    await tx.getByRole('button', { name: 'Approve and send', exact: true }).click()
    await expect(tx.getByText('submitted', { exact: true })).toBeVisible()
    const sent = (await rpc('wallet_transaction_status', { transactionId: job.id })).result
    expect(sent.txHash).toMatch(/^0x[0-9a-f]{64}$/); expect(sent.state).toBe('confirmed'); expect(sent.confirmations).toBe(3); expect(sent.finalized).toBe(true)
    expect((await rpc('wallet_request_transaction', request)).result.id).toBe(job.id)
    expect(readFileSync(join(profile, 'fixture-submissions.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1)
    const cancelled = await page.evaluate(async ({ to, password }) => {
      const grants = await window.wallet.agentAccess!.snapshot()
      const pending = window.wallet.agentExecution!.createPolicy({ clientId: grants.grants[0].id, recipients: [to],
        perSend: '0.001', daily: '0.005', total: '0.01', maxFee: '0.0001', minutes: 60 }, password).then(() => false, () => true)
      await window.wallet.agentExecution!.kill()
      return pending
    }, { to: TO, password: PASSWORD })
    expect(cancelled).toBe(true)
    await panel.getByText('Authorize an autonomous spending account', { exact: true }).click()
    await panel.getByLabel('Allowed recipient addresses (one per line)').fill(TO)
    const policyPassword = panel.locator('details').getByLabel('Wallet password', { exact: true })
    await policyPassword.fill('wrong-password')
    await panel.getByRole('button', { name: 'Authorize isolated account', exact: true }).click()
    await expect(panel.getByRole('alert')).toContainText('password is incorrect')
    await policyPassword.fill(PASSWORD)
    await panel.getByRole('button', { name: 'Authorize isolated account', exact: true }).click()
    await expect(panel.getByText('Funding address:', { exact: false })).toBeVisible()
    const policy = (await rpc('wallet_spending_accounts')).result[0]
    expect(policy.accountIndex).toBe(1000); expect(policy.active).toBe(true)
    expect(policy.address).not.toBe(sent.from)
    // Model a separate owner funding transfer; this writes only a fixture marker.
    writeFileSync(join(profile, 'fixture-funded'), 'offline-fixture')
    for (const width of [400, 768, 1200]) {
      await app.evaluate(({ BrowserWindow }, width) => { const win = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().startsWith('devtools://'))!; win.setMinimumSize(380, 700); win.setSize(width, 900) }, width)
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
      await expect.poll(() => panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      await panel.getByText('Funding address:', { exact: false }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(evidence, `spending-${width}.png`) })
    }
    const autonomous = { ...request, requestId: 'autonomous-1', amount: '0.0005', policyId: policy.id }
    expect((await rpc('wallet_send_autonomous', { ...autonomous, recipient: sent.from })).ok).toBe(false)
    const auto = (await rpc('wallet_send_autonomous', autonomous)).result
    expect(auto.state).toBe('submitted'); expect(auto.from).toBe(policy.address)
    expect((await rpc('wallet_send_autonomous', autonomous)).result.id).toBe(auto.id)
    expect((await rpc('wallet_transaction_status', { transactionId: auto.id })).result.state).toBe('confirmed')
    await panel.getByRole('button', { name: 'Stop all autonomous sending', exact: true }).click()
    await expect(panel.getByText('Stopped / expired', { exact: false })).toBeVisible()
    expect((await rpc('wallet_send_autonomous', { ...autonomous, requestId: 'after-kill' })).ok).toBe(false)
    await panel.getByRole('button', { name: 'Revoke Execution assistant' }).click()
    expect((await rpc('wallet_transactions')).ok).toBe(false)
    await panel.getByRole('button', { name: 'Recover ETH', exact: true }).click()
    await panel.getByLabel('Recovery amount (ETH)').fill('0.001')
    await panel.getByLabel('Wallet password', { exact: true }).last().fill(PASSWORD)
    await panel.getByRole('button', { name: 'Prepare recovery', exact: true }).click()
    const recovery = panel.getByTestId('agent-transaction').filter({ hasText: 'Wallet recovery' })
    await recovery.getByRole('button', { name: 'Approve and send', exact: true }).click()
    await expect(recovery.getByText('submitted', { exact: true })).toBeVisible()
    const submissions = readFileSync(join(profile, 'fixture-submissions.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    expect(submissions).toHaveLength(3); expect(submissions[2].from).toBe(policy.address)
    await page.screenshot({ path: join(evidence, 'recovery-submitted.png') })
    expect(errors).toEqual([])
  } finally {
    await app?.close().catch(() => {})
    expect(profile.startsWith(join(tmpdir(), 'mm-agent-execution-e2e-'))).toBe(true)
    rmSync(profile, { recursive: true, force: true })
  }
})
