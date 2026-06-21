/**
 * agw.ts — Abstract Global Wallet (AGW) address resolution
 *
 * MAIN-process helper shared by token-fetcher, balance-fetcher and tx-sender.
 *
 * An AGW is a zkSync-native smart-contract account on Abstract (chainId 2741).
 * Its address is deployed by the AGW factory deterministically from the initial
 * signer EOA:  salt = keccak256(initialSigner)  →  factory.getAddressForSalt(salt).
 * This matches @abstract-foundation/agw-client's official salt scheme, so the
 * value below is the *correct* AGW address ONLY when this wallet's EOA is the
 * AGW's initial signer (the "connect your wallet to AGW" flow). AGWs created
 * with an email/social signer won't match — those require a manual override and
 * are watch-only (we can't sign for them).
 */

import { keccak256, toBytes, encodeFunctionData, parseAbi } from 'viem'

export const AGW_FACTORY  = '0xe86Bf72715dF28a0b7c3C8F596E7fE05a22A139c' as const
export const ABSTRACT_RPC = 'https://api.mainnet.abs.xyz'

const AGW_FACTORY_ABI = parseAbi(['function getAddressForSalt(bytes32 salt) view returns (address)'])

/**
 * Deterministically resolve the AGW smart-account address for an EOA via the
 * Abstract factory. Returns null on RPC failure or empty result.
 */
export async function deriveAgwAddress(eoa: string): Promise<string | null> {
  try {
    const salt     = keccak256(toBytes(eoa as `0x${string}`))
    const callData = encodeFunctionData({ abi: AGW_FACTORY_ABI, functionName: 'getAddressForSalt', args: [salt] })
    const res = await fetch(ABSTRACT_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: AGW_FACTORY, data: callData }, 'latest'] }),
      signal: AbortSignal.timeout(8_000)
    })
    const json = await res.json() as { result?: string }
    const hex = json.result
    if (!hex || hex === '0x' || hex.length < 40) return null
    const agw = '0x' + hex.slice(-40)
    console.log(`[Abstract] AGW address: ${eoa.slice(0, 10)}… → ${agw}`)
    return agw
  } catch {
    return null
  }
}
