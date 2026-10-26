/** CIP-113 v0.0.1 read-only observer. No transaction construction/signing/submission. */
import { bech32 } from '@scure/base'
import { blake2b } from '@noble/hashes/blake2b'
import { asBytes, asConstr, decodePlutusData, type PlutusData } from './cardano-plutus-data'
import type { Cip113Credential, Cip113OwnerAddress, Cip113RegistryProof, Cip113ProtocolState,
  Cip113ProgrammableDetails, Cip113HistoryEvent } from '../shared/cip113-wire'

// Foundation platform deployment record, independently observed through Koios on 2026-10-14.
// Core schema pinned to audited release 6b75ba3286b4692ca23059ff51285db357fb09c6.
export const CIP113_MAINNET = {
  deploymentId: 'bfefbd222e40d88f5d4454e92b24062533070f41a3e25c0a23383264650cdb72',
  registryPolicy: '484e733d122af44e6101988bcc47ed261a7af5c43c797e89d60e3075',
  baseScript: 'd91d08e381f8ef95ffbb3f8048f020d7361ded8f3abfdf66c25fa838',
  paramsPolicy: '3a511ec25af655c1aef31d0d9c0c6154eae7321045b1fa46fac55ecd',
  paramsName: '50726f746f636f6c506172616d73', // ProtocolParams, not an empty asset name.
  dispatcher: '46b61f0584f21481b22ea18f945e48ac4148f50fc3ade494a7762440',
  issuance: 'ed3fb7e046b4f3387e0749fb46847dbc15e85e61aaa76558f968136d',
  transfer: 'cb418959c00d6779e176fcf6227824a6ac3b5bea7a672ef66a216dae',
  thirdParty: '92e307862c5374ee78f3cfdaaa45447f7f0db6776d54fa5f8df1a85c',
  upgrade: '2ab871806b01d07fe7d93bf45ff4ce97bd156d168d7a08078ac8a517',
} as const
const KOIOS = 'https://api.koios.rest/api/v1'
const SENTINEL = 'ff'.repeat(30)
const hex = (bytes: Uint8Array) => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('')
function bytes(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value) || value.length > 32768) throw new Error('Invalid CIP-113 datum bytes')
  return Uint8Array.from(value.match(/../g)!, n => parseInt(n, 16))
}
function address(header: number, payment: string, stake?: Uint8Array): string {
  return bech32.encode('addr', bech32.toWords(new Uint8Array([header, ...bytes(payment), ...(stake ?? [])])), 200)
}
export const CIP113_REGISTRY_ADDRESS = address(0x71, CIP113_MAINNET.registryPolicy)
const PARAMS_ADDRESS = address(0x71, CIP113_MAINNET.paramsPolicy)

export function deriveCip113OwnerAddresses(walletAddress: string): Cip113OwnerAddress[] {
  const decoded = bech32.decode(walletAddress as `${string}1${string}`, 200)
  const data = Uint8Array.from(bech32.fromWords(decoded.words))
  if (decoded.prefix !== 'addr' || (data[0] & 15) !== 1) throw new Error('CIP-113 discovery supports mainnet addresses only')
  const kind = data[0] >> 4
  if ((kind !== 0 || data.length !== 57) && (kind !== 6 || data.length !== 29)) {
    throw new Error('CIP-113 discovery requires a key-owned base or enterprise address')
  }
  const candidates: Array<['payment-key' | 'stake-key', Uint8Array]> = [['payment-key', data.slice(1, 29)]]
  if (kind === 0) candidates.push(['stake-key', data.slice(29, 57)])
  const seen = new Set<string>()
  return candidates.flatMap(([credentialSource, credential]) => {
    const receive = address(0x11, CIP113_MAINNET.baseScript, credential)
    if (seen.has(receive)) return []
    seen.add(receive)
    return [{ address: receive, credentialSource, credentialHash: hex(credential) }]
  })
}

