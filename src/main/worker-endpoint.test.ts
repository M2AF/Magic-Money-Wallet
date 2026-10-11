import { describe, it, expect } from 'vitest'
import { WORKER_URL, LEGACY_WORKER_URL, WORKER_HOSTS, migrateWorkerUrl } from './worker-endpoint'

describe('worker-endpoint', () => {
  it('trusts the custom domain and keeps the legacy host for older installs', () => {
    expect(WORKER_HOSTS).toEqual(['api.magicmoney.dev', 'magicmoney-swap-proxy.guildfordking.workers.dev'])
  })

  it('migrates only the legacy default', () => {
    expect(migrateWorkerUrl(LEGACY_WORKER_URL)).toBe(WORKER_URL)
    expect(migrateWorkerUrl(`${LEGACY_WORKER_URL}/`)).toBe(WORKER_URL)
    expect(migrateWorkerUrl(WORKER_URL)).toBe(WORKER_URL)
    expect(migrateWorkerUrl('')).toBe('')
    expect(migrateWorkerUrl(undefined)).toBeUndefined()
    expect(migrateWorkerUrl('https://example.com')).toBe('https://example.com')
  })
})
