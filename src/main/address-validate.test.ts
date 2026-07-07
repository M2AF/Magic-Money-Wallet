import { describe, it, expect } from 'vitest'
import { validateAddress } from './address-validate'
import { deriveAddresses, deriveTestnetAddresses } from './wallet-core'

// Real derived addresses from the public Foundry test mnemonic — every
// validator is exercised against addresses our own signer produces.
const FOUNDRY = 'test test test test test test test test test test test junk'

describe('address-validate', () => {
  it('accepts every address this wallet itself derives (mainnet)', async () => {
    const a = await deriveAddresses(FOUNDRY, 0)
    expect(validateAddress('ethereum', a.evm)).toEqual({ valid: true })
    expect(validateAddress('arbitrum', a.evm)).toEqual({ valid: true })
    expect(validateAddress('solana', a.solana)).toEqual({ valid: true })
    expect(validateAddress('cardano', a.cardano)).toEqual({ valid: true })
    expect(validateAddress('bitcoin', a.bitcoin)).toEqual({ valid: true })          // bc1q
    expect(validateAddress('bitcoin', a.bitcoinNested)).toEqual({ valid: true })    // 3…
    expect(validateAddress('bitcoin', a.bitcoinTaproot)).toEqual({ valid: true })   // bc1p
    expect(validateAddress('tron', a.tron)).toEqual({ valid: true })
    expect(validateAddress('dogecoin', a.dogecoin)).toEqual({ valid: true })
  })

  it('accepts testnet encodings in testnet mode and rejects them on mainnet', async () => {
    const t = await deriveTestnetAddresses(FOUNDRY, 0)
    expect(validateAddress('bitcoin', t.bitcoin, true).valid).toBe(true)
    expect(validateAddress('cardano', t.cardano, true).valid).toBe(true)
    expect(validateAddress('bitcoin', t.bitcoin, false).valid).toBe(false)
    expect(validateAddress('cardano', t.cardano, false).valid).toBe(false)
    // …and mainnet encodings rejected in testnet mode, with a network hint.
    const m = await deriveAddresses(FOUNDRY, 0)
    expect(validateAddress('bitcoin', m.bitcoin, true).reason).toMatch(/MAINNET/)
    expect(validateAddress('cardano', m.cardano, true).reason).toMatch(/MAINNET/)
  })

  it('rejects cross-chain pastes with a clear reason', async () => {
    const a = await deriveAddresses(FOUNDRY, 0)
    expect(validateAddress('bitcoin', a.evm).valid).toBe(false)
    expect(validateAddress('solana', a.evm).valid).toBe(false)
    expect(validateAddress('ethereum', a.solana).valid).toBe(false)
    expect(validateAddress('dogecoin', a.tron).valid).toBe(false)
    expect(validateAddress('tron', a.dogecoin).valid).toBe(false)
    expect(validateAddress('cardano', a.cardanoStake).reason).toMatch(/stake address/)
  })

  it('rejects EVM checksum typos but accepts all-lowercase', async () => {
    const a = await deriveAddresses(FOUNDRY, 0)   // EIP-55 mixed-case
    expect(validateAddress('ethereum', a.evm.toLowerCase()).valid).toBe(true)
    // Flip the case of one letter → checksum failure.
    const mangled = a.evm.replace(/[a-f](?=[0-9a-fA-F]*$)/, c => c.toUpperCase())
    expect(mangled).not.toBe(a.evm)
    expect(validateAddress('ethereum', mangled).valid).toBe(false)
  })

  it('rejects garbage, empties, and near-misses', () => {
    for (const chain of ['ethereum', 'solana', 'cardano', 'bitcoin', 'dogecoin', 'tron']) {
      expect(validateAddress(chain, '').valid).toBe(false)
      expect(validateAddress(chain, 'definitely-not-an-address').valid).toBe(false)
    }
    expect(validateAddress('bitcoin', 'bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq').valid).toBe(false)  // bad bech32 checksum
    expect(validateAddress('tron', 'TXYZa9zzzzzzzzzzzzzzzzzzzzzzzzzzzz').valid).toBe(false)             // bad base58check
  })
})
