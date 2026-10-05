import { describe, expect, it, vi } from 'vitest'
import { prepareXReserveWithdrawal, validatePreparedWithdrawal } from './xreserve-withdrawal-prepare'
import { XRESERVE_MAINNET, XRESERVE_SEPOLIA_PREPROD } from './xreserve-network'

const recipient = '0x' + '22'.repeat(20)
const depositor = '0x' + '11'.repeat(32)
const pad = (s: string) => '0x' + s.slice(2).padStart(64, '0')
const input = { amount: '10.000001', recipient, remoteDepositor: depositor, maxFeeRaw: '500000' }

// Independent binary fixture assembled by byte offsets from Circle's published
// BurnIntents.sol, TransferSpec.sol and WithdrawHookData.sol, not the adapter.
function fixture(testnet = false) {
  const net = testnet ? XRESERVE_SEPOLIA_PREPROD : XRESERVE_MAINNET
  const identity = '0x' + '33'.repeat(32)
  const hook = Buffer.alloc(112)
  hook.writeUInt32BE(0x6b20f62a, 0); hook.writeUInt32BE(1, 4); hook.writeUInt32BE(10004, 8)
  Buffer.from(identity.slice(2), 'hex').copy(hook, 12)
  Buffer.from(depositor.slice(2), 'hex').copy(hook, 44)
  const spec = Buffer.alloc(340 + hook.length)
  spec.writeUInt32BE(0xca85def7, 0); spec.writeUInt32BE(1, 4)
  for (const offset of [16, 48, 80, 144, 208, 304]) Buffer.from(identity.slice(2), 'hex').copy(spec, offset)
  Buffer.from(pad(net.ethereum.usdc).slice(2), 'hex').copy(spec, 112)
  Buffer.from(pad(recipient).slice(2), 'hex').copy(spec, 176)
  spec.writeBigUInt64BE(10000001n, 296); spec.writeUInt32BE(112, 336); hook.copy(spec, 340)
  const bytes = Buffer.alloc(72 + spec.length)
  bytes.writeUInt32BE(0x070afbc2, 0); bytes.writeBigUInt64BE(30000000n, 28)
  bytes.writeBigUInt64BE(500000n, 60); bytes.writeUInt32BE(spec.length, 68); spec.copy(bytes, 72)
  return { batches: [{ encoded: '0x' + bytes.toString('hex'), messageHashToSign: '0x' + '44'.repeat(32), burnIntents: [{
    maxBlockHeight: '30000000', maxFee: '500000', spec: {
      version: 1, sourceDomain: 0, destinationDomain: 0, sourceContract: identity, destinationContract: identity,
      sourceToken: identity, destinationToken: pad(net.ethereum.usdc), sourceDepositor: identity,
      destinationRecipient: pad(recipient), sourceSigner: identity, destinationCaller: '0x' + '00'.repeat(32),
      value: '10000001', salt: identity, hookData: {
        remoteDomain: 10004, remoteToken: identity, remoteDepositor: depositor,
        forwardingContractAddress: '0x' + '00'.repeat(20), forwardingCalldata: '0x',
      },
    },
  }] }] }
}

