import { describe, expect, it, vi } from 'vitest'
import { fetchCircleWithdrawalStatus, validateCircleWithdrawalStatus } from './xreserve-withdrawal-status'
import { XRESERVE_SEPOLIA_PREPROD } from './xreserve-network'
import { handleXReserveTestnet, type XReserveTestnetHost } from './xreserve-testnet-handlers'
import type { WalletConfig } from './secure-store'

const known = { withdrawalId: '6149dc3d-71bf-4d57-8cc1-5e2d4c0a8e70', burnTxHash: 'ab'.repeat(32), transferSpecHash: '0x' + 'cd'.repeat(32) }
const body = () => ({ withdrawalId: known.withdrawalId, burnTxId: '0x' + known.burnTxHash,
  status: 'created', useCircleForwarding: true, transferSpecHashes: [known.transferSpecHash] })
describe('Circle outbound status binding', () => {
  it.each(['created', 'verified', 'confirmed', 'finalized', 'expired', 'failed'])('keeps %s separate from independently verified delivery', state => {
    expect(validateCircleWithdrawalStatus({ ...body(), status: state }, known)).toMatchObject({ state, transactionHash: null, deliveryVerified: false })
  })
  it('retains a forwarded hash as evidence to check, not a successful receipt', () => {
    expect(validateCircleWithdrawalStatus({ ...body(), status: 'finalized', transactionHash: '0x' + 'ef'.repeat(32) }, known))
      .toMatchObject({ transactionHash: '0x' + 'ef'.repeat(32), deliveryVerified: false })
  })
  it.each(['withdrawal', 'burn', 'transfer', 'extra-transfer', 'state', 'forwarding', 'transaction'])('rejects inconsistent %s', field => {
    const b: Record<string, unknown> = body()
    if (field === 'withdrawal') b.withdrawalId = '7149dc3d-71bf-4d57-8cc1-5e2d4c0a8e70'
    if (field === 'burn') b.burnTxId = '0x' + '11'.repeat(32)
    if (field === 'transfer') b.transferSpecHashes = ['0x' + '11'.repeat(32)]
    if (field === 'extra-transfer') b.transferSpecHashes = [known.transferSpecHash, known.transferSpecHash]
    if (field === 'state') b.status = 'complete'
    if (field === 'forwarding') b.useCircleForwarding = false
    if (field === 'transaction') b.transactionHash = '0x12'
    expect(() => validateCircleWithdrawalStatus(b, known)).toThrow()
  })
  it('uses the documented singular status path on the privileged network profile', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(body())))
    await fetchCircleWithdrawalStatus(known, { fetchFn, network: XRESERVE_SEPOLIA_PREPROD })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect((fetchFn.mock.calls[0] as unknown[])[0]).toBe('https://xreserve-api-testnet.circle.com/v1/withdrawal/' + known.withdrawalId)
  })
  it('refuses unsafe references before requesting a status', async () => {
    const fetchFn = vi.fn()
    await expect(fetchCircleWithdrawalStatus({ ...known, withdrawalId: '../withdraw' }, { fetchFn })).rejects.toThrow('invalid withdrawal reference')
    expect(fetchFn).not.toHaveBeenCalled()
  })
  it.each([404, 403, 429, 500])('does not turn HTTP %s into refund, expiry or delivery', async status => {
    await expect(fetchCircleWithdrawalStatus(known, { fetchFn: async () => new Response('error', { status }) })).rejects.toMatchObject({
      kind: status === 404 ? 'not-found' : status === 429 ? 'rate-limited' : 'unavailable',
    })
  })
  it.each([false, true])('routes status using wallet testnetMode=%s without addresses, seed or storage writes', async testnetMode => {
    const forbidden = vi.fn(async () => { throw new Error('status must not use this capability') })
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(body())))
    const host: XReserveTestnetHost = {
      loadConfig: async () => ({ testnetMode } as WalletConfig), fetchFn,
      saveConfig: forbidden, loadAddresses: forbidden, loadMnemonic: forbidden,
      loadTracking: forbidden, saveTracking: forbidden,
    }
    expect(await handleXReserveTestnet('xreserve:withdrawal-status', { ...known, network: 'attacker' }, host))
      .toMatchObject({ ok: true, value: { state: 'created', deliveryVerified: false } })
    expect((fetchFn.mock.calls[0] as unknown[])[0]).toBe(`https://xreserve-api${testnetMode ? '-testnet' : ''}.circle.com/v1/withdrawal/${known.withdrawalId}`)
    expect(forbidden).not.toHaveBeenCalled()
    host.fetchFn = async () => new Response('error', { status: 403 })
    expect(await handleXReserveTestnet('xreserve:withdrawal-status', known, host)).toEqual({ ok: false, code: 'unavailable', message: 'Circle withdrawal status: HTTP 403', submitted: [] })
  })
})
