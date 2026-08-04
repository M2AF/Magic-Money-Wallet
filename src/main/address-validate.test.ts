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

describe('Midnight addresses', () => {
  // Real addresses derived from the repo test mnemonic.
  const MAINNET = 'mn_addr1lhm2myd3rwe672fs3hsw2nc9t4wvkhtst7fq75jtlh7674a3reqspywdyd'
  const PREPROD = 'mn_addr_preprod1lhm2myd3rwe672fs3hsw2nc9t4wvkhtst7fq75jtlh7674a3reqs6s6l86'
  const SHIELDED = 'mn_shield-addr_preprod1j79fwduuxrpphd7v3flqufr6slsquc3laz5xcv0vn2ft23p4k6vnvh3vy3ckjx9leyts2yc3mak23suejz47je5dh9n5c9zfsagrm0gxngfy4'
  const DUST = 'mn_dust_preprod1wdkdudaenm0zef20rvgnacmpmrqy9xjjn8q0rjh3j6q2nreq3jyxvcfa5vr'

  it('accepts the right address for the active network', () => {
    expect(validateAddress('midnight', MAINNET, false).valid).toBe(true)
    expect(validateAddress('midnight', PREPROD, true).valid).toBe(true)
  })

  it('no longer rejects a Midnight address as an EVM one', () => {
    // Without a `midnight` case this fell through to the EVM default and told
    // the user to check for typos in a perfectly valid address.
    for (const [addr, testnet] of [[MAINNET, false], [PREPROD, true]] as const) {
      expect(validateAddress('midnight', addr, testnet).reason ?? '').not.toMatch(/EVM/)
    }
    expect(validateAddress('midnight', 'not-an-address', false).reason).not.toMatch(/EVM/)
  })

  it('catches a cross-network paste and names the direction', () => {
    expect(validateAddress('midnight', PREPROD, false).reason).toMatch(/PREPROD/)
    expect(validateAddress('midnight', MAINNET, true).reason).toMatch(/MAINNET/)
  })

  it('rejects shielded and DUST addresses, which cannot receive NIGHT', () => {
    expect(validateAddress('midnight', SHIELDED, true).reason).toMatch(/shielded/)
    expect(validateAddress('midnight', DUST, true).reason).toMatch(/DUST/)
  })

  it('rejects junk with Midnight-specific guidance', () => {
    expect(validateAddress('midnight', 'mn_addr1nope', false).valid).toBe(false)
    expect(validateAddress('midnight', '0x1234', false).reason).toMatch(/mn_addr/)
    expect(validateAddress('midnight', '', false).valid).toBe(false)
  })
})
