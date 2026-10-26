import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bech32 } from '@scure/base'
import { blake2b } from '@noble/hashes/blake2b'
import { CIP113_MAINNET, CIP113_REGISTRY_ADDRESS, decodeCip113Protocol, decodeCip113Registry,
  deriveCip113OwnerAddresses, collectCip113Holdings, cip113HistoryEvents, discoverCip113Holdings, type Cip113Read } from './cardano-programmable'
const fixture = (name: string): any[] => JSON.parse(readFileSync(new URL(`./__fixtures__/cip113/${name}.json`, import.meta.url), 'utf8'))
const registry = fixture('registry'), params = fixture('params'), holding = fixture('holding'), transactions = fixture('history-tx'), statuses = fixture('tx-cbor')
const checkedTransactions = transactions.map(row => ({ ...row, valid_contract: statuses.find(s => s.tx_hash === row.tx_hash)?.valid_contract }))
const unit = holding[0].asset_list[0].policy_id + holding[0].asset_list[0].asset_name
const decodedHolder = Uint8Array.from(bech32.fromWords(bech32.decode(holding[0].address, 200).words))
// Synthetic public address for testing credential derivation, not a claim of private-key ownership.
const wallet = bech32.encode('addr', bech32.toWords(new Uint8Array([1, ...new Uint8Array(28).fill(17), ...decodedHolder.slice(29)])), 200)
const owners = deriveCip113OwnerAddresses(wallet)
const proof = decodeCip113Registry(registry), protocol = decodeCip113Protocol(params)
const cloned = <T>(v: T): T => structuredClone(v)

