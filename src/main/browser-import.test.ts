/**
 * browser-import.test.ts — CSV password-export parsing
 *
 * The profile/DPAPI import paths need a real OS user and another browser's
 * files, so they stay manual; the CSV parser is pure and is covered here
 * against the real export shapes of the mainstream password managers.
 */
import { describe, it, expect, vi } from 'vitest'

// browser-import touches Electron only for app.getPath — stub it so the pure
// CSV paths run under plain Node (same pattern as magic-guard.test.ts).
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

import { parseCsv, parsePasswordCsv } from './browser-import'

describe('parseCsv', () => {
  it('splits simple rows', () => {
    expect(parseCsv('a,b,c\nd,e,f')).toEqual([['a', 'b', 'c'], ['d', 'e', 'f']])
  })

  it('handles quoted fields with commas, doubled quotes, and embedded newlines', () => {
    expect(parseCsv('"a,1","say ""hi""","line1\nline2"')).toEqual([['a,1', 'say "hi"', 'line1\nline2']])
  })

  it('handles CRLF and skips trailing blank lines', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([['a', 'b'], ['c', 'd']])
  })
})

describe('parsePasswordCsv', () => {
  it('parses a Chrome/Edge/Brave export', () => {
    const csv = 'name,url,username,password,note\nGH,https://github.com,alice,s3cret,\n'
    const r = parsePasswordCsv(csv)
    expect(r.error).toBeUndefined()
    expect(r.logins).toEqual([{ url: 'https://github.com', username: 'alice', password: 's3cret' }])
  })

  it('parses a Bitwarden export (login_uri/login_username/login_password)', () => {
    const csv = 'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n' +
      ',,login,GitHub,,,0,https://github.com,bob,pw123,\n'
    const r = parsePasswordCsv(csv)
    expect(r.logins).toEqual([{ url: 'https://github.com', username: 'bob', password: 'pw123' }])
  })

  it('falls back to positional url,username,password without a header', () => {
    const r = parsePasswordCsv('https://x.com,carol,pw\nhttps://y.com,dave,pw2')
    expect(r.logins).toHaveLength(2)
    expect(r.logins[1]).toEqual({ url: 'https://y.com', username: 'dave', password: 'pw2' })
  })

  it('strips a UTF-8 BOM before reading the header', () => {
    const r = parsePasswordCsv('﻿url,username,password\nhttps://z.com,e,pw')
    expect(r.logins).toEqual([{ url: 'https://z.com', username: 'e', password: 'pw' }])
  })

  it('skips rows missing a URL or password and counts them', () => {
    const r = parsePasswordCsv('url,username,password\nhttps://a.com,u,\n,u2,pw\nhttps://b.com,u3,pw3')
    expect(r.logins).toHaveLength(1)
    expect(r.skipped).toBe(2)
  })

  it('reports an error for an empty/unusable file', () => {
    expect(parsePasswordCsv('').error).toBeTruthy()
    expect(parsePasswordCsv('name,notes\nfoo,bar').error).toBeTruthy()
  })

  it('keeps quoted passwords containing commas and quotes intact', () => {
    const r = parsePasswordCsv('url,username,password\nhttps://a.com,u,"p,w""x"')
    expect(r.logins[0].password).toBe('p,w"x')
  })
})
