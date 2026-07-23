import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Engine } from 'adblock-rs'

// Same mocking pattern as secure-store.test.ts: only Electron's app.getPath/
// getAppPath are mocked (with a faithful reversible temp-dir stand-in) — the
// rest of the module (config, exceptions, engine, policy) runs for real.
const { tmp } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs'); const path = require('path'); const os = require('os')
  return { tmp: fs.mkdtempSync(path.join(os.tmpdir(), 'mm-magicguard-')) }
})

vi.mock('electron', () => ({
  app: { getPath: () => tmp, getAppPath: () => tmp },
}))

import {
  hostnameFromUrl,
  isSiteExcepted,
  mapResourceType,
  deriveSourceUrl,
  decideRequest,
  buildEngineFromTexts,
  initMagicGuardEngine,
  registerTab,
  unregisterTab,
  resetPageCounter,
  noteBlocked,
  getCounts,
  getMagicGuardState,
  setMagicGuardEnabled,
  setMagicGuardForSite,
  type ElectronResourceType,
} from './magic-guard'
import { deleteWallet, lock } from './secure-store'

beforeEach(() => { deleteWallet(); lock() })

describe('magic-guard · resource-type mapping', () => {
  it('maps every Electron resourceType to its adblock-rust alias', () => {
    const table: Array<[ElectronResourceType, string]> = [
      ['mainFrame', 'document'],
      ['subFrame', 'subdocument'],
      ['stylesheet', 'stylesheet'],
      ['script', 'script'],
      ['image', 'image'],
      ['font', 'font'],
      ['object', 'object'],
      ['xhr', 'xmlhttprequest'],
      ['ping', 'ping'],
      ['cspReport', 'csp_report'],
      ['media', 'media'],
      ['webSocket', 'websocket'],
      ['other', 'other'],
    ]
    for (const [electronType, expected] of table) {
      expect(mapResourceType(electronType)).toBe(expected)
    }
  })
})

describe('magic-guard · source URL derivation', () => {
  const url = 'https://ads.example.com/t.js'

  it('prefers a valid frame URL', () => {
    expect(deriveSourceUrl({ frameUrl: 'https://dapp.example/', referrer: 'https://ref.example/', tabUrl: 'https://tab.example/', url }))
      .toBe('https://dapp.example/')
  })
  it('falls back to referrer when frame URL is missing/invalid', () => {
    expect(deriveSourceUrl({ frameUrl: null, referrer: 'https://ref.example/', tabUrl: 'https://tab.example/', url }))
      .toBe('https://ref.example/')
    expect(deriveSourceUrl({ frameUrl: 'not a url', referrer: 'https://ref.example/', tabUrl: 'https://tab.example/', url }))
      .toBe('https://ref.example/')
  })
  it('falls back to the tab URL when frame + referrer are missing/invalid', () => {
    expect(deriveSourceUrl({ frameUrl: null, referrer: null, tabUrl: 'https://tab.example/', url }))
      .toBe('https://tab.example/')
  })
  it('falls back to the request URL itself as a last resort', () => {
    expect(deriveSourceUrl({ frameUrl: null, referrer: null, tabUrl: null, url })).toBe(url)
  })
  it('rejects a ws(s) frame/referrer/tab URL — only http(s) counts as a source document', () => {
    expect(deriveSourceUrl({ frameUrl: 'wss://x.example/', referrer: null, tabUrl: null, url })).toBe(url)
  })
})

