import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Desktop auto-revoke through the REAL storage path: secure-store.ts reading
 * userData/auto-revoke.json and approved-origins.json, the real controller, and
 * the real pre-signing guard. Only Electron's userData path is mocked, pointed
 * at a temp dir (same approach as secure-store.test.ts).
 */
const { tmp } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs'); const path = require('path'); const os = require('os')
  return { tmp: fs.mkdtempSync(path.join(os.tmpdir(), 'mm-autorevoke-store-')) }
})

vi.mock('electron', () => ({
  app: { getPath: () => tmp },
  safeStorage: { isEncryptionAvailable: () => false },
}))

import {
  loadAutoRevokeState, saveAutoRevokeState,
  addApprovedOrigin, clearApprovedOrigins, getApprovedOrigins, hasOriginChain,
} from './secure-store'
import { createAutoRevoke } from './auto-revoke'
import { desktopGrantActive, recheckGrantBeforeSigning, SITE_DISCONNECTED_MESSAGE } from './grant-recheck'

const SITE = 'https://evm.example'
const settingsFile = join(tmp, 'auto-revoke.json')
const quiet = () => {}

/** The desktop wiring from ipc-handlers.ts, minus Electron windows and timers. */
function desktopController() {
  return createAutoRevoke({
    load: loadAutoRevokeState,
    save: saveAutoRevokeState,
    revokeAllOrigins: () => clearApprovedOrigins(),
    hasOriginGrants: () => getApprovedOrigins().length > 0,
    wc: { ready: () => true, topics: () => [], disconnect: async () => {} },
    schedule: () => {},
    log: quiet,
  })
}

/** Approval done → guard → load key → sign, as at every ipc-handlers call site. */
async function approveAndSign() {
  const autoRevoke = desktopController()
  const loadKey = vi.fn(() => 'key')
  const run = async () => {
    await recheckGrantBeforeSigning(() => autoRevoke.reconcile(), () => hasOriginChain(SITE, 'evm'), quiet)
    return `signed-with-${loadKey()}`
  }
  return { run, loadKey }
}

beforeEach(() => {
  rmSync(settingsFile, { recursive: true, force: true })
  clearApprovedOrigins()
  addApprovedOrigin(SITE, 'evm')   // a stored grant that would authorise signing
})

describe('desktop auto-revoke settings file', () => {
  it('a missing file is Off: the stored grant still signs', async () => {
    expect(loadAutoRevokeState()).toBeNull()
    const { run, loadKey } = await approveAndSign()
    await expect(run()).resolves.toBe('signed-with-key')
    expect(loadKey).toHaveBeenCalledOnce()
  })

  it('a corrupt file is not read as Off: the request is refused before the key loads', async () => {
    // An armed countdown, truncated mid-write.
    writeFileSync(settingsFile, '{"enabled":true,"durationMinutes":1,"startedAt":17')
    expect(() => loadAutoRevokeState()).toThrow()

    const { run, loadKey } = await approveAndSign()
    await expect(run()).rejects.toMatchObject({ code: 4100, message: SITE_DISCONNECTED_MESSAGE })
    expect(loadKey).not.toHaveBeenCalled()
    expect(hasOriginChain(SITE, 'evm')).toBe(true)   // grant untouched — refused, not revoked
  })

  it('an existing file that cannot be read is refused the same way', async () => {
    // A real read failure on an existing path (EISDIR), standing in for a
    // transient lock/permission error.
    mkdirSync(settingsFile)
    expect(() => loadAutoRevokeState()).toThrow()

    const { run, loadKey } = await approveAndSign()
    await expect(run()).rejects.toMatchObject({ code: 4100 })
    expect(loadKey).not.toHaveBeenCalled()
  })

  it('once the file reads again, signing resumes (and an overdue deadline is enforced)', async () => {
    mkdirSync(settingsFile)
    await expect((await approveAndSign()).run()).rejects.toMatchObject({ code: 4100 })

    rmSync(settingsFile, { recursive: true, force: true })
    saveAutoRevokeState({ enabled: true, durationMinutes: 60, startedAt: Date.now(), pendingWc: null })
    await expect((await approveAndSign()).run()).resolves.toBe('signed-with-key')

    saveAutoRevokeState({ enabled: true, durationMinutes: 1, startedAt: Date.now() - 5 * 60_000, pendingWc: null })
    const { run, loadKey } = await approveAndSign()
    await expect(run()).rejects.toMatchObject({ code: 4100 })
    expect(loadKey).not.toHaveBeenCalled()
    expect(getApprovedOrigins()).toEqual([])   // expiry ran and revoked the grant
  })
})

describe('desktop address-only reads (eth_accounts, CIP-30 reads) during a storage failure', () => {
  /** The gate ipc-handlers.ts wraps around every dApp grant check, on a fresh controller (nothing cached). */
  function readGate() {
    const autoRevoke = desktopController()
    const enforce = vi.fn()
    const canRead = () => desktopGrantActive({
      overdue: () => autoRevoke.overdue(),
      readSettings: loadAutoRevokeState,
      hasGrant: () => hasOriginChain(SITE, 'evm'),
      enforce,
    })
    return { canRead, enforce }
  }

  it('a missing file is Off: the connected site can read its address', () => {
    expect(readGate().canRead()).toBe(true)
  })

  it('a corrupt file refuses the read, though the stored grant is intact', () => {
    writeFileSync(settingsFile, '{"enabled":true,"durationMinutes":1,"startedAt":17')
    const { canRead, enforce } = readGate()
    expect(canRead()).toBe(false)
    expect(hasOriginChain(SITE, 'evm')).toBe(true)
    expect(enforce).not.toHaveBeenCalled()   // an expiry could only fail again
  })

  it('an existing file that cannot be read refuses the read', () => {
    mkdirSync(settingsFile)
    expect(readGate().canRead()).toBe(false)
  })

  it('reads resume once the file is readable and not overdue', () => {
    mkdirSync(settingsFile)
    expect(readGate().canRead()).toBe(false)
    rmSync(settingsFile, { recursive: true, force: true })
    saveAutoRevokeState({ enabled: true, durationMinutes: 60, startedAt: Date.now(), pendingWc: null })
    expect(readGate().canRead()).toBe(true)
  })

  it('an overdue deadline in the file refuses the read before the controller has cached anything', () => {
    saveAutoRevokeState({ enabled: true, durationMinutes: 1, startedAt: Date.now() - 5 * 60_000, pendingWc: null })
    const { canRead, enforce } = readGate()
    expect(canRead()).toBe(false)
    expect(enforce).toHaveBeenCalledOnce()
  })
})
