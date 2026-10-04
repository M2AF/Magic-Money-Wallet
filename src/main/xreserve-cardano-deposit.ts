/**
 * xreserve-cardano-deposit.ts — the unsigned Ethereum → Cardano xReserve
 * deposit, and the check it must pass before anything could sign it.
 *
 * PURE CODE, NOT WIRED IN. Nothing here holds a key, approves, signs, submits,
 * polls, routes or quotes. It builds the one contract call an inbound (gate 2)
 * route would need and validates a proposed call against what the user
 * approved. The ERC-20 `approve` that must precede it is a separate, future
 * step and is deliberately absent.
 *
 * Sources (read 2026-09-27):
 *   • Circle, "Deposit USDC into xReserve" quickstart — the Cardano encoding
 *     (`parseCardanoAddress`): remoteRecipient = 4-byte credential tag +
 *     28-byte payment credential; hookData empty for an enterprise address,
 *     95 bytes for a base address (66 zero bytes, a 1-byte staking tag, the
 *     28-byte staking credential).
 *   • Circle, supported blockchains and domains — Ethereum mainnet xReserve
 *     0x8888888199b2Df864bf678259607d6D5EBb4e3Ce, Ethereum USDC
 *     0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48, Cardano remote domain 10004.
 *   • circlefin/evm-xreserve-contracts DepositToRemote.sol — the signature
 *     depositToRemote(uint256 value, uint32 remoteDomain, bytes32
 *     remoteRecipient, address localToken, uint256 maxFee, bytes hookData),
 *     selector 0xfaadb53b (confirmed against a real mainnet deposit).
 *   • CIP-19 — Shelley address header: type nibble, network nibble.
 *
 * NETWORKS. Every function takes an optional xReserve network profile
 * (xreserve-network.ts) and defaults to mainnet; the Sepolia → Preprod profile
 * pins Circle's documented testnet contract, USDC and address network instead.
 *
 * WHAT IS NOT DECIDED HERE: the fee actually charged and the minimum deposit.
 * `maxFee` is a CAP the caller must state explicitly; nothing is defaulted, and
 * Circle's sample figures are not economics. See docs/XRESERVE-GATE2-RESEARCH.md.
 */

import { bech32 } from '@scure/base'
import {
  encodeFunctionData, decodeFunctionData, getAddress, isAddress, type Hex,
} from 'viem'
import { xreserveNetwork, type XReserveNetwork } from './xreserve-network'

export const XRESERVE_ETHEREUM_MAINNET = {
  chainId: 1,
  /** Circle xReserve on Ethereum mainnet (Circle's supported-domains table). */
  xReserve: '0x8888888199b2Df864bf678259607d6D5EBb4e3Ce',
  /** Circle's Ethereum mainnet USDC. */
  usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  /** xReserve remote domain for Cardano. */
  cardanoDomain: 10004,
  usdcDecimals: 6,
} as const

export const DEPOSIT_TO_REMOTE_SELECTOR = '0xfaadb53b'

export const XRESERVE_DEPOSIT_ABI = [{
  type: 'function',
  name: 'depositToRemote',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'value', type: 'uint256' },
    { name: 'remoteDomain', type: 'uint32' },
    { name: 'remoteRecipient', type: 'bytes32' },
    { name: 'localToken', type: 'address' },
    { name: 'maxFee', type: 'uint256' },
    { name: 'hookData', type: 'bytes' },
  ],
  outputs: [],
}] as const

export class XReserveCardanoError extends Error {}
const fail = (why: string): never => { throw new XReserveCardanoError(why) }

const UINT256_MAX = (1n << 256n) - 1n
const hex = (b: Uint8Array): string => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

// ── Cardano recipient ─────────────────────────────────────────────────────────

export interface CardanoCredential { kind: 'key' | 'script'; hash: string }

export interface CardanoRecipientEncoding {
  address: string
  addressKind: 'base' | 'enterprise'
  /** CIP-19 header type nibble: 0-3 base, 6-7 enterprise. */
  addressType: number
  payment: CardanoCredential
  stake: CardanoCredential | null
  /** 32 bytes: 4-byte credential tag (1 key hash, 2 script hash) + 28-byte payment credential. */
  remoteRecipient: Hex
  /** Empty for enterprise; 95 bytes for base (66 zero bytes, staking tag, staking credential). */
  hookData: Hex
}

