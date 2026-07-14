// Cross-check monero-pure.ts derivation against monero-ts (keys-only WASM wallet).
import * as bip39 from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { HDKey } from '@scure/bip32'
import { keccak_256 } from '@noble/hashes/sha3'
import { ed25519 } from '@noble/curves/ed25519'
import moneroTs from 'monero-ts'

const L = ed25519.CURVE.n
const toLE = (v, len = 32) => { const o = new Uint8Array(len); for (let i = 0; i < len; i++) { o[i] = Number(v & 0xffn); v >>= 8n } return o }
const fromLE = (b) => { let v = 0n; for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]); return v }
const scReduce32 = (b) => toLE(fromLE(b) % L)
const hex = (b) => Buffer.from(b).toString('hex')

const mnemonic = 'test test test test test test test test test test test junk'
const seed = await bip39.mnemonicToSeed(mnemonic)
const node = HDKey.fromMasterSeed(seed).derive("m/44'/128'/0'/0/0")

const spend = scReduce32(keccak_256(node.privateKey))
const view = scReduce32(keccak_256(spend))
console.log('spend:', hex(spend))
console.log('view :', hex(view))

// monero-ts: create keys-only wallet from the private spend key; it computes
// the view key + address itself → both must match monero-pure's math.
const w = await moneroTs.createWalletKeys({
  networkType: moneroTs.MoneroNetworkType.MAINNET,
  privateSpendKey: hex(spend),
})
console.log('monero-ts view   :', await w.getPrivateViewKey())
console.log('monero-ts address:', await w.getAddress(0, 0))
console.log('view match:', (await w.getPrivateViewKey()) === hex(view))
await w.close()
