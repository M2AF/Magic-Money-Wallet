/**
 * xreserve-forwarded-prepare.ts — Circle-side preparation of a Cardano USDCx
 * withdrawal FORWARDED to Solana (privileged layer). Preparation only: no key
 * access, burn building, signing, /withdraw submission or settlement claim.
 *
 * A SEPARATE validator from the direct-Ethereum one (xreserve-withdrawal-
 * prepare.ts), which still refuses every forwarding route. Measured 2026-10-05
 * (docs/evidence/usdcx-portal-2026-10-05.json): a Solana-destined preparation is
 * an OUTER Gateway transfer to Arc (CCTP domain 26) whose hook asks Arc's
 * TokenMessengerV2 to `depositForBurnWithHook` onward to Solana (domain 5).
 * Both layers are decoded and every field is pinned or bound to the request:
 *
 *   outer   version 1, Ethereum (0) -> Arc (26); Gateway Wallet -> Gateway
 *           Minter; Ethereum USDC -> Arc USDC; recipient and caller = xReserve
 *           on Arc; value = the requested amount; burn fee <= the caller's cap
 *   hook    Cardano domain 10004, the requested depositor, Circle's Cardano
 *           USDCx identifier, forwarding contract = Arc TokenMessengerV2
 *   nested  depositForBurnWithHook(amount = value, domain 5, mintRecipient =
 *           the requested 32 bytes, burnToken = Arc USDC, no destination
 *           caller, maxFee <= the caller's forwarding cap, finality threshold
 *           for the requested speed, hookData = exactly "cctp-forward")
 *
 * Sources for the pins: Arc mainnet contract list (docs.arc.io references →
 * contract addresses: USDC, TokenMessengerV2, GatewayWallet, GatewayMinter,
 * CCTP domain 26) and Circle `GET /v1/info` (xReserve on Arc, Cardano remote
 * token identifier), both read 2026-10-05.
 *
 * NOT ESTABLISHED, so the result is always `executable: false`: whether the
 * Solana `mintRecipient` must be a wallet or its USDC token account (Circle's
 * forwarding convention, unproven by any settlement), whether IOG's operator
 * accepts forwarded intents, and real settlement. Fee caps given here are the
 * caller's ceilings, never product defaults.
 */

import { decodeFunctionData, encodeFunctionData, keccak256, type Hex } from 'viem'
import { base58 } from '@scure/base'
import { ProviderFault, type HttpFetchFn } from './xreserve-cardano-provider'
import { XRESERVE_MAINNET } from './xreserve-network'

export const XRESERVE_SOLANA_FORWARDING = Object.freeze({
  arcDomain: 26,
  solanaDomain: 5,
  /** Ethereum-side Gateway Wallet (same vanity address as Arc's, per Arc docs). */
  gatewayWallet: '0x77777777dcc4d5a8b6e418fd04d8997ef11000ee',
  gatewayMinter: '0x2222222d7164433c4c09b0b0d809a9b52c04c205',
  arcUsdc: '0x3600000000000000000000000000000000000000',
  /** Circle /v1/info: xReserve on Arc (domain 26). */
  arcXReserve: '0x8888888199b2df864bf678259607d6d5ebb4e3ce',
  /** Arc TokenMessengerV2. */
  tokenMessengerV2: '0x28b5a0e9c621a5badaa536219b3a228c8168cf5d',
  /** Circle /v1/info: Cardano (10004) USDCx remote token identifier. */
  cardanoRemoteToken: '0x9ea9794d33dbcef3f77718e903816e877ab2577f4d7ee653638f1f60fc671dd6',
  /** CCTP v2 finality thresholds: fast 1000, standard 2000. */
  fastFinality: 1000,
  standardFinality: 2000,
  /** The forwarding hook payload: ASCII "cctp-forward", right-padded to 32 bytes. */
  hookData: '0x636374702d666f72776172640000000000000000000000000000000000000000',
})

