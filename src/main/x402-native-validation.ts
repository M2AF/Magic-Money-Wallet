/** Closed exact-scheme subsets: sponsor-paid classic SPL USDC; direct key-address ADA. */
import { PublicKey } from '@solana/web3.js'
import { bech32 } from '@scure/base'
import { decodeCardanoAddress } from './cardano-pure'
import { x402ResourceUrl } from './x402-validation'
import { NATIVE_NETWORKS, type AgentNativeNetwork, type NativeX402Required } from '../shared/agent-native'

export const SVM_USDC = {
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
} as const
export function nativeObject(raw: unknown, keys: string[], required = keys): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw new Error('Expected a plain request object.')
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(k => !keys.includes(k)) || required.some(k => !Object.hasOwn(value, k))) throw new Error('Missing or unsupported request field.')
  return value
}
export function nativeText(raw: unknown, max = 256): string {
  if (typeof raw !== 'string' || !raw || raw.length > max || /[\u0000-\u0020\u007f\u202a-\u202e\u2066-\u2069]/.test(raw)) throw new Error('Invalid request text.')
  return raw
}
export function nativeAddress(raw: unknown, network: AgentNativeNetwork): string {
  const address = nativeText(raw)
  if (NATIVE_NETWORKS[network].chain === 'solana') {
    const key = new PublicKey(address)
    if (key.toBase58() !== address || !PublicKey.isOnCurve(key.toBytes()) || key.equals(PublicKey.default)) throw new Error('Use a nonzero on-curve Solana address.')
  } else {
    const bytes = decodeCardanoAddress(address), type = bytes[0] >> 4, net = bytes[0] & 15
    const prefix = network === 'cardano:mainnet' ? 'addr' : 'addr_test'
    if (bech32.decode(address as `${string}1${string}`, 1000).prefix !== prefix || address !== address.toLowerCase()
      || !((type === 0 && bytes.length === 57) || (type === 6 && bytes.length === 29)) || net !== (prefix === 'addr' ? 1 : 0)) throw new Error('Use a key-payment Cardano address on the selected network.')
  }
  return address
}
export function validateNativeX402(raw: unknown, environment: string) {
  const args = nativeObject(raw, ['requestId', 'resourceUrl', 'paymentRequired'])
  const requestId = nativeText(args.requestId, 80), resourceUrl = x402ResourceUrl(args.resourceUrl)
  const payment = nativeObject(args.paymentRequired, ['x402Version', 'resource', 'accepts', 'error', 'extensions'], ['x402Version', 'resource', 'accepts'])
  if (payment.x402Version !== 2) throw new Error('Only x402 v2 is supported.')
  const resource = nativeObject(payment.resource, ['url', 'description', 'mimeType'], ['url'])
  if (x402ResourceUrl(resource.url) !== resourceUrl) throw new Error('Resource URL binding mismatch.')
  for (const value of [resource.description, resource.mimeType, payment.error]) if (value !== undefined && (typeof value !== 'string' || value.length > 240 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value))) throw new Error('Invalid merchant display text.')
  if (payment.extensions !== undefined) nativeObject(payment.extensions, [])
  if (!Array.isArray(payment.accepts) || payment.accepts.length !== 1) throw new Error('Select exactly one x402 payment option.')
  const accepted = nativeObject(payment.accepts[0], ['scheme', 'network', 'asset', 'amount', 'payTo', 'maxTimeoutSeconds', 'extra'])
  if (accepted.scheme !== 'exact' || typeof accepted.network !== 'string' || !Object.hasOwn(NATIVE_NETWORKS, accepted.network)) throw new Error('Unsupported exact payment network.')
  const network = accepted.network as AgentNativeNetwork, def = NATIVE_NETWORKS[network]
  if (environment !== def.environment) throw new Error('x402 network does not match paired mode.')
  const recipient = nativeAddress(accepted.payTo, network)
  if (typeof accepted.amount !== 'string' || !/^[1-9][0-9]{0,19}$/.test(accepted.amount) || BigInt(accepted.amount) >= 2n ** 64n) throw new Error('Use a positive uint64 amount in base units.')
  if (!Number.isInteger(accepted.maxTimeoutSeconds) || Number(accepted.maxTimeoutSeconds) < 15 || Number(accepted.maxTimeoutSeconds) > 300) throw new Error('Supported timeout is 15 to 300 seconds.')
  if (def.chain === 'solana') {
    if (accepted.asset !== SVM_USDC[network as keyof typeof SVM_USDC]) throw new Error('USDC mint does not match the pinned network asset.')
    const extra = nativeObject(accepted.extra, ['feePayer', 'memo', 'transactionVersions', 'ataCreationRequired'], ['feePayer'])
    nativeAddress(extra.feePayer, network)
    if (extra.memo !== undefined && (typeof extra.memo !== 'string' || !extra.memo || Buffer.byteLength(extra.memo, 'utf8') > 256 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(extra.memo))) throw new Error('Unsupported memo.')
    if (extra.transactionVersions !== undefined && (!Array.isArray(extra.transactionVersions) || extra.transactionVersions.length !== 1 || extra.transactionVersions[0] !== 0)) throw new Error('Only version 0 transactions are supported.')
    if (extra.ataCreationRequired !== undefined && extra.ataCreationRequired !== false) throw new Error('Recipient ATA must already exist.')
  } else {
    if (accepted.asset !== 'lovelace') throw new Error('Only direct ADA x402 payments are supported on Cardano.')
    const extra = nativeObject(accepted.extra, ['areFeesSponsored', 'confirmationPolicy'], [])
    if (extra.areFeesSponsored !== undefined && extra.areFeesSponsored !== false) throw new Error('Cardano fees are paid by this account.')
    if (extra.confirmationPolicy !== undefined) {
      const confirmations = nativeObject(extra.confirmationPolicy, ['l1Confirmations']).l1Confirmations
      if (!Number.isInteger(confirmations) || Number(confirmations) < 0 || Number(confirmations) > 20) throw new Error('Unsupported confirmation policy.')
    }
  }
  if (Buffer.byteLength(JSON.stringify(args), 'utf8') > 6000) throw new Error('x402 request too large.')
  return { requestId, resourceUrl, required: structuredClone(payment) as unknown as NativeX402Required, network, recipient, asset: accepted.asset as string, amountRaw: accepted.amount }
}