describe('magic-guard · request policy (decideRequest)', () => {
  let blockingEngine: Engine
  let emptyEngine: Engine

  beforeEach(() => {
    blockingEngine = buildEngineFromTexts(['||ads.example.com^'])
    emptyEngine = buildEngineFromTexts([''])
  })

  const base = {
    url: 'https://ads.example.com/tracker.js',
    sourceUrl: 'https://publisher.com/',
    resourceType: 'script' as ElectronResourceType,
    method: 'GET',
  }

  it('blocks a matching subresource when enabled and not excepted', () => {
    expect(decideRequest({ ...base, engine: blockingEngine, enabled: true, siteEnabled: true })).toEqual({ cancel: true })
  })
  it('allows a non-matching subresource', () => {
    expect(decideRequest({ ...base, engine: emptyEngine, enabled: true, siteEnabled: true })).toEqual({ cancel: false })
  })
  it('allows everything when globally disabled, even a matching rule', () => {
    expect(decideRequest({ ...base, engine: blockingEngine, enabled: false, siteEnabled: true })).toEqual({ cancel: false })
  })
  it('allows everything when the site is excepted, even a matching rule', () => {
    expect(decideRequest({ ...base, engine: blockingEngine, enabled: true, siteEnabled: false })).toEqual({ cancel: false })
  })
  it('bypasses mainFrame requests in v1, even a matching rule', () => {
    expect(decideRequest({ ...base, resourceType: 'mainFrame', engine: blockingEngine, enabled: true, siteEnabled: true })).toEqual({ cancel: false })
  })
  it('allows non-http(s)/ws schemes outright (e.g. chrome-extension:, data:, blob:)', () => {
    expect(decideRequest({ ...base, url: 'data:text/plain,hi', engine: blockingEngine, enabled: true, siteEnabled: true })).toEqual({ cancel: false })
  })
  it('fails open when the engine has not loaded yet (null)', () => {
    expect(decideRequest({ ...base, engine: null, enabled: true, siteEnabled: true })).toEqual({ cancel: false })
  })
  it('fails open when the engine throws (malformed input / internal error)', () => {
    const throwingEngine = { check: () => { throw new Error('boom') } } as unknown as Engine
    expect(decideRequest({ ...base, engine: throwingEngine, enabled: true, siteEnabled: true })).toEqual({ cancel: false })
  })
})

describe('magic-guard · engine lifecycle', () => {
  it('falls back to degraded (fail-open) when the bundled lists cannot be found, without throwing', async () => {
    await expect(initMagicGuardEngine()).resolves.toBeUndefined()
    const state = getMagicGuardState('example.com')
    expect(state.status).toBe('degraded')
    expect(state.effectiveEnabled).toBe(false)
    expect(state.error).toBeTruthy()
  })
})

describe('magic-guard · site exceptions + hostname canonicalization', () => {
  it('exact hostname matching: excepting a site does not affect another', () => {
    expect(isSiteExcepted('dapp.example')).toBe(false)
    setMagicGuardForSite('dapp.example', false) // protect:false = except
    expect(isSiteExcepted('dapp.example')).toBe(true)
    expect(isSiteExcepted('other.example')).toBe(false)
    setMagicGuardForSite('dapp.example', true) // protect:true = un-except
    expect(isSiteExcepted('dapp.example')).toBe(false)
  })
  it('canonicalizes hostnames from full URLs (no path/query/port leak)', () => {
    expect(hostnameFromUrl('https://DAPP.example:8443/path?x=1')).toBe('dapp.example')
    expect(hostnameFromUrl('not a url')).toBeNull()
    expect(hostnameFromUrl(null)).toBeNull()
  })
})

describe('magic-guard · global enable/disable', () => {
  it('persists the global toggle and reflects it in state', () => {
    const off = setMagicGuardEnabled(false, null)
    expect(off.enabled).toBe(false)
    expect(off.status).toBe('disabled')
    const on = setMagicGuardEnabled(true, null)
    expect(on.enabled).toBe(true)
  })
})

describe('magic-guard · per-tab / per-page counters', () => {
  it('counts blocked requests, resets the page counter without touching the tab counter, and isolates tabs', () => {
    registerTab(101)
    registerTab(202)

    noteBlocked(101); noteBlocked(101); noteBlocked(101)
    expect(getCounts(101)).toEqual({ page: 3, tab: 3 })
    expect(getCounts(202)).toEqual({ page: 0, tab: 0 }) // isolation: tab 202 untouched

    resetPageCounter(101)
    expect(getCounts(101)).toEqual({ page: 0, tab: 3 }) // page resets, tab persists

    noteBlocked(202)
    expect(getCounts(202)).toEqual({ page: 1, tab: 1 })

    unregisterTab(101)
    expect(getCounts(101)).toEqual({ page: 0, tab: 0 }) // closed tab reports zero, not stale counts
  })
  it('an unregistered/unknown webContents id always reports zero', () => {
    expect(getCounts(999999)).toEqual({ page: 0, tab: 0 })
    expect(getCounts(null)).toEqual({ page: 0, tab: 0 })
  })
})