/** The 4-byte credential tags Circle's quickstart uses for `remoteRecipient`. */
const PAYMENT_TAG = { key: '00000001', script: '00000002' } as const
/** The 1-byte staking tags Circle's quickstart places in base-address hookData. */
const STAKING_TAG = { key: '01', script: '02' } as const
/** txHash(32) + txIdx(1) + datumTag(1) + datum(32), all zero in Circle's quickstart. */
const HOOK_ZERO_PREFIX = '00'.repeat(66)

/**
 * Encode a Cardano base or enterprise address for xReserve, on the profile's
 * Cardano network (mainnet by default).
 *
 * Stricter than Circle's sample, which checks only the address type: the
 * prefix must be exactly the network's (`addr` / `addr_test`), the network
 * nibble must match, the length exact for the type, and the string canonical
 * (lowercase, no whitespace). Other-network, pointer, reward (stake), Byron,
 * malformed and truncated addresses throw.
 */
export function encodeCardanoRecipient(address: string, network?: XReserveNetwork): CardanoRecipientEncoding {
  const net = xreserveNetwork(network)
  const mainnet = net.cardano.networkId === 1
  if (typeof address !== 'string' || address.length === 0) return fail('A Cardano address is required.')
  if (address !== address.trim() || /\s/.test(address)) return fail('The Cardano address contains whitespace.')
  // Shelley addresses are bech32 (`hrp` + '1' + data). A string without that
  // shape — a base58 Byron address, most commonly — is refused by name.
  if (!/^[a-z_]+1[02-9ac-hj-np-z]+$/i.test(address)) {
    return fail('Not a valid Shelley (bech32) Cardano address. Byron addresses are not supported.')
  }
  if (address !== address.toLowerCase()) return fail('The Cardano address must be lowercase bech32.')

  let prefix: string
  let bytes: Uint8Array
  try {
    const decoded = bech32.decode(address as `${string}1${string}`, 1000)
    prefix = decoded.prefix
    bytes = bech32.fromWords(decoded.words)
  } catch {
    return fail('Not a valid Shelley (bech32) Cardano address. Byron addresses are not supported.')
  }
  if (mainnet && prefix === 'addr_test') return fail('This is a Cardano testnet address; xReserve deposits here are mainnet only.')
  if (!mainnet && prefix === 'addr') return fail(`This is a Cardano mainnet address; this deposit is on ${net.cardano.name}.`)
  if (prefix === 'stake' || prefix === 'stake_test') return fail('This is a Cardano reward (stake) address, which cannot receive USDCx.')
  if (prefix !== net.cardano.addressPrefix) return fail(`Unexpected address prefix "${prefix}".`)
  if (bytes.length === 0) return fail('The Cardano address is empty.')

  const header = bytes[0]
  const type = header >> 4
  const headerNetwork = header & 0x0f
  if (headerNetwork !== net.cardano.networkId) {
    return fail(mainnet ? 'The address header is not for Cardano mainnet.' : `The address header is not for ${net.cardano.name}.`)
  }

  const base = type >= 0 && type <= 3
  const enterprise = type === 6 || type === 7
  if (type === 4 || type === 5) return fail('Pointer addresses are not supported. Use a base (addr1q…) or enterprise (addr1v…) address.')
  if (type === 14 || type === 15) return fail('Reward addresses cannot receive USDCx.')
  if (type === 8) return fail('Byron addresses are not supported.')
  if (!base && !enterprise) return fail(`Unsupported Cardano address type ${type}.`)

  const expectedLength = base ? 57 : 29
  if (bytes.length !== expectedLength) {
    return fail(`Malformed ${base ? 'base' : 'enterprise'} address: expected ${expectedLength} bytes, got ${bytes.length}.`)
  }

  // CIP-19: bit 0 of the type = payment is a script; bit 1 (base only) = stake is a script.
  const payment: CardanoCredential = { kind: (type & 1) === 1 ? 'script' : 'key', hash: hex(bytes.slice(1, 29)) }
  const stake: CardanoCredential | null = base
    ? { kind: (type & 2) === 2 ? 'script' : 'key', hash: hex(bytes.slice(29, 57)) }
    : null

  const remoteRecipient = `0x${PAYMENT_TAG[payment.kind]}${payment.hash}` as Hex
  const hookData = (stake
    ? `0x${HOOK_ZERO_PREFIX}${STAKING_TAG[stake.kind]}${stake.hash}`
    : '0x') as Hex

  return { address, addressKind: base ? 'base' : 'enterprise', addressType: type, payment, stake, remoteRecipient, hookData }
}

