/**
 * Circle-side outbound withdrawal preparation. No key access, burn building,
 * signing, /withdraw submission or settlement claim lives here.
 *
 * Sources: developers.circle.com/openapi/xreserve.yaml (v1.0.0, 2026-10-04),
 * circlefin/evm-gateway-contracts src/lib/{BurnIntents,TransferSpec}.sol,
 * circlefin/evm-xreserve-contracts src/lib/WithdrawHookData.sol.
 *
 * This first adapter accepts direct Ethereum USDC delivery only. A future
 * privileged Cardano operator adapter must establish remoteDepositor encoding
 * and registered remote-token/contract identities before supplying this input.
 * Prepared bytes are NOT a wallet signing authorization. The operator's
 * messageHashToSign is deliberately not exposed as a user signing request.
 */
import { getAddress, isAddress, keccak256, type Hex } from 'viem'
import { ProviderFault, type HttpFetchFn } from './xreserve-cardano-provider'
import { xreserveNetwork, type XReserveNetwork } from './xreserve-network'

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const bad = (message: string): never => { throw new ProviderFault('malformed', `Circle withdrawal: ${message}`) }
const MAX_UINT256 = (1n << 256n) - 1n
const ZERO32 = '0x' + '00'.repeat(32)

function uint(v: unknown, bytes: number): bigint {
  if (typeof v !== 'string' || v.length > 78 || !/^(0|[1-9][0-9]*)$/.test(v)) return bad('invalid integer terms')
  const n = BigInt(v)
  if (n >= 1n << BigInt(bytes * 8)) return bad('integer terms out of range')
  return n
}
function number(v: unknown): string {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > 0xffffffff) return bad('invalid domain or version')
  return String(v)
}
function hex(v: unknown, bytes?: number): string {
  if (typeof v !== 'string' || !/^0x(?:[a-fA-F0-9]{2})*$/.test(v) || v.length > 32_770
      || (bytes !== undefined && v.length !== 2 + bytes * 2)) return bad('invalid encoded terms')
  return v.toLowerCase()
}
const packedUint = (v: unknown, bytes: number) => uint(v, bytes).toString(16).padStart(bytes * 2, '0')
const packedHex = (v: unknown, bytes?: number) => hex(v, bytes).slice(2)
const address32 = (v: string) => '0x' + '00'.repeat(12) + v.slice(2).toLowerCase()

/** Exact six-decimal amounts, never floating point or rounded. */
function amountRaw(v: unknown): bigint {
  if (typeof v !== 'string' || v.length > 85 || !/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(v)) return bad('amount must have at most six decimals')
  const [whole, fraction = ''] = v.split('.')
  const n = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
  if (n === 0n || n > MAX_UINT256) return bad('amount out of range')
  return n
}
const decimal = (n: bigint) => `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, '0')}`

export interface WithdrawalPrepareInput {
  /** USDC requested at the destination, excluding fees. */
  amount: string
  /** Established by the privileged remote-chain integration, not a renderer. */
  remoteDepositor: string
  /** Ethereum address; this initial adapter supports domain 0 only. */
  recipient: string
  /** Wallet/user ceiling for Circle's returned burn fee, integer base units. */
  maxFeeRaw: string
}

interface Expected {
  amount: bigint; maxFee: bigint; remoteDepositor: string; recipient: string; network: XReserveNetwork
}
function expected(input: WithdrawalPrepareInput, network?: XReserveNetwork): Expected {
  const net = xreserveNetwork(network)
  if (!obj(input)) return bad('missing withdrawal terms')
  if (typeof input.recipient !== 'string' || !isAddress(input.recipient, { strict: false }) || /^0x0{40}$/i.test(input.recipient)) return bad('invalid Ethereum recipient')
  const remoteDepositor = hex(input.remoteDepositor, 32)
  if (remoteDepositor === ZERO32) return bad('empty remote depositor')
  return { amount: amountRaw(input.amount), maxFee: uint(input.maxFeeRaw, 32), remoteDepositor, recipient: getAddress(input.recipient), network: net }
}

export interface PreparedWithdrawal {
  network: XReserveNetwork['id']
  recipient: string
  remoteDepositor: string
  destinationDomain: 0
  amountRaw: string
  maxFeeRaw: string
  /** USDCx to burn = value + maxFee; excludes the separate Cardano ADA fee. */
  burnAmountRaw: string
  /** Source-domain block limit returned by Circle, NOT a Cardano TTL. */
  maxBlockHeight: string
  encoded: string
  /** Bind a later Circle status to this exact transfer. */
  transferSpecHash: string
  /** Always false until a separate operator/burn-validator integration exists. */
  executable: false
}

/**
 * Reconstruct every byte using Circle's published big-endian layouts. This
 * binds all JSON fields to the encoded payload rather than trusting a friendly
 * amount/recipient alongside different bytes. Only one intent is accepted.
 */
