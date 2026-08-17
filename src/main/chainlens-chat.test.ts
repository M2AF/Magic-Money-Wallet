/**
 * chainlens-chat.test.ts
 *
 * The client is a thin pass-through, so what is worth testing is the session:
 * which account it speaks as, when it is thrown away, and what it refuses to
 * hand back to the renderer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ACCOUNT = 'ec18dcf5-3271-46fd-8029-41e5b2f39eed'
const OTHER_ACCOUNT = '3f2c6cb8-2a43-4b69-bf5e-099ef63be79f'
const ADDRESS = '0x01faf6dfc230d755141d84d7cb980dd68f5efe13'
const OTHER_ADDRESS = '0x00000000000000000000000000000000deadbeef'

// Mutable fixtures the mocks read, so each test can reshape the world.
let profile: { id: string; display_name: string | null; avatar_url: string | null } | null
let addresses: { evm: string; accountIndex: number } | null
let sessionResult: unknown

vi.mock('./supabase-sync', () => ({
  getProfileByAddress: vi.fn(async () => profile),
}))

vi.mock('./secure-store', () => ({
  loadAddresses: vi.fn(async () => addresses),
  loadMnemonic: vi.fn(async () => 'test test test'),
  loadConfig: vi.fn(async () => ({})),
}))

vi.mock('./passkey-reconcile-chainlens', () => ({
  CHAINLENS_ORIGIN: 'https://chainlens.test',
  evmSigner: vi.fn(async () => ({ address: ADDRESS, signMessage: async () => '0xsig' })),
}))

// Variadic so `mock.calls[n][3]` (the ChainLens id argument) stays inspectable.
const walletSession = vi.fn(async (...args: unknown[]) => { void args; return sessionResult })
vi.mock('./chainlens-auth', () => ({
  chainlensWalletSession: (...args: unknown[]) => walletSession(...args),
  isChainLensSession: (value: { token?: string }) => typeof value?.token === 'string',
}))

import {
  chatStatus, chatWorld, chatSendWorld, chatFriends, chatUnread,
  chatMarkRead, chatSearchGifs, clearChatSession,
} from './chainlens-chat'
import { getProfileByAddress } from './supabase-sync'

/** Queue of responses `fetch` will hand back, in order. */
let responses: Array<{ status?: number; body?: unknown }>
let requests: Array<{ url: string; init: RequestInit }>

const jsonResponse = ({ status = 200, body = {} }: { status?: number; body?: unknown }) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  clearChatSession()
  profile = { id: ACCOUNT, display_name: 'Crypto Jesus', avatar_url: 'https://img.test/a.png' }
  addresses = { evm: ADDRESS, accountIndex: 0 }
  sessionResult = { token: 'jwt-1', userId: ACCOUNT }
  walletSession.mockClear()
  vi.mocked(getProfileByAddress).mockClear()
  responses = []
  requests = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    requests.push({ url: String(url), init })
    return jsonResponse(responses.shift() ?? { body: {} })
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  clearChatSession()
})

const authHeader = (index: number) =>
  (requests[index].init.headers as Record<string, string>).Authorization

describe('session identity', () => {
  it('signs in as the account the wallet is displaying', async () => {
    responses.push({ body: { messages: [] } })
    await chatWorld()

    // The displayed profile id is passed straight through as the account to
    // authenticate as — never re-derived from the address.
    expect(walletSession).toHaveBeenCalledTimes(1)
    expect(walletSession.mock.calls[0][3]).toBe(ACCOUNT)
    expect(authHeader(0)).toBe('Bearer jwt-1')
  })

  it('reuses one session across calls instead of re-signing per request', async () => {
    responses.push({ body: { messages: [] } }, { body: { friends: [], incoming: [], outgoing: [] } })
    await chatWorld()
    await chatFriends()

    expect(walletSession).toHaveBeenCalledTimes(1)
    // The identity lookup is a network round trip through the Worker; polling
    // every 3s must not repeat it.
    expect(getProfileByAddress).toHaveBeenCalledTimes(1)
  })

  it('refuses to run when there is no ChainLens profile yet', async () => {
    profile = null
    await expect(chatWorld()).rejects.toThrow(/Open Profile and connect/i)
    expect(walletSession).not.toHaveBeenCalled()
  })

  it('surfaces the session error rather than chatting as the wrong account', async () => {
    sessionResult = { error: 'This wallet is not a verified wallet on that ChainLens account.', mismatch: true }
    await expect(chatWorld()).rejects.toThrow(/not a verified wallet/i)
  })

  it('re-signs for a new account when the wallet switches address', async () => {
    responses.push({ body: { messages: [] } })
    await chatWorld()

    // Switching account in the wallet is switching ChainLens user.
    addresses = { evm: OTHER_ADDRESS, accountIndex: 1 }
    profile = { id: OTHER_ACCOUNT, display_name: 'Other', avatar_url: null }
    sessionResult = { token: 'jwt-2', userId: OTHER_ACCOUNT }
    responses.push({ body: { messages: [] } })
    await chatWorld()

    expect(walletSession).toHaveBeenCalledTimes(2)
    expect(walletSession.mock.calls[1][3]).toBe(OTHER_ACCOUNT)
    expect(authHeader(1)).toBe('Bearer jwt-2')
  })

  it('re-signs after the session is explicitly cleared', async () => {
    responses.push({ body: { messages: [] } })
    await chatWorld()
    clearChatSession()

    responses.push({ body: { messages: [] } })
    await chatWorld()
    expect(walletSession).toHaveBeenCalledTimes(2)
  })

  it('re-authenticates once on a 401 and retries the call', async () => {
    responses.push({ status: 401, body: { error: 'Invalid or expired token' } })
    responses.push({ body: { messages: [{ id: 4 }] } })
    sessionResult = { token: 'jwt-1', userId: ACCOUNT }

    const messages = await chatWorld()
    expect(messages).toEqual([{ id: 4 }])
    expect(walletSession).toHaveBeenCalledTimes(2)
  })

  it('gives up after one re-auth so a rejected identity fails fast', async () => {
    responses.push({ status: 401, body: { error: 'Invalid or expired token' } })
    responses.push({ status: 401, body: { error: 'Invalid or expired token' } })

    await expect(chatWorld()).rejects.toThrow(/Invalid or expired token/i)
    expect(walletSession).toHaveBeenCalledTimes(2)
  })
})

