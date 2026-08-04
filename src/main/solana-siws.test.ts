import { describe, expect, it } from 'vitest'
import {
  buildSiwsMessage, checkSiwsDomain, formatSiws, parseSiwsMessage, siwsWarnings,
} from './solana-siws'

const ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'

describe('checkSiwsDomain — the phishing check', () => {
  it('accepts an exact match', () => {
    expect(checkSiwsDomain('jup.ag', 'https://jup.ag').ok).toBe(true)
  })

  it('accepts a subdomain asking to sign in to its parent', () => {
    // app.foo.com signing you in to foo.com is normal.
    expect(checkSiwsDomain('foo.com', 'https://app.foo.com').ok).toBe(true)
    expect(checkSiwsDomain('app.foo.com', 'https://foo.com').ok).toBe(true)
  })

  it('REJECTS a site claiming a domain it is not', () => {
    const check = checkSiwsDomain('jup.ag', 'https://jup-ag-airdrop.xyz')
    expect(check.ok).toBe(false)
    expect(check.warning).toContain('jup-ag-airdrop.xyz')
    expect(check.warning).toContain('jup.ag')
    expect(check.warning).toMatch(/phishing/i)
  })

  it('is not fooled by a domain that merely contains the real one', () => {
    // evil-jup.ag.attacker.com must NOT pass as jup.ag.
    expect(checkSiwsDomain('jup.ag', 'https://jup.ag.attacker.com').ok).toBe(false)
    expect(checkSiwsDomain('jup.ag', 'https://notjup.ag').ok).toBe(false)
  })

  it('normalises a claimed domain given as a full URL or with a port', () => {
    expect(checkSiwsDomain('https://foo.com/path', 'https://foo.com').ok).toBe(true)
    expect(checkSiwsDomain('foo.com:443', 'https://foo.com:443').ok).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(checkSiwsDomain('FOO.com', 'https://foo.COM').ok).toBe(true)
  })

  it('binds to the real origin when no domain is claimed', () => {
    const check = checkSiwsDomain(undefined, 'https://foo.com')
    expect(check.ok).toBe(true)
    expect(check.originHost).toBe('foo.com')
  })
})

describe('buildSiwsMessage', () => {
  it('produces the spec field order so dApp verification succeeds', () => {
    const msg = buildSiwsMessage({
      domain: 'jup.ag',
      statement: 'Sign in to Jupiter',
      uri: 'https://jup.ag',
      version: '1',
      chainId: 'mainnet',
      nonce: 'abc123',
      issuedAt: '2026-08-03T12:00:00.000Z',
    }, ADDRESS)

    expect(msg).toBe([
      'jup.ag wants you to sign in with your Solana account:',
      ADDRESS,
      '',
      'Sign in to Jupiter',
      '',
      'URI: https://jup.ag',
      'Version: 1',
      'Chain ID: mainnet',
      'Nonce: abc123',
      'Issued At: 2026-08-03T12:00:00.000Z',
    ].join('\n'))
  })

  it('omits absent optional fields entirely rather than emitting blanks', () => {
    const msg = buildSiwsMessage({ domain: 'foo.com' }, ADDRESS)
    expect(msg).toBe(`foo.com wants you to sign in with your Solana account:\n${ADDRESS}`)
    expect(msg).not.toContain('URI:')
    expect(msg).not.toContain('Nonce:')
  })

  it('prefers an explicitly supplied address over the wallet default', () => {
    const other = 'So11111111111111111111111111111111111111112'
    expect(buildSiwsMessage({ domain: 'a.com', address: other }, ADDRESS)).toContain(other)
  })

  it('renders resources as a bulleted list', () => {
    const msg = buildSiwsMessage({
      domain: 'a.com', resources: ['https://a.com/tos', 'https://a.com/privacy'],
    }, ADDRESS)
    expect(msg).toContain('Resources:\n- https://a.com/tos\n- https://a.com/privacy')
  })
})