export function validatePreparedWithdrawal(
  response: unknown, input: WithdrawalPrepareInput, network?: XReserveNetwork,
): PreparedWithdrawal {
  const want = expected(input, network)
  if (!obj(response) || !Array.isArray(response.batches) || response.batches.length !== 1) return bad('expected one batch')
  const batch: unknown = response.batches[0]
  if (!obj(batch) || !Array.isArray(batch.burnIntents) || batch.burnIntents.length !== 1) return bad('expected one burn intent')
  hex(batch.messageHashToSign, 32) // Operator signature material, not wallet authorization.
  const burn: unknown = batch.burnIntents[0]
  if (!obj(burn) || !obj(burn.spec)) return bad('missing burn specification')
  const spec = burn.spec
  if (!obj(spec.hookData)) return bad('missing withdrawal hook')
  const hook = spec.hookData
  const fee = uint(burn.maxFee, 32), value = uint(spec.value, 32), height = uint(burn.maxBlockHeight, 32)
  if (fee > want.maxFee) return bad('returned burn fee exceeds the allowed ceiling')
  if (value !== want.amount) return bad('returned amount differs from the requested USDC')
  if (value + fee > MAX_UINT256 || height === 0n) return bad('invalid burn amount or block limit')
  if (number(spec.version) !== '1' || number(spec.sourceDomain) !== '0' || number(spec.destinationDomain) !== '0') return bad('unsupported transfer version or domain')
  if (hex(spec.destinationToken, 32) !== address32(want.network.ethereum.usdc)) return bad('destination token is not the pinned USDC')
  if (hex(spec.destinationRecipient, 32) !== address32(want.recipient)) return bad('destination recipient differs from requested address')
  if (number(hook.remoteDomain) !== String(want.network.cardanoDomain) || hex(hook.remoteDepositor, 32) !== want.remoteDepositor) return bad('remote source differs from requested Cardano account')
  // Routing to other networks requires a separate forwarding-calldata verifier.
  if (hook.forwardingContractAddress !== '0x0000000000000000000000000000000000000000' || hex(hook.forwardingCalldata) !== '0x') return bad('forwarding routes are not supported by this adapter')
  if (hex(spec.destinationCaller, 32) !== ZERO32) return bad('restricted destination caller is unsupported')
  // Required registered identities are retained in the bytes, but cannot be
  // approved for signing until the operator integration pins their meaning.
  for (const v of [spec.sourceContract, spec.destinationContract, spec.sourceToken, spec.sourceDepositor, spec.sourceSigner, hook.remoteToken]) {
    if (hex(v, 32) === ZERO32) return bad('missing registered transfer identity')
  }
  const hookBytes = '6b20f62a' + packedUint('1', 4) + packedUint(number(hook.remoteDomain), 4)
    + packedHex(hook.remoteToken, 32) + packedHex(hook.remoteDepositor, 32)
    + packedHex(address32(hook.forwardingContractAddress), 32) + packedUint('0', 4)
  const specBytes = 'ca85def7' + packedUint(number(spec.version), 4)
    + packedUint(number(spec.sourceDomain), 4) + packedUint(number(spec.destinationDomain), 4)
    + [spec.sourceContract, spec.destinationContract, spec.sourceToken, spec.destinationToken,
      spec.sourceDepositor, spec.destinationRecipient, spec.sourceSigner, spec.destinationCaller].map(v => packedHex(v, 32)).join('')
    + packedUint(spec.value, 32) + packedHex(spec.salt, 32) + packedUint(String(hookBytes.length / 2), 4) + hookBytes
  const canonical = '0x070afbc2' + packedUint(burn.maxBlockHeight, 32) + packedUint(burn.maxFee, 32)
    + packedUint(String(specBytes.length / 2), 4) + specBytes
  const encoded = hex(batch.encoded)
  // Circle also documents sets. A set with exactly one matching intent is
  // harmless; anything extra or malformed cannot reproduce these bytes.
  if (encoded !== canonical && encoded !== '0xe999239b00000001' + canonical.slice(2)) return bad('encoded burn differs from the returned terms')
  return {
    network: want.network.id, recipient: want.recipient, remoteDepositor: want.remoteDepositor,
    destinationDomain: 0, amountRaw: value.toString(), maxFeeRaw: fee.toString(),
    burnAmountRaw: (value + fee).toString(), maxBlockHeight: height.toString(), encoded,
    transferSpecHash: keccak256(('0x' + specBytes) as Hex), executable: false,
  }
}

export async function prepareXReserveWithdrawal(
  input: WithdrawalPrepareInput,
  opts: { network?: XReserveNetwork; fetchFn?: HttpFetchFn } = {},
): Promise<PreparedWithdrawal> {
  const want = expected(input, opts.network)
  const body = { batches: [{ token: 'USDC', valueExcludingFees: decimal(want.amount),
    remoteDomain: want.network.cardanoDomain, remoteDepositor: want.remoteDepositor,
    finalDestinationDomain: 0, finalDestinationRecipient: address32(want.recipient), useCircleForwarding: true }] }
  let response: Response
  try {
    response = await (opts.fetchFn ?? fetch)(`${want.network.circleApiBase}/v1/prepare-withdrawal`, {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15_000), redirect: 'error',
    })
  } catch { throw new ProviderFault('unavailable', 'Circle withdrawal: request failed or timed out') }
  if (response.status !== 200) {
    throw new ProviderFault(response.status === 429 ? 'rate-limited' : 'unavailable', `Circle withdrawal: HTTP ${response.status}`)
  }
  let data: unknown
  try { data = await response.json() } catch { return bad('response is not JSON') }
  return validatePreparedWithdrawal(data, input, want.network)
}