// ── The unsigned deposit ──────────────────────────────────────────────────────

/** What the user approves. Amounts are integer USDC base units (6 decimals). */
export interface CardanoDepositInput {
  /** Cardano mainnet base or enterprise address that receives the USDCx. */
  recipient: string
  /** USDC to deposit, base units. Must be positive. */
  amountRaw: bigint | string
  /** Most USDC the remote mint may charge, base units. Required; may be zero. */
  maxFeeRaw: bigint | string
}

export interface DepositToRemoteParams {
  value: bigint
  remoteDomain: number
  remoteRecipient: Hex
  localToken: string
  maxFee: bigint
  hookData: Hex
}

export interface UnsignedCardanoDeposit {
  /** EIP-155 chain id of the profile's source chain. */
  chainId: number
  to: string
  /** Native ETH sent with the call: always zero. */
  value: 0n
  data: Hex
  params: DepositToRemoteParams
  recipient: CardanoRecipientEncoding
}

function baseUnits(v: unknown, what: string): bigint {
  if (typeof v === 'bigint') {
    if (v < 0n || v > UINT256_MAX) fail(`${what} is out of range.`)
    return v
  }
  if (typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v)) {
    const n = BigInt(v)
    if (n > UINT256_MAX) fail(`${what} is out of range.`)
    return n
  }
  return fail(`${what} must be a non-negative integer in USDC base units.`)
}

/**
 * Build the unsigned `depositToRemote` call. Everything that is not the
 * user's (contract, token, domain, chain, zero ETH value) is pinned here.
 */
export function buildCardanoDepositRequest(input: CardanoDepositInput, network?: XReserveNetwork): UnsignedCardanoDeposit {
  const net = xreserveNetwork(network)
  if (!input || typeof input !== 'object') return fail('Deposit terms are required.')
  const recipient = encodeCardanoRecipient(input.recipient, net)
  // Circle's quickstart ENCODES script payment credentials (types 1, 3, 7), but
  // nothing establishes that the Cardano mint supports them or that this wallet
  // could spend USDCx locked at a script. Until there is evidence, a deposit is
  // only built to a key payment credential. A script STAKING credential under a
  // key payment credential (type 2) stays supported: the key controls spending.
  if (recipient.payment.kind !== 'key') {
    fail('Deposits to a Cardano script payment address are not supported. Use an address whose payment part is a key (addr1q… or addr1v…).')
  }
  const value = baseUnits(input.amountRaw, 'Deposit amount')
  if (value === 0n) fail('Deposit amount must be positive.')
  if (input.maxFeeRaw === undefined || input.maxFeeRaw === null) fail('A maximum fee must be stated explicitly (it may be zero).')
  const maxFee = baseUnits(input.maxFeeRaw, 'Maximum fee')
  // Not a Circle rule (the contract only requires value > 0): the wallet's own
  // bound, so an approved fee cap can never consume the whole deposit.
  if (maxFee >= value) fail('The maximum fee must be less than the deposit amount.')

  const params: DepositToRemoteParams = {
    value,
    remoteDomain: net.cardanoDomain,
    remoteRecipient: recipient.remoteRecipient,
    localToken: net.ethereum.usdc,
    maxFee,
    hookData: recipient.hookData,
  }
  const data = encodeFunctionData({
    abi: XRESERVE_DEPOSIT_ABI,
    functionName: 'depositToRemote',
    args: [params.value, params.remoteDomain, params.remoteRecipient, params.localToken as Hex, params.maxFee, params.hookData],
  })
  return { chainId: net.ethereum.chainId, to: net.ethereum.xReserve, value: 0n, data, params, recipient }
}

// ── Decoding and pre-signing validation ───────────────────────────────────────

/**
 * Decode `depositToRemote` calldata, refusing anything that is not its exact
 * canonical encoding: a different selector, a trailing byte, dirty padding or
 * a non-standard offset all fail, because re-encoding the decoded arguments
 * must reproduce the input byte for byte.
 */
