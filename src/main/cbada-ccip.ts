/**
 * cbada-ccip.ts — Coinbase Wrapped ADA (cbADA) over Chainlink CCIP: pinned
 * identities and read-only capability checks (privileged layer).
 *
 * SOURCES (2026-10-05).
 * - Chainlink CCIP mainnet directory: the token page for cbADA and the chain
 *   pages for Base and Solana (token addresses, pools, pool types, lanes,
 *   rate limits, routers, chain selectors).
 * - Base mainnet, read on chain: the token reports name "Coinbase Wrapped ADA",
 *   symbol cbADA, 6 decimals. The router supports the Solana selector. The
 *   pool is "LockReleaseTokenPool 2.0.0" for this exact token, supports Solana,
 *   and its remote token is exactly the Solana mint below.
 *
 * LANES. The directory lists Base<->Solana and Base<->Robinhood Chain; there is
 * no Solana<->Robinhood lane, and Robinhood Chain is not a wallet network. The
 * Base pool is LOCK/RELEASE: sending to Base RELEASES cbADA the pool holds, so
 * that direction is limited by the pool's balance (0 when checked). Solana's pool
 * is BURN/MINT.
 *
 * Nothing here sends a CCIP message: discovery and pricing only. Execution
 * (approval, ccipSend, message-id tracking, destination credit proof) is a
 * separate, validated unit.
 */

import { createPublicClient, http, parseAbi, encodeAbiParameters, type Hex } from 'viem'
import { base } from 'viem/chains'
import { base58 } from '@scure/base'

export type CbAdaChain = 'base' | 'solana'

export const CBADA = Object.freeze({
  base: Object.freeze({
    token: '0xcbADA732173e39521CDBE8bf59a6Dc85A9fc7b8c',
    decimals: 6,
    pool: '0x8d8C266E08ac7a24A79b9d6A2ce32cE1d908c61F',
    poolType: 'lock-release' as const,
    router: '0x881e3A65B4d4a04dD529061dd0071cf975F58bCD',
    selector: 15971525489660198786n,
  }),
  solana: Object.freeze({
    token: 'cbADAmv9issuPfhFwyQG3xac4DGPd1LDSt1oz7vwJsg',
    decimals: 6,
    pool: '8CpyxupqVZupuFW3TtFwbokv8e5rQMv6irwuj5PPYrab',
    poolType: 'burn-mint' as const,
    router: 'Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C',
    selector: 124615329519749607n,
  }),
  /** Per-lane outbound capacity from the directory: 10,000,000 cbADA (refill ~115.74/s). */
  laneCapacityRaw: 10_000_000_000_000n,
})

/** The lanes the directory lists between wallet networks. */
export const CBADA_LANES: ReadonlyArray<readonly [CbAdaChain, CbAdaChain]> = [['base', 'solana'], ['solana', 'base']]

export function cbAdaLane(from: string, to: string): boolean {
  return CBADA_LANES.some(([a, b]) => a === from && b === to)
}

export function isCbAda(chain: string, address: string): boolean {
  if (chain === 'base') return address.toLowerCase() === CBADA.base.token.toLowerCase()
  if (chain === 'solana') return address === CBADA.solana.token
  return false
}

const ROUTER_ABI = parseAbi([
  'function getFee(uint64 destinationChainSelector, (bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) view returns (uint256)',
])
const ERC20_ABI = parseAbi(['function balanceOf(address) view returns (uint256)'])
/** CCIP SVMExtraArgsV1 tag: (uint32 computeUnits, uint64 writableBitmap, bool outOfOrder, bytes32 tokenReceiver, bytes32[] accounts). */
const SVM_EXTRA_ARGS_V1 = '0x1f3b3aba'

export interface CcipReads {
  /** CCIP fee for Base -> Solana in wei (native ETH). Null when it could not be read. */
  feeBaseToSolana(amountRaw: bigint, solanaRecipient: string): Promise<bigint | null>
  /** cbADA the Base lock/release pool holds: the most a transfer TO Base can release. */
  baseReleaseLiquidity(): Promise<bigint | null>
}

/** Token-only transfer to a Solana wallet: no receiver program, the wallet as token receiver. */
export function svmTokenTransferExtraArgs(solanaRecipient: string): Hex {
  const key = base58.decode(solanaRecipient)
  if (key.length !== 32) throw new Error('Invalid Solana recipient')
  const receiver = ('0x' + Array.from(key, b => b.toString(16).padStart(2, '0')).join('')) as Hex
  return (SVM_EXTRA_ARGS_V1 + encodeAbiParameters(
    [{ type: 'tuple', components: [{ type: 'uint32' }, { type: 'uint64' }, { type: 'bool' }, { type: 'bytes32' }, { type: 'bytes32[]' }] }],
    [[0, 0n, true, receiver, []]],
  ).slice(2)) as Hex
}

export function baseCcipReads(rpcUrl: string): CcipReads {
  const client = createPublicClient({ chain: base, transport: http(rpcUrl, { timeout: 15_000 }) })
  return {
    async feeBaseToSolana(amountRaw, solanaRecipient) {
      try {
        return await client.readContract({
          address: CBADA.base.router as Hex, abi: ROUTER_ABI, functionName: 'getFee',
          args: [CBADA.solana.selector, {
            receiver: ('0x' + '00'.repeat(32)) as Hex, data: '0x',
            tokenAmounts: [{ token: CBADA.base.token as Hex, amount: amountRaw }],
            feeToken: '0x0000000000000000000000000000000000000000', extraArgs: svmTokenTransferExtraArgs(solanaRecipient),
          }],
        })
      } catch { return null }
    },
    async baseReleaseLiquidity() {
      try {
        return await client.readContract({ address: CBADA.base.token as Hex, abi: ERC20_ABI, functionName: 'balanceOf', args: [CBADA.base.pool as Hex] })
      } catch { return null }
    },
  }
}

/** Try each RPC in order per read; a read that fails everywhere is null (unknown), never zero. */
export function baseCcipReadsWithFallback(rpcUrls: string[]): CcipReads {
  const readers = rpcUrls.map(baseCcipReads)
  const first = async <T>(f: (r: CcipReads) => Promise<T | null>): Promise<T | null> => {
    for (const r of readers) { const v = await f(r); if (v !== null) return v }
    return null
  }
  return {
    feeBaseToSolana: (amount, recipient) => first(r => r.feeBaseToSolana(amount, recipient)),
    baseReleaseLiquidity: () => first(r => r.baseReleaseLiquidity()),
  }
}
