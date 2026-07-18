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

// ── Privacy Mode derivation (Monero / Zcash transparent) ─────────────────────
// The Monero vector was cross-checked against monero-ts (createWalletKeys from
// the same spend key reproduces this exact view key + address), so a regression
// here means the wallet no longer matches what monero-wallet-cli would restore
// from an exported spend key.
describe('wallet-core derivePrivacyAddresses', () => {
  it('derives the known Monero account #0 (verified against monero-ts)', async () => {
    const { getMoneroKeys } = await import('./wallet-core')
    const k = await getMoneroKeys(FOUNDRY, 0)
    expect(k.privateSpendKey).toBe('a32c2cb1eacc5ab4c7a83935ec5447cff500f7a5c43b4104259f36babfed9105')
    expect(k.privateViewKey).toBe('a92226dfdb87cc49ffcc5d9ae27a82591afdd3d039f537758df6ee8cd4590f06')
    expect(k.address).toBe('48Xucn75vn7aEEPSksVh3VY1SZEToLh56gbiHKEybgkAMgxr4ehqxaeSF7HzX9e1rAbCXV4Snr8Vwicae6kgX58fHnidf65')
  })

  it('produces correctly-formatted privacy addresses and caches the view key', async () => {
    const { derivePrivacyAddresses } = await import('./wallet-core')
    const p = await derivePrivacyAddresses(FOUNDRY, 0)
    expect(p.monero.startsWith('4')).toBe(true)
    expect(p.monero).toHaveLength(95)
    expect(p.moneroViewKey).toMatch(/^[0-9a-f]{64}$/)
    expect(p.zcashTransparent.startsWith('t1')).toBe(true)
  })

  it('is deterministic and sensitive to the account index', async () => {
    const { derivePrivacyAddresses } = await import('./wallet-core')
    const p0 = await derivePrivacyAddresses(FOUNDRY, 0)
    const p0again = await derivePrivacyAddresses(FOUNDRY, 0)
    const p1 = await derivePrivacyAddresses(FOUNDRY, 1)
    expect(p0).toEqual(p0again)
    expect(p1.monero).not.toBe(p0.monero)
    expect(p1.zcashTransparent).not.toBe(p0.zcashTransparent)
  })

  it('round-trips its own Monero address through the validator', async () => {
    const { derivePrivacyAddresses } = await import('./wallet-core')
    const { validateMoneroAddress } = await import('./monero-pure')
    const p = await derivePrivacyAddresses(FOUNDRY, 0)
    expect(validateMoneroAddress(p.monero)).toBe(true)
    // checksum sensitivity: flipping one character must fail
    const corrupted = p.monero.slice(0, 94) + (p.monero[94] === 'a' ? 'b' : 'a')
    expect(validateMoneroAddress(corrupted)).toBe(false)
  })
})

// ── Midnight derivation — pinned against Lace (mainnet, 2026-07-13) ──────────
// A throwaway 24-word wallet was created in Lace and its exported Zswap keys +
// receive addresses matched these derivations byte-for-byte (see midnight.ts
// header for the recipe). If this regresses, NIGHT sent to our address would
// not appear in a Lace restore of the same phrase.
describe('wallet-core Midnight derivation (Lace-verified)', () => {
  const LACE_PHRASE = 'fan crew offer depart cream maple scrap gallery guard chief exile foil pyramid live they march pilot bottom tuna inhale paddle glue across chimney'

  it('reproduces the Lace test wallet addresses exactly', async () => {
    const { derivePrivacyAddresses } = await import('./wallet-core')
    const p = await derivePrivacyAddresses(LACE_PHRASE, 0)
    expect(p.midnight).toBe('mn_addr1m2vkj22w9r7g37yry7cawdj0pnsvyvryc6l0afw69vctellddrqq0gl5g2')
    expect(p.midnightShielded).toBe('mn_shield-addr1l6xvefgt4w0m24ujr7rhydzj2tw5vmfm74ens9uu5ynj0kfhwn7n2ujd43n9wlnutvzpejzwp9wzzppm2wqfxc790kh9llyn772zrcq8t4qr4')
    // DUST fee address — matched byte-for-byte to Lace AND to Midnight's official
    // DustAddress.encodePublicKey codec. Guards the 0x73-prefixed LE encoding.
    expect(p.midnightDust).toBe('mn_dust1ww32942he5x9em6tf9eknvc2a379ch3da7k0sykzfjwms6hxvr49wrfl2vk')
  })

  it('derives midnight fields for the Foundry account too (format check)', async () => {
    const { derivePrivacyAddresses } = await import('./wallet-core')
    const p = await derivePrivacyAddresses(FOUNDRY, 0)
    expect(p.midnight?.startsWith('mn_addr1')).toBe(true)
    expect(p.midnightShielded?.startsWith('mn_shield-addr1')).toBe(true)
    const p1 = await derivePrivacyAddresses(FOUNDRY, 1)
    expect(p1.midnight).not.toBe(p.midnight)
  })
})