export function decodeDepositToRemoteCalldata(data: string): DepositToRemoteParams {
  if (typeof data !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(data)) return fail('Calldata is not hex.')
  const lower = data.toLowerCase() as Hex
  if (!lower.startsWith(DEPOSIT_TO_REMOTE_SELECTOR)) return fail('Calldata is not a depositToRemote call.')
  let args: readonly unknown[]
  try {
    const decoded = decodeFunctionData({ abi: XRESERVE_DEPOSIT_ABI, data: lower })
    if (decoded.functionName !== 'depositToRemote') fail('Calldata is not a depositToRemote call.')
    args = decoded.args as readonly unknown[]
  } catch (e) {
    if (e instanceof XReserveCardanoError) throw e
    return fail('Calldata could not be decoded as depositToRemote.')
  }
  const [value, remoteDomain, remoteRecipient, localToken, maxFee, hookData] = args as
    [bigint, number, Hex, Hex, bigint, Hex]
  const canonical = encodeFunctionData({
    abi: XRESERVE_DEPOSIT_ABI, functionName: 'depositToRemote',
    args: [value, remoteDomain, remoteRecipient, localToken, maxFee, hookData],
  })
  if (canonical.toLowerCase() !== lower) fail('Calldata carries extra or non-canonical bytes.')
  return {
    value, remoteDomain,
    remoteRecipient: remoteRecipient.toLowerCase() as Hex,
    localToken: getAddress(localToken),
    maxFee,
    hookData: hookData.toLowerCase() as Hex,
  }
}

/** A proposed Ethereum call, as some future signing path would receive it. */
export interface ProposedEvmCall {
  chainId: number | bigint
  to: string
  /** Native ETH, in wei. */
  value: bigint | number | string
  data: string
}

function weiOf(v: unknown): bigint | null {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null
  if (typeof v === 'string' && /^(0x[0-9a-fA-F]+|[0-9]+)$/.test(v)) return BigInt(v)
  return null
}

/**
 * Check a proposed call against the terms the user approved, before any future
 * signing step. Every component must match exactly: chain, contract, zero ETH
 * value, selector, token, domain, amount, maximum fee, recipient and hookData
 * — and the calldata must be byte-identical to the one built from the
 * approved terms. Returns the decoded parameters on success.
 */
export function validateCardanoDepositRequest(
  proposed: ProposedEvmCall, approved: CardanoDepositInput, network?: XReserveNetwork,
): DepositToRemoteParams {
  const net = xreserveNetwork(network)
  if (!proposed || typeof proposed !== 'object') return fail('No call was proposed.')
  const expected = buildCardanoDepositRequest(approved, net)

  const chainId = typeof proposed.chainId === 'bigint' ? proposed.chainId
    : typeof proposed.chainId === 'number' && Number.isSafeInteger(proposed.chainId) ? BigInt(proposed.chainId) : null
  if (chainId !== BigInt(net.ethereum.chainId)) fail(`The call is not for ${net.ethereum.name}.`)
  if (typeof proposed.to !== 'string' || !isAddress(proposed.to, { strict: false })
      || proposed.to.toLowerCase() !== net.ethereum.xReserve.toLowerCase()) {
    fail('The call is not addressed to Circle\'s xReserve contract.')
  }
  const wei = weiOf(proposed.value)
  if (wei === null) fail('The call\'s ETH value is unreadable.')
  if (wei !== 0n) fail('The call sends ETH; a deposit must send none.')

  const got = decodeDepositToRemoteCalldata(proposed.data)
  const want = expected.params
  if (got.localToken.toLowerCase() !== want.localToken.toLowerCase()) fail('The call deposits a token other than Ethereum USDC.')
  if (got.remoteDomain !== want.remoteDomain) fail('The call targets a remote domain other than Cardano (10004).')
  if (got.value !== want.value) fail('The call deposits a different amount than approved.')
  if (got.maxFee !== want.maxFee) fail('The call sets a different maximum fee than approved.')
  if (got.remoteRecipient !== want.remoteRecipient.toLowerCase()) fail('The call pays a different Cardano payment credential than approved.')
  if (got.hookData !== want.hookData.toLowerCase()) fail('The call\'s hookData does not match the approved Cardano address.')
  // Belt and braces: every field matched, so the bytes must too.
  if (proposed.data.toLowerCase() !== expected.data.toLowerCase()) fail('The calldata differs from the approved deposit.')
  return got
}
