/** Direct key-address ADA only; pure-ADA inputs, exact outputs and finite TTL. */
import { blake2b } from '@noble/hashes/blake2b'
import { ed25519 } from '@noble/curves/ed25519'
import { mnemonicToEntropy } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { cborArray, cborBytes, cborMap, cborUint, extractTxBody } from './cardano-cip30'
import { cardanoSign, getCardanoSpendingKey, decodeCardanoAddress, minAdaForOutput, type CardanoUtxo } from './cardano-pure'
import { CborMap, decodeCbor } from './cardano-tx-inspect'
import type { NativePlan, NativeTransaction } from '../shared/agent-native'
import { nativeAddress } from './x402-native-validation'

interface ChainState { utxos: CardanoUtxo[]; slot: number; time: number; height: number; feeA: bigint; feeB: bigint; coins: bigint; maxSize: number }
const hash = (bytes: Uint8Array) => Buffer.from(blake2b(bytes, { dkLen: 32 })).toString('hex')
const ref = (u: CardanoUtxo) => `${u.txHash}#${u.txIndex}`
function body(tx: NativeTransaction, inputs: CardanoUtxo[], fee: bigint, ttl: number, coins: bigint) {
  const to = decodeCardanoAddress(tx.recipient), from = decodeCardanoAddress(tx.from), amount = BigInt(tx.amountRaw)
  const change = inputs.reduce((n, u) => n + u.lovelace, 0n) - amount - fee
  if (amount < minAdaForOutput(to, [], coins) || change < 0n || (change > 0n && change < minAdaForOutput(from, [], coins))) throw new Error('Exact ADA payment/change is below minimum ADA.')
  const output = (address: Uint8Array, value: bigint) => cborArray([cborBytes(address), cborUint(value)])
  return cborMap([[cborUint(0), cborArray(inputs.map(u => cborArray([cborBytes(Buffer.from(u.txHash, 'hex')), cborUint(u.txIndex)])))],
    [cborUint(1), cborArray([output(to, amount), ...(change ? [output(from, change)] : [])])], [cborUint(2), cborUint(fee)], [cborUint(3), cborUint(ttl)]])
}
const envelope = (txBody: Uint8Array, pub: Uint8Array = new Uint8Array(32), signature: Uint8Array = new Uint8Array(64)) =>
  cborArray([txBody, cborMap([[cborUint(0), cborArray([cborArray([cborBytes(pub), cborBytes(signature)])])]]), new Uint8Array([0xf5]), new Uint8Array([0xf6])])