type Obj = Record<string, unknown>
function object(v: unknown): Obj { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid CIP-113 provider object'); return v as Obj }
function list(v: unknown): unknown[] { if (!Array.isArray(v)) throw new Error('Invalid CIP-113 provider list'); return v }
function string(v: unknown): string { if (typeof v !== 'string') throw new Error('Invalid CIP-113 provider string'); return v }
function integer(v: unknown): number { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new Error('Invalid CIP-113 provider integer'); return v }
function quantity(v: unknown): bigint {
  const s = string(v)
  if (!/^\d{1,78}$/.test(s)) throw new Error('Invalid CIP-113 asset quantity')
  return BigInt(s)
}
function ref(row: Obj): string {
  const hash = string(row.tx_hash)
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Invalid CIP-113 output reference')
  return `${hash}#${integer(row.tx_index)}`
}
function credential(d: PlutusData): Cip113Credential {
  const fields = asConstr(d, 'credential', undefined, 1)
  if (d.kind !== 'constr' || (d.index !== 0 && d.index !== 1)) throw new Error('Unsupported CIP-113 credential')
  const hash = hex(asBytes(fields[0], 'credential hash'))
  if ((hash.length !== 56 && !(d.index === 0 && hash === ''))) throw new Error('Invalid CIP-113 credential hash')
  return { type: d.index === 0 ? 'key' : 'script', hash }
}
function datum(row: Obj): PlutusData {
  const raw = bytes(string(object(row.inline_datum).bytes))
  if (hex(blake2b(raw, { dkLen: 32 })) !== row.datum_hash) throw new Error('CIP-113 datum hash does not match its bytes')
  return decodePlutusData(raw)
}
function hasMarker(row: Obj, policy: string, name: string): boolean {
  const markers = list(row.asset_list).map(object).filter(a => a.policy_id === policy)
  return markers.length === 1 && markers[0].asset_name === name && quantity(markers[0].quantity) === 1n
}

export function decodeCip113Protocol(rows: unknown): Cip113ProtocolState {
  const candidates = list(rows).map(object).filter(r => hasMarker(r, CIP113_MAINNET.paramsPolicy, CIP113_MAINNET.paramsName))
  if (candidates.length !== 1) throw new Error('The canonical CIP-113 protocol parameters are missing or ambiguous')
  const row = candidates[0]
  if (row.address !== PARAMS_ADDRESS || row.is_spent !== false) throw new Error('Invalid CIP-113 protocol parameter custody')
  const fields = asConstr(datum(row), 'protocol params', 0, 6)
  const current = fields.slice(0, 5).map(credential)
  if (current.some(c => c.hash.length !== 56)) throw new Error('Invalid CIP-113 protocol wiring')
  const pending = asConstr(fields[5], 'pending authority')
  const pendingIndex = fields[5].kind === 'constr' ? fields[5].index : -1
  if (!((pendingIndex === 1 && pending.length === 0) || (pendingIndex === 0 && pending.length === 1))) throw new Error('Invalid CIP-113 authority nomination')
  const nominee = pendingIndex === 0 ? credential(pending[0]) : null
  if (nominee && nominee.hash.length !== 56) throw new Error('Invalid CIP-113 pending authority')
  return {
    outputReference: ref(row), dispatcher: current[0], issuance: current[1], transferDelegate: current[2],
    thirdPartyDelegate: current[3], upgradeAuthority: current[4], pendingUpgradeAuthority: nominee,
    matchesPublishedWiring: [CIP113_MAINNET.dispatcher, CIP113_MAINNET.issuance, CIP113_MAINNET.transfer, CIP113_MAINNET.thirdParty, CIP113_MAINNET.upgrade]
      .every((expected, i) => current[i].type === 'script' && current[i].hash === expected),
  }
}

export function decodeCip113Registry(rows: unknown): Map<string, Cip113RegistryProof> {
  const nodes = new Map<string, { proof: Cip113RegistryProof; next: string }>()
  for (const row of list(rows).map(object)) {
    if (row.address !== CIP113_REGISTRY_ADDRESS || row.is_spent !== false) throw new Error('Invalid CIP-113 registry custody')
    const assets = list(row.asset_list).map(object)
    if (!assets.some(a => a.policy_id === CIP113_MAINNET.registryPolicy)) continue // Donations are not registry nodes.
    const f = asConstr(datum(row), 'registry node', 0, 7)
    const key = hex(asBytes(f[0], 'registry key'))
    const next = hex(asBytes(f[1], 'next registry key'))
    if ((key !== '' && key.length !== 56) || (next.length !== 56 && next !== SENTINEL)
      || !hasMarker(row, CIP113_MAINNET.registryPolicy, key) || nodes.has(key) || next <= key) throw new Error('Invalid CIP-113 registry NFT or ordering')
    const global = hex(asBytes(f[6], 'global state policy'))
    if (global !== '' && global.length !== 56) throw new Error('Invalid CIP-113 global state policy')
    nodes.set(key, { next, proof: { outputReference: ref(row), policyId: key,
      minting: credential(f[2]), transfer: credential(f[3]), thirdParty: credential(f[4]), unfracking: credential(f[5]), globalStatePolicy: global || null } })
  }
  let cursor = ''
  const visited = new Set<string>()
  while (cursor !== SENTINEL) {
    const node = nodes.get(cursor)
    if (!node || visited.has(cursor)) throw new Error('The CIP-113 registry response is incomplete')
    visited.add(cursor); cursor = node.next
  }
  if (visited.size !== nodes.size) throw new Error('The CIP-113 registry has disconnected entries')
  const origin = nodes.get('')!.proof
  if ([origin.minting, origin.transfer, origin.thirdParty, origin.unfracking].some(c => c.type !== 'key' || c.hash !== '') || origin.globalStatePolicy !== null) throw new Error('Invalid CIP-113 origin node')
  nodes.delete('')
  return new Map(Array.from(nodes, ([key, value]) => [key, value.proof]))
}

export interface Cip113ObservedHolding { unit: string; rawBalance: string; details: Cip113ProgrammableDetails }
export function collectCip113Holdings(
  rows: unknown, owners: Cip113OwnerAddress[], registry: Map<string, Cip113RegistryProof>, protocol: Cip113ProtocolState, checkedAt: number,
): Cip113ObservedHolding[] {
  const addresses = new Set(owners.map(o => o.address))
  const seen = new Set<string>()
  const balances = new Map<string, bigint>()
  for (const row of list(rows).map(object)) {
    if (!addresses.has(string(row.address)) || row.payment_cred !== CIP113_MAINNET.baseScript || row.is_spent !== false) throw new Error('CIP-113 holding ownership does not match the requested account')
    const outputReference = ref(row)
    if (seen.has(outputReference)) throw new Error('Duplicate CIP-113 holding output')
    seen.add(outputReference)
    const units = new Set<string>()
    for (const asset of list(row.asset_list).map(object)) {
      const policy = string(asset.policy_id), name = string(asset.asset_name)
      if (!/^[0-9a-f]{56}$/.test(policy) || !/^(?:[0-9a-f]{2}){0,32}$/.test(name)) throw new Error('Invalid CIP-113 asset identity')
      const amount = quantity(asset.quantity)
      const unit = policy + name
      if (units.has(unit)) throw new Error('Duplicate CIP-113 asset entry')
      units.add(unit)
      if (!registry.has(policy) || amount === 0n) continue
      balances.set(unit, (balances.get(unit) ?? 0n) + amount)
    }
  }
  return Array.from(balances, ([unit, balance]) => ({ unit, rawBalance: balance.toString(), details: {
    deploymentId: CIP113_MAINNET.deploymentId, network: 'mainnet', checkedAt, holdingAddresses: owners,
    registry: registry.get(unit.slice(0, 56))!, protocol, availableRawBalance: null,
    restrictions: { state: 'unknown', reason: protocol.matchesPublishedWiring
      ? 'Token-specific transfer rules and third-party powers have not been verified.' : 'The live protocol wiring differs from the published release.' },
    history: { state: 'unknown', reason: 'Recent token balance changes have not been loaded.' },
  } }))
}

export function cip113HistoryEvents(rows: unknown, unit: string, owners: Cip113OwnerAddress[]): Cip113HistoryEvent[] {
  const addresses = new Set(owners.map(o => o.address))
  const seen = new Set<string>()
  return list(rows).map(object).flatMap(row => {
    const txHash = string(row.tx_hash)
    if (!/^[0-9a-f]{64}$/.test(txHash) || seen.has(txHash)) throw new Error('Invalid or duplicate CIP-113 history transaction')
    seen.add(txHash)
    if (row.valid_contract === false) return [] // Invalid Plutus transactions do not apply ordinary inputs/outputs.
    if (row.valid_contract !== true) throw new Error('CIP-113 history transaction outcome is unverified')
    const amount = (outputs: unknown): bigint => {
      const refs = new Set<string>()
      return list(outputs).map(object).reduce((sum, out) => {
        if (!addresses.has(string(object(out.payment_addr).bech32))) return sum
        const reference = ref(out)
        if (refs.has(reference)) throw new Error('Duplicate CIP-113 history output')
        refs.add(reference)
        const units = new Set<string>()
        return sum + list(out.asset_list).map(object).reduce((n, asset) => {
          const assetUnit = string(asset.policy_id) + string(asset.asset_name)
          if (units.has(assetUnit)) throw new Error('Duplicate CIP-113 history asset')
          units.add(assetUnit)
          return assetUnit === unit ? n + quantity(asset.quantity) : n
        }, 0n)
      }, 0n)
    }
    const incoming = amount(row.outputs), outgoing = amount(row.inputs)
    if (incoming === 0n && outgoing === 0n) return []
    const net = incoming - outgoing
    return [{ txHash, blockHeight: integer(row.block_height), timestamp: integer(row.tx_timestamp), netRawQuantity: net.toString(),
      change: net > 0n ? 'increase' as const : net < 0n ? 'decrease' as const : 'unchanged' as const, trigger: 'unknown' as const }]
  }).sort((a, b) => b.blockHeight - a.blockHeight || b.txHash.localeCompare(a.txHash))
}

export type Cip113Read = (path: string, body: unknown) => Promise<unknown>
export const cip113KoiosRead: Cip113Read = async (path, body) => {
  if (!/^(?:address_utxos\?limit=1000&offset=\d+|asset_utxos|address_txs\?order=block_height.desc&limit=20|tx_info|tx_cbor)$/.test(path)) throw new Error('Unsupported CIP-113 read endpoint')
  const response = await fetch(`${KOIOS}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error(`CIP-113 provider unavailable (${response.status})`)
  const text = await response.text()
  if (text.length > 4_000_000) throw new Error('CIP-113 provider response is too large')
  return JSON.parse(text) as unknown
}
async function utxos(read: Cip113Read, addresses: string[]): Promise<unknown[]> {
  const result: unknown[] = []
  for (let page = 0; page < 10; page++) {
    const rows = list(await read(`address_utxos?limit=1000&offset=${page * 1000}`, { _addresses: addresses, _extended: true }))
    if (rows.length > 1000) throw new Error('CIP-113 pagination exceeded its requested page size')
    result.push(...rows)
    if (rows.length < 1000) return result
  }
  throw new Error('CIP-113 discovery exceeded its scan limit; holdings may be incomplete')
}
export async function discoverCip113Holdings(walletAddress: string, read: Cip113Read = cip113KoiosRead): Promise<{
  holdings: Cip113ObservedHolding[]; registryPolicies: string[]; checkedAt: number; error: string | null;
}> {
  const checkedAt = Date.now()
  try {
    const owners = deriveCip113OwnerAddresses(walletAddress)
    const [registryRows, paramsRows, ownedRows] = await Promise.all([
      utxos(read, [CIP113_REGISTRY_ADDRESS]),
      read('asset_utxos', { _asset_list: [[CIP113_MAINNET.paramsPolicy, CIP113_MAINNET.paramsName]], _extended: true }),
      utxos(read, owners.map(o => o.address)),
    ])
    const registry = decodeCip113Registry(registryRows), protocol = decodeCip113Protocol(paramsRows)
    const holdings = collectCip113Holdings(ownedRows, owners, registry, protocol, checkedAt)
    if (holdings.length) {
      try {
        const history = list(await read('address_txs?order=block_height.desc&limit=20', { _addresses: owners.map(o => o.address), _after_block_height: 0 }))
        if (!history.length) throw new Error('CIP-113 history is unavailable for known held outputs')
        const hashes = Array.from(new Set(history.map(v => string(object(v).tx_hash)))).slice(0, 20)
        if (hashes.some(h => !/^[0-9a-f]{64}$/.test(h))) throw new Error('Invalid CIP-113 history reference')
        const [transactions, statuses] = await Promise.all([
          read('tx_info', { _tx_hashes: hashes, _inputs: true, _assets: true }),
          read('tx_cbor', { _tx_hashes: hashes }),
        ])
        if (list(transactions).length !== hashes.length || list(transactions).some(t => !hashes.includes(string(object(t).tx_hash)))) throw new Error('Incomplete CIP-113 history transaction response')
        const outcomes = new Map<string, boolean>()
        for (const status of list(statuses).map(object)) {
          const hash = string(status.tx_hash)
          if (!hashes.includes(hash) || outcomes.has(hash) || typeof status.valid_contract !== 'boolean') throw new Error('Invalid CIP-113 history outcome')
          outcomes.set(hash, status.valid_contract)
        }
        if (outcomes.size !== hashes.length) throw new Error('Incomplete CIP-113 history outcomes')
        const checkedTransactions = list(transactions).map(object).map(row => ({ ...row, valid_contract: outcomes.get(string(row.tx_hash)) }))
        for (const holding of holdings) holding.details.history = { state: 'ready', checkedAt,
          value: { scope: 'token', coverage: 'recent', events: cip113HistoryEvents(checkedTransactions, holding.unit, owners) } }
      } catch {
        for (const holding of holdings) holding.details.history = { state: 'error', reason: 'Could not load recent programmable-token balance changes.' }
      }
    }
    return { holdings, registryPolicies: Array.from(registry.keys()), checkedAt, error: null }
  } catch (error) {
    return { holdings: [], registryPolicies: [], checkedAt, error: error instanceof Error ? error.message : 'CIP-113 discovery failed' }
  }
}

// Share a short-lived read between Tokens and the legacy stake-account NFT scan.
// Account-keyed, memory-only; provider failures are never cached as empty balances.
type Snapshot = Awaited<ReturnType<typeof discoverCip113Holdings>>
const snapshots = new Map<string, { promise: Promise<Snapshot>; expiresAt: number }>()
export function cachedCip113Holdings(walletAddress: string): Promise<Snapshot> {
  const held = snapshots.get(walletAddress)
  if (held && held.expiresAt > Date.now()) return held.promise
  if (snapshots.size >= 32) snapshots.delete(snapshots.keys().next().value!)
  const promise = discoverCip113Holdings(walletAddress)
  snapshots.set(walletAddress, { promise, expiresAt: Infinity })
  void promise.then(result => {
    const entry = snapshots.get(walletAddress)
    if (entry?.promise !== promise) return
    if (result.error) snapshots.delete(walletAddress)
    else entry.expiresAt = Date.now() + 5000
  })
  return promise
}
