import { describe, expect, it } from 'vitest'
import {
  DAPP_CHAINS,
  grantChain,
  grantForChainLabel,
  hasChainGrant,
  normalizeApprovedOrigins,
  originList,
  revokeChain,
} from './dapp-permissions'

describe('normalizeApprovedOrigins (migration)', () => {
  it('expands a legacy string[] to every chain so existing connections survive', () => {
    const records = normalizeApprovedOrigins(['https://a.example', 'https://b.example'])
    expect(records).toHaveLength(2)
    for (const record of records) expect(record.chains).toEqual([...DAPP_CHAINS])
    expect(hasChainGrant(records, 'https://a.example', 'cardano')).toBe(true)
    expect(hasChainGrant(records, 'https://a.example', 'evm')).toBe(true)
  })

  it('reads the new per-chain shape back unchanged', () => {
    const records = normalizeApprovedOrigins([
      { origin: 'https://a.example', chains: ['cardano'], addedAt: 123 },
    ])
    expect(records).toEqual([{ origin: 'https://a.example', chains: ['cardano'], addedAt: 123 }])
    expect(hasChainGrant(records, 'https://a.example', 'cardano')).toBe(true)
    expect(hasChainGrant(records, 'https://a.example', 'evm')).toBe(false)
  })

  it('is idempotent — re-normalizing its own output changes nothing', () => {
    const once = normalizeApprovedOrigins(['https://a.example'])
    expect(normalizeApprovedOrigins(once)).toEqual(once)
    const scoped = normalizeApprovedOrigins([{ origin: 'https://b.example', chains: ['evm'], addedAt: 5 }])
    expect(normalizeApprovedOrigins(scoped)).toEqual(scoped)
  })

  it('survives a cold or corrupt store without throwing', () => {
    for (const bad of [undefined, null, {}, 'nope', 42]) {
      expect(normalizeApprovedOrigins(bad)).toEqual([])
    }
    expect(normalizeApprovedOrigins([])).toEqual([])
  })

  it('drops junk entries rather than trusting them', () => {
    const records = normalizeApprovedOrigins([
      '',                                                       // empty origin
      { origin: 'https://ok.example', chains: ['cardano'] },     // valid, no addedAt
      { origin: 'https://none.example', chains: [] },            // empty grant = revoked
      { origin: 'https://bad.example', chains: ['dogecoin'] },    // unknown chain
      { chains: ['evm'] },                                       // no origin
      null,
    ])
    expect(originList(records)).toEqual(['https://ok.example'])
    expect(records[0].addedAt).toBe(0)
  })

  it('merges a duplicated origin into one record', () => {
    const records = normalizeApprovedOrigins([
      { origin: 'https://a.example', chains: ['evm'], addedAt: 10 },
      { origin: 'https://a.example', chains: ['cardano'], addedAt: 20 },
    ])
    expect(records).toHaveLength(1)
    expect(records[0].chains.sort()).toEqual(['cardano', 'evm'])
  })
})

describe('grant and revoke', () => {
  it('adds a chain without disturbing existing grants', () => {
    let records = normalizeApprovedOrigins([])
    records = grantChain(records, 'https://a.example', 'evm')
    records = grantChain(records, 'https://a.example', 'cardano')
    expect(records).toHaveLength(1)
    expect(records[0].chains).toEqual(['evm', 'cardano'])
  })

  it('is a no-op when the grant already exists', () => {
    const first = grantChain([], 'https://a.example', 'evm')
    expect(grantChain(first, 'https://a.example', 'evm')).toBe(first)
  })

  it('revokes one chain and leaves the others connected', () => {
    let records = grantChain(grantChain([], 'https://a.example', 'evm'), 'https://a.example', 'cardano')
    records = revokeChain(records, 'https://a.example', 'evm')
    expect(hasChainGrant(records, 'https://a.example', 'evm')).toBe(false)
    expect(hasChainGrant(records, 'https://a.example', 'cardano')).toBe(true)
  })

  it('drops the origin entirely once its last chain is revoked', () => {
    const records = revokeChain(grantChain([], 'https://a.example', 'evm'), 'https://a.example', 'evm')
    expect(records).toEqual([])
  })

  it('revokes the whole origin when no chain is given', () => {
    const records = grantChain(grantChain([], 'https://a.example', 'evm'), 'https://b.example', 'cardano')
    expect(originList(revokeChain(records, 'https://a.example'))).toEqual(['https://b.example'])
  })

  it('never treats an unknown origin as granted', () => {
    const records = grantChain([], 'https://a.example', 'evm')
    expect(hasChainGrant(records, 'https://evil.example', 'evm')).toBe(false)
  })
})

describe('grantForChainLabel', () => {
  it('maps approval-sheet labels to grants', () => {
    expect(grantForChainLabel('Cardano')).toBe('cardano')
    expect(grantForChainLabel('Bitcoin')).toBe('bitcoin')
    expect(grantForChainLabel('Solana')).toBe('solana')
    expect(grantForChainLabel('Polkadot')).toBe('polkadot')
  })

  it('folds every EVM network onto the single evm grant', () => {
    // These share one address and one provider, so they share one grant.
    for (const label of ['Ethereum', 'Monad', 'Abstract', 'Robinhood Chain', 'Base']) {
      expect(grantForChainLabel(label)).toBe('evm')
    }
  })
})

describe('cross-chain isolation (the bug this shape fixes)', () => {
  it('an EVM-only connection cannot reach Cardano or Bitcoin', () => {
    const records = grantChain([], 'https://dapp.example', 'evm')
    expect(hasChainGrant(records, 'https://dapp.example', 'evm')).toBe(true)
    expect(hasChainGrant(records, 'https://dapp.example', 'cardano')).toBe(false)
    expect(hasChainGrant(records, 'https://dapp.example', 'bitcoin')).toBe(false)
  })
})
