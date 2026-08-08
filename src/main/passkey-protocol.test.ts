import { describe, it, expect } from 'vitest'
import {
  rpIdMatchesOrigin, requireSiteForRpId, defaultRpIdForOrigin,
  encodePasskeyError, passkeyError, passkeyErrorCode,
  PASSKEY_ORIGIN_MISMATCH, PASSKEY_REJECTED, PASSKEY_EXCLUDED,
} from './passkey-protocol'

// The rpId rule is the boundary that decides WHICH site's passkeys a page may
// touch. Phase 2 shipped a host-suffix check; this is the registrable-domain
// version built on a real public suffix list, and these are the cases that
// distinguish the two.
describe('rpIdMatchesOrigin · registrable domains', () => {
  it('accepts a site claiming itself', () => {
    expect(rpIdMatchesOrigin('chainlensnft.info', 'https://chainlensnft.info')).toBe(true)
    expect(rpIdMatchesOrigin('example.com', 'https://example.com')).toBe(true)
    expect(rpIdMatchesOrigin('example.com', 'https://example.com:8443')).toBe(true)
  })

  it('accepts a subdomain claiming its registrable parent', () => {
    expect(rpIdMatchesOrigin('chainlensnft.info', 'https://www.chainlensnft.info')).toBe(true)
    expect(rpIdMatchesOrigin('example.com', 'https://a.b.c.example.com')).toBe(true)
    // Any registrable-domain SUFFIX is legal, not just the apex.
    expect(rpIdMatchesOrigin('b.example.com', 'https://a.b.example.com')).toBe(true)
  })

  // ⚠ The Phase 2 hole. `co.uk` is a public suffix: a page on evil.co.uk that
  // could claim it would own every passkey minted by every other *.co.uk site.
  it('refuses a page claiming a PUBLIC SUFFIX it merely sits under', () => {
    expect(rpIdMatchesOrigin('co.uk', 'https://evil.co.uk')).toBe(false)
    expect(rpIdMatchesOrigin('com', 'https://evil.com')).toBe(false)
    expect(rpIdMatchesOrigin('info', 'https://chainlensnft.info')).toBe(false)
    expect(rpIdMatchesOrigin('org.uk', 'https://attacker.org.uk')).toBe(false)
    expect(rpIdMatchesOrigin('ac.uk', 'https://fake.ac.uk')).toBe(false)
  })

  // The PRIVATE section of the list matters just as much: github.io and
  // s3.amazonaws.com hand out subdomains to strangers.
  it('refuses a private-registry suffix (github.io, amazonaws)', () => {
    expect(rpIdMatchesOrigin('github.io', 'https://someone.github.io')).toBe(false)
    expect(rpIdMatchesOrigin('s3.amazonaws.com', 'https://bucket.s3.amazonaws.com')).toBe(false)
    // …but a site really served AT that host is still itself.
    expect(rpIdMatchesOrigin('github.io', 'https://github.io')).toBe(true)
    // …and its own subdomain remains claimable by its owner.
    expect(rpIdMatchesOrigin('someone.github.io', 'https://a.someone.github.io')).toBe(true)
  })

  it('refuses an unrelated or lookalike host', () => {
    expect(rpIdMatchesOrigin('chainlensnft.info', 'https://evil.example')).toBe(false)
    expect(rpIdMatchesOrigin('chainlensnft.info', 'https://notchainlensnft.info')).toBe(false)
    expect(rpIdMatchesOrigin('example.com', 'https://example.com.evil.test')).toBe(false)
    // A suffix match must be on a LABEL boundary.
    expect(rpIdMatchesOrigin('ample.com', 'https://example.com')).toBe(false)
  })

  it('requires a secure origin, with loopback the documented exception', () => {
    expect(rpIdMatchesOrigin('chainlensnft.info', 'http://chainlensnft.info')).toBe(false)
    expect(rpIdMatchesOrigin('localhost', 'http://localhost:5183')).toBe(true)
    expect(rpIdMatchesOrigin('localhost', 'https://localhost')).toBe(true)
    expect(rpIdMatchesOrigin('127.0.0.1', 'http://127.0.0.1:8080')).toBe(true)
    // Capacitor serves the wallet's own WebView from https://localhost.
    expect(rpIdMatchesOrigin('localhost', 'https://localhost/index.html')).toBe(true)
  })

  it('is case-insensitive and rejects junk', () => {
    expect(rpIdMatchesOrigin('ChainLensNFT.info', 'https://WWW.CHAINLENSNFT.INFO')).toBe(true)
    expect(rpIdMatchesOrigin('', 'https://chainlensnft.info')).toBe(false)
    expect(rpIdMatchesOrigin('chainlensnft.info', '')).toBe(false)
    expect(rpIdMatchesOrigin('chainlensnft.info', 'not a url')).toBe(false)
    expect(rpIdMatchesOrigin('chainlensnft.info', 'file:///tmp/x.html')).toBe(false)
    expect(rpIdMatchesOrigin('chainlensnft.info', 'chrome-extension://abc/page.html')).toBe(false)
    expect(rpIdMatchesOrigin(undefined as unknown as string, 'https://x.test')).toBe(false)
  })
})

