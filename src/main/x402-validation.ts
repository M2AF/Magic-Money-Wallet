import { isIP } from 'node:net'
import { getAddress, isAddress } from 'viem'
import type { X402PaymentRequired, X402Validated } from '../shared/x402'

// Circle contracts + upstream x402 DEFAULT_ASSETS at 56054d8f6b05c5ed2994fca1dc81a6252afd9d42.
// Addresses establish identity. Domain names are signing parameters, never token lookup keys.
export const X402_ASSETS = {
  'eip155:1': { chainId: 1, name: 'Ethereum', environment: 'mainnet', asset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', domainName: 'USD Coin' },
  'eip155:11155111': { chainId: 11155111, name: 'Sepolia', environment: 'testnet', asset: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', domainName: 'USDC' },
  'eip155:143': { chainId: 143, name: 'Monad', environment: 'mainnet', asset: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603', domainName: 'USDC' },
  'eip155:8453': { chainId: 8453, name: 'Base', environment: 'mainnet', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', domainName: 'USD Coin' },
  'eip155:84532': { chainId: 84532, name: 'Base Sepolia', environment: 'testnet', asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', domainName: 'USDC' },
} as const

function object(raw: unknown, allowed: string[], required = allowed): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null)) throw new Error('Expected a plain x402 object.')
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(value, k))) throw new Error('Unsupported or missing x402 field.')
  return value
}
function text(raw: unknown, limit: number): string {
  if (typeof raw !== 'string' || !raw || raw.length > limit || /[\u0000-\u0020\u007f\u202a-\u202e\u2066-\u2069]/.test(raw)) throw new Error('Invalid x402 text.')
  return raw
}
function displayText(raw: unknown, limit: number): void {
  if (typeof raw !== 'string' || raw.length > limit || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(raw)) throw new Error('Invalid x402 display text.')
}
function address(raw: unknown): string {
  if (typeof raw !== 'string' || !isAddress(raw, { strict: true }) || /^0x0{40}$/i.test(raw)) throw new Error('Invalid nonzero x402 address.')
  return getAddress(raw)
}
export function x402ResourceUrl(raw: unknown): string {
  const input = text(raw, 2048)
  let url: URL
  try { url = new URL(input) } catch { throw new Error('Invalid x402 resource URL.') }
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')
    || isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') || host.endsWith('.')
    || /(^|\.)(localhost|local|internal|lan|home|onion)$/.test(host)
    || !/^[a-z0-9.-]+$/.test(host)) throw new Error('Use an HTTPS resource URL with a public hostname and no credentials, fragment or custom port.')
  return url.href
}

/** No network activity or signing. Unsupported/ambiguous server fields fail closed. */
export function validateX402Proposal(raw: unknown, environment: string): X402Validated {
  const args = object(raw, ['requestId', 'resourceUrl', 'paymentRequired'])
  const requestId = text(args.requestId, 80), resourceUrl = x402ResourceUrl(args.resourceUrl)
  const payment = object(args.paymentRequired, ['x402Version', 'resource', 'accepts', 'error', 'extensions'], ['x402Version', 'resource', 'accepts'])
  if (payment.x402Version !== 2) throw new Error('Only x402 v2 is supported. Legacy X-PAYMENT requests are unsupported.')
  const resource = object(payment.resource, ['url', 'description', 'mimeType'], ['url'])
  if (x402ResourceUrl(resource.url) !== resourceUrl) throw new Error('Resource URL does not match the payment requirement.')
  if (resource.description !== undefined) displayText(resource.description, 240)
  if (resource.mimeType !== undefined) displayText(resource.mimeType, 80)
  if (payment.error !== undefined) displayText(payment.error, 240)
  if (payment.extensions !== undefined) object(payment.extensions, [])
  if (!Array.isArray(payment.accepts) || payment.accepts.length !== 1) throw new Error('Select exactly one supported x402 payment option; ambiguous requirements are rejected.')
  const accepted = object(payment.accepts[0], ['scheme', 'network', 'amount', 'asset', 'payTo', 'maxTimeoutSeconds', 'extra'])
  if (accepted.scheme !== 'exact' || typeof accepted.network !== 'string' || !Object.hasOwn(X402_ASSETS, accepted.network)) throw new Error('Unsupported x402 network or scheme. Select a pinned exact USDC network.')
  const asset = X402_ASSETS[accepted.network as keyof typeof X402_ASSETS]
  if (environment !== asset.environment) throw new Error('Payment network does not match the paired mainnet/testnet mode.')
  if (address(accepted.asset) !== asset.asset) throw new Error('USDC contract does not match the pinned chain asset.')
  const recipient = address(accepted.payTo)
  if (typeof accepted.amount !== 'string' || !/^[1-9][0-9]{0,77}$/.test(accepted.amount) || BigInt(accepted.amount) >= 2n ** 256n) throw new Error('Use a positive uint256 integer amount in USDC base units.')
  if (!Number.isInteger(accepted.maxTimeoutSeconds) || (accepted.maxTimeoutSeconds as number) < 15 || (accepted.maxTimeoutSeconds as number) > 300) throw new Error('Supported payment timeout is 15 to 300 seconds.')
  const extra = object(accepted.extra, ['name', 'version', 'assetTransferMethod', 'paymentFlow'], ['name', 'version'])
  if (extra.name !== asset.domainName || extra.version !== '2' || (extra.assetTransferMethod !== undefined && extra.assetTransferMethod !== 'eip3009')
    || (extra.paymentFlow !== undefined && extra.paymentFlow !== 'authorization')) throw new Error('Unsupported x402 domain, transfer method or payment flow.')
  // Keep the original validated requirements for the v2 accepted echo. Do not
  // silently drop extensions or rewrite the merchant's display/signing fields.
  const paymentRequired = structuredClone(payment) as unknown as X402PaymentRequired
  if (Buffer.byteLength(JSON.stringify(args), 'utf8') > 6000) throw new Error('x402 request is too large.')
  return { requestId, resourceUrl, paymentRequired, chainId: asset.chainId, networkName: asset.name, asset: asset.asset,
    recipient, amountRaw: accepted.amount, domainName: asset.domainName, environment: asset.environment }
}
