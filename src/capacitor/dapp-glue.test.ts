import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (event: unknown) => void>(),
  handle: vi.fn(async () => null),
  getState: vi.fn(async () => ({ activeTabId: 2 })),
  respond: vi.fn(async (_value: { requestId: string; json: string }) => {}),
}))

vi.mock('../extension/wallet-handlers', () => ({
  handle: mocks.handle,
  PAGE_RPC_TYPES: new Set(['web3:request']),
}))
vi.mock('./platform-capacitor', () => ({ setDappSink: vi.fn() }))
vi.mock('./dapp-browser', () => ({
  DappBrowser: {
    addListener: vi.fn(async (name: string, cb: (event: unknown) => void) => {
      mocks.listeners.set(name, cb)
      return { remove: vi.fn() }
    }),
    getState: mocks.getState,
    respond: mocks.respond,
    emitEvent: vi.fn(async () => {}),
  },
}))
vi.mock('./wallet-local', () => ({ maybeAutofillActiveTab: vi.fn(), resetAutofillGuard: vi.fn() }))
vi.mock('./passkey-provider', () => ({ capacitorPasskeyEnv: {} }))
vi.mock('../main/passkey-bridge', () => ({ handlePasskeyCreate: vi.fn(), handlePasskeyGet: vi.fn(), handlePasskeyProbe: vi.fn() }))
vi.mock('../main/passkey-protocol', () => ({ encodePasskeyError: vi.fn() }))
vi.mock('./passkey-system-provider', () => ({ syncPasskeyDiscovery: vi.fn() }))
vi.mock('./capacitor-store', () => ({ loadMnemonic: vi.fn() }))

import { initDappGlue } from './dapp-glue'

initDappGlue()

async function request(tabId: number, method: string) {
  mocks.listeners.get('pageRequest')?.({
    requestId: 'request-1',
    origin: 'https://chainlensnft.info',
    tabId,
    payloadJson: JSON.stringify({ id: 1, type: 'web3:request', args: [{ method, params: [{ chainId: '0x1237' }] }] }),
  })
  await vi.waitFor(() => expect(mocks.respond).toHaveBeenCalled())
  const response = mocks.respond.mock.lastCall?.[0]
  if (!response) throw new Error('The dApp request was not answered')
  return JSON.parse(response.json)
}

describe('Android dApp network switching', () => {
  beforeEach(() => {
    mocks.handle.mockClear()
    mocks.respond.mockClear()
    mocks.getState.mockClear()
  })

  it('rejects a network switch from a background tab', async () => {
    const response = await request(1, 'wallet_switchEthereumChain')
    expect(response.error).toMatch(/Open this browser tab/)
    expect(mocks.handle).not.toHaveBeenCalled()
  })

  it('allows a network switch from the active tab', async () => {
    const response = await request(2, 'wallet_switchEthereumChain')
    expect(response.error).toBeUndefined()
    expect(mocks.handle).toHaveBeenCalledOnce()
  })

  it('keeps passive reads working in background tabs', async () => {
    const response = await request(1, 'eth_chainId')
    expect(response.error).toBeUndefined()
    expect(mocks.handle).toHaveBeenCalledOnce()
    expect(mocks.getState).not.toHaveBeenCalled()
  })
})
