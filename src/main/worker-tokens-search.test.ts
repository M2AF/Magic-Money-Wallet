/**
 * Worker /tokens text search: Relay's own index first, the slow external search
 * and the LI.FI catalogue only when that index is thin — and then in parallel.
 *
 * Measured 2026-09-24: a cold Relay text search with useExternalSearch took
 * 1-3.3 s and returned fewer hits (USDC on Base: 2 vs 20), which then pulled the
 * LI.FI catalogue in serially; this was the cold search p95 of 3.9 s.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
// @ts-expect-error -- untyped Worker module
import { handleTokens } from '../../cloudflare-worker/tokens.js'

type Call = { url: string; body: { useExternalSearch?: boolean; term?: string } | null; at: number }

function stubProviders(relayOwnHits: number) {
  const calls: Call[] = []
  const started = Date.now()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push({ url, body, at: Date.now() - started })
    if (url.startsWith('https://api.relay.link/currencies/v2')) {
      const n = body.useExternalSearch ? 1 : relayOwnHits
      await new Promise(r => setTimeout(r, body.useExternalSearch ? 40 : 1))
      return Response.json(Array.from({ length: n }, (_, i) => ({
        address: `0x${(i + (body.useExternalSearch ? 100 : 1)).toString(16).padStart(40, '0')}`,
        symbol: `T${i}`, name: `Token ${i}`, decimals: 18, metadata: { verified: true },
      })))
    }
    if (url.startsWith('https://li.quest/v1/tokens')) {
      await new Promise(r => setTimeout(r, 40))
      return Response.json({ tokens: { '8453': [{ address: `0x${'ab'.repeat(20)}`, symbol: 'ZZQ', name: 'zzq', decimals: 18 }] } })
    }
    return new Response('{}', { status: 404 })
  }))
  return calls
}

const get = (q: string) => handleTokens(
  new Request(`https://w.test/tokens?chain=base&q=${q}`), new URL(`https://w.test/tokens?chain=base&q=${q}`), {}, null,
).then((r: Response) => r.json())

afterEach(() => vi.unstubAllGlobals())

describe('Worker /tokens text search', () => {
  it("answers from Relay's own index, without the external search or the catalogue", async () => {
    const calls = stubProviders(20)
    const body = await get('usdc')
    expect(body.tokens).toHaveLength(20)
    expect(calls).toHaveLength(1)
    expect(calls[0].body?.useExternalSearch).toBe(false)
  })

  it('a thin index falls back to external search AND the catalogue, started together', async () => {
    const calls = stubProviders(2)
    const body = await get('zzq')
    const external = calls.find(c => c.body?.useExternalSearch === true)
    const catalogue = calls.find(c => c.url.startsWith('https://li.quest/v1/tokens'))
    expect(external && catalogue).toBeTruthy()
    // Parallel, not serial: the second starts before the first (40 ms) finishes.
    expect(Math.abs(external!.at - catalogue!.at)).toBeLessThan(30)
    // Own index first, then the fallback's extra hits, deduplicated.
    expect(body.tokens.map((t: { symbol: string }) => t.symbol)).toEqual(['T0', 'T1', 'T0', 'ZZQ'])
  })

  it('an exact address still uses external search (it finds unindexed tokens)', async () => {
    const calls = stubProviders(0)
    await get(`0x${'12'.repeat(20)}`)
    expect(calls[0].body?.useExternalSearch).toBe(true)
  })
})
