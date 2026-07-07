import { describe, it, expect } from 'vitest'
import { deriveAddresses, generateMnemonic, validateMnemonic, normalizeMnemonic, getEvmPrivateKey } from './wallet-core'

// The crown-jewel test: if address derivation regresses, users receive funds at
// addresses they don't control. The EVM vector is the well-known Foundry/Anvil
// account #0, a fixed external reference for BIP-39 → BIP-44 m/44'/60'/0'/0/0.
const FOUNDRY = 'test test test test test test test test test test test junk'

describe('wallet-core deriveAddresses', () => {
  it('derives the known Foundry EVM account #0 (EIP-55 checksummed)', async () => {
    const a = await deriveAddresses(FOUNDRY, 0)
    expect(a.evm).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
  })

  it('produces correctly-formatted addresses for every supported chain', async () => {
    const a = await deriveAddresses(FOUNDRY, 0)
    expect(a.evm).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(a.solana.length).toBeGreaterThanOrEqual(32)
    expect(a.cardano.startsWith('addr1')).toBe(true)
    expect(a.cardanoStake.startsWith('stake1')).toBe(true)
    expect(a.bitcoin.startsWith('bc1q')).toBe(true)
    expect(a.polkadot.length).toBeGreaterThan(40)
    expect(a.accountIndex).toBe(0)
  })

  it('is deterministic and sensitive to the account index', async () => {
    const a0 = await deriveAddresses(FOUNDRY, 0)
    const a0again = await deriveAddresses(FOUNDRY, 0)
    const a1 = await deriveAddresses(FOUNDRY, 1)
    expect(a0).toEqual(a0again)
    expect(a1.evm).not.toBe(a0.evm)
    expect(a1.solana).not.toBe(a0.solana)
    expect(a1.cardano).not.toBe(a0.cardano)
  })

  it('rejects an invalid mnemonic', async () => {
    await expect(deriveAddresses('not actually a valid bip39 mnemonic phrase here', 0)).rejects.toThrow()
  })

  it('generates valid 12-word mnemonics', () => {
    const m = generateMnemonic()
    expect(m.trim().split(/\s+/)).toHaveLength(12)
    expect(validateMnemonic(m)).toBe(true)
    expect(validateMnemonic('clearly invalid')).toBe(false)
  })

  // Regression (audit L-2): bip39 seeds the RAW string, so a phrase with stray
  // whitespace/case must derive the SAME keys everywhere — address derivation
  // and signing-key derivation must agree, or funds land at addresses the
  // signing path can't control.
  it('derives identical addresses and signing keys for whitespace-mangled phrases', async () => {
    const mangled = `  Test  test\ttest test test  TEST test test test test test junk \n`
    expect(normalizeMnemonic(mangled)).toBe(FOUNDRY)
    const clean = await deriveAddresses(FOUNDRY, 0)
    const messy = await deriveAddresses(mangled, 0)
    expect(messy).toEqual(clean)
    expect(await getEvmPrivateKey(mangled, 0)).toBe(await getEvmPrivateKey(FOUNDRY, 0))
    // The signing key must correspond to the derived address's known vector.
    expect(clean.evm).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
  })
})
