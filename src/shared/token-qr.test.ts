import { describe, expect, it, vi } from 'vitest'
import { parseTokenQr } from './token-qr'
import { validateAddress } from '../main/address-validate'

const address = '0x1111111111111111111111111111111111111111'
const context = { key: 'captured-selection', chainId: 'ethereum' }
const validator = (chain: string, value: string) => validateAddress(chain, value)

describe('address-only QR parsing', () => {
  it('validates the complete recipient and returns the captured selection without transaction data', async () => {
    expect(await parseTokenQr(` ${address} `, context, validator)).toMatchObject({ ok: true, address, key: context.key, format: 'address' })
  })
  it('rejects the selected chain mismatch using the real backend validator', async () => {
    expect(await parseTokenQr(address, { ...context, chainId: 'cardano' }, validator)).toMatchObject({ ok: false, code: 'invalid-address' })
    expect(await parseTokenQr(address, { ...context, chainId: 'solana' }, validator)).toMatchObject({ ok: false, code: 'invalid-address' })
  })
  it.each([
    `ethereum:${address}@8453?value=100`, `ethereum:${address}/transfer?address=${address}&uint256=1`,
    'solana:SomeMint?amount=1&spl-token=OtherMint', 'bitcoin:bc1qrecipient?amount=1',
    `https://example.com/${address}`, `javascript:${address}`, `wc:${address}`, `cardano:${address}`,
    `${address}?amount=1`, `${address}#ignored`, `%30x${address.slice(2)}`,
  ])('rejects payment links or requests without silently dropping terms: %s', async input => {
    const check = vi.fn(() => ({ valid: true }))
    expect(await parseTokenQr(input, context, check)).toMatchObject({ ok: false, code: 'unsupported-format' })
    expect(check).not.toHaveBeenCalled()
  })
  it.each([null, undefined, {}, '', '  '])('rejects empty/non-string input: %s', async input => {
    expect(await parseTokenQr(input, context, validator)).toMatchObject({ ok: false, code: 'empty' })
  })
  it.each([`${address}\n`, `${address}\u0000`, `${address}\u202e`, `${address}\u200b`, 'a'.repeat(2049), 'two addresses'])('rejects malformed or oversized data', async input => {
    const check = vi.fn(() => ({ valid: true }))
    expect(await parseTokenQr(input, context, check)).toMatchObject({ ok: false, code: 'malformed' })
    expect(check).not.toHaveBeenCalled()
  })
  it('fails closed on validator failure or malformed validator result', async () => {
    expect(await parseTokenQr(address, context, () => { throw new Error('offline') })).toMatchObject({ ok: false, code: 'validation-failed' })
    expect(await parseTokenQr(address, context, () => ({ valid: false }))).toMatchObject({ ok: false, code: 'invalid-address' })
  })
  it('returns the original key after async validation, so the UI can discard a stale scan', async () => {
    let finish!: (value: { valid: boolean }) => void
    const mutable = { ...context }
    const promise = parseTokenQr(address, mutable, () => new Promise(resolve => { finish = resolve }))
    mutable.key = 'new-selection'
    mutable.chainId = 'cardano'
    finish({ valid: true })
    expect(await promise).toMatchObject({ key: context.key })
  })
})