export function cardanoNativeAdapter(mnemonic: () => string, now = Date.now, fetcher: typeof fetch = fetch, assertAuthority: () => void = () => {}) {
  const base = (tx: NativeTransaction) => tx.network === 'cardano:mainnet' ? 'https://api.koios.rest/api/v1' : 'https://preprod.koios.rest/api/v1'
  async function json(tx: NativeTransaction, path: string, data?: unknown): Promise<any> {
    const r = await fetcher(`${base(tx)}${path}`, { method: data ? 'POST' : 'GET', headers: { accept: 'application/json', ...(data ? { 'Content-Type': 'application/json' } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(12000) })
    if (!r.ok) throw new Error('Cardano provider unavailable.')
    return r.json()
  }
  async function state(tx: NativeTransaction): Promise<ChainState> {
    nativeAddress(tx.from, tx.network); nativeAddress(tx.recipient, tx.network)
    const [genesis, tip, params, rows] = await Promise.all([json(tx, '/genesis'), json(tx, '/tip'), json(tx, '/cli_protocol_params'), json(tx, '/address_utxos', { _addresses: [tx.from], _extended: true })])
    if (String(genesis?.[0]?.networkmagic) !== (tx.network === 'cardano:mainnet' ? '764824073' : '1') || String(genesis?.[0]?.slotlength) !== '1') throw new Error('Cardano genesis mismatch.')
    const t = tip?.[0]
    if (!t || ![t.abs_slot, t.block_time, t.block_height].every(Number.isSafeInteger) || Math.abs(now() / 1000 - t.block_time) > 120) throw new Error('Cardano chain tip is stale.')
    for (const n of [params.txFeePerByte, params.txFeeFixed, params.utxoCostPerByte, params.maxTxSize]) if (!Number.isSafeInteger(n) || n <= 0) throw new Error('Live Cardano protocol parameters required.')
    if (!Array.isArray(rows) || rows.length > 1000) throw new Error('Invalid Cardano UTXO response.')
    const utxos: CardanoUtxo[] = []
    const refs = new Set<string>()
    for (const u of rows) {
      if (!/^[0-9a-f]{64}$/.test(u.tx_hash) || !Number.isSafeInteger(u.tx_index) || u.tx_index < 0 || !/^[1-9][0-9]{0,19}$/.test(u.value) || !Array.isArray(u.asset_list)
        || u.address !== tx.from || u.is_spent !== false || !Object.hasOwn(u, 'datum_hash') || !Object.hasOwn(u, 'inline_datum') || !Object.hasOwn(u, 'reference_script')) throw new Error('Incomplete Cardano input data.')
      const id = `${u.tx_hash}#${u.tx_index}`
      if (refs.has(id)) throw new Error('Duplicate Cardano UTXO.'); refs.add(id)
      // Assets/datums/reference scripts cannot silently become spendable ADA.
      if (u.asset_list.length || u.datum_hash || u.inline_datum || u.reference_script) continue
      utxos.push({ txHash: u.tx_hash, txIndex: u.tx_index, lovelace: BigInt(u.value), assets: [] })
    }
    return { utxos, slot: t.abs_slot, time: t.block_time, height: t.block_height, feeA: BigInt(params.txFeePerByte), feeB: BigInt(params.txFeeFixed), coins: BigInt(params.utxoCostPerByte), maxSize: params.maxTxSize }
  }
  async function check(tx: NativeTransaction) {
    if (!tx.plan || now() >= tx.plan.expiresAt || !Number.isSafeInteger(tx.plan.ttl)) throw new Error('Cardano review expired.')
    const s = await state(tx), p = tx.plan, raw = Buffer.from(p.unsigned, 'base64'), decoded = decodeCbor(raw)
    const inputs = p.locks.map(r => s.utxos.find(u => ref(u) === r))
    if (!inputs.length || inputs.length > 10 || inputs.some(u => !u) || new Set(p.locks).size !== p.locks.length) throw new Error('Cardano inputs no longer available.')
    const remaining = p.ttl! - (s.slot + Math.floor(now() / 1000 - s.time))
    if (remaining <= 0 || remaining > 300 || s.time * 1000 + (p.ttl! - s.slot) * 1000 > tx.expiresAt) throw new Error('Cardano TTL outside authorization window.')
    const expected = body(tx, inputs as CardanoUtxo[], BigInt(p.feeRaw), p.ttl!, s.coins)
    if (!Array.isArray(decoded) || decoded.length !== 4 || !(decoded[0] instanceof CborMap) || !Buffer.from(envelope(expected)).equals(raw)
      || p.txHash !== hash(expected) || p.totalRaw !== (BigInt(tx.amountRaw) + BigInt(p.feeRaw)).toString()
      || BigInt(p.feeRaw) < s.feeA * BigInt(raw.length) + s.feeB || raw.length > s.maxSize) throw new Error('Cardano transaction differs from stored intent.')
  }
  return {
    async build(tx: NativeTransaction, locked: string[]): Promise<NativePlan> {
      const s = await state(tx), selected: CardanoUtxo[] = [], expiresAt = Math.floor(Math.min(tx.expiresAt, now() + 90000) / 1000) * 1000
      const ttl = s.slot + Math.floor(expiresAt / 1000 - s.time)
      let fee = s.feeB + s.feeA * 400n
      for (const u of s.utxos.filter(u => !locked.includes(ref(u))).sort((a, b) => a.lovelace === b.lovelace ? ref(a).localeCompare(ref(b)) : a.lovelace > b.lovelace ? -1 : 1)) {
        selected.push(u); if (selected.length > 10) break
        if (selected.reduce((n, u) => n + u.lovelace, 0n) < BigInt(tx.amountRaw) + fee + minAdaForOutput(decodeCardanoAddress(tx.from), [], s.coins)) continue
        for (let n = 0; n < 5; n++) {
          const txBody = body(tx, selected, fee, ttl, s.coins), raw = envelope(txBody), requiredFee = s.feeB + s.feeA * BigInt(raw.length)
          if (fee < requiredFee) { fee = requiredFee; continue }
          if (raw.length > s.maxSize) throw new Error('Cardano transaction too large.')
          return { reviewId: '', expiresAt, unsigned: Buffer.from(raw).toString('base64'), feeRaw: fee.toString(), totalRaw: (BigInt(tx.amountRaw) + fee).toString(), locks: selected.map(ref), ttl, txHash: hash(txBody) }
        }
      }
      throw new Error('Insufficient pure-ADA inputs including minimum change and fees.')
    }, check,
    async sign(tx: NativeTransaction) {
      await check(tx)
      assertAuthority()
      const key = getCardanoSpendingKey(mnemonicToEntropy(mnemonic(), wordlist), tx.accountIndex), address = decodeCardanoAddress(tx.from)
      if (!Buffer.from(blake2b(key.pub, { dkLen: 28 })).equals(Buffer.from(address.slice(1, 29)))) throw new Error('Isolated Cardano key mismatch.')
      const bytes = extractTxBody(Buffer.from(tx.plan!.unsigned, 'base64')), digest = blake2b(bytes, { dkLen: 32 }), signature = cardanoSign(digest, key.kL, key.kR)
      if (!ed25519.verify(signature, digest, key.pub)) throw new Error('Cardano signature verification failed.')
      assertAuthority()
      return { raw: Buffer.from(envelope(bytes, key.pub, signature)).toString('base64'), hash: hash(bytes) }
    },
    async broadcast(tx: NativeTransaction, raw: string) {
      const r = await fetcher(`${base(tx)}/submittx`, { method: 'POST', headers: { 'Content-Type': 'application/cbor' }, body: new Uint8Array(Buffer.from(raw, 'base64')), signal: AbortSignal.timeout(20000) })
      if (!r.ok) throw new Error('Cardano submission uncertain.'); return await r.json() as string
    },
    async receipt(tx: NativeTransaction) {
      if (!tx.txHash || !tx.plan) return null
      const [info, cbor, tip] = await Promise.all([json(tx, '/tx_info', { _tx_hashes: [tx.txHash] }), json(tx, '/tx_cbor', { _tx_hashes: [tx.txHash] }), json(tx, '/tip')])
      if (!info?.length || !cbor?.length) return null
      const row = info[0], hex = cbor[0].cbor
      if (row.tx_hash !== tx.txHash || row.valid_contract !== true || cbor[0].valid_contract !== true || cbor[0].tx_hash !== tx.txHash || cbor[0].block_hash !== row.block_hash || typeof hex !== 'string' || !/^[0-9a-f]+$/.test(hex)
        || hash(extractTxBody(Buffer.from(hex, 'hex'))) !== tx.plan.txHash || tx.txHash !== tx.plan.txHash || !Number.isSafeInteger(row.block_height)) throw new Error('Cardano receipt identity mismatch.')
      const block = await json(tx, '/block_info', { _block_hashes: [row.block_hash] })
      if (block?.[0]?.hash !== row.block_hash || block[0].block_height !== row.block_height || !Number.isSafeInteger(tip?.[0]?.block_height)) throw new Error('Cardano canonical block unavailable.')
      const confirmations = tip[0].block_height - row.block_height + 1
      if (confirmations < 1) throw new Error('Cardano receipt ahead of chain tip.')
      return { confirmations, finalized: confirmations >= 400, reverted: false }
    },
  }
}