describe('requireSiteForRpId', () => {
  it('returns the host actually being shown, port included', () => {
    expect(requireSiteForRpId('chainlensnft.info', 'https://www.chainlensnft.info')).toBe('www.chainlensnft.info')
    expect(requireSiteForRpId('localhost', 'http://localhost:5183')).toBe('localhost:5183')
  })

  it('throws a coded mismatch rather than returning something wrong', () => {
    expect(() => requireSiteForRpId('co.uk', 'https://evil.co.uk'))
      .toThrow(expect.objectContaining({ code: PASSKEY_ORIGIN_MISMATCH }))
  })
})

describe('defaultRpIdForOrigin', () => {
  // Per spec the default is the origin's EFFECTIVE DOMAIN — the whole host, not
  // its registrable domain. Defaulting to the apex would silently widen a
  // credential's scope beyond the page that asked for it.
  it('is the full host, not the registrable domain', () => {
    expect(defaultRpIdForOrigin('https://www.chainlensnft.info')).toBe('www.chainlensnft.info')
    expect(defaultRpIdForOrigin('https://a.b.example.com:8443')).toBe('a.b.example.com')
    expect(defaultRpIdForOrigin('http://localhost:5183')).toBe('localhost')
  })

  it('always satisfies the rule it feeds', () => {
    for (const origin of ['https://www.chainlensnft.info', 'https://a.b.example.com', 'http://localhost:5183']) {
      expect(rpIdMatchesOrigin(defaultRpIdForOrigin(origin), origin)).toBe(true)
    }
  })
})

describe('encodePasskeyError', () => {
  it('carries a coded error and its message across the wire', () => {
    expect(encodePasskeyError(passkeyError(PASSKEY_EXCLUDED, 'You already have one.')))
      .toBe('MMPK:PASSKEY_EXCLUDED:You already have one.')
  })

  // ⚠ "Wallet is locked" is a true sentence we must not hand to an arbitrary
  // site, and neither is an internal stack. Only CODED errors keep their text.
  it('replaces an uncoded message with a generic refusal', () => {
    for (const e of [
      new Error('Wallet is locked — please unlock first'),
      new TypeError('challenge must be a base64url string'),
      'something odd',
    ]) {
      const encoded = encodePasskeyError(e)
      expect(encoded).toBe(`MMPK:${PASSKEY_REJECTED}:The operation either timed out or was not allowed.`)
      expect(encoded).not.toMatch(/locked|base64url|odd/i)
    }
  })

  it('round-trips through passkeyErrorCode', () => {
    expect(passkeyErrorCode(passkeyError(PASSKEY_EXCLUDED, 'x'))).toBe(PASSKEY_EXCLUDED)
    expect(passkeyErrorCode(new Error('plain'))).toBe('')
    expect(passkeyErrorCode(null)).toBe('')
  })
})
