import { expect, test, chromium, type BrowserContext, type Page } from '@playwright/test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Real-extension check for the Testnet Mode xReserve Sepolia → Preprod panel.
 *
 * NOT stubbed: Testnet Mode itself, the wallet's derived addresses, and the
 * `xreserve:testnet-state` / `xreserve:testnet-set-key` round trips through the
 * extension bridge and the service worker's router, and the refusal of the
 * real approve / deposit channels for an intent that was never prepared.
 * Stubbed at the window.wallet seam, with call counts: prepare, approve,
 * approval status, deposit and check — so nothing reaches Sepolia, Circle or
 * Blockfrost and nothing is signed.
 *
 * Requires a built extension: npm run build:extension.
 */

const distExtension = resolve(process.cwd(), 'dist-extension')
const shots = process.env.XRESERVE_SHOTS_DIR

async function launchWithExtension(): Promise<BrowserContext> {
  expect(existsSync(join(distExtension, 'manifest.json')), 'run npm run build:extension first').toBe(true)
  return chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'mm-xreserve-')), {
    headless: false,
    viewport: { width: 400, height: 900 },
    args: [`--disable-extensions-except=${distExtension}`, `--load-extension=${distExtension}`],
  })
}

async function createWalletToDashboard(page: Page) {
  await page.getByText('Create New Wallet').click()
  await expect(page.locator('.seed-grid')).toBeVisible({ timeout: 15_000 })
  await page.getByText('Reveal phrase').click()
  await page.getByText("I've Written It Down — Continue").click()
  for (const cb of await page.locator('input[type="checkbox"]').all()) await cb.check()
  await page.getByRole('button', { name: /Save Wallet/i }).click()
  await page.getByPlaceholder(/Password \(min/).fill('e2e-test-password-1')
  await page.getByPlaceholder('Confirm password').fill('e2e-test-password-1')
  await page.getByText('Encrypt & Continue').click()
  await expect(page.getByText('Portfolio').first()).toBeVisible({ timeout: 30_000 })
}

const snap = async (page: Page, name: string, focus?: ReturnType<Page['locator']>) => {
  if (!shots) return
  if (focus) await focus.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(shots, `${name}.png`) })
}

