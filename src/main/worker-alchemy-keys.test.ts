/**
 * Worker Alchemy key rotation (cloudflare-worker/read.js alchemyFetch).
 *
 * ALCHEMY_KEY hit its monthly capacity on 2026-09-28 and blanked every EVM NFT
 * list. A second Alchemy app key (ALCHEMY_KEY_2) is rotated with the first so
 * each carries about half the load, and a refused request fails over.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

type AlchemyFetch = (env: Record<string, string>, urlFor: (key: string) => string, init?: RequestInit) => Promise<Response>
let alchemyFetch: AlchemyFetch

beforeEach(async () => {
  // Fresh module per test: rotation turn and exhausted-key state are module-level.
  vi.resetModules()
  // @ts-expect-error -- untyped Worker module
  ;({ alchemyFetch } = await import('../../cloudflare-worker/read.js'))
})
afterEach(() => { vi.unstubAllGlobals() })

const keyOf = (url: string) => /\/(?:v2|nft\/v3)\/([^/]+)/.exec(new URL(url).pathname)?.[1] ?? ''
const url = (key: string) => `https://eth-mainnet.g.alchemy.com/nft/v3/${key}/getNFTsForOwner`

function stub(respond: (key: string) => Response) {
  const seen: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (u: string) => { const k = keyOf(u); seen.push(k); return respond(k) }))
  return seen
}

const capped = () => new Response('Monthly capacity limit exceeded. Visit https://dashboard.alchemy.com/settings/billing', { status: 429 })

describe('Worker Alchemy key rotation', () => {
  it('alternates between the two keys', async () => {
    const seen = stub(() => Response.json({ ok: true }))
    const env = { ALCHEMY_KEY: 'k1', ALCHEMY_KEY_2: 'k2' }
    for (let i = 0; i < 4; i++) await alchemyFetch(env, url)
    expect(seen).toEqual(['k1', 'k2', 'k1', 'k2'])
  })

  it('uses only ALCHEMY_KEY when no second key is configured', async () => {
    const seen = stub(() => Response.json({ ok: true }))
    for (let i = 0; i < 3; i++) await alchemyFetch({ ALCHEMY_KEY: 'k1' }, url)
    expect(seen).toEqual(['k1', 'k1', 'k1'])
  })

  it('fails over on a capped key, then stops trying it first', async () => {
    const seen = stub(k => (k === 'k1' ? capped() : Response.json({ ok: true })))
    const env = { ALCHEMY_KEY: 'k1', ALCHEMY_KEY_2: 'k2' }
    const first = await alchemyFetch(env, url)
    expect(first.status).toBe(200)
    await alchemyFetch(env, url)
    await alchemyFetch(env, url)
    // Only the first request paid for discovering k1's cap.
    expect(seen).toEqual(['k1', 'k2', 'k2', 'k2'])
  })

  it('fails over on 403 (e.g. network not enabled on that app) without benching the key', async () => {
    const seen = stub(k => (k === 'k1' ? new Response('not enabled', { status: 403 }) : Response.json({ ok: true })))
    const env = { ALCHEMY_KEY: 'k1', ALCHEMY_KEY_2: 'k2' }
    expect((await alchemyFetch(env, url)).status).toBe(200)
    await alchemyFetch(env, url) // k2's turn
    await alchemyFetch(env, url) // k1's turn again — still tried first
    expect(seen).toEqual(['k1', 'k2', 'k2', 'k1', 'k2'])
  })

  it('returns the upstream refusal when every key is capped', async () => {
    stub(() => capped())
    const res = await alchemyFetch({ ALCHEMY_KEY: 'k1', ALCHEMY_KEY_2: 'k2' }, url)
    expect(res.status).toBe(429)
    expect(await res.text()).toMatch(/Monthly capacity/)
  })

  it('re-sends the same POST body on failover', async () => {
    const bodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
      bodies.push(String(init?.body))
      return keyOf(u) === 'k1' ? capped() : Response.json({ ok: true })
    }))
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber' })
    await alchemyFetch({ ALCHEMY_KEY: 'k1', ALCHEMY_KEY_2: 'k2' }, k => `https://eth-mainnet.g.alchemy.com/v2/${k}`, { method: 'POST', body })
    expect(bodies).toEqual([body, body])
  })
})
