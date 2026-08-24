/**
 * Import guards — the shared rules every target enforces before an imported
 * token/NFT is written to config (Electron ipc-handlers and the extension /
 * Capacitor / iOS wallet-handlers all call straight into these).
 */
import { describe, expect, it } from 'vitest'
import type { CustomAssetConfig } from './custom-chains'
import { assertNftImportable, assertTokenImportable, importableChainIds } from './custom-chains'

const ADDR = '0xdddddddddddddddddddddddddddddddddddddddd'
const OTHER = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

const base: CustomAssetConfig = {
  customChains: [{
    id: 'custom-9999', name: 'My Chain', chainId: 9999,
    nativeSymbol: 'MYC', rpcUrl: 'https://rpc.mychain.example', explorerUrl: '',
  }],
  customTokens: [],
  customNfts: [],
  testnetMode: false,
}

describe('importable chains', () => {
  it('covers the built-in EVM chains as well as user-added ones', () => {
    const ids = importableChainIds(base)
    expect(ids.has('ethereum')).toBe(true)
    expect(ids.has('base')).toBe(true)
    expect(ids.has('custom-9999')).toBe(true)
  })

  it('excludes non-EVM chains — the import path is eth_call-based', () => {
    const ids = importableChainIds(base)
    for (const id of ['solana', 'cardano', 'bitcoin', 'polkadot', 'tron', 'dogecoin']) {
      expect(ids.has(id)).toBe(false)
    }
  })
})

describe('assertTokenImportable', () => {
  it('accepts a built-in chain', () => {
    expect(() => assertTokenImportable(base, 'ethereum', ADDR)).not.toThrow()
  })

  it('accepts a user-added chain', () => {
    expect(() => assertTokenImportable(base, 'custom-9999', ADDR)).not.toThrow()
  })

  it('rejects an unknown chain', () => {
    expect(() => assertTokenImportable(base, 'not-a-chain', ADDR)).toThrow('Unknown network')
  })

  it('rejects a duplicate on the same chain, but allows the same contract elsewhere', () => {
    const cfg = { ...base, customTokens: [{ chain: 'ethereum', contractAddress: ADDR, name: 'X', symbol: 'X', decimals: 18 }] }
    expect(() => assertTokenImportable(cfg, 'ethereum', ADDR)).toThrow('already imported')
    expect(() => assertTokenImportable(cfg, 'base', ADDR)).not.toThrow()
  })

  it('refuses to import while Testnet Mode is on', () => {
    // Testnet chain ids are the SAME as mainnet's, and a stored import records
    // only the id — so a Sepolia token would resurface as an Ethereum holding.
    expect(() => assertTokenImportable({ ...base, testnetMode: true }, 'ethereum', ADDR))
      .toThrow('Testnet Mode')
  })
})

describe('assertNftImportable', () => {
  it('accepts a built-in chain', () => {
    expect(() => assertNftImportable(base, 'base', ADDR, '7')).not.toThrow()
  })

  it('rejects an unknown chain', () => {
    expect(() => assertNftImportable(base, 'not-a-chain', ADDR, '7')).toThrow('Unknown network')
  })

  it('keys duplicates on chain + contract + token id', () => {
    const cfg = { ...base, customNfts: [{ chain: 'base', contractAddress: ADDR, tokenId: '7', type: 'ERC-721' as const }] }
    expect(() => assertNftImportable(cfg, 'base', ADDR, '7')).toThrow('already imported')
    expect(() => assertNftImportable(cfg, 'base', ADDR, '8')).not.toThrow()
    expect(() => assertNftImportable(cfg, 'base', OTHER, '7')).not.toThrow()
    expect(() => assertNftImportable(cfg, 'ethereum', ADDR, '7')).not.toThrow()
  })

  it('refuses to import while Testnet Mode is on', () => {
    expect(() => assertNftImportable({ ...base, testnetMode: true }, 'base', ADDR, '7'))
      .toThrow('Testnet Mode')
  })
})