test.describe('xReserve testnet panel', () => {
  test('appears only in Testnet Mode, and takes one explicit click per transaction', async () => {
    test.setTimeout(120_000)
    const ctx = await launchWithExtension()
    try {
      const page = await ctx.newPage()
      const extId = ctx.serviceWorkers()[0]?.url().split('/')[2]
        ?? (await ctx.waitForEvent('serviceworker')).url().split('/')[2]
      await page.goto(`chrome-extension://${extId}/popup.html`)
      await createWalletToDashboard(page)

      // Mainnet: the panel is absent and the real state call refuses nothing it should not.
      await page.locator('.bottom-nav-btn:has-text("Swap")').click()
      await expect(page.getByText('YOU PAY')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByTestId('xreserve-testnet-panel')).toHaveCount(0)
      const mainnetPrepare = await page.evaluate(() =>
        (window as unknown as { wallet: { xreserveTestnetPrepare: (r: unknown) => Promise<unknown> } })
          .wallet.xreserveTestnetPrepare({ amount: '1', maxFee: '0.1' }))
      expect(mainnetPrepare).toMatchObject({ ok: false, code: 'not-testnet' })

      // Real Testnet Mode, then reload so every page reads it.
      await page.evaluate(() => (window as unknown as { wallet: { setTestnetMode: (b: boolean) => Promise<unknown> } }).wallet.setTestnetMode(true))
      await page.reload()
      await expect(page.getByText('Portfolio').first()).toBeVisible({ timeout: 30_000 })
      await page.locator('.bottom-nav-btn:has-text("Swap")').click()
      const panel = page.getByTestId('xreserve-testnet-panel')
      await expect(panel).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('Not available in Testnet Mode')).toBeVisible()
      // The recipient is the wallet's own derived Preprod address.
      await expect(panel.getByText(/^addr_test1/)).toBeVisible()
      // Keyless Koios is the default: no project id is asked for, and Review needs only the amounts.
      const koiosRadio = panel.getByRole('radio', { name: /Koios/ })
      const blockfrostRadio = panel.getByRole('radio', { name: /Blockfrost/ })
      await expect(koiosRadio).toBeChecked()
      await expect(panel.getByPlaceholder('preprod…')).toHaveCount(0)
      await expect(panel.getByRole('button', { name: 'Review deposit' })).toBeDisabled()
      await panel.getByPlaceholder('e.g. 20').fill('20')
      await panel.getByPlaceholder('e.g. 10').fill('10')
      await expect(panel.getByRole('button', { name: 'Review deposit' })).toBeEnabled()
      await snap(page, '1-koios-default', panel.getByRole('button', { name: 'Review deposit' }))
      await panel.getByPlaceholder('e.g. 20').fill('')
      await panel.getByPlaceholder('e.g. 10').fill('')

      // Blockfrost stays available (real set-source channel): it asks for a Preprod project id.
      await blockfrostRadio.click()   // the radio mirrors the SAVED choice, so it flips after the round trip
      await expect(blockfrostRadio).toBeChecked()
      await expect(panel.getByPlaceholder('preprod…')).toBeVisible()
      await panel.getByPlaceholder('e.g. 20').fill('20')
      await panel.getByPlaceholder('e.g. 10').fill('10')
      await expect(panel.getByRole('button', { name: 'Review deposit' })).toBeDisabled()
      await snap(page, '1b-blockfrost-needs-id', panel.getByRole('button', { name: 'Save project id' }))
      // A malformed key is refused by the privileged layer; a well-formed one is stored.
      await panel.getByPlaceholder('preprod…').fill('mainnetNOTAKEY')
      await panel.getByRole('button', { name: 'Save project id' }).click()
      await expect(page.getByRole('alert')).toContainText('invalid-key')
      await panel.getByPlaceholder('preprod…').fill(`preprod${'Ab12'.repeat(8)}`)
      await panel.getByRole('button', { name: 'Save project id' }).click()
      await expect(panel.getByPlaceholder('preprod…')).toHaveCount(0)
      await expect(panel.getByRole('button', { name: 'Review deposit' })).toBeEnabled()
      // Back to keyless Koios for the rest of the run.
      await koiosRadio.click()
      await expect(koiosRadio).toBeChecked()
      await panel.getByPlaceholder('e.g. 20').fill('')
      await panel.getByPlaceholder('e.g. 10').fill('')

      // The REAL approve and deposit channels refuse an intent that was never prepared.
      const realRefusals = await page.evaluate(async () => {
        const w = (window as unknown as { wallet: Record<string, (a: unknown) => Promise<unknown>> }).wallet
        return [await w.xreserveTestnetApprove('never-prepared'), await w.xreserveTestnetDeposit({ intentId: 'never-prepared', expected: {} })]
      })
      expect(realRefusals).toMatchObject([{ ok: false, code: 'intent-unknown' }, { ok: false, code: 'intent-unknown' }])

      // Stub the network-touching calls, counting every one.
      const installStubs = () => page.evaluate(() => {
        const w = window as unknown as { wallet: Record<string, unknown>; __calls: Record<string, unknown[]>; __allowance: bigint | number }
        w.__calls = { prepare: [], approve: [], approvalStatus: [], deposit: [], check: [], recover: [] }
        ;(w as unknown as { __pending: boolean }).__pending = false
        w.__allowance = 0
        const recipient = (document.querySelector('[data-testid="xreserve-testnet-panel"]')?.textContent ?? '').match(/addr_test1[0-9a-z]+/)?.[0] ?? ''
        const sender = '0xd0402a74d8d05e7c4a78e5e01fed14f94c0f4863'
        const depositHash = `0x${'ab'.repeat(32)}`
        const approvalHash = `0x${'cd'.repeat(32)}`
        const terms = (intentId: string) => ({
          intentId, expiresAt: Date.now() + 600_000, sourceChain: 'Ethereum Sepolia', destinationChain: 'Cardano Preprod',
          sender, recipient, recipientKind: 'base',
          xReserve: '0x008888878f94C0d87defdf0B07f46B93C1934442', usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
          amountRaw: '20000000', maxFeeRaw: '10000000', amount: '20', maxFee: '10',
          usdcBalanceRaw: '50000000', ethBalanceRaw: '100000000000000000',
          allowanceRaw: String(w.__allowance), needsApproval: Number(w.__allowance) < 20_000_000,
        })
        let n = 0
        w.wallet.xreserveTestnetPrepare = async (req: unknown) => { w.__calls.prepare.push(req); return { ok: true, value: terms(`intent-${++n}`) } }
        w.wallet.xreserveTestnetApprove = async (intentId: string) => {
          w.__calls.approve.push(intentId)
          return { ok: true, value: { intentId, state: 'submitted', approvalTxHash: approvalHash, explorerUrl: `https://sepolia.etherscan.io/tx/${approvalHash}`, terms: null } }
        }
        // The first status read finds the approval unconfirmed; the next one confirmed.
        w.wallet.xreserveTestnetApprovalStatus = async (intentId: string) => {
          w.__calls.approvalStatus.push(intentId)
          if (w.__calls.approvalStatus.length === 1) {
            return { ok: true, value: { intentId, state: 'pending', approvalTxHash: approvalHash, explorerUrl: `https://sepolia.etherscan.io/tx/${approvalHash}`, terms: null } }
          }
          w.__allowance = 20_000_000
          return { ok: true, value: { intentId, state: 'confirmed', approvalTxHash: approvalHash, explorerUrl: `https://sepolia.etherscan.io/tx/${approvalHash}`, terms: terms(intentId) } }
        }
        w.wallet.xreserveTestnetDeposit = async (req: unknown) => {
          w.__calls.deposit.push(req)
          return { ok: true, value: { sourceTxHash: depositHash, explorerUrl: `https://sepolia.etherscan.io/tx/${depositHash}`, approvalTxHash: null, tracking: 'started', trackingReason: null, record: null } }
        }
        const pendingOf = () => (w as unknown as { __pending: boolean }).__pending
        const realState = w.wallet.xreserveTestnetState as () => Promise<{ ok: boolean; value: { deposits: unknown[]; pendingSends: unknown[] } }>
        w.wallet.xreserveTestnetState = async () => {
          const r = await realState()
          if (!r.ok) return r
          const pendingSends = pendingOf()
            ? [{ key: 'k', corrupt: false, nonce: 7, txHash: depositHash, explorerUrl: `https://sepolia.etherscan.io/tx/${depositHash}`, amountRaw: '20000000', maxFeeRaw: '10000000', createdAt: 1 }]
            : []
          const deposits = w.__calls.deposit.length === 0 || pendingOf() ? [] : [{ sourceTxHash: depositHash, explorerUrl: `https://sepolia.etherscan.io/tx/${depositHash}`,
            sender, recipient, amountRaw: '20000000', maxFeeRaw: '10000000', cardanoTipAtSubmission: 4100000 }]
          return { ...r, value: { ...r.value, deposits, pendingSends } }
        }
        // Read-only recovery: finds the pending deposit on "Sepolia" and starts tracking it. Never sends.
        w.wallet.xreserveTestnetRecover = async () => {
          w.__calls.recover.push(null)
          // Held open until the test releases it, so the pending card can be inspected.
          await new Promise<void>(release => { (w as unknown as { __releaseRecover: () => void }).__releaseRecover = release })
          ;(w as unknown as { __pending: boolean }).__pending = false
          return { ok: true, value: { entries: [{ nonce: 7, txHash: depositHash, verdict: 'found', tracking: 'started', reason: 'Found on Sepolia; tracking started.' }] } }
        }
        w.wallet.xreserveTestnetCheck = async (req: unknown) => {
          w.__calls.check.push(req)
          return { ok: true, value: { kind: 'checked', persisted: 'saved', status: {
            state: 'minted', retryable: false, reason: null, sourceCode: 'verified', sourceConfirmations: '40', linkCode: 'linked',
            trackingError: null, providerFailure: null, conflict: null,
            mint: { txHash: 'ef'.repeat(32), blockHeight: 4100050, confirmations: 151 }, creditedRaw: '19999999',
            locatorState: 'minted', auditState: null,
          } } }
        }
      })
      const calls = () => page.evaluate(() => {
        const c = (window as unknown as { __calls: Record<string, unknown[]> }).__calls
        return { prepare: c.prepare.length, approve: c.approve.length, approvalStatus: c.approvalStatus.length, deposit: c.deposit.length, check: c.check.length, recover: c.recover.length }
      })
      const review = async () => {
        await panel.getByPlaceholder('e.g. 20').fill('20')
        await panel.getByPlaceholder('e.g. 10').fill('10')
        await panel.getByRole('button', { name: 'Review deposit' }).click()
      }
      await installStubs()

      // ── Step 1: the approval only ────────────────────────────────────────
      await review()
      const step1 = page.getByTestId('xreserve-testnet-preview')
      await expect(step1).toContainText('Step 1 of 2 — approve USDC')
      await expect(step1).toContainText('No deposit is sent')
      await expect(panel.getByRole('button', { name: 'Sign deposit' })).toHaveCount(0)
      await snap(page, '2-step1-approve', step1.getByRole('button', { name: 'Approve 20 USDC' }))

      await step1.getByRole('button', { name: 'Approve 20 USDC' }).click()
      // The hash is shown with its (not yet confirmed) state; no deposit anywhere.
      const approvalBox = page.getByTestId('xreserve-testnet-approval')
      await expect(approvalBox).toContainText('0xcdcdcdcd')
      await expect(approvalBox).toContainText('not confirmed yet')
      await expect(panel.getByRole('button', { name: 'Sign deposit' })).toHaveCount(0)
      expect(await calls()).toMatchObject({ approve: 1, approvalStatus: 1, deposit: 0 })
      await snap(page, '3-approval-pending', step1.getByRole('button', { name: 'Check approval' }))

      // ── Confirmed: the terms again, and a separate click to deposit ──────
      await step1.getByRole('button', { name: 'Check approval' }).click()
      const step2 = page.getByTestId('xreserve-testnet-deposit-confirm')
      await expect(step2).toContainText('Step 2 of 2 — confirm the deposit')
      await expect(step2).toContainText('Approval confirmed')
      await expect(step2).toContainText('20 USDC on Ethereum Sepolia')
      await expect(step2).toContainText('20 USDC', { useInnerText: true })
      expect(await calls()).toMatchObject({ approve: 1, approvalStatus: 2, deposit: 0 })
      await snap(page, '4-step2-confirm-deposit', step2.getByRole('button', { name: 'Sign deposit' }))

      // ── Leaving instead of clicking never deposits ───────────────────────
      await step2.getByRole('button', { name: 'Cancel' }).click()
      await expect(step2).toHaveCount(0)
      await page.locator('.bottom-nav-btn:has-text("Portfolio")').click()
      await page.locator('.bottom-nav-btn:has-text("Swap")').click()
      await expect(panel.getByRole('button', { name: 'Review deposit' })).toBeVisible()
      expect(await calls()).toMatchObject({ approve: 1, deposit: 0 })

      // ── With the allowance in place: one click, the deposit only ─────────
      await review()
      const confirm = page.getByTestId('xreserve-testnet-deposit-confirm')
      await expect(confirm).toContainText('Confirm the deposit')
      await expect(confirm).not.toContainText('Step 2 of 2')
      await expect(panel.getByRole('button', { name: /^Approve/ })).toHaveCount(0)
      // This deposit's outcome is left UNRESOLVED (as after an interrupted broadcast): the panel
      // must show it as pending and resolve it with ONE read-only check — never by sending again.
      await page.evaluate(() => { (window as unknown as { __pending: boolean }).__pending = true })
      await confirm.getByRole('button', { name: 'Sign deposit' }).click()
      await expect(page.getByTestId('xreserve-testnet-result')).toContainText('Deposit sent on Sepolia')
      const pendingCard = page.getByTestId('xreserve-testnet-pending')
      await expect(pendingCard).toContainText('Pending deposit — outcome not confirmed yet')
      await expect(pendingCard).toContainText('nonce 7')
      await expect(pendingCard.getByRole('button', { name: 'Checking…' })).toBeDisabled()
      await snap(page, '6-pending-recovery', pendingCard)
      await page.waitForFunction(() => typeof (window as unknown as { __releaseRecover?: () => void }).__releaseRecover === 'function')
      await page.evaluate(() => (window as unknown as { __releaseRecover: () => void }).__releaseRecover())
      await expect(page.getByTestId('xreserve-testnet-recovered')).toContainText('Found on Sepolia; tracking started.')
      await expect(page.getByTestId('xreserve-testnet-pending')).toHaveCount(0)
      expect(await calls()).toMatchObject({ recover: 1, deposit: 1 })
      const depositArgs = await page.evaluate(() => (window as unknown as { __calls: { deposit: unknown[] } }).__calls.deposit)
      expect(depositArgs).toEqual([{ intentId: 'intent-2', expected: expect.objectContaining({ amountRaw: '20000000', maxFeeRaw: '10000000', sender: '0xd0402a74d8d05e7c4a78e5e01fed14f94c0f4863' }) }])
      expect(await calls()).toMatchObject({ approve: 1, deposit: 1 })

      await panel.getByRole('button', { name: 'Check status' }).click()
      await expect(panel).toContainText('Minted on Cardano Preprod')
      await expect(panel).toContainText('19.999999 USDCx credited')
      await snap(page, '5-sent-and-checked', panel.getByText('USDCx credited'))

      // ── Reopening the wallet after an approval shows no pending deposit ──
      await page.reload()
      await expect(page.getByText('Portfolio').first()).toBeVisible({ timeout: 30_000 })
      await page.locator('.bottom-nav-btn:has-text("Swap")').click()
      await expect(panel.getByRole('button', { name: 'Review deposit' })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByTestId('xreserve-testnet-deposit-confirm')).toHaveCount(0)
      await expect(page.getByTestId('xreserve-testnet-preview')).toHaveCount(0)
      const realState = await page.evaluate(() => (window as unknown as { wallet: { xreserveTestnetState: () => Promise<unknown> } }).wallet.xreserveTestnetState())
      expect(realState).toMatchObject({ ok: true, value: { deposits: [] } })
    } finally {
      await ctx.close()
    }
  })
})