describe('CIP-113 canonical read-only discovery', () => {
  it('decodes authenticated live-capture protocol and complete registry schema', () => {
    expect(protocol.matchesPublishedWiring).toBe(true)
    expect(protocol.outputReference).toBe(`${CIP113_MAINNET.deploymentId}#0`)
    expect(protocol.upgradeAuthority.hash).toBe(CIP113_MAINNET.upgrade)
    expect(proof.size).toBe(3)
    expect(proof.get(unit.slice(0, 56))?.transfer.hash).toBe('62b98b0894870aadfba1a7fd1b368c56aa91caa2701fb7e92a3f1bf1')
  })
  it('derives both key conventions without deriving or exposing private keys', () => {
    expect(owners.map(o => o.credentialSource)).toEqual(['payment-key', 'stake-key'])
    expect(owners[1].address).toBe(holding[0].address)
    for (const owner of owners) {
      const data = Uint8Array.from(bech32.fromWords(bech32.decode(owner.address as any, 200).words))
      expect(data[0]).toBe(0x11)
    }
    expect(() => deriveCip113OwnerAddresses('addr_test1bad')).toThrow()
  })
  it('checks account ownership and exact quantities, without guessing restrictions', () => {
    const result = collectCip113Holdings(holding, owners, proof, protocol, 123)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ unit, rawBalance: '1', details: { availableRawBalance: null,
      deploymentId: CIP113_MAINNET.deploymentId, restrictions: { state: 'unknown' } } })
    const big = cloned(holding); big[0].asset_list[0].quantity = '123456789012345678901234567890'
    expect(collectCip113Holdings(big, owners, proof, protocol, 123)[0].rawBalance).toBe('123456789012345678901234567890')
    expect(() => collectCip113Holdings(holding, [owners[0]], proof, protocol, 123)).toThrow(/ownership/)
  })
  it('rejects missing/disconnected registry nodes and spoofed marker NFTs', () => {
    expect(() => decodeCip113Registry(registry.slice(1))).toThrow(/incomplete/)
    expect(() => decodeCip113Registry([...registry, registry[1]])).toThrow()
    const bad = cloned(registry); bad[1].asset_list[0].asset_name = 'ff'.repeat(28)
    expect(() => decodeCip113Registry(bad)).toThrow(/NFT/)
    const malformed = cloned(registry); malformed[0].inline_datum.bytes = 'd87980'
    expect(() => decodeCip113Registry(malformed)).toThrow()
  })
  it('rejects malformed, wrong-custody, spent and ambiguous protocol parameters', () => {
    for (const rows of [[], [...params, params[0]], [{ ...params[0], is_spent: true }], [{ ...params[0], address: CIP113_REGISTRY_ADDRESS }]]) {
      expect(() => decodeCip113Protocol(rows)).toThrow()
    }
    const changed = cloned(params)
    changed[0].inline_datum.bytes = changed[0].inline_datum.bytes.replace(CIP113_MAINNET.dispatcher, 'ab'.repeat(28))
    changed[0].datum_hash = Buffer.from(blake2b(Buffer.from(changed[0].inline_datum.bytes, 'hex'), { dkLen: 32 })).toString('hex')
    expect(decodeCip113Protocol(changed).matchesPublishedWiring).toBe(false)
    const tampered = cloned(params); tampered[0].datum_hash = '00'.repeat(32)
    expect(() => decodeCip113Protocol(tampered)).toThrow(/datum hash/)
  })
  it('cannot double-count duplicated outputs/assets or accept malformed quantities', () => {
    expect(() => collectCip113Holdings([...holding, holding[0]], owners, proof, protocol, 1)).toThrow(/Duplicate/)
    const duplicate = cloned(holding); duplicate[0].asset_list.push(duplicate[0].asset_list[0])
    expect(() => collectCip113Holdings(duplicate, owners, proof, protocol, 1)).toThrow(/Duplicate/)
    const bad = cloned(holding); bad[0].asset_list[0].quantity = '-1'
    expect(() => collectCip113Holdings(bad, owners, proof, protocol, 1)).toThrow(/quantity/)
  })
  it('attributes only observed token balance changes, never user/issuer intent', () => {
    const events = cip113HistoryEvents(checkedTransactions, unit, owners)
    expect(events).toMatchObject([{ netRawQuantity: '1', change: 'increase', trigger: 'unknown' }])
    expect(cip113HistoryEvents(checkedTransactions, 'aa'.repeat(28), owners)).toEqual([])
    expect(cip113HistoryEvents([{ ...checkedTransactions[0], valid_contract: false }], unit, owners)).toEqual([])
    expect(() => cip113HistoryEvents(transactions, unit, owners)).toThrow(/unverified/)
    expect(() => cip113HistoryEvents([...checkedTransactions, checkedTransactions[0]], unit, owners)).toThrow(/duplicate/)
    const malformed = cloned(checkedTransactions); delete malformed[0].inputs
    expect(() => cip113HistoryEvents(malformed, unit, owners)).toThrow()
  })
  it('loads bounded recent token history and never invokes execution endpoints', async () => {
    const called: string[] = []
    const read: Cip113Read = async (path, body: any) => {
      called.push(path)
      if (path.startsWith('address_utxos')) return body._addresses.includes(CIP113_REGISTRY_ADDRESS) ? registry : holding
      if (path === 'asset_utxos') return params
      if (path.startsWith('address_txs')) return transactions.map(t => ({ tx_hash: t.tx_hash }))
      if (path === 'tx_info') return transactions
      if (path === 'tx_cbor') return statuses
      throw new Error('Unexpected endpoint')
    }
    const result = await discoverCip113Holdings(wallet, read)
    expect(result.error).toBeNull()
    expect(result.holdings[0].details.history).toMatchObject({ state: 'ready', value: { scope: 'token', coverage: 'recent', events: [{ trigger: 'unknown' }] } })
    expect(called.some(p => /submit|burn|mint|sign/.test(p))).toBe(false)
  })
  it('keeps holdings when history fails, but never reports a provider failure as zero assets', async () => {
    const read: Cip113Read = async (path, body: any) => {
      if (path.startsWith('address_utxos')) return body._addresses.includes(CIP113_REGISTRY_ADDRESS) ? registry : holding
      if (path === 'asset_utxos') return params
      throw new Error('history offline')
    }
    const result = await discoverCip113Holdings(wallet, read)
    expect(result.error).toBeNull()
    expect(result.holdings[0].details.history.state).toBe('error')
    expect((await discoverCip113Holdings(wallet, async () => { throw new Error('offline') })).error).toBe('offline')
  })
})