describe('status', () => {
  it('reports eligibility and identity without leaking the GIPHY key', async () => {
    responses.push({ body: { eligible: true, walletLinked: true, socialLinked: true, giphyApiKey: 'secret-key' } })
    const status = await chatStatus()

    expect(status).toEqual({
      eligible: true, walletLinked: true, socialLinked: true,
      giphyAvailable: true,
      userId: ACCOUNT, displayName: 'Crypto Jesus', avatarUrl: 'https://img.test/a.png',
    })
    // The key is a credential the wallet was lent, not one to hand to the UI.
    expect(JSON.stringify(status)).not.toContain('secret-key')
  })

  it('reports GIF search as unavailable when the server withholds the key', async () => {
    responses.push({ body: { eligible: false, walletLinked: true, socialLinked: false, giphyApiKey: null } })
    const status = await chatStatus()
    expect(status.eligible).toBe(false)
    expect(status.giphyAvailable).toBe(false)
  })
})

describe('requests', () => {
  it('sends the cursor only when polling incrementally', async () => {
    responses.push({ body: { messages: [] } }, { body: { messages: [] } })
    await chatWorld()
    await chatWorld(42)

    expect(requests[0].url).toBe('https://chainlens.test/api/chat/world')
    expect(requests[1].url).toBe('https://chainlens.test/api/chat/world?after=42')
  })

  it('posts a world message and returns the stored row', async () => {
    responses.push({ status: 201, body: { message: { id: 9, content: 'gm' } } })
    expect(await chatSendWorld('text', 'gm')).toEqual({ id: 9, content: 'gm' })
    expect(JSON.parse(String(requests[0].init.body))).toEqual({ type: 'text', content: 'gm' })
  })

  it('normalizes an empty unread payload', async () => {
    responses.push({ body: {} })
    expect(await chatUnread()).toEqual({ pending_requests: 0, unread_direct: 0, conversations: [] })
  })

  it('marks World Chat read without naming a friend', async () => {
    responses.push({ body: { conversation: 'world', last_read_id: 12 } })
    await chatMarkRead(12)
    expect(JSON.parse(String(requests[0].init.body))).toEqual({ last_read_id: 12 })
  })

  it('marks a DM read against the friend it belongs to', async () => {
    responses.push({ body: { conversation: 'dm:7', last_read_id: 30 } })
    await chatMarkRead(30, OTHER_ACCOUNT)
    expect(JSON.parse(String(requests[0].init.body)))
      .toEqual({ last_read_id: 30, friend_id: OTHER_ACCOUNT })
  })

  it('raises the server’s own message on failure', async () => {
    responses.push({ status: 403, body: { error: 'Direct messages are only available between friends' } })
    await expect(chatMarkRead(3, OTHER_ACCOUNT)).rejects.toThrow(/only available between friends/i)
  })
})

describe('GIF proxy', () => {
  it('fetches GIPHY in main with the session key and drops unusable results', async () => {
    // status first (populates the key), then the GIPHY call itself.
    responses.push({ body: { eligible: true, walletLinked: true, socialLinked: true, giphyApiKey: 'secret-key' } })
    responses.push({ body: { data: [
      { id: 'a', title: 'One', images: { fixed_width: { url: 'https://media.giphy.com/a.gif', webp: 'https://media.giphy.com/a.webp' } } },
      { id: 'b', title: 'Broken', images: {} },
    ] } })

    const gifs = await chatSearchGifs('cats')

    expect(gifs).toEqual([{
      id: 'a', title: 'One',
      url: 'https://media.giphy.com/a.gif',
      preview: 'https://media.giphy.com/a.webp',
    }])

    const giphyUrl = new URL(requests[requests.length - 1].url)
    expect(giphyUrl.host).toBe('api.giphy.com')
    expect(giphyUrl.pathname).toBe('/v1/gifs/search')
    expect(giphyUrl.searchParams.get('api_key')).toBe('secret-key')
    expect(giphyUrl.searchParams.get('rating')).toBe('pg-13')
    expect(giphyUrl.searchParams.get('limit')).toBe('30')
    expect(giphyUrl.searchParams.get('q')).toBe('cats')
  })

  it('falls back to trending for an empty query', async () => {
    responses.push({ body: { eligible: true, giphyApiKey: 'secret-key' } })
    responses.push({ body: { data: [] } })
    await chatSearchGifs('   ')

    const giphyUrl = new URL(requests[requests.length - 1].url)
    expect(giphyUrl.pathname).toBe('/v1/gifs/trending')
    expect(giphyUrl.searchParams.has('q')).toBe(false)
  })

  it('reports unavailability when the account has no GIPHY key', async () => {
    responses.push({ body: { eligible: false, giphyApiKey: null } })
    await expect(chatSearchGifs('cats')).rejects.toThrow(/unavailable/i)
  })
})