describe('outbound Circle withdrawal preparation', () => {
  it('binds exact six-decimal amounts and fees to a canonical single burn', () => {
    expect(validatePreparedWithdrawal(fixture(), input)).toMatchObject({ amountRaw: '10000001', maxFeeRaw: '500000', burnAmountRaw: '10500001', executable: false, destinationDomain: 0 })
    const set = fixture(); set.batches[0].encoded = '0xe999239b00000001' + set.batches[0].encoded.slice(2)
    expect(validatePreparedWithdrawal(set, input).executable).toBe(false)
  })

  it('pins testnet USDC and refuses crossing network profiles', () => {
    expect(validatePreparedWithdrawal(fixture(true), input, XRESERVE_SEPOLIA_PREPROD).network).toBe('sepolia-preprod')
    expect(() => validatePreparedWithdrawal(fixture(true), input)).toThrow('pinned USDC')
  })

  it.each(['recipient', 'account', 'amount', 'fee', 'token', 'domain', 'caller', 'forwarding', 'extra-intent', 'extra-batch', 'operator-hash'])('rejects altered %s terms', change => {
    const f = fixture(), b = f.batches[0], burn = b.burnIntents[0], s = burn.spec
    if (change === 'recipient') s.destinationRecipient = '0x' + '55'.repeat(32)
    if (change === 'account') s.hookData.remoteDepositor = '0x' + '55'.repeat(32)
    if (change === 'amount') s.value = '10000000'
    if (change === 'fee') burn.maxFee = '500001'
    if (change === 'token') s.destinationToken = '0x' + '55'.repeat(32)
    if (change === 'domain') s.destinationDomain = 5
    if (change === 'caller') s.destinationCaller = '0x' + '55'.repeat(32)
    if (change === 'forwarding') s.hookData.forwardingCalldata = '0x12345678'
    if (change === 'extra-intent') b.burnIntents.push(structuredClone(burn))
    if (change === 'extra-batch') f.batches.push(structuredClone(b))
    if (change === 'operator-hash') b.messageHashToSign = '0x12'
    expect(() => validatePreparedWithdrawal(f, input)).toThrow()
  })

  it.each(['trailing', 'truncated', 'changed-byte', 'changed-json', 'set-count', 'hook-length'])('rejects %s bytes independently of displayed terms', change => {
    const f = fixture(), b = f.batches[0]
    const bytes = Buffer.from(b.encoded.slice(2), 'hex')
    if (change === 'trailing') b.encoded += '00'
    if (change === 'truncated') b.encoded = b.encoded.slice(0, -2)
    if (change === 'changed-byte') { bytes[103] ^= 1; b.encoded = '0x' + bytes.toString('hex') }
    if (change === 'changed-json') b.burnIntents[0].spec.sourceSigner = '0x' + '55'.repeat(32)
    if (change === 'set-count') b.encoded = '0xe999239b00000002' + b.encoded.slice(2)
    if (change === 'hook-length') { bytes.writeUInt32BE(111, 72 + 336); b.encoded = '0x' + bytes.toString('hex') }
    expect(() => validatePreparedWithdrawal(f, input)).toThrow('encoded burn differs')
  })

  it('posts only to the pinned preparation endpoint, with no wallet signature or withdrawal submission', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(fixture(true))))
    await prepareXReserveWithdrawal(input, { network: XRESERVE_SEPOLIA_PREPROD, fetchFn })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://xreserve-api-testnet.circle.com/v1/prepare-withdrawal')
    expect(init.method).toBe('POST'); expect(init.redirect).toBe('error')
    expect(JSON.parse(init.body as string)).toEqual({ batches: [{ token: 'USDC', valueExcludingFees: '10.000001', remoteDomain: 10004,
      remoteDepositor: depositor, finalDestinationDomain: 0, finalDestinationRecipient: pad(recipient), useCircleForwarding: true }] })
  })

  it.each(['0', '1e2', '0.0000001', '01', '1.0000000', '-1'])('rejects invalid amount %s before HTTP', async amount => {
    const fetchFn = vi.fn()
    await expect(prepareXReserveWithdrawal({ ...input, amount }, { fetchFn })).rejects.toThrow()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it.each([403, 429, 500])('preserves HTTP %s as a provider failure, never a usable quote', async status => {
    await expect(prepareXReserveWithdrawal(input, { fetchFn: async () => new Response('private body', { status }) })).rejects.toMatchObject({
      kind: status === 429 ? 'rate-limited' : 'unavailable', message: `Circle withdrawal: HTTP ${status}`,
    })
  })

  it('does not leak transport URLs or accept non-JSON/error responses', async () => {
    await expect(prepareXReserveWithdrawal(input, { fetchFn: async () => { throw new Error('secret URL') } })).rejects.toThrow('request failed or timed out')
    await expect(prepareXReserveWithdrawal(input, { fetchFn: async () => new Response('broken') })).rejects.toThrow('not JSON')
    await expect(prepareXReserveWithdrawal(input, { fetchFn: async () => new Response('{}') })).rejects.toThrow('expected one batch')
  })
})
