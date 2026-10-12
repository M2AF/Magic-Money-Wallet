import { describe, it, expect } from 'vitest'
import { WORKER_URL, LEGACY_WORKER_URL, WORKER_HOSTS, migrateWorkerUrl, midnightEndpoints } from './worker-endpoint'

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

  it('routes Midnight mainnet through the Worker proxy without exposing a key', () => {
    const e = midnightEndpoints('mainnet')
    expect(e).toEqual({
      indexerHttp: 'https://api.magicmoney.dev/midnight/indexer?mm_client=magicmoney-wallet-v1',
      indexerWs: 'wss://api.magicmoney.dev/midnight/indexer/ws?mm_client=magicmoney-wallet-v1',
      nodeRpc: 'https://api.magicmoney.dev/midnight/rpc?mm_client=magicmoney-wallet-v1',
      nodeRpcWs: 'wss://api.magicmoney.dev/midnight/rpc/ws?mm_client=magicmoney-wallet-v1',
    })
    expect(JSON.stringify(e)).not.toMatch(/project_id|nightmainnet|midnight.network/)
  })
})
