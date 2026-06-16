/**
 * wallet-core.ts — ManCave Wallet
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

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WalletAddresses {
  evm: string       // checksummed 0x address (works on Ethereum, Monad, Abstract)
  solana: string    // base58 pubkey
  cardano: string | null  // bech32 base address (null if CSL not available)
}

// ─── Cardano lazy-load (native .node binary) ─────────────────────────────────

type CSL = typeof import('@emurgo/cardano-serialization-lib-asmjs')
let _csl: CSL | null = null

async function getCSL(): Promise<CSL | null> {
  if (_csl) return _csl
  try {
    // @emurgo/cardano-serialization-lib-asmjs is an ESM-only package ("type": "module").
    // require() cannot load ESM modules — dynamic import() is required here.
    // electron-vite.config.ts sets output.dynamicImportInCjs: false so Rollup
    // preserves this as import() in the CJS bundle instead of converting to require().
    const lib = await import('@emurgo/cardano-serialization-lib-asmjs')
    _csl = lib as unknown as CSL
    return _csl
  } catch (e) {
    console.warn('[wallet-core] Cardano serialization lib not available —', e)
    return null
  }
}

// ─── Mnemonic helpers ────────────────────────────────────────────────────────

/**
 * Generate a fresh cryptographically secure 12-word BIP-39 mnemonic.
 * Uses @scure/bip39 which relies on Web Crypto / node:crypto for entropy.
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

// ─── Address derivation ───────────────────────────────────────────────────────

/**
 * Derive public addresses for all supported chains from a single mnemonic.
 * Private keys are created transiently here and never returned.
 */
export async function deriveAddresses(mnemonic: string): Promise<WalletAddresses> {
  const cleaned = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!validateMnemonic(cleaned)) {
    throw new Error('Invalid BIP-39 mnemonic phrase')
  }

  const seed = await bip39.mnemonicToSeed(cleaned)

  // ── EVM — secp256k1 — m/44'/60'/0'/0/0 ─────────────────────────────────
  // Works for Ethereum mainnet, Monad, Abstract, and any EVM-compatible chain.
  // Same private key, same address across all of them.
  const evmRoot = HDKey.fromMasterSeed(seed)
  const evmNode = evmRoot.derive("m/44'/60'/0'/0/0")
  if (!evmNode.privateKey) throw new Error('EVM derivation failed — no private key returned')
  const evmHex = `0x${Buffer.from(evmNode.privateKey).toString('hex')}` as `0x${string}`
  const evmAddress = privateKeyToAccount(evmHex).address  // EIP-55 checksummed
  // evmNode.privateKey is garbage-collected here — it never leaves this scope

  // ── Solana — ed25519 (SLIP-0010) — m/44'/501'/0'/0' ────────────────────
  const { key: solKey } = derivePath("m/44'/501'/0'/0'", Buffer.from(seed).toString('hex'))
  const solanaAddress = Keypair.fromSeed(solKey).publicKey.toBase58()
  // solKey is a transient Uint8Array, collected after this line

  // ── Cardano — ed25519-bip32 (CIP-1852) — m/1852'/1815'/0' ──────────────
  // Cardano requires raw entropy bytes (NOT the 512-bit seed buffer)
  // because its bip32 variant handles key stretching differently.
  let cardanoAddress: string | null = null
  const CSL = await getCSL()

  if (CSL) {
    try {
      const harden = (n: number) => 0x80000000 + n
      const entropy = Buffer.from(bip39.mnemonicToEntropy(cleaned, wordlist), 'hex')
      const rootKey = CSL.Bip32PrivateKey.from_bip39_entropy(entropy, Buffer.from(''))

      // Account: m/1852'/1815'/0'
      const accountKey = rootKey
        .derive(harden(1852))   // purpose: Shelley
        .derive(harden(1815))   // coin type: ADA
        .derive(harden(0))      // account 0

      // Payment key: .../0/0 (spending)
      const payPub = accountKey.derive(0).derive(0).to_public()
      // Stake key: .../2/0 (delegation)
      const stkPub = accountKey.derive(2).derive(0).to_public()

      // Cardano Shelley base address = payment keyhash + stake keyhash
      const networkId = CSL.NetworkInfo.mainnet().network_id()
      cardanoAddress = CSL.BaseAddress.new(
        networkId,
        CSL.StakeCredential.from_keyhash(payPub.to_raw_key().hash()),
        CSL.StakeCredential.from_keyhash(stkPub.to_raw_key().hash())
      ).to_address().to_bech32()
    } catch (err) {
      console.error('[wallet-core] Cardano address derivation error:', err)
    }
  }

  return { evm: evmAddress, solana: solanaAddress, cardano: cardanoAddress }
}

// ─── Signing (Phase 2 — used during send flow) ───────────────────────────────

/**
 * Re-derive the EVM private key from a mnemonic for a single signing operation.
 * The returned key must be zeroed by the caller after use.
 * NEVER pass this key to the renderer.
 */
export async function getEvmPrivateKey(mnemonic: string): Promise<`0x${string}`> {
  const seed = await bip39.mnemonicToSeed(mnemonic.trim().toLowerCase())
  const node = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0")
  if (!node.privateKey) throw new Error('EVM signing key derivation failed')
  return `0x${Buffer.from(node.privateKey).toString('hex')}`
}

/**
 * Re-derive the Solana keypair for a single signing operation.
 * NEVER pass this keypair to the renderer.
 */
export async function getSolanaKeypair(mnemonic: string): Promise<Keypair> {
  const seed = await bip39.mnemonicToSeed(mnemonic.trim().toLowerCase())
  const { key } = derivePath("m/44'/501'/0'/0'", Buffer.from(seed).toString('hex'))
  return Keypair.fromSeed(key)
}