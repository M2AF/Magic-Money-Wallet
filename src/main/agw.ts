/**
 * agw.ts — Abstract Global Wallet (AGW) resolution + ownership
 *
 * MAIN-process helper shared by token-fetcher, balance-fetcher, ipc-handlers.
 *
 * An AGW is a zkSync-native smart-contract account on Abstract (chainId 2741).
 * IMPORTANT — there are two distinct relationships, and they are NOT the same:
 *
 *   1. Deployment: salt = keccak256(initialSigner) → factory.getAddressForSalt.
 *      This only yields a user's real AGW if THIS wallet's EOA was the AGW's
 *      initial deployer signer (rare — most users create the AGW with an
 *      email/passkey/Privy embedded signer, then link an external wallet).
 *
 *   2. Linking: the canonical ExclusiveDelegateResolver maps an EOA → the AGW
 *      it is linked to (the portal's "Login with Wallet" association).
 *
 * Most AGWs are owned on-chain by a Privy *embedded* signer, NOT the user's
 * external wallet — in which case this app CANNOT sign for the AGW (writes must
 * go through the Abstract portal / Privy). `isEoaAgwOwner` checks the real
 * on-chain K1 owner so we only ever enable sending when it will actually work.
 *
 * Constants below are taken from @abstract-foundation/agw-client's own source
 * (constants.js) — do not substitute older factory/resolver addresses.
 */

import { keccak256, toBytes, encodeFunctionData, decodeFunctionResult, parseAbi, getAddress, isAddress } from 'viem'

export const ABSTRACT_RPC = 'https://api.mainnet.abs.xyz'

const SMART_ACCOUNT_FACTORY        = '0x9B947df68D35281C972511B3E7BC875926f26C1A' as const
const EXCLUSIVE_DELEGATE_RESOLVER  = '0x0000000078CC4Cc1C14E27c0fa35ED6E5E58825D' as const
// bytes24(keccak256("AGW_LINK")) — the rights key the resolver uses for AGW links.
const AGW_LINK_RIGHTS              = '0xc10dcfe266c1f71ef476efbd3223555750dc271e4115626b' as const

const FACTORY_ABI  = parseAbi(['function getAddressForSalt(bytes32 salt) view returns (address)'])
const RESOLVER_ABI = parseAbi(['function exclusiveWalletByRights(address vault, bytes24 rights) view returns (address)'])
const ACCOUNT_ABI  = parseAbi(['function k1ListOwners() view returns (address[])'])

async function ethCall(to: string, data: string): Promise<string | null> {
  try {
    const res = await fetch(ABSTRACT_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
      signal: AbortSignal.timeout(8_000)
    })
    const json = await res.json() as { result?: string }
    return (json.result && json.result !== '0x') ? json.result : null
  } catch {
    return null
  }
}

/**
 * Counterfactual AGW address for an EOA acting as the *initial deployer signer*.
 * Only equals the user's real AGW when they deployed it with this wallet.
 */
export async function deriveAgwAddress(eoa: string): Promise<string | null> {
  const data = encodeFunctionData({ abi: FACTORY_ABI, functionName: 'getAddressForSalt', args: [keccak256(toBytes(eoa as `0x${string}`))] })
  const hex = await ethCall(SMART_ACCOUNT_FACTORY, data)
  return hex && hex.length >= 42 ? getAddress(('0x' + hex.slice(-40)) as `0x${string}`) : null
}

/**
 * The AGW an EOA is linked to via the canonical resolver, or null if none.
 * (The resolver echoes the input address back when there is no link.)
 */
export async function getLinkedAgw(eoa: string): Promise<string | null> {
  if (!isAddress(eoa)) return null
  const data = encodeFunctionData({ abi: RESOLVER_ABI, functionName: 'exclusiveWalletByRights', args: [getAddress(eoa), AGW_LINK_RIGHTS] })
  const hex = await ethCall(EXCLUSIVE_DELEGATE_RESOLVER, data)
  if (!hex || hex.length < 42) return null
  const resolved = getAddress(('0x' + hex.slice(-40)) as `0x${string}`)
  return resolved.toLowerCase() === eoa.toLowerCase() ? null : resolved
}

/** True only when `eoa` is an on-chain K1 owner of `agw` → this app can sign for it. */
export async function isEoaAgwOwner(eoa: string, agw: string): Promise<boolean> {
  if (!isAddress(eoa) || !isAddress(agw)) return false
  const hex = await ethCall(agw, encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'k1ListOwners', args: [] }))
  if (!hex) return false
  try {
    const owners = decodeFunctionResult({ abi: ACCOUNT_ABI, functionName: 'k1ListOwners', data: hex as `0x${string}` }) as readonly string[]
    return owners.some(o => o.toLowerCase() === eoa.toLowerCase())
  } catch {
    return false
  }
}

/**
 * Resolve the AGW for an account and whether this wallet can sign for it.
 *   agw      = manual override ?? on-chain linked AGW (no counterfactual guess)
 *   agwOwned = the EOA is a real K1 owner → direct send works; else watch-only.
 */
export async function resolveAccountAgw(eoa: string, override?: string | null): Promise<{ agw?: string; agwOwned: boolean }> {
  const candidate = (override && isAddress(override)) ? getAddress(override) : await getLinkedAgw(eoa)
  if (!candidate) return { agw: undefined, agwOwned: false }
  return { agw: candidate, agwOwned: await isEoaAgwOwner(eoa, candidate) }
}
