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

describe('privacy chain addresses (Monero / Zcash)', () => {
  it('accepts the wallet\'s own derived privacy addresses', async () => {
    const { derivePrivacyAddresses } = await import('./wallet-core')
    const p = await derivePrivacyAddresses(FOUNDRY, 0)
    expect(validateAddress('monero', p.monero).valid).toBe(true)
    expect(validateAddress('zcash', p.zcashTransparent).valid).toBe(true)
  })

  it('rejects cross-chain pastes on the privacy chains', async () => {
    const { derivePrivacyAddresses } = await import('./wallet-core')
    const a = await deriveAddresses(FOUNDRY, 0)
    const p = await derivePrivacyAddresses(FOUNDRY, 0)
    expect(validateAddress('monero', a.evm).valid).toBe(false)
    expect(validateAddress('monero', p.zcashTransparent).valid).toBe(false)
    expect(validateAddress('zcash', p.monero).valid).toBe(false)
    expect(validateAddress('zcash', a.bitcoin).valid).toBe(false)
    expect(validateAddress('zcash', a.dogecoin).valid).toBe(false)  // also base58check but wrong version bytes
  })

  it('rejects shielded Zcash recipients with a helpful reason', () => {
    const res = validateAddress('zcash', 'zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtpepqu9jc8ruqavzs')
    expect(res.valid).toBe(false)
    expect(res.reason).toMatch(/transparent/i)
  })

  it('accepts a known-good mainnet Monero donation address', () => {
    // The Monero project's published donation address (getmonero.org).
    const donation = '44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXft3XjrpDtQGv7SqSsaBYBb98uNbr2VBBEt7f2wfn3RVGQBEP3A'
    expect(validateAddress('monero', donation).valid).toBe(true)
  })
})
