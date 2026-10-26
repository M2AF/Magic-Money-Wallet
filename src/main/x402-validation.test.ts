import { describe, expect, it } from 'vitest'
import { validateX402Proposal, x402ResourceUrl } from './x402-validation'
import { x402Fixture } from './x402-fixtures'
describe('closed x402 v2 validation', () => {
  it('accepts the canonical testnet token and preserves the original exact requirements', () => {
    const fixture = x402Fixture(), result = validateX402Proposal(fixture, 'testnet')
    expect(result.chainId).toBe(84532); expect(result.amountRaw).toBe('10000')
    expect(result.paymentRequired).toEqual(fixture.paymentRequired)
    fixture.paymentRequired.accepts[0].amount = '999999'
    expect(result.amountRaw).toBe('10000'); expect(result.paymentRequired.accepts[0].amount).toBe('10000')
  })
  it('supports only the pinned Base mainnet asset with the correct domain', () => {
    const args = x402Fixture(), accept = args.paymentRequired.accepts[0]
    Object.assign(accept, { network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', extra: { name: 'USD Coin', version: '2' } })
    expect(validateX402Proposal(args, 'mainnet').chainId).toBe(8453)
    expect(() => validateX402Proposal(args, 'testnet')).toThrow('mode')
  })
  it.each(['0', '01', '1.0', '1e6', '-1', ' 1', (2n ** 256n).toString()])('rejects invalid base-unit amount %s', amount => {
    const args = x402Fixture(); args.paymentRequired.accepts[0].amount = amount
    expect(() => validateX402Proposal(args, 'testnet')).toThrow('integer')
  })
  it.each(['http://merchant.example.com/', 'https://user:password@merchant.example.com/', 'https://merchant.example.com/#secret',
    'https://127.0.0.1/', 'https://[::1]/', 'https://0x7f000001/', 'https://localhost/', 'https://service.internal/',
    'https://merchant.example.com:8443/', 'https://merchant.example.com./', 'https://merchant.example.com/\u202eevil'])('rejects unsafe URL %s', url => {
    expect(() => x402ResourceUrl(url)).toThrow()
  })
  it('binds the whole resource URL including the query', () => {
    const args = x402Fixture(); args.paymentRequired.resource.url += '&different=1'
    expect(() => validateX402Proposal(args, 'testnet')).toThrow('does not match')
  })
  it.each(['asset', 'network', 'scheme', 'payTo'] as const)('rejects unsupported %s', field => {
    const args = x402Fixture(); args.paymentRequired.accepts[0][field] = field === 'asset' || field === 'payTo' ? '0x0000000000000000000000000000000000000000' : 'unsupported'
    expect(() => validateX402Proposal(args, 'testnet')).toThrow()
  })
  it('rejects legacy protocols, multiple accepts, extensions and signing input smuggling', () => {
    const legacy = x402Fixture(); legacy.paymentRequired.x402Version = 1
    expect(() => validateX402Proposal(legacy, 'testnet')).toThrow('v2')
    const multiple = x402Fixture(); multiple.paymentRequired.accepts.push(multiple.paymentRequired.accepts[0])
    expect(() => validateX402Proposal(multiple, 'testnet')).toThrow('exactly one')
    for (const mutation of [
      (a: any) => { a.paymentRequired.extensions = { arbitrary: {} } },
      (a: any) => { a.nonce = '0x' + '11'.repeat(32) },
      (a: any) => { a.paymentRequired.accepts[0].validBefore = '9999999999' },
      (a: any) => { a.paymentRequired.accepts[0].extra.assetTransferMethod = 'permit2' },
      (a: any) => { a.paymentRequired.accepts[0].extra.version = '1' },
      (a: any) => { a.paymentRequired.accepts[0].extra.name = 'Attacker' },
      (a: any) => { a.paymentRequired.resource.description = 'hidden\u202etext' },
    ]) { const args = x402Fixture(); mutation(args); expect(() => validateX402Proposal(args, 'testnet')).toThrow() }
  })
})