const DEPOSIT_FOR_BURN_WITH_HOOK = [{
  type: 'function', name: 'depositForBurnWithHook', stateMutability: 'nonpayable', outputs: [],
  inputs: [
    { name: 'amount', type: 'uint256' }, { name: 'destinationDomain', type: 'uint32' },
    { name: 'mintRecipient', type: 'bytes32' }, { name: 'burnToken', type: 'address' },
    { name: 'destinationCaller', type: 'bytes32' }, { name: 'maxFee', type: 'uint256' },
    { name: 'minFinalityThreshold', type: 'uint32' }, { name: 'hookData', type: 'bytes' },
  ],
}] as const

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const bad = (message: string): never => { throw new ProviderFault('malformed', `Circle forwarded withdrawal: ${message}`) }
const ZERO32 = '0x' + '00'.repeat(32)
const address32 = (a: string) => '0x' + '00'.repeat(12) + a.slice(2).toLowerCase()

function uint(v: unknown, bytes: number): bigint {
  if (typeof v !== 'string' || v.length > 78 || !/^(0|[1-9][0-9]*)$/.test(v)) return bad('invalid integer terms')
  const n = BigInt(v)
  if (n >= 1n << BigInt(bytes * 8)) return bad('integer terms out of range')
  return n
}
function int(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > 0xffffffff) return bad('invalid domain or version')
  return v
}
function hex(v: unknown, bytes?: number): string {
  if (typeof v !== 'string' || !/^0x(?:[a-fA-F0-9]{2})*$/.test(v) || v.length > 32_770
      || (bytes !== undefined && v.length !== 2 + bytes * 2)) return bad('invalid encoded terms')
  return v.toLowerCase()
}
const packedUint = (n: bigint | number, bytes: number) => BigInt(n).toString(16).padStart(bytes * 2, '0')
const packedHex = (v: unknown, bytes?: number) => hex(v, bytes).slice(2)

function amountRaw(v: unknown, what: string): bigint {
  if (typeof v !== 'string' || v.length > 85 || !/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(v)) return bad(`${what} must have at most six decimals`)
  const [whole, fraction = ''] = v.split('.')
  const n = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
  if (n === 0n) return bad(`${what} must be positive`)
  return n
}
const decimal = (n: bigint) => `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, '0')}`

export interface ForwardedWithdrawalInput {
  /** USDC requested at Solana, excluding fees (decimal, <= 6 places). */
  amount: string
  /** Established by the privileged Cardano integration, never a renderer. */
  remoteDepositor: string
  /** Solana address (base58, 32 bytes); see the recipient-convention caveat above. */
  solanaRecipient: string
  /** Ceiling for the outer burn fee Circle returns, integer base units. */
  maxBurnFeeRaw: string
  /** Ceiling for the CCTP forwarding fee written into the nested call, decimal USDC. */
  forwardingMaxFee: string
  fastFinality: boolean
}

interface Expected {
  amount: bigint; remoteDepositor: string; mintRecipient: string; maxBurnFee: bigint; forwardingMaxFee: bigint; finality: number
}

function expected(input: ForwardedWithdrawalInput): Expected {
  if (!obj(input)) return bad('missing withdrawal terms')
  const remoteDepositor = hex(input.remoteDepositor, 32)
  if (remoteDepositor === ZERO32) bad('empty remote depositor')
  let recipient: Uint8Array
  try { recipient = base58.decode(String(input.solanaRecipient)) } catch { return bad('invalid Solana recipient') }
  if (recipient.length !== 32 || recipient.every(b => b === 0)) bad('invalid Solana recipient')
  if (typeof input.fastFinality !== 'boolean') bad('finality speed must be stated')
  return {
    amount: amountRaw(input.amount, 'amount'), remoteDepositor,
    mintRecipient: '0x' + Array.from(recipient, b => b.toString(16).padStart(2, '0')).join(''),
    maxBurnFee: uint(input.maxBurnFeeRaw, 32), forwardingMaxFee: amountRaw(input.forwardingMaxFee, 'forwarding fee cap'),
    finality: input.fastFinality ? XRESERVE_SOLANA_FORWARDING.fastFinality : XRESERVE_SOLANA_FORWARDING.standardFinality,
  }
}

export interface PreparedForwardedWithdrawal {
  destination: 'solana'
  /** The 32 bytes CCTP will mint to; wallet vs token-account convention unverified. */
  mintRecipient: string
  remoteDepositor: string
  amountRaw: string
  /** Outer burn fee (USDCx) Circle returned, within the caller's cap. */
  burnFeeRaw: string
  /** USDCx to burn = value + burn fee; excludes Cardano ADA fees. */
  burnAmountRaw: string
  /** CCTP forwarding fee ceiling written into the nested call (deducted on the way). */
  forwardingMaxFeeRaw: string
  minFinalityThreshold: number
  maxBlockHeight: string
  encoded: string
  transferSpecHash: string
  recipientConvention: 'unverified'
  executable: false
}

