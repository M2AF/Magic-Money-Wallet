import { describe, it, expect } from 'vitest'
import { matchHistory, historyHost, type HistoryEntry } from './history-wire'

let seq = 0
const entry = (over: Partial<HistoryEntry> & { url: string }): HistoryEntry => ({
  id: `e${seq++}`,
  title: '',
  host: historyHost(over.url),
  lastVisitedAt: 1_000,
  visits: 1,
  ...over,
})

describe('historyHost', () => {
  it('strips www and lowercases', () => {
    expect(historyHost('https://WWW.Example.com/path')).toBe('example.com')
  })
  it('returns empty for anything unparseable', () => {
    expect(historyHost('not a url')).toBe('')
  })
})

describe('matchHistory', () => {
  it('returns the most recent entries for an empty query', () => {
    const old = entry({ url: 'https://a.com', lastVisitedAt: 1 })
    const recent = entry({ url: 'https://b.com', lastVisitedAt: 99 })
    expect(matchHistory([old, recent], '', 5).map(e => e.host)).toEqual(['b.com', 'a.com'])
  })

  it('does not mutate the caller list while sorting', () => {
    const items = [entry({ url: 'https://a.com', lastVisitedAt: 1 }), entry({ url: 'https://b.com', lastVisitedAt: 9 })]
    matchHistory(items, '', 5)
    expect(items.map(e => e.host)).toEqual(['a.com', 'b.com'])
  })

  it('ranks a host prefix above a host substring', () => {
    const prefix = entry({ url: 'https://open.com' })
    const substring = entry({ url: 'https://myopenthing.com' })
    expect(matchHistory([substring, prefix], 'open', 5).map(e => e.host))
      .toEqual(['open.com', 'myopenthing.com'])
  })

  it('ranks any host match above a title-only match, however recent', () => {
    const titleOnly = entry({ url: 'https://zzz.com', title: 'Open Sesame', lastVisitedAt: 10_000 })
    const hostMatch = entry({ url: 'https://opensea.io', lastVisitedAt: 1 })
    expect(matchHistory([titleOnly, hostMatch], 'open', 5).map(e => e.host))
      .toEqual(['opensea.io', 'zzz.com'])
  })

  it('breaks a tier tie on visit count before recency', () => {
    const often = entry({ url: 'https://openb.com', visits: 12, lastVisitedAt: 1 })
    const recent = entry({ url: 'https://opena.com', visits: 1, lastVisitedAt: 9_000 })
    expect(matchHistory([recent, often], 'open', 5).map(e => e.host))
      .toEqual(['openb.com', 'opena.com'])
  })

  it('matches a host even when the scheme is typed', () => {
    const hit = entry({ url: 'https://example.com/page' })
    expect(matchHistory([hit], 'https://exa', 5)).toHaveLength(1)
  })

  it('matches deeper path text through the url tier', () => {
    const hit = entry({ url: 'https://example.com/quarterly-report' })
    expect(matchHistory([hit], 'quarterly', 5)).toHaveLength(1)
  })

  it('drops entries that match nothing', () => {
    expect(matchHistory([entry({ url: 'https://example.com', title: 'Example' })], 'zzz', 5)).toEqual([])
  })

  it('honours the limit', () => {
    const items = ['a', 'b', 'c', 'd'].map(h => entry({ url: `https://open${h}.com` }))
    expect(matchHistory(items, 'open', 2)).toHaveLength(2)
    expect(matchHistory(items, 'open', 0)).toEqual([])
  })
})
