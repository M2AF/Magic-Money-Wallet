/**
 * wallet-core.ts — MagicMoney Wallet
 *
 * SECURITY CONTRACT:
 *   - This module runs in the Electron MAIN process ONLY.
 *   - Private keys and mnemonic phrases NEVER leave this file.
 *   - The renderer receives only: public addresses, balance strings, tx hashes.
 *   - All signing happens here before disposal.
 */

import * as bip39 from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { HDKey } from '@scure/bip32'
import { derivePath } from 'ed25519-hd-key'
import { Keypair } from '@solana/web3.js'
import { privateKeyToAccount } from 'viem/accounts'
import { deriveCardanoAddress, deriveCardanoStakeAddress } from './cardano-pure'
import { sha256 } from '@noble/hashes/sha256'
import { ripemd160 } from '@noble/hashes/ripemd160'
import { blake2b } from '@noble/hashes/blake2b'
import { keccak_256 } from '@noble/hashes/sha3'
import { ed25519 } from '@noble/curves/ed25519'
import { secp256k1 } from '@noble/curves/secp256k1'
import { base58 } from '@scure/base'
import * as btc from '@scure/btc-signer'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WalletAddresses {
  evm: string            // checksummed 0x address (Ethereum, Monad, Abstract …)
  solana: string         // base58 pubkey
  cardano: string        // bech32 base address  (addr1q…)
  cardanoStake: string   // bech32 stake address (stake1…)
  bitcoin: string        // BIP-84 P2WPKH native SegWit (bc1q…) — the payment address
  bitcoinNested: string  // BIP-49 P2SH-P2WPKH nested SegWit (3…)
  bitcoinTaproot: string // BIP-86 P2TR taproot (bc1p…) — the ordinals/inscriptions address
  polkadot: string       // SS58 ED25519 (1…)
  tron: string           // base58check secp256k1 (T…)
  dogecoin: string       // BIP-44 legacy P2PKH (D…)
  accountIndex: number   // BIP-44 account index (0 = default)
  // Abstract Global Wallet (smart account) — resolved, not seed-derived.
  // agw = manual override ?? auto-derived from evm. agwOwned = this EOA can sign
  // for it (i.e. it is the AGW's initial signer) → required to send from it.
  agw?: string
  agwOwned?: boolean
  // Testnet Mode: chains whose ADDRESSES differ on testnet (Bitcoin tb1…/2…/tb1p…
  // via coin-type-1 paths; Cardano addr_test…). Derived once when Testnet Mode is
  // enabled (wallet unlocked) and cached here so testnet balances render from
  // addresses.json even while locked. EVM/Solana/Tron reuse the mainnet address.
  testnet?: TestnetAddresses
}

export interface TestnetAddresses {
  bitcoin: string        // tb1q…  (m/84'/1'/{account}'/0/0)
  bitcoinNested: string  // 2…     (m/49'/1'/{account}'/0/0)
  bitcoinTaproot: string // tb1p…  (m/86'/1'/{account}'/0/0)
  cardano: string        // addr_test1…
  cardanoStake: string   // stake_test1…
}

// ─── Mnemonic helpers ────────────────────────────────────────────────────────

/**
 * Canonical mnemonic form: trimmed, lowercased, single-spaced. EVERY path that
 * feeds a phrase into bip39 (seed or entropy) must go through this — the seed is
 * derived from the raw string, so "word  word" and "word word" produce different
 * keys. Storage (secure-store / chrome-store) also normalizes on save + unlock
 * so persisted phrases are canonical no matter where they came from.
 */