/** Decode and pin both layers; reproduce every byte of `encoded` from them. */
export function validateForwardedWithdrawal(response: unknown, input: ForwardedWithdrawalInput): PreparedForwardedWithdrawal {
  const want = expected(input)
  const F = XRESERVE_SOLANA_FORWARDING
  if (!obj(response) || !Array.isArray(response.batches) || response.batches.length !== 1) return bad('expected one batch')
  const batch: unknown = response.batches[0]
  if (!obj(batch) || !Array.isArray(batch.burnIntents) || batch.burnIntents.length !== 1) return bad('expected one burn intent')
  hex(batch.messageHashToSign, 32) // Operator signature material, never wallet authorization.
  const burn: unknown = batch.burnIntents[0]
  if (!obj(burn) || !obj(burn.spec) || !obj(burn.spec.hookData)) return bad('missing burn specification')
  const spec = burn.spec as Record<string, unknown>
  const hook = spec.hookData as Record<string, unknown>

  // ── Outer: Ethereum Gateway -> Arc xReserve ──────────────────────────────
  const fee = uint(burn.maxFee, 32), value = uint(spec.value, 32), height = uint(burn.maxBlockHeight, 32)
  if (fee > want.maxBurnFee) bad('returned burn fee exceeds the allowed ceiling')
  if (value !== want.amount) bad('returned amount differs from the requested USDC')
  if (height === 0n) bad('invalid block limit')
  if (int(spec.version) !== 1 || int(spec.sourceDomain) !== 0 || int(spec.destinationDomain) !== F.arcDomain) bad('not an Ethereum-to-Arc transfer')
  const pins: Array<[unknown, string, string]> = [
    [spec.sourceContract, F.gatewayWallet, 'source contract'],
    [spec.destinationContract, F.gatewayMinter, 'destination contract'],
    [spec.sourceToken, XRESERVE_MAINNET.ethereum.usdc.toLowerCase(), 'source token'],
    [spec.destinationToken, F.arcUsdc, 'destination token'],
    [spec.destinationRecipient, F.arcXReserve, 'destination recipient'],
    [spec.destinationCaller, F.arcXReserve, 'destination caller'],
  ]
  for (const [got, pin, what] of pins) if (hex(got, 32) !== address32(pin)) bad(`${what} is not the pinned identity`)
  for (const v of [spec.sourceDepositor, spec.sourceSigner, spec.salt]) if (hex(v, 32) === ZERO32) bad('missing transfer identity')

  // ── Hook: the Cardano source and the forwarding contract ─────────────────
  if (int(hook.remoteDomain) !== XRESERVE_MAINNET.cardanoDomain) bad('remote domain is not Cardano')
  if (hex(hook.remoteDepositor, 32) !== want.remoteDepositor) bad('remote depositor differs from the requested Cardano account')
  if (hex(hook.remoteToken, 32) !== F.cardanoRemoteToken) bad('remote token is not Cardano USDCx')
  if (typeof hook.forwardingContractAddress !== 'string' || hook.forwardingContractAddress.toLowerCase() !== F.tokenMessengerV2) {
    bad('forwarding contract is not Arc TokenMessengerV2')
  }
  const calldata = hex(hook.forwardingCalldata)

  // ── Nested: depositForBurnWithHook to Solana ─────────────────────────────
  let call: ReturnType<typeof decodeFunctionData<typeof DEPOSIT_FOR_BURN_WITH_HOOK>>
  try { call = decodeFunctionData({ abi: DEPOSIT_FOR_BURN_WITH_HOOK, data: calldata as Hex }) } catch { return bad('forwarding call is not depositForBurnWithHook') }
  const [amount, domain, mintRecipient, burnToken, destinationCaller, maxFee, finality, hookData] = call.args
  if (encodeFunctionData({ abi: DEPOSIT_FOR_BURN_WITH_HOOK, functionName: 'depositForBurnWithHook', args: call.args }).toLowerCase() !== calldata) {
    bad('forwarding call carries extra or non-canonical bytes')
  }
  if (amount !== value) bad('forwarded amount differs from the withdrawal')
  if (domain !== F.solanaDomain) bad('forwarding destination is not Solana')
  if (mintRecipient.toLowerCase() !== want.mintRecipient) bad('forwarding recipient differs from the requested Solana address')
  if (burnToken.toLowerCase() !== F.arcUsdc) bad('forwarding burns a token other than Arc USDC')
  if (destinationCaller.toLowerCase() !== ZERO32) bad('restricted destination caller is unsupported')
  if (maxFee > want.forwardingMaxFee) bad('forwarding fee cap exceeds the allowed ceiling')
  if (finality !== want.finality) bad('forwarding finality differs from the requested speed')
  if (hookData.toLowerCase() !== F.hookData) bad('forwarding hook payload is not the CCTP forward marker')

  // ── Reproduce Circle's encoding byte for byte ───────────────────────────
  const callBytes = calldata.slice(2)
  const hookBytes = '6b20f62a' + packedUint(1, 4) + packedUint(XRESERVE_MAINNET.cardanoDomain, 4)
    + packedHex(hook.remoteToken, 32) + packedHex(hook.remoteDepositor, 32)
    + packedHex(address32(F.tokenMessengerV2), 32) + packedUint(callBytes.length / 2, 4) + callBytes
  const specBytes = 'ca85def7' + packedUint(1, 4) + packedUint(0, 4) + packedUint(F.arcDomain, 4)
    + [spec.sourceContract, spec.destinationContract, spec.sourceToken, spec.destinationToken,
      spec.sourceDepositor, spec.destinationRecipient, spec.sourceSigner, spec.destinationCaller].map(v => packedHex(v, 32)).join('')
    + packedUint(value, 32) + packedHex(spec.salt, 32) + packedUint(hookBytes.length / 2, 4) + hookBytes
  const canonical = '0x070afbc2' + packedUint(height, 32) + packedUint(fee, 32) + packedUint(specBytes.length / 2, 4) + specBytes
  const encoded = hex(batch.encoded)
  if (encoded !== canonical && encoded !== '0xe999239b00000001' + canonical.slice(2)) bad('encoded burn differs from the returned terms')

  return {
    destination: 'solana', mintRecipient: want.mintRecipient, remoteDepositor: want.remoteDepositor,
    amountRaw: value.toString(), burnFeeRaw: fee.toString(), burnAmountRaw: (value + fee).toString(),
    forwardingMaxFeeRaw: maxFee.toString(), minFinalityThreshold: finality,
    maxBlockHeight: height.toString(), encoded, transferSpecHash: keccak256(('0x' + specBytes) as Hex),
    recipientConvention: 'unverified', executable: false,
  }
}