describe('siwsWarnings', () => {
  it('surfaces a domain mismatch', () => {
    const check = checkSiwsDomain('jup.ag', 'https://evil.xyz')
    expect(siwsWarnings({ domain: 'jup.ag', nonce: 'n' }, check).some(w => /phishing/i.test(w))).toBe(true)
  })

  it('warns when the request has already expired', () => {
    const check = checkSiwsDomain('a.com', 'https://a.com')
    const w = siwsWarnings({ domain: 'a.com', nonce: 'n', expirationTime: '2020-01-01T00:00:00.000Z' }, check)
    expect(w).toContain('This sign-in request has already expired')
  })

  it('does not warn about a future expiry', () => {
    const check = checkSiwsDomain('a.com', 'https://a.com')
    const future = new Date(Date.now() + 3_600_000).toISOString()
    const w = siwsWarnings({ domain: 'a.com', nonce: 'n', expirationTime: future }, check)
    expect(w.some(x => x.includes('expired'))).toBe(false)
  })

  it('warns about a missing nonce, which allows replay', () => {
    const check = checkSiwsDomain('a.com', 'https://a.com')
    expect(siwsWarnings({ domain: 'a.com' }, check).some(w => /reused/.test(w))).toBe(true)
  })

  it('is silent for a well-formed request', () => {
    const check = checkSiwsDomain('a.com', 'https://a.com')
    expect(siwsWarnings({ domain: 'a.com', nonce: 'xyz' }, check)).toEqual([])
  })
})

describe('formatSiws', () => {
  it('shows the fields a user needs to judge the request', () => {
    const check = checkSiwsDomain('jup.ag', 'https://jup.ag')
    const text = formatSiws({
      domain: 'jup.ag', statement: 'Sign in to Jupiter', uri: 'https://jup.ag', nonce: 'abc',
    }, ADDRESS, check)
    expect(text).toContain('jup.ag')
    expect(text).toContain(ADDRESS)
    expect(text).toContain('Sign in to Jupiter')
    expect(text).toContain('abc')
    // Reassurance that matters: a sign-in is not a transfer.
    expect(text).toContain('cannot move funds')
  })
})

describe('parseSiwsMessage — SIWS arriving through plain signMessage', () => {
  // Captured verbatim from Magic Eden in the in-app browser. Most dApps
  // authenticate this way rather than via the solana:signIn feature, so the
  // phishing check has to work on this shape too.
  const MAGIC_EDEN = [
    'magiceden.io wants you to sign in with your Solana account:',
    '3noTuHnQdHkat2w5rBx18vAACMzFUvB5LodEe5vMN98d',
    '',
    'Welcome to Magic Eden. Signing is the only way we can truly know that you are the owner of the wallet you are connecting. Signing is a safe, gas-less transaction that does not in any way give Magic Eden permission to perform any transactions with your wallet.',
    '',
    'URI: https://magiceden.io/',
    'Version: 1',
    'Nonce: c5c80c5738e4492bafbdabe05b30a38e',
    'Issued At: 2026-08-04T01:53:57.145Z',
  ].join('\n')

  it('extracts the domain and fields from a real dApp message', () => {
    const parsed = parseSiwsMessage(MAGIC_EDEN)
    expect(parsed).not.toBeNull()
    expect(parsed!.domain).toBe('magiceden.io')
    expect(parsed!.address).toBe('3noTuHnQdHkat2w5rBx18vAACMzFUvB5LodEe5vMN98d')
    expect(parsed!.uri).toBe('https://magiceden.io/')
    expect(parsed!.nonce).toBe('c5c80c5738e4492bafbdabe05b30a38e')
    expect(parsed!.issuedAt).toBe('2026-08-04T01:53:57.145Z')
    expect(parsed!.statement).toContain('Welcome to Magic Eden')
  })

  it('stays silent when the real origin matches', () => {
    const parsed = parseSiwsMessage(MAGIC_EDEN)!
    expect(siwsWarnings(parsed, checkSiwsDomain(parsed.domain, 'https://magiceden.io'))).toEqual([])
  })

  it('CATCHES a phishing site replaying the identical message', () => {
    // Byte-for-byte the same text, served from somewhere else.
    const parsed = parseSiwsMessage(MAGIC_EDEN)!
    const w = siwsWarnings(parsed, checkSiwsDomain(parsed.domain, 'https://magiceden-mint.xyz'))
    expect(w.some(x => /phishing/i.test(x))).toBe(true)
    expect(w.some(x => x.includes('magiceden-mint.xyz'))).toBe(true)
  })

  it('returns null for an ordinary message so normal signing is unaffected', () => {
    expect(parseSiwsMessage('Please confirm your order #123')).toBeNull()
    expect(parseSiwsMessage('')).toBeNull()
    expect(parseSiwsMessage('foo.com wants you to sign in with your Ethereum account:')).toBeNull()
  })
})
