import { afterEach, expect, it, vi } from 'vitest'
import { readRedactedOwnership, REDACTED_CONTRACT, bindSovereignAccount, sovereignAccess, sovereignAllowed, refreshSovereignAccess, initSovereignAccess } from './sovereign-access'
const OWNER = '0x1111111111111111111111111111111111111111'
const OTHER = '0x2222222222222222222222222222222222222222'
const word = (count: bigint) => `0x${count.toString(16).padStart(64, '0')}`
const transport = (balance = word(1n), chain = '0x1237') => vi.fn(async (_url: unknown, options: RequestInit) => {
  const call = JSON.parse(options.body as string)
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: call.id, result: call.method === 'eth_chainId' ? chain : call.method === 'eth_blockNumber' ? '0xabc' : balance }))
})
afterEach(() => { bindSovereignAccount(null); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })
it('checks chain and balanceOf the precise owner and contract at a measured block', async () => {
  const request = transport()
  expect(await readRedactedOwnership(OWNER, undefined, request as typeof fetch)).toEqual({ balance: '1', block: '2748' })
  const call = JSON.parse(request.mock.calls[2][1].body as string)
  expect(call.params).toEqual([{ to: REDACTED_CONTRACT, data: `0x70a08231${OWNER.slice(2).padStart(64, '0')}` }, '0xabc'])
})
it('zero NFTs does not become a holder; full uint256 balances remain exact', async () => {
  expect((await readRedactedOwnership(OWNER, undefined, transport(word(0n)) as typeof fetch)).balance).toBe('0')
  expect((await readRedactedOwnership(OWNER, undefined, transport(word(2n**200n)) as typeof fetch)).balance).toBe((2n**200n).toString())
})
it('rejects wrong chain, empty/malformed balances, invalid owners and RPC errors', async () => {
  await expect(readRedactedOwnership(OWNER, undefined, transport(word(1n), '0xb626') as typeof fetch)).rejects.toThrow('Wrong chain')
  for (const value of ['0x', '0x1', 'garbage']) await expect(readRedactedOwnership(OWNER, undefined, transport(value) as typeof fetch)).rejects.toThrow('Invalid balance')
  await expect(readRedactedOwnership('bad')).rejects.toThrow('Invalid owner')
  await expect(readRedactedOwnership(OWNER, undefined, vi.fn(async () => new Response('{}', { status: 503 })))).rejects.toThrow('RPC unavailable')
})
it('ownership is account/session bound and revoked by an RPC failure', async () => {
  vi.stubGlobal('fetch', transport())
  vi.stubGlobal('window', { wallet: { getAddresses: async () => ({ evm: OWNER }) } })
  bindSovereignAccount(OWNER); await refreshSovereignAccess()
  expect(sovereignAllowed()).toBe(true)
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
  await refreshSovereignAccess()
  expect(sovereignAccess().status).toBe('error'); expect(sovereignAllowed()).toBe(false)
  bindSovereignAccount(null); expect(sovereignAllowed()).toBe(false)
})
it('ignores a late holder response after switching accounts', async () => {
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  const request = transport()
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, options: RequestInit) => {
    const call = JSON.parse(options.body as string)
    if (call.method === 'eth_call' && call.params[0].data.includes(OWNER.slice(2))) await blocked
    return request(url, options)
  }))
  vi.stubGlobal('window', { wallet: { getAddresses: async () => ({ evm: OTHER }) } })
  bindSovereignAccount(OWNER); const old = refreshSovereignAccess()
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  bindSovereignAccount(null); release(); await old
  expect(sovereignAccess().owner).toBeNull(); expect(sovereignAllowed()).toBe(false)
})

it('does not trust an expired ownership result', async () => {
  vi.stubGlobal('fetch', transport())
  vi.stubGlobal('window', { wallet: { getAddresses: async () => ({ evm: OWNER }) } })
  bindSovereignAccount(OWNER); await refreshSovereignAccess()
  expect(sovereignAllowed()).toBe(true)
  vi.spyOn(Date, 'now').mockReturnValue(sovereignAccess().checkedAt + 90_000)
  expect(sovereignAllowed()).toBe(false)
})
it('a hung ownership request times out without leaving access enabled', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn((_url: unknown, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(new Error('timeout')), { once:true })
  })))
  bindSovereignAccount(OWNER); const result = refreshSovereignAccess()
  await vi.advanceTimersByTimeAsync(10_000); await result
  expect(sovereignAccess().status).toBe('error'); expect(sovereignAllowed()).toBe(false)
})

it('detached browser lock invalidates an unfinished account synchronization', async () => {
  let locked!: () => void
  let resolveOwner!: (value: { evm: string }) => void
  const account = new Promise<{ evm: string }>(resolve => { resolveOwner = resolve })
  const getAddresses = vi.fn(() => account)
  vi.stubGlobal('fetch', transport())
  vi.stubGlobal('window', {
    location: { search: '?browserChrome=1' }, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    wallet: { isUnlocked: async () => true, getAddresses, onLocked: (callback: () => void) => { locked = callback }, offLocked: vi.fn() }
  })
  vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  const dispose = initSovereignAccess(vi.fn())
  try {
    await vi.waitFor(() => expect(getAddresses).toHaveBeenCalledOnce())
    locked(); resolveOwner({ evm: OWNER })
    await Promise.resolve(); await Promise.resolve()
    expect(sovereignAccess().owner).toBeNull(); expect(sovereignAllowed()).toBe(false)
  } finally { dispose() }
})
