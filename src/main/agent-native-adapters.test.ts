import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Connection, Keypair, PublicKey, SystemProgram, VersionedTransaction } from '@solana/web3.js'
import { base58 } from '@scure/base'
import { mnemonicToEntropy } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { ed25519 } from '@noble/curves/ed25519'
import { blake2b } from '@noble/hashes/blake2b'
import { getSolanaKeypair } from './wallet-core'
import { deriveCardanoAddress } from './cardano-pure'
import { solanaNativeAdapter } from './agent-native-solana'
import { cardanoNativeAdapter } from './agent-native-cardano'
import { SVM_USDC } from './x402-native-validation'
import { TOKEN_PROGRAM_ID } from './spl-transfer'
import { CborMap, decodeCbor } from './cardano-tx-inspect'
import { extractTxBody } from './cardano-cip30'
import type { NativeTransaction } from '../shared/agent-native'

const seed = 'test test test test test test test test test test test junk', network = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' as const
const recipient = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey.toBase58(), sponsor = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey.toBase58()
let solana: string, ada: string, adaTo: string
beforeAll(async () => { solana = (await getSolanaKeypair(seed, 1000)).publicKey.toBase58(); ada = deriveCardanoAddress(mnemonicToEntropy(seed, wordlist), 1000, true); adaTo = deriveCardanoAddress(new Uint8Array(16).fill(2), 0, true) })
function transaction(cardano = false, x402 = false): NativeTransaction {
  const now = Date.now(), from = cardano ? ada : solana, to = cardano ? adaTo : recipient
  const tx: NativeTransaction = { id: 'native-test', requestId: 'request-1', clientId: 'agent', clientName: 'Assistant', context: 'testnet', accountIndex: 1000,
    mode: x402 ? 'x402' : 'autonomous', policyId: 'native-policy', network: cardano ? 'cardano:preprod' : network, from, recipient: to, asset: x402 ? cardano ? 'lovelace' : SVM_USDC[network] : 'native',
    amountRaw: cardano ? '2000000' : x402 ? '10000' : '10000000', createdAt: now, expiresAt: now + 300000, state: 'prepared', plan: null, reservedAt: now, txHash: null, confirmations: 0, finalized: false, error: null }
  if (x402) tx.x402 = { nonce: 'aa'.repeat(32), resourceUrl: 'https://merchant.example.com/data', automatic: true, reasons: [], required: { x402Version: 2, resource: { url: 'https://merchant.example.com/data' },
    accepts: [{ scheme: 'exact', network: tx.network, asset: tx.asset, amount: tx.amountRaw, payTo: to, maxTimeoutSeconds: 300, extra: cardano ? {} : { feePayer: sponsor } }] } }
  return tx
}
function solSetup(x402 = false) {
  const tx = transaction(false, x402), blockhash = Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey.toBase58()
  const system = { owner: SystemProgram.programId, executable: false, data: Buffer.alloc(0), lamports: 1000000000 }
  const mint = Buffer.alloc(82); mint[44] = 6; mint[45] = 1
  const ata = (owner: string) => { const data = Buffer.alloc(165); new PublicKey(tx.asset).toBuffer().copy(data); new PublicKey(owner).toBuffer().copy(data, 32); data.writeBigUInt64LE(100000000n, 64); data[108] = 1; return { owner: TOKEN_PROGRAM_ID, executable: false, data, lamports: 2039280 } }
  const rpc = {
    getGenesisHash: vi.fn(async () => 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1'), getLatestBlockhash: vi.fn(async () => ({ blockhash, lastValidBlockHeight: 150 })),
    getFeeForMessage: vi.fn(async () => ({ value: 5000 })), getBlockHeight: vi.fn(async () => 10), isBlockhashValid: vi.fn(async () => ({ value: true })),
    getAccountInfo: vi.fn(async (key: PublicKey) => { if (!x402 || key.toBase58() === tx.from) return system; if (key.toBase58() === tx.asset) return { owner: TOKEN_PROGRAM_ID, executable: false, data: mint, lamports: 1000000 }; return ata(rpc.getAccountInfo.mock.calls.filter(([k]) => k.toBase58() !== tx.from && k.toBase58() !== tx.asset).length % 2 ? tx.from : tx.recipient) }),
    getMinimumBalanceForRentExemption: vi.fn(async () => 890880), simulateTransaction: vi.fn(async () => ({ value: { err: null } })), sendRawTransaction: vi.fn(async () => 'never-live'),
    getTransaction: vi.fn(), getSignatureStatuses: vi.fn(), getBlock: vi.fn(),
  }
  // Explicit ATA identity rather than relying on call order.
  if (x402) {
    const { PublicKey: P } = { PublicKey }
    const mintKey = new P(tx.asset)
    const source = PublicKey.findProgramAddressSync([new P(tx.from).toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintKey.toBuffer()], new P('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'))[0].toBase58()
    rpc.getAccountInfo = vi.fn(async key => key.toBase58() === tx.from ? system : key.toBase58() === tx.asset ? { owner: TOKEN_PROGRAM_ID, executable: false, data: mint, lamports: 1 } : ata(key.toBase58() === source ? tx.from : tx.recipient))
  }
  return { tx, rpc, adapter: solanaNativeAdapter(rpc as unknown as Connection, () => seed) }
}

describe('offline Solana signing adapter', () => {
  it('distinguishes two real native sends within one blockhash without changing an idempotent retry', async () => {
    const s = solSetup(); s.tx.plan = await s.adapter.build(s.tx)
    const second: NativeTransaction = { ...s.tx, id: 'native-other-wallet-generated-id', requestId: 'request-2', plan: null }; second.plan = await s.adapter.build(second)
    expect((await s.adapter.sign(s.tx)).hash).not.toBe((await s.adapter.sign(second)).hash)
    expect((await s.adapter.sign(s.tx)).hash).toBe((await s.adapter.sign(s.tx)).hash)
    expect(s.tx.plan.locks).not.toEqual(second.plan!.locks)
  })
  it('rechecks current authority after provider awaits and before loading signing material', async () => {
    const s = solSetup(); s.tx.plan = await s.adapter.build(s.tx)
    const secret = vi.fn(() => seed), stopped = solanaNativeAdapter(s.rpc as unknown as Connection, secret, Date.now, () => { throw new Error('Stopped') })
    await expect(stopped.sign(s.tx)).rejects.toThrow('Stopped'); expect(secret).not.toHaveBeenCalled()
  })
  it.each([false, true])('signs only the exact native/USDC message (x402=%s), simulating without signatures', async x402 => {
    const s = solSetup(x402); s.tx.plan = await s.adapter.build(s.tx)
    const signed = await s.adapter.sign(s.tx), decoded = VersionedTransaction.deserialize(Buffer.from(signed.raw, 'base64')), index = decoded.message.staticAccountKeys.findIndex(k => k.toBase58() === s.tx.from)
    expect(ed25519.verify(decoded.signatures[index], decoded.message.serialize(), new PublicKey(s.tx.from).toBytes())).toBe(true)
    if (x402) { expect(signed.hash).toBeNull(); expect(decoded.signatures[0].every(b => b === 0)).toBe(true); expect(s.tx.plan.totalRaw).toBe('0') }
    else { expect(signed.hash).toBe(base58.encode(decoded.signatures[0])); expect(s.tx.plan.totalRaw).toBe('10005000') }
    for (const [simulated] of s.rpc.simulateTransaction.mock.calls as unknown as [VersionedTransaction][]) expect(simulated.signatures.every(sig => sig.every(b => b === 0))).toBe(true)
    expect(s.rpc.sendRawTransaction).not.toHaveBeenCalled()
  })
  it.each(['genesis', 'blockhash', 'height', 'message', 'fee', 'simulation', 'recipient'] as const)('rejects changed %s before signing', async bad => {
    const s = solSetup(); s.tx.plan = await s.adapter.build(s.tx)
    if (bad === 'genesis') s.rpc.getGenesisHash.mockResolvedValue('wrong')
    if (bad === 'blockhash') s.rpc.isBlockhashValid.mockResolvedValue({ value: false })
    if (bad === 'height') s.rpc.getBlockHeight.mockResolvedValue(151)
    if (bad === 'message') s.tx.amountRaw = '10000001'
    if (bad === 'fee') s.rpc.getFeeForMessage.mockResolvedValue({ value: 10000 })
    if (bad === 'simulation') s.rpc.simulateTransaction.mockResolvedValue({ value: { err: 'failure' as any } })
    if (bad === 'recipient') s.tx.recipient = sponsor
    await expect(s.adapter.sign(s.tx)).rejects.toThrow(); expect(s.rpc.sendRawTransaction).not.toHaveBeenCalled()
  })
})

function adaSetup(x402 = false) {
  const tx = transaction(true, x402), timestamp = Math.floor(Date.now() / 1000)
  const data = { genesis: [{ networkmagic: '1', slotlength: '1' }], tip: [{ abs_slot: 1000, block_time: timestamp, block_height: 100 }], params: { txFeePerByte: 44, txFeeFixed: 155381, utxoCostPerByte: 4310, maxTxSize: 16384 },
    utxos: [{ tx_hash: 'ab'.repeat(32), tx_index: 0, address: tx.from, value: '10000000', asset_list: [], datum_hash: null, inline_datum: null, reference_script: null, is_spent: false }] as any[], cbor: '', receipt: true }
  let submitted = 0
  const fetcher = vi.fn(async (input: any, init: any) => {
    const path = new URL(String(input)).pathname.split('/').pop(), body = init?.body
    let result: any
    if (path === 'genesis') result = data.genesis
    else if (path === 'tip') result = data.tip
    else if (path === 'cli_protocol_params') result = data.params
    else if (path === 'address_utxos') result = data.utxos
    else if (path === 'submittx') { submitted++; const raw = Buffer.from(body); data.cbor = raw.toString('hex'); result = Buffer.from(blake2b(extractTxBody(raw), { dkLen: 32 })).toString('hex') }
    else if (path === 'tx_info') result = data.receipt ? [{ tx_hash: tx.txHash, block_hash: 'cd'.repeat(32), block_height: 99, valid_contract: true }] : []
    else if (path === 'tx_cbor') result = [{ tx_hash: tx.txHash, block_hash: 'cd'.repeat(32), cbor: data.cbor, valid_contract: true }]
    else if (path === 'block_info') result = [{ hash: 'cd'.repeat(32), block_height: 99 }]
    else throw new Error('Unexpected offline Cardano path')
    return new Response(JSON.stringify(result), { status: 200 })
  })
  return { tx, data, fetcher, adapter: cardanoNativeAdapter(() => seed, Date.now, fetcher as typeof fetch), submitted: () => submitted }
}
describe('offline Cardano signing adapter', () => {
  it('rechecks current authority after provider awaits and before loading signing material', async () => {
    const s = adaSetup(); s.tx.plan = await s.adapter.build(s.tx, [])
    const secret = vi.fn(() => seed), stopped = cardanoNativeAdapter(secret, Date.now, s.fetcher as typeof fetch, () => { throw new Error('Stopped') })
    await expect(stopped.sign(s.tx)).rejects.toThrow('Stopped'); expect(secret).not.toHaveBeenCalled()
  })
  it.each([false, true])('builds exact ADA with key witness, bounded TTL, correct fee and canonical body hash (x402=%s)', async x402 => {
    const s = adaSetup(x402); s.tx.plan = await s.adapter.build(s.tx, [])
    const signed = await s.adapter.sign(s.tx), raw = Buffer.from(signed.raw, 'base64'), decoded = decodeCbor(raw) as any[], b = decoded[0] as CborMap, witnesses = (decoded[1] as CborMap).getInt(0) as Uint8Array[][]
    expect(signed.hash).toBe(s.tx.plan.txHash); expect(s.tx.plan.ttl).toBeLessThanOrEqual(1090); expect(b.size).toBe(4)
    expect(ed25519.verify(witnesses[0][1], blake2b(extractTxBody(raw), { dkLen: 32 }), witnesses[0][0])).toBe(true)
    const inputs = b.getInt(0) as any[][]; expect(Buffer.from(inputs[0][0]).toString('hex') + '#' + inputs[0][1]).toBe(s.tx.plan.locks[0])
    expect(s.submitted()).toBe(0)
    s.tx.txHash = signed.hash; expect(await s.adapter.broadcast(s.tx, signed.raw)).toBe(signed.hash)
    expect(await s.adapter.receipt(s.tx)).toEqual({ confirmations: 2, finalized: false, reverted: false })
  })
  it.each(['genesis', 'params', 'stale', 'spent', 'asset', 'datum', 'script', 'address', 'recipient', 'fee', 'ttl', 'locked', 'receipt'] as const)('rejects invalid %s evidence', async bad => {
    const s = adaSetup(); s.tx.plan = await s.adapter.build(s.tx, [])
    if (bad === 'genesis') s.data.genesis[0].networkmagic = '2'
    if (bad === 'params') s.data.params.txFeeFixed = 0
    if (bad === 'stale') s.data.tip[0].block_time -= 1000
    if (bad === 'spent') s.data.utxos[0].is_spent = true
    if (bad === 'asset') s.data.utxos[0].asset_list = [{ policy_id: 'ab', asset_name: '', quantity: '1' }]
    if (bad === 'datum') s.data.utxos[0].datum_hash = 'aa'
    if (bad === 'script') s.data.utxos[0].reference_script = {}
    if (bad === 'address') s.data.utxos[0].address = adaTo
    if (bad === 'recipient') s.tx.amountRaw = '2000001'
    if (bad === 'fee') s.tx.plan.feeRaw = '1'
    if (bad === 'ttl') s.tx.plan.ttl = 100000
    if (bad === 'locked') { await expect(s.adapter.build(s.tx, s.tx.plan.locks)).rejects.toThrow('inputs'); return }
    if (bad === 'receipt') { s.tx.txHash = s.tx.plan.txHash!; s.data.cbor = '00'; await expect(s.adapter.receipt(s.tx)).rejects.toThrow(); return }
    await expect(s.adapter.sign(s.tx)).rejects.toThrow(); expect(s.submitted()).toBe(0)
  })
})