export function normalizeMnemonic(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Generate a fresh cryptographically secure 12-word BIP-39 mnemonic.
 */
export function generateMnemonic(): string {
  return bip39.generateMnemonic(wordlist, 128) // 128-bit entropy = 12 words
}

/**
 * Validate a user-entered mnemonic against the BIP-39 English wordlist.
 */
export function validateMnemonic(phrase: string): boolean {
  return bip39.validateMnemonic(normalizeMnemonic(phrase), wordlist)
}

// ─── Bitcoin addresses via @scure/btc-signer ─────────────────────────────────
// Three address types from one seed: Native SegWit (bc1q, BIP-84), Nested SegWit
// (3…, BIP-49 P2SH-P2WPKH), Taproot (bc1p, BIP-86 — p2tr applies the BIP-86 key
// tweak internally, so we pass the x-only internal key = compressed pubkey[1..]).
// Testnet uses TEST_NETWORK params (tb1q…/2…/tb1p…) — same prefixes on testnet3
// and testnet4 (they differ only at the chain level, not address encoding).

function btcNativeSegwit(compressedPubkey: Uint8Array, network = btc.NETWORK): string {
  const a = btc.p2wpkh(compressedPubkey, network).address
  if (!a) throw new Error('Bitcoin native-SegWit address failed')
  return a
}
function btcNestedSegwit(compressedPubkey: Uint8Array, network = btc.NETWORK): string {
  const a = btc.p2sh(btc.p2wpkh(compressedPubkey, network), network).address
  if (!a) throw new Error('Bitcoin nested-SegWit address failed')
  return a
}
function btcTaproot(compressedPubkey: Uint8Array, network = btc.NETWORK): string {
  const a = btc.p2tr(compressedPubkey.slice(1), undefined, network).address
  if (!a) throw new Error('Bitcoin Taproot address failed')
  return a
}

// ─── Polkadot SS58 (1…) ──────────────────────────────────────────────────────

function ss58Encode(pubkey: Uint8Array, networkPrefix = 0): string {
  const prefix   = new Uint8Array([networkPrefix])
  const payload  = new Uint8Array([...prefix, ...pubkey])
  const preimage = new Uint8Array([...Buffer.from('SS58PRE'), ...payload])
  const checksum = blake2b(preimage, { dkLen: 64 }).slice(0, 2)
  return base58.encode(new Uint8Array([...payload, ...checksum]))
}

// ─── base58check (Tron, Dogecoin) ────────────────────────────────────────────
// payload ++ first-4-bytes(double-sha256(payload)), base58-encoded. Shared by the
// two secp256k1 chains below (Bitcoin uses bech32, so it has its own encoder above).

function base58check(payload: Uint8Array): string {
  const checksum = sha256(sha256(payload)).slice(0, 4)
  return base58.encode(new Uint8Array([...payload, ...checksum]))
}

// ─── Tron (T…) ────────────────────────────────────────────────────────────────
// secp256k1, same as EVM: keccak256 of the 64-byte uncompressed pubkey (no 0x04
// prefix), last 20 bytes, prepended with 0x41 (mainnet), then base58check.

function deriveTronAddress(privateKey: Uint8Array): string {
  const uncompressed = secp256k1.getPublicKey(privateKey, false)  // 65 bytes, 0x04 prefix
  const hash = keccak_256(uncompressed.slice(1))                  // drop 0x04
  return base58check(new Uint8Array([0x41, ...hash.slice(-20)]))
}

// ─── Dogecoin legacy P2PKH (D…) ───────────────────────────────────────────────
// Bitcoin-style HASH160 of the compressed pubkey, version byte 0x1E, base58check.
// Dogecoin mainnet does not use SegWit, so this is BIP-44 (m/44'/3') P2PKH.

function deriveDogecoinAddress(compressedPubkey: Uint8Array): string {
  const hash160 = ripemd160(sha256(compressedPubkey))
  return base58check(new Uint8Array([0x1e, ...hash160]))
}

// ─── Address derivation ───────────────────────────────────────────────────────

/**
 * Derive public addresses for all supported chains from a single mnemonic.
 * Private keys are created transiently and never returned.
 */
export async function deriveAddresses(mnemonic: string, accountIndex = 0): Promise<WalletAddresses> {
  const cleaned = normalizeMnemonic(mnemonic)
  if (!validateMnemonic(cleaned)) {
    throw new Error('Invalid BIP-39 mnemonic phrase')
  }

  const seed = await bip39.mnemonicToSeed(cleaned)

  // ── EVM — secp256k1 — m/44'/60'/{account}'/0/0 ───────────────────────────
  const evmRoot = HDKey.fromMasterSeed(seed)
  const evmNode = evmRoot.derive(`m/44'/60'/${accountIndex}'/0/0`)
  if (!evmNode.privateKey) throw new Error('EVM derivation failed')
  const evmHex = `0x${Buffer.from(evmNode.privateKey).toString('hex')}` as `0x${string}`
  const evmAddress = privateKeyToAccount(evmHex).address   // EIP-55 checksummed

  // ── Solana — ed25519 (SLIP-0010) — m/44'/501'/{account}'/0' ─────────────
  const { key: solKey } = derivePath(`m/44'/501'/${accountIndex}'/0'`, Buffer.from(seed).toString('hex'))
  const solanaAddress = Keypair.fromSeed(solKey).publicKey.toBase58()

  // ── Cardano — CIP-3 v2 Icarus + CIP-1852 + BIP32-Ed25519 ────────────────
  const entropy = bip39.mnemonicToEntropy(cleaned, wordlist)
  const cardanoAddress = deriveCardanoAddress(entropy, accountIndex)
  const cardanoStake   = deriveCardanoStakeAddress(entropy, accountIndex)

  // ── Bitcoin — three address types from one seed ──────────────────────────
  //   Native SegWit  m/84'/0'/{acct}'/0/0  (bc1q…) — payment
  //   Nested SegWit  m/49'/0'/{acct}'/0/0  (3…)
  //   Taproot        m/86'/0'/{acct}'/0/0  (bc1p…) — ordinals
  const btcRoot = HDKey.fromMasterSeed(seed)
  const btcNativeNode  = btcRoot.derive(`m/84'/0'/${accountIndex}'/0/0`)
  const btcNestedNode  = btcRoot.derive(`m/49'/0'/${accountIndex}'/0/0`)
  const btcTaprootNode = btcRoot.derive(`m/86'/0'/${accountIndex}'/0/0`)
  if (!btcNativeNode.publicKey || !btcNestedNode.publicKey || !btcTaprootNode.publicKey) throw new Error('Bitcoin derivation failed')
  const bitcoinAddress = btcNativeSegwit(btcNativeNode.publicKey)
  const bitcoinNested  = btcNestedSegwit(btcNestedNode.publicKey)
  const bitcoinTaproot = btcTaproot(btcTaprootNode.publicKey)

  // ── Polkadot — SLIP-0010 ED25519 — m/44'/354'/{account}'/0'/0' ───────────
  const { key: dotPrivKey } = derivePath(`m/44'/354'/${accountIndex}'/0'/0'`, Buffer.from(seed).toString('hex'))
  const dotPubKey           = ed25519.getPublicKey(dotPrivKey)
  const polkadotAddress     = ss58Encode(dotPubKey, 0)   // prefix 0 = Polkadot relay chain

  // ── Tron — secp256k1 — m/44'/195'/{account}'/0/0 ─────────────────────────
  const tronNode = HDKey.fromMasterSeed(seed).derive(`m/44'/195'/${accountIndex}'/0/0`)
  if (!tronNode.privateKey) throw new Error('Tron derivation failed')
  const tronAddress = deriveTronAddress(tronNode.privateKey)

  // ── Dogecoin — secp256k1 — m/44'/3'/{account}'/0/0 (legacy P2PKH) ─────────
  const dogeNode = HDKey.fromMasterSeed(seed).derive(`m/44'/3'/${accountIndex}'/0/0`)
  if (!dogeNode.publicKey) throw new Error('Dogecoin derivation failed')
  const dogecoinAddress = deriveDogecoinAddress(dogeNode.publicKey)

  return { evm: evmAddress, solana: solanaAddress, cardano: cardanoAddress, cardanoStake, bitcoin: bitcoinAddress, bitcoinNested, bitcoinTaproot, polkadot: polkadotAddress, tron: tronAddress, dogecoin: dogecoinAddress, accountIndex }
}

/**
 * Testnet Mode addresses — only the chains whose encoding differs from mainnet.
 * Bitcoin follows the BIP-44 testnet convention (coin type 1) so the addresses
 * match what Sparrow/Electrum derive from the same seed; Cardano keeps its
 * mainnet keys/path and only flips the network header (preprod convention).
 */
export async function deriveTestnetAddresses(mnemonic: string, accountIndex = 0): Promise<TestnetAddresses> {
  const cleaned = normalizeMnemonic(mnemonic)
  if (!validateMnemonic(cleaned)) {
    throw new Error('Invalid BIP-39 mnemonic phrase')
  }

  const seed = await bip39.mnemonicToSeed(cleaned)
  const btcRoot = HDKey.fromMasterSeed(seed)
  const nativeNode  = btcRoot.derive(`m/84'/1'/${accountIndex}'/0/0`)
  const nestedNode  = btcRoot.derive(`m/49'/1'/${accountIndex}'/0/0`)
  const taprootNode = btcRoot.derive(`m/86'/1'/${accountIndex}'/0/0`)
  if (!nativeNode.publicKey || !nestedNode.publicKey || !taprootNode.publicKey) throw new Error('Bitcoin testnet derivation failed')

  const entropy = bip39.mnemonicToEntropy(cleaned, wordlist)

  return {
    bitcoin: btcNativeSegwit(nativeNode.publicKey, btc.TEST_NETWORK),
    bitcoinNested: btcNestedSegwit(nestedNode.publicKey, btc.TEST_NETWORK),
    bitcoinTaproot: btcTaproot(taprootNode.publicKey, btc.TEST_NETWORK),
    cardano: deriveCardanoAddress(entropy, accountIndex, true),
    cardanoStake: deriveCardanoStakeAddress(entropy, accountIndex, true),
  }
}

// ─── Signing helpers (Phase 2) ───────────────────────────────────────────────

export async function getEvmPrivateKey(mnemonic: string, accountIndex = 0): Promise<`0x${string}`> {
  const seed = await bip39.mnemonicToSeed(normalizeMnemonic(mnemonic))
  const node = HDKey.fromMasterSeed(seed).derive(`m/44'/60'/${accountIndex}'/0/0`)
  if (!node.privateKey) throw new Error('EVM signing key derivation failed')
  return `0x${Buffer.from(node.privateKey).toString('hex')}`
}

export async function getSolanaKeypair(mnemonic: string, accountIndex = 0): Promise<Keypair> {
  const seed = await bip39.mnemonicToSeed(normalizeMnemonic(mnemonic))
  const { key } = derivePath(`m/44'/501'/${accountIndex}'/0'`, Buffer.from(seed).toString('hex'))
  return Keypair.fromSeed(key)
}

export async function getBitcoinKey(mnemonic: string, accountIndex = 0, testnet = false): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> {
  const seed = await bip39.mnemonicToSeed(normalizeMnemonic(mnemonic))
  const node = HDKey.fromMasterSeed(seed).derive(`m/84'/${testnet ? 1 : 0}'/${accountIndex}'/0/0`)
  if (!node.privateKey || !node.publicKey) throw new Error('Bitcoin key derivation failed')
  return { privateKey: node.privateKey, publicKey: node.publicKey }
}

/** BIP-49 nested-SegWit (3…) signing key. */
export async function getBitcoinNestedKey(mnemonic: string, accountIndex = 0, testnet = false): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> {
  const seed = await bip39.mnemonicToSeed(normalizeMnemonic(mnemonic))
  const node = HDKey.fromMasterSeed(seed).derive(`m/49'/${testnet ? 1 : 0}'/${accountIndex}'/0/0`)
  if (!node.privateKey || !node.publicKey) throw new Error('Bitcoin nested key derivation failed')
  return { privateKey: node.privateKey, publicKey: node.publicKey }
}

/** BIP-86 Taproot (bc1p…) signing key — the ordinals address key. */
export async function getBitcoinTaprootKey(mnemonic: string, accountIndex = 0, testnet = false): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> {
  const seed = await bip39.mnemonicToSeed(normalizeMnemonic(mnemonic))
  const node = HDKey.fromMasterSeed(seed).derive(`m/86'/${testnet ? 1 : 0}'/${accountIndex}'/0/0`)
  if (!node.privateKey || !node.publicKey) throw new Error('Bitcoin Taproot key derivation failed')
  return { privateKey: node.privateKey, publicKey: node.publicKey }
}

export async function getPolkadotKey(mnemonic: string, accountIndex = 0): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> {
  const seed = await bip39.mnemonicToSeed(normalizeMnemonic(mnemonic))
  const { key: privKey } = derivePath(`m/44'/354'/${accountIndex}'/0'/0'`, Buffer.from(seed).toString('hex'))
  const pubKey = ed25519.getPublicKey(privKey)
  return { privateKey: privKey, publicKey: pubKey }
}

export async function getTronKey(mnemonic: string, accountIndex = 0): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array; address: string }> {
  const seed = await bip39.mnemonicToSeed(normalizeMnemonic(mnemonic))
  const node = HDKey.fromMasterSeed(seed).derive(`m/44'/195'/${accountIndex}'/0/0`)
  if (!node.privateKey) throw new Error('Tron key derivation failed')
  return { privateKey: node.privateKey, publicKey: secp256k1.getPublicKey(node.privateKey, false), address: deriveTronAddress(node.privateKey) }
}

export async function getDogecoinKey(mnemonic: string, accountIndex = 0): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array; address: string }> {
  const seed = await bip39.mnemonicToSeed(normalizeMnemonic(mnemonic))
  const node = HDKey.fromMasterSeed(seed).derive(`m/44'/3'/${accountIndex}'/0/0`)
  if (!node.privateKey || !node.publicKey) throw new Error('Dogecoin key derivation failed')
  return { privateKey: node.privateKey, publicKey: node.publicKey, address: deriveDogecoinAddress(node.publicKey) }
}
