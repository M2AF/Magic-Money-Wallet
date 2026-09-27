import { describe, expect, it, vi } from 'vitest'
import { recheckGrantBeforeSigning, SITE_DISCONNECTED_MESSAGE } from './grant-recheck'
import { createAutoRevoke } from './auto-revoke'

const quiet = () => {}

/** Mirrors an ipc-handlers call site: approval done → recheck → load key → sign. */
async function signAfterApproval(reconcile: () => Promise<unknown>, hasGrant: () => boolean) {
  const loadKey = vi.fn(() => 'key')
  const sign = vi.fn((_key: string) => '0xsig')
  const run = async () => {
    await recheckGrantBeforeSigning(reconcile, hasGrant, quiet)
    return sign(loadKey())
  }
  return { run, loadKey, sign }
}

describe('desktop grant re-check before signing', () => {
  it('refuses with 4100 when reconciling fails, without consulting the stale grant or touching the key', async () => {
    const hasGrant = vi.fn(() => true)   // the stored grant would still say yes
    const { run, loadKey, sign } = await signAfterApproval(
      () => Promise.reject(new Error('disk full')), hasGrant,
    )
    await expect(run()).rejects.toMatchObject({ code: 4100, message: SITE_DISCONNECTED_MESSAGE })
    expect(hasGrant).not.toHaveBeenCalled()
    expect(loadKey).not.toHaveBeenCalled()
    expect(sign).not.toHaveBeenCalled()
  })

  it('refuses with 4100 when the site no longer holds the grant', async () => {
    const { run, loadKey } = await signAfterApproval(() => Promise.resolve(), () => false)
    await expect(run()).rejects.toMatchObject({ code: 4100, message: SITE_DISCONNECTED_MESSAGE })
    expect(loadKey).not.toHaveBeenCalled()
  })

  it('signs when reconciling succeeds and the grant is intact', async () => {
    const { run, sign } = await signAfterApproval(() => Promise.resolve(), () => true)
    await expect(run()).resolves.toBe('0xsig')
    expect(sign).toHaveBeenCalledOnce()
  })

  it('regression: with the real controller, an unreadable auto-revoke state fails closed', async () => {
    // Nothing cached (overdue() is false) and the grant store still says yes —
    // the previous helper swallowed the reconcile error and let this through.
    const autoRevoke = createAutoRevoke({
      load: () => { throw new Error('EBUSY: auto-revoke.json') },
      save: () => {},
      revokeAllOrigins: () => {},
      hasOriginGrants: () => true,
      wc: { ready: () => true, topics: () => [], disconnect: async () => {} },
      schedule: () => {},
      log: quiet,
    })
    expect(autoRevoke.overdue()).toBe(false)
    const { run, loadKey } = await signAfterApproval(() => autoRevoke.reconcile(), () => true)
    await expect(run()).rejects.toMatchObject({ code: 4100 })
    expect(loadKey).not.toHaveBeenCalled()
  })
})