/** The preparation request (nonfunding). Mainnet only: Arc forwarding was measured there. */
export function forwardedWithdrawalRequest(input: ForwardedWithdrawalInput): unknown {
  const want = expected(input)
  return { batches: [{
    token: 'USDC', valueExcludingFees: decimal(want.amount),
    remoteDomain: XRESERVE_MAINNET.cardanoDomain, remoteDepositor: want.remoteDepositor,
    finalDestinationDomain: XRESERVE_SOLANA_FORWARDING.solanaDomain, finalDestinationRecipient: want.mintRecipient,
    useCircleForwarding: true,
    forwardingOptions: { maxFee: decimal(want.forwardingMaxFee), usesFastFinality: input.fastFinality },
  }] }
}

export async function prepareForwardedWithdrawal(
  input: ForwardedWithdrawalInput, opts: { fetchFn?: HttpFetchFn } = {},
): Promise<PreparedForwardedWithdrawal> {
  const body = forwardedWithdrawalRequest(input)
  let response: Response
  try {
    response = await (opts.fetchFn ?? fetch)(`${XRESERVE_MAINNET.circleApiBase}/v1/prepare-withdrawal`, {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15_000), redirect: 'error',
    })
  } catch { throw new ProviderFault('unavailable', 'Circle forwarded withdrawal: request failed or timed out') }
  if (response.status !== 200) {
    throw new ProviderFault(response.status === 429 ? 'rate-limited' : 'unavailable', `Circle forwarded withdrawal: HTTP ${response.status}`)
  }
  let data: unknown
  try { data = await response.json() } catch { return bad('response is not JSON') }
  return validateForwardedWithdrawal(data, input)
}
