/**
 * Read-only Circle-side outbound status, bound to the operator's known burn
 * and transfer specification. See Circle xReserve OpenAPI WithdrawalResponse.
 *
 * This is not an independent Cardano burn proof or Ethereum USDC receipt proof.
 * Even Circle 'finalized' returns deliveryVerified: false. The future outbound
 * coordinator must obtain both ledger proofs before completing a bridge route.
 * Never retries /withdraw, burns again, or treats expired/404 as a refund.
 */
import { ProviderFault, type HttpFetchFn } from './xreserve-cardano-provider'
import { xreserveNetwork, type XReserveNetwork } from './xreserve-network'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HASH = /^0x[0-9a-f]{64}$/i
const CARDANO_HASH = /^(?:0x)?[0-9a-f]{64}$/i
const STATES = ['created', 'verified', 'confirmed', 'finalized', 'expired', 'failed'] as const
import type { CircleWithdrawalState, CircleWithdrawalStatus, WithdrawalReference } from '../shared/xreserve-testnet-wire'
export type { CircleWithdrawalState, CircleWithdrawalStatus, WithdrawalReference }
const bad = (reason: string): never => { throw new ProviderFault('malformed', `Circle withdrawal status: ${reason}`) }
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function reference(v: WithdrawalReference): WithdrawalReference {
  if (!obj(v) || typeof v.withdrawalId !== 'string' || !UUID.test(v.withdrawalId)
      || typeof v.burnTxHash !== 'string' || !CARDANO_HASH.test(v.burnTxHash)
      || typeof v.transferSpecHash !== 'string' || !HASH.test(v.transferSpecHash)) return bad('invalid withdrawal reference')
  return { withdrawalId: v.withdrawalId.toLowerCase(), burnTxHash: v.burnTxHash.replace(/^0x/i, '').toLowerCase(), transferSpecHash: v.transferSpecHash.toLowerCase() }
}

export function validateCircleWithdrawalStatus(body: unknown, known: WithdrawalReference): CircleWithdrawalStatus {
  const want = reference(known)
  if (!obj(body) || typeof body.withdrawalId !== 'string' || body.withdrawalId.toLowerCase() !== want.withdrawalId
      || typeof body.burnTxId !== 'string' || !CARDANO_HASH.test(body.burnTxId)
      || body.burnTxId.replace(/^0x/i, '').toLowerCase() !== want.burnTxHash) return bad('response belongs to a different withdrawal or burn')
  if (!Array.isArray(body.transferSpecHashes) || body.transferSpecHashes.length !== 1
      || typeof body.transferSpecHashes[0] !== 'string' || body.transferSpecHashes[0].toLowerCase() !== want.transferSpecHash) return bad('response belongs to a different transfer specification')
  if (body.useCircleForwarding !== true || !STATES.includes(body.status as CircleWithdrawalState)) return bad('unsupported forwarding or status')
  if (body.transactionHash !== undefined && (typeof body.transactionHash !== 'string' || !HASH.test(body.transactionHash))) return bad('invalid forwarded transaction hash')
  return { ...want, state: body.status as CircleWithdrawalState,
    transactionHash: typeof body.transactionHash === 'string' ? body.transactionHash.toLowerCase() : null,
    deliveryVerified: false }
}

export async function fetchCircleWithdrawalStatus(
  known: WithdrawalReference, opts: { network?: XReserveNetwork; fetchFn?: HttpFetchFn } = {},
): Promise<CircleWithdrawalStatus> {
  const want = reference(known), net = xreserveNetwork(opts.network)
  let response: Response
  try {
    response = await (opts.fetchFn ?? fetch)(`${net.circleApiBase}/v1/withdrawal/${want.withdrawalId}`, {
      headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000), redirect: 'error',
    })
  } catch { throw new ProviderFault('unavailable', 'Circle withdrawal status: request failed or timed out') }
  if (response.status !== 200) throw new ProviderFault(response.status === 429 ? 'rate-limited'
    : response.status === 404 ? 'not-found' : 'unavailable', `Circle withdrawal status: HTTP ${response.status}`)
  let body: unknown
  try { body = await response.json() } catch { return bad('response is not JSON') }
  return validateCircleWithdrawalStatus(body, want)
}
