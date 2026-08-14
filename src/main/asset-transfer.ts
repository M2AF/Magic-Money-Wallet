/**
 * asset-transfer.ts — encoding and on-chain verification for non-native EVM
 * transfers (ERC-20, ERC-721, ERC-1155).
 *
 * Platform-agnostic like tx-sender.ts: no Electron imports, so Electron, the
 * extension, Android and iOS all share this one implementation.
 *
 * The renderer tells us which standard it *thinks* an asset uses, derived from
 * WalletCollectible.contractType — a free-form string that every indexer spells
 * differently. We never encode from that hint. `resolveEvmNftStandard` re-probes
 * ERC-165 on-chain and `assertEvmNftOwnership` re-checks the holding, so a stale
 * or malformed hint fails closed instead of producing a transaction that
 * silently does the wrong thing. The cost is one or two eth_calls on a path the
 * user has already waited on a fee estimate for.
 */

import { encodeFunctionData, parseAbi, parseUnits, type PublicClient } from 'viem'

export type EvmNftStandard = 'erc721' | 'erc1155'

export const ERC20_TRANSFER_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)'
])

// The *safe* variant on purpose: it calls onERC721Received on contract
// recipients, so sending to a contract that can't handle NFTs reverts instead of
// locking the token there forever.
export const ERC721_TRANSFER_ABI = parseAbi([
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)'
])

export const ERC1155_TRANSFER_ABI = parseAbi([
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)'
])

// ERC-165 interface ids. Same constants token-fetcher.ts uses for the custom
// chain import flow.
const IFACE_ERC721  = '0x80ac58cd'
const IFACE_ERC1155 = '0xd9b67a26'

/** ERC-20 `transfer(to, amount)` calldata. `amount` is a human decimal string. */
export function encodeErc20Transfer(to: string, amount: string, decimals: number): `0x${string}` {
  return encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: 'transfer',
    args: [to as `0x${string}`, parseUnits(amount, decimals)]
  })
}

/** ERC-721 / ERC-1155 `safeTransferFrom` calldata. */
export function encodeNftTransfer(opts: {
  standard: EvmNftStandard
  from: string
  to: string
  tokenId: string
  /** ERC-1155 only; defaults to 1. Ignored for ERC-721. */
  quantity?: string
}): `0x${string}` {
  const { standard, from, to, tokenId } = opts
  const id = BigInt(tokenId)

  if (standard === 'erc721') {
    return encodeFunctionData({
      abi: ERC721_TRANSFER_ABI,
      functionName: 'safeTransferFrom',
      args: [from as `0x${string}`, to as `0x${string}`, id]
    })
  }

  const amount = BigInt(opts.quantity ?? '1')
  if (amount <= 0n) throw new Error('Quantity must be at least 1')
  return encodeFunctionData({
    abi: ERC1155_TRANSFER_ABI,
    functionName: 'safeTransferFrom',
    args: [from as `0x${string}`, to as `0x${string}`, id, amount, '0x']
  })
}

/**
 * Ask the contract which standard it actually implements.
 *
 * `hint` is only used as a tie-break for the (rare) contracts that predate
 * ERC-165 and answer neither probe — and only when it names a standard we can
 * encode. Contracts that claim BOTH interfaces are rejected: that combination is
 * malformed and we'd be guessing which transfer signature the token really uses.
 */
export async function resolveEvmNftStandard(
  client: PublicClient,
  contract: string,
  hint?: EvmNftStandard
): Promise<EvmNftStandard> {
  const probe = async (iface: string): Promise<boolean> => {
    try {
      return await client.readContract({
        address: contract as `0x${string}`,
        abi: ERC721_TRANSFER_ABI,
        functionName: 'supportsInterface',
        args: [iface as `0x${string}`]
      }) as boolean
    } catch {
      return false   // pre-ERC-165 contracts revert or return empty
    }
  }

  const [is721, is1155] = await Promise.all([probe(IFACE_ERC721), probe(IFACE_ERC1155)])

  if (is721 && is1155) {
    throw new Error(
      'This contract reports itself as both ERC-721 and ERC-1155, so the wallet ' +
      'can’t tell which transfer it supports. Send it from the collection’s own site instead.'
    )
  }
  if (is721)  return 'erc721'
  if (is1155) return 'erc1155'

  if (hint) return hint
  throw new Error(
    'That contract doesn’t identify itself as ERC-721 or ERC-1155, so the wallet ' +
    'can’t work out how to transfer it.'
  )
}

/**
 * Refuse to build a transfer the wallet cannot actually make. Catches the stale
 * -index case (the NFT was sold or moved since the last portfolio refresh),
 * which would otherwise reach the user as a raw revert after they'd paid gas.
 */
export async function assertEvmNftOwnership(opts: {
  client: PublicClient
  standard: EvmNftStandard
  contract: string
  tokenId: string
  owner: string
  quantity?: string
}): Promise<void> {
  const { client, standard, contract, tokenId, owner } = opts
  const id = BigInt(tokenId)

  if (standard === 'erc721') {
    let onChainOwner: string
    try {
      onChainOwner = await client.readContract({
        address: contract as `0x${string}`,
        abi: ERC721_TRANSFER_ABI,
        functionName: 'ownerOf',
        args: [id]
      }) as string
    } catch {
      throw new Error('Could not read this NFT’s owner on-chain — try again in a moment.')
    }
    if (onChainOwner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('This wallet no longer owns that NFT. Refresh your Collectibles tab.')
    }
    return
  }

  const want = BigInt(opts.quantity ?? '1')
  let held: bigint
  try {
    held = await client.readContract({
      address: contract as `0x${string}`,
      abi: ERC1155_TRANSFER_ABI,
      functionName: 'balanceOf',
      args: [owner as `0x${string}`, id]
    }) as bigint
  } catch {
    throw new Error('Could not read your balance for that NFT — try again in a moment.')
  }
  if (held < want) {
    throw new Error(
      held === 0n
        ? 'This wallet no longer owns that NFT. Refresh your Collectibles tab.'
        : `You only hold ${held} of this edition, but tried to send ${want}.`
    )
  }
}
