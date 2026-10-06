/**
 * Arc-forwarded (Solana) withdrawal preparation: both layers decoded and
 * pinned. The fixture is Circle's real, nonfunding response to a synthetic
 * request (2026-10-05; src/main/__fixtures__/iog/prepare-withdrawal-probes.json).
 * Its 10.00 forwarding cap exercised the schema only; it is not a default.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { base58 } from '@scure/base'
import { encodeFunctionData, decodeFunctionData, type Hex } from 'viem'
import {
  validateForwardedWithdrawal, forwardedWithdrawalRequest, prepareForwardedWithdrawal,
  XRESERVE_SOLANA_FORWARDING as F, type ForwardedWithdrawalInput,
} from './xreserve-forwarded-prepare'
import { validatePreparedWithdrawal } from './xreserve-withdrawal-prepare'
import { ProviderFault } from './xreserve-cardano-provider'

const probes = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'iog', 'prepare-withdrawal-probes.json'), 'utf8'))
const response = () => structuredClone(probes.solana.response)
const input: ForwardedWithdrawalInput = {
  amount: '10.00',
  remoteDepositor: '0x00000001' + '00'.repeat(28),
  solanaRecipient: base58.encode(new Uint8Array(32).fill(0x11)),
  maxBurnFeeRaw: '2000000',
  forwardingMaxFee: '10.00',
  fastFinality: true,
}
const intent = (r: any) => r.batches[0].burnIntents[0]
const refuse = (r: unknown, pattern: RegExp, i: ForwardedWithdrawalInput = input) => {
  expect(() => validateForwardedWithdrawal(r, i)).toThrow(ProviderFault)
  expect(() => validateForwardedWithdrawal(r, i)).toThrow(pattern)
}
const ABI = [{ type: 'function', name: 'depositForBurnWithHook', stateMutability: 'nonpayable', outputs: [], inputs: [
  { name: 'amount', type: 'uint256' }, { name: 'destinationDomain', type: 'uint32' }, { name: 'mintRecipient', type: 'bytes32' },
  { name: 'burnToken', type: 'address' }, { name: 'destinationCaller', type: 'bytes32' }, { name: 'maxFee', type: 'uint256' },
  { name: 'minFinalityThreshold', type: 'uint32' }, { name: 'hookData', type: 'bytes' }] }] as const
/** Rewrite one nested argument, keeping the rest of the call canonical. */
function withCall(change: (args: any[]) => void) {
  const r = response()
  const hook = intent(r).spec.hookData
  const args = [...decodeFunctionData({ abi: ABI, data: hook.forwardingCalldata as Hex }).args] as any[]
  change(args)
  hook.forwardingCalldata = encodeFunctionData({ abi: ABI, functionName: 'depositForBurnWithHook', args: args as any })
  return r
}

