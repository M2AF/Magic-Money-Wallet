// Disposable public seed and intercepted Devnet/Preprod only. Never forwards RPC.
require('./x402-wrapper.cjs')
const { net } = require('electron')
const { PublicKey, Keypair, SystemProgram, VersionedTransaction } = require('@solana/web3.js')
const { base58 } = require('@scure/base')
const { blake2b } = require('@noble/hashes/blake2b')
const mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
const token = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), ataProgram = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
const sponsor = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey.toBase58(), recipient = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey.toBase58()
const blockhash = Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey.toBase58(), solTransactions = new Map(), adaTransactions = new Map(), owners = new Set()
const ata = owner => PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(), token.toBuffer(), mint.toBuffer()], ataProgram)[0].toBase58()
const context = value => ({ context: { slot: 100 }, value })
function solRpc(call) {
  const p = call.params || []
  switch (call.method) {
    case 'getGenesisHash': return 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
    case 'getLatestBlockhash': return context({ blockhash, lastValidBlockHeight: 250 })
    case 'getBlockHeight': return 100
    case 'isBlockhashValid': return context(true)
    case 'getFeeForMessage': return context(5000)
    case 'getMinimumBalanceForRentExemption': return 890880
    case 'getAccountInfo': {
      const key = p[0]; let data = Buffer.alloc(0), owner = SystemProgram.programId.toBase58()
      if (key === mint.toBase58()) { data = Buffer.alloc(82); data[44] = 6; data[45] = 1; owner = token.toBase58() }
      else {
        const candidate = [...owners, recipient, sponsor].find(o => ata(o) === key)
        if (candidate) { data = Buffer.alloc(165); mint.toBuffer().copy(data); new PublicKey(candidate).toBuffer().copy(data, 32); data.writeBigUInt64LE(100000000n, 64); data[108] = 1; owner = token.toBase58() }
        else owners.add(key)
      }
      return context({ data: [data.toString('base64'), 'base64'], executable: false, owner, lamports: 10000000000, rentEpoch: 0, space: data.length })
    }
    case 'simulateTransaction': return context({ err: null, logs: [], accounts: null, unitsConsumed: 10000, returnData: null })
    case 'sendTransaction': {
      const tx = VersionedTransaction.deserialize(Buffer.from(p[0], 'base64')), signature = base58.encode(tx.signatures[0]), msg = tx.message
      solTransactions.set(signature, { slot: 100, blockTime: Math.floor(Date.now() / 1000), version: 0,
        transaction: { signatures: tx.signatures.map(s => base58.encode(s)), message: { header: msg.header, accountKeys: msg.staticAccountKeys.map(k => k.toBase58()), recentBlockhash: msg.recentBlockhash,
          instructions: msg.compiledInstructions.map(i => ({ programIdIndex: i.programIdIndex, accounts: i.accountKeyIndexes, data: base58.encode(i.data) })), addressTableLookups: [] } },
        meta: { err: null, fee: 5000, preBalances: msg.staticAccountKeys.map(() => 10000000000), postBalances: msg.staticAccountKeys.map(() => 9999995000), innerInstructions: [], logMessages: [], loadedAddresses: { writable: [], readonly: [] } } })
      return signature
    }
    case 'getTransaction': return solTransactions.get(p[0]) || null
    case 'getSignatureStatuses': return context(p[0].map(hash => solTransactions.has(hash) ? { slot: 100, confirmations: 2, err: null, confirmationStatus: 'confirmed' } : null))
    case 'getBlock': return { blockhash, previousBlockhash: blockhash, parentSlot: 99, blockTime: Math.floor(Date.now() / 1000), blockHeight: 100, transactions: [...solTransactions.values()].map(t => ({ transaction: t.transaction, meta: t.meta, version: 0 })) }
    case 'getBalance': return context(0)
    case 'getTokenAccountsByOwner': return context([])
    case 'getAssetsByOwner': return { items: [], total: 0 }
    default: return context([])
  }
}
function cborLength(b, start) {
  const ai = b[start] & 31, type = b[start] >> 5, width = ai < 24 ? 0 : ai === 24 ? 1 : ai === 25 ? 2 : ai === 26 ? 4 : 8
  let n = ai < 24 ? ai : 0; for (let i = 1; i <= width; i++) n = n * 256 + b[start + i]
  let end = start + width + 1
  if (type === 2 || type === 3) return end + n - start
  if (type === 4 || type === 5) for (let i = 0; i < n * (type === 5 ? 2 : 1); i++) end += cborLength(b, end)
  return end - start
}
function cardano(path, body) {
  const tip = { abs_slot: 1000, block_time: Math.floor(Date.now() / 1000), block_height: 100 }
  if (path === 'genesis') return [{ networkmagic: '1', slotlength: '1' }]
  if (path === 'tip') return [tip]
  if (path === 'cli_protocol_params') return { txFeePerByte: 44, txFeeFixed: 155381, utxoCostPerByte: 4310, maxTxSize: 16384 }
  if (path === 'address_utxos') return Array.from({ length: 10 }, (_, i) => ({ tx_hash: (i + 1).toString(16).padStart(64, '0'), tx_index: 0, address: body._addresses[0], value: '100000000',
    asset_list: [], datum_hash: null, inline_datum: null, reference_script: null, is_spent: false }))
  if (path === 'submittx') { const raw = Buffer.from(body), txBody = raw.subarray(1, 1 + cborLength(raw, 1)), hash = Buffer.from(blake2b(txBody, { dkLen: 32 })).toString('hex'); adaTransactions.set(hash, raw.toString('hex')); return hash }
  if (path === 'tx_info') return body._tx_hashes.filter(hash => adaTransactions.has(hash)).map(tx_hash => ({ tx_hash, block_hash: 'cd'.repeat(32), block_height: 99, valid_contract: true }))
  if (path === 'tx_cbor') return body._tx_hashes.map(tx_hash => ({ tx_hash, block_hash: 'cd'.repeat(32), cbor: adaTransactions.get(tx_hash), valid_contract: true }))
  if (path === 'block_info') return [{ hash: 'cd'.repeat(32), block_height: 99 }]
  throw new Error('Unknown offline Cardano endpoint')
}
function intercept(original) {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input.url || String(input)
    if (/preprod\.koios\.rest/.test(url)) {
      const bytes = init?.body, body = typeof bytes === 'string' ? JSON.parse(bytes) : bytes
      return new Response(JSON.stringify(cardano(new URL(url).pathname.split('/').pop(), body)), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    let body; try { body = JSON.parse(init?.body || 'null') } catch {}
    const calls = Array.isArray(body) ? body : [body]
    if (calls.some(c => c && typeof c.method === 'string' && !c.method.startsWith('eth_') && (c.jsonrpc === '2.0'))) {
      const replies = calls.map(c => ({ jsonrpc: '2.0', id: c.id, result: solRpc(c) }))
      return new Response(JSON.stringify(Array.isArray(body) ? replies : replies[0]), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return original(input, init)
  }
}
globalThis.fetch = intercept(globalThis.fetch.bind(globalThis)); net.fetch = intercept(net.fetch.bind(net))
