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
import { ed25519 } from '@noble/curves/ed25519'
import { bech32, base58 } from '@scure/base'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WalletAddresses {
  evm: string            // checksummed 0x address (Ethereum, Monad, Abstract …)
  solana: string         // base58 pubkey
  cardano: string        // bech32 base address  (addr1q…)
  cardanoStake: string   // bech32 stake address (stake1…)
  bitcoin: string        // BIP-84 P2WPKH native SegWit (bc1q…)
  polkadot: string       // SS58 ED25519 (1…)
  accountIndex: number   // BIP-44 account index (0 = default)
}

// ─── Mnemonic helpers ────────────────────────────────────────────────────────

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
  const cleaned = phrase.trim().toLowerCase().replace(/\s+/g, ' ')
  return bip39.validateMnemonic(cleaned, wordlist)
}

// ─── Bitcoin P2WPKH (bc1q…) ──────────────────────────────────────────────────

function deriveBitcoinAddress(compressedPubkey: Uint8Array): string {
  const hash160 = ripemd160(sha256(compressedPubkey))
  const words   = Array.from(bech32.toWords(hash160))
  return bech32.encode('bc', new Uint8Array([0, ...words]))  // witness version 0
}

// ─── Polkadot SS58 (1…) ──────────────────────────────────────────────────────

function ss58Encode(pubkey: Uint8Array, networkPrefix = 0): string {
  const prefix   = new Uint8Array([networkPrefix])
  const payload  = new Uint8Array([...prefix, ...pubkey])
  const preimage = new Uint8Array([...Buffer.from('SS58PRE'), ...payload])
  const checksum = blake2b(preimage, { dkLen: 64 }).slice(0, 2)
  return base58.encode(new Uint8Array([...payload, ...checksum]))
}

// ─── Address derivation ───────────────────────────────────────────────────────

/**
 * Derive public addresses for all supported chains from a single mnemonic.
 * Private keys are created transiently and never returned.
 */
export async function deriveAddresses(mnemonic: string, accountIndex = 0): Promise<WalletAddresses> {
  const cleaned = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ')
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

  // ── Bitcoin — BIP-84 — m/84'/0'/{account}'/0/0 ───────────────────────────
  const btcNode = HDKey.fromMasterSeed(seed).derive(`m/84'/0'/${accountIndex}'/0/0`)
  if (!btcNode.publicKey) throw new Error('Bitcoin derivation failed')
  const bitcoinAddress = deriveBitcoinAddress(btcNode.publicKey)

  // ── Polkadot — SLIP-0010 ED25519 — m/44'/354'/{account}'/0'/0' ───────────
  const { key: dotPrivKey } = derivePath(`m/44'/354'/${accountIndex}'/0'/0'`, Buffer.from(seed).toString('hex'))
  const dotPubKey           = ed25519.getPublicKey(dotPrivKey)
  const polkadotAddress     = ss58Encode(dotPubKey, 0)   // prefix 0 = Polkadot relay chain

  return { evm: evmAddress, solana: solanaAddress, cardano: cardanoAddress, cardanoStake, bitcoin: bitcoinAddress, polkadot: polkadotAddress, accountIndex }
}

// ─── Signing helpers (Phase 2) ───────────────────────────────────────────────

export async function getEvmPrivateKey(mnemonic: string, accountIndex = 0): Promise<`0x${string}`> {
  const seed = await bip39.mnemonicToSeed(mnemonic.trim().toLowerCase())
  const node = HDKey.fromMasterSeed(seed).derive(`m/44'/60'/${accountIndex}'/0/0`)
  if (!node.privateKey) throw new Error('EVM signing key derivation failed')
  return `0x${Buffer.from(node.privateKey).toString('hex')}`
}

export async function getSolanaKeypair(mnemonic: string, accountIndex = 0): Promise<Keypair> {
  const seed = await bip39.mnemonicToSeed(mnemonic.trim().toLowerCase())
  const { key } = derivePath(`m/44'/501'/${accountIndex}'/0'`, Buffer.from(seed).toString('hex'))
  return Keypair.fromSeed(key)
}

export async function getBitcoinKey(mnemonic: string, accountIndex = 0): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> {
  const seed = await bip39.mnemonicToSeed(mnemonic.trim().toLowerCase())
  const node = HDKey.fromMasterSeed(seed).derive(`m/84'/0'/${accountIndex}'/0/0`)
  if (!node.privateKey || !node.publicKey) throw new Error('Bitcoin key derivation failed')
  return { privateKey: node.privateKey, publicKey: node.publicKey }
}

export async function getPolkadotKey(mnemonic: string, accountIndex = 0): Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> {
  const seed = await bip39.mnemonicToSeed(mnemonic.trim().toLowerCase())
  const { key: privKey } = derivePath(`m/44'/354'/${accountIndex}'/0'/0'`, Buffer.from(seed).toString('hex'))
  const pubKey = ed25519.getPublicKey(privKey)
  return { privateKey: privKey, publicKey: pubKey }
}