describe('validateForwardedWithdrawal — the recorded Arc -> Solana preparation', () => {
  it('decodes both layers and reproduces the encoded burn', () => {
    const p = validateForwardedWithdrawal(response(), input)
    expect(p).toMatchObject({
      destination: 'solana', amountRaw: '10000000', burnFeeRaw: '1015650', burnAmountRaw: '11015650',
      forwardingMaxFeeRaw: '10000000', minFinalityThreshold: 1000, mintRecipient: '0x' + '11'.repeat(32),
      recipientConvention: 'unverified', executable: false,
    })
    expect(p.transferSpecHash).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('builds the same request shape Circle accepted', () => {
    expect(forwardedWithdrawalRequest(input)).toEqual({ batches: [{
      ...probes.solana.request.batches[0], valueExcludingFees: '10.000000',
      forwardingOptions: { maxFee: '10.000000', usesFastFinality: true },
    }] })
  })

  it('the direct-Ethereum validator still refuses it', () => {
    expect(() => validatePreparedWithdrawal(response(), { amount: '10', remoteDepositor: input.remoteDepositor,
      recipient: '0x' + '11'.repeat(20), maxFeeRaw: '2000000' })).toThrow(ProviderFault)
  })
})

describe('validateForwardedWithdrawal — refuses every change to recipient, route, token, contract, hook or fee', () => {
  it('a different Solana recipient', () => refuse(withCall(a => { a[2] = '0x' + '22'.repeat(32) }), /recipient differs/))
  it('a different nested domain', () => refuse(withCall(a => { a[1] = 6 }), /not Solana/))
  it('a different nested amount', () => refuse(withCall(a => { a[0] = 9_000_000n }), /amount differs/))
  it('another burn token', () => refuse(withCall(a => { a[3] = '0x' + '33'.repeat(20) }), /other than Arc USDC/))
  it('a restricted destination caller', () => refuse(withCall(a => { a[4] = '0x' + '44'.repeat(32) }), /destination caller/))
  it('a different hook payload', () => refuse(withCall(a => { a[7] = '0xdeadbeef' }), /CCTP forward marker/))
  it('a forwarding fee above the cap', () => refuse(withCall(a => { a[5] = 10_000_001n }), /fee cap exceeds/))
  it('a different finality speed', () => refuse(response(), /finality differs/, { ...input, fastFinality: false }))
  it('a burn fee above the caller\'s ceiling', () => refuse(response(), /burn fee exceeds/, { ...input, maxBurnFeeRaw: '1000000' }))
  it('a forwarding cap above the caller\'s', () => refuse(response(), /fee cap exceeds/, { ...input, forwardingMaxFee: '9.99' }))

  it('another forwarding contract', () => {
    const r = response(); intent(r).spec.hookData.forwardingContractAddress = '0x' + '55'.repeat(20)
    refuse(r, /TokenMessengerV2/)
  })
  it('extra bytes after the nested call', () => {
    const r = response(); intent(r).spec.hookData.forwardingCalldata += '00'
    refuse(r, /extra or non-canonical|not depositForBurnWithHook/)
  })
  it('another outer destination domain', () => { const r = response(); intent(r).spec.destinationDomain = 0; refuse(r, /Ethereum-to-Arc/) })
  it('another outer recipient', () => { const r = response(); intent(r).spec.destinationRecipient = '0x' + '00'.repeat(12) + '66'.repeat(20); refuse(r, /destination recipient/) })
  it('another outer token', () => { const r = response(); intent(r).spec.destinationToken = '0x' + '00'.repeat(12) + '77'.repeat(20); refuse(r, /destination token/) })
  it('another remote token', () => { const r = response(); intent(r).spec.hookData.remoteToken = '0x' + '88'.repeat(32); refuse(r, /Cardano USDCx/) })
  it('another depositor', () => refuse(response(), /remote depositor/, { ...input, remoteDepositor: '0x00000001' + '99'.repeat(28) }))
  it('a requested amount the response does not carry', () => refuse(response(), /amount differs/, { ...input, amount: '11' }))
  it('encoded bytes that differ from the JSON terms', () => {
    const r = response(); r.batches[0].encoded = r.batches[0].encoded.replace(/0098968000/, '0098968100')
    refuse(r, /encoded burn differs/)
  })
  it('two intents', () => { const r = response(); r.batches[0].burnIntents.push(intent(r)); refuse(r, /one burn intent/) })
  it('an invalid Solana recipient input', () => {
    expect(() => validateForwardedWithdrawal(response(), { ...input, solanaRecipient: 'not-base58-0OIl' })).toThrow(/Solana recipient/)
  })
})

describe('prepareForwardedWithdrawal', () => {
  it('posts the request and validates the answer; a non-200 is a provider fault', async () => {
    let sent: unknown
    const ok = async (_url: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return new Response(JSON.stringify(response()), { status: 200 }) }
    expect((await prepareForwardedWithdrawal(input, { fetchFn: ok as never })).executable).toBe(false)
    expect(sent).toEqual(forwardedWithdrawalRequest(input))
    await expect(prepareForwardedWithdrawal(input, { fetchFn: (async () => new Response('', { status: 400 })) as never }))
      .rejects.toMatchObject({ kind: 'unavailable' })
  })
  it('pins match the documented identities', () => {
    expect(F.arcDomain).toBe(26)
    expect(F.solanaDomain).toBe(5)
  })
})
