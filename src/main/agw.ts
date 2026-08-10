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
 * Third relationship, added once Abstract shipped key export: the user can pull
 * that embedded signer's own private key out of the portal (Settings → Export
 * Signer Private Key) and hand it to us. `agwForSigner` finds the AGW that key
 * controls, and `resolveAccountAgw` reports it as owned + signer-driven so the
 * send path signs with the imported key instead of this wallet's EOA.
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

/**
 * The AGW's on-chain K1 owners, or null when the call fails — which includes an
 * account that has not been deployed yet (eth_call returns '0x'). null means
 * "unknown", never "no owners", so callers must not read it as a denial.
 */
async function k1Owners(agw: string): Promise<string[] | null> {
  if (!isAddress(agw)) return null
  const hex = await ethCall(agw, encodeFunctionData({ abi: ACCOUNT_ABI, functionName: 'k1ListOwners', args: [] }))
  if (!hex) return null
  try {
    const owners = decodeFunctionResult({ abi: ACCOUNT_ABI, functionName: 'k1ListOwners', data: hex as `0x${string}` }) as readonly string[]
    return owners.map(o => o.toLowerCase())
  } catch {
    return null
  }
}

/** True only when `eoa` is an on-chain K1 owner of `agw` → this app can sign for it. */
export async function isEoaAgwOwner(eoa: string, agw: string): Promise<boolean> {
  if (!isAddress(eoa)) return false
  const owners = await k1Owners(agw)
  return owners?.includes(eoa.toLowerCase()) ?? false
}

/**
 * The AGW an *imported signer key* controls, or null.
 *
 * Two ways a signer reaches its AGW, tried in order: the resolver link, then the
 * factory salt (the portal's embedded signer IS the deployer signer, so the
 * counterfactual address is the real one). BOTH are confirmed against the live
 * k1ListOwners before being returned — `deriveAgwAddress` will happily produce a
 * plausible-looking address for a key that never created an AGW, and surfacing
 * that as the user's smart wallet would invite sends into a phantom account.
 */
export async function agwForSigner(signer: string): Promise<string | null> {
  if (!isAddress(signer)) return null
  const s = getAddress(signer)
  const linked = await getLinkedAgw(s)
  if (linked && await isEoaAgwOwner(s, linked)) return linked
  const derived = await deriveAgwAddress(s)
  if (derived && await isEoaAgwOwner(s, derived)) return derived
  return null
}

/**
 * Coerce an exported signer secret to a 0x-prefixed 32-byte private key, or null
 * when it isn't one. Accepts exactly what the Abstract portal's "Export Signer
 * Private Key" hands over (0x-prefixed hex) plus the bare-hex form, and tolerates
 * the whitespace a clipboard round-trip adds. Curve validity is left to
 * `privateKeyToAccount`, which rejects out-of-range scalars.
 */
export function normalizeSignerKey(secret: string): `0x${string}` | null {
  const cleaned = secret.trim().replace(/\s+/g, '')
  const hex = /^0x/i.test(cleaned) ? cleaned.slice(2) : cleaned
  return /^[0-9a-fA-F]{64}$/.test(hex) ? `0x${hex.toLowerCase()}` : null
}

export interface AgwResolution {
  agw?: string
  /** Some key we hold is a K1 owner → a direct send will actually go through. */
  agwOwned: boolean
  /** The imported signer key — not this wallet's EOA — is what must sign. */
  agwSignerActive?: boolean
}

/**
 * Resolve the AGW for an account and whether we can sign for it.
 *   agw             = manual override ?? on-chain linked AGW ?? the imported
 *                     signer's own AGW (never a counterfactual guess)
 *   agwOwned        = the EOA or the imported signer is a real K1 owner → direct
 *                     send works; else watch-only.
 *   agwSignerActive = the EOA is NOT an owner but the imported signer is, so the
 *                     send path has to use the imported key.
 */
export async function resolveAccountAgw(
  eoa: string,
  override?: string | null,
  signer?: string | null
): Promise<AgwResolution> {
  const signerAddr = (signer && isAddress(signer)) ? getAddress(signer) : null

  let candidate = (override && isAddress(override)) ? getAddress(override) : await getLinkedAgw(eoa)
  // No link from this wallet's EOA, but the user imported the portal's signer —
  // that key knows its own AGW even when nothing on-chain points at our EOA.
  if (!candidate && signerAddr) candidate = await agwForSigner(signerAddr)
  if (!candidate) return { agw: undefined, agwOwned: false }

  const owners = await k1Owners(candidate)
  const eoaOwns = owners?.includes(eoa.toLowerCase()) ?? false
  const signerOwns = signerAddr != null && (owners?.includes(signerAddr.toLowerCase()) ?? false)
  // Prefer this wallet's own key when it works — the imported key is the fallback.
  return { agw: candidate, agwOwned: eoaOwns || signerOwns, agwSignerActive: !eoaOwns && signerOwns }
}
