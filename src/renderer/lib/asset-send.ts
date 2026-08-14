/**
 * asset-send.ts — which held assets the Send flow can move, and how to describe
 * them to the bridge.
 *
 * This module only ever decides what the UI OFFERS. The backend re-derives the
 * transfer semantics itself (for EVM it re-probes ERC-165 on-chain before
 * encoding) and refuses anything it cannot verify, so a wrong answer here can
 * withhold a button but can never produce a wrong transaction.
 *
 * The reason it exists at all: WalletCollectible.contractType is a free-form
 * string that every data source spells differently — Alchemy "ERC721",
 * Blockscout "ERC-721", the import flow "ERC-721", Tron "TRC-721"/"TRC-1155",
 * Cardano "CIP25", Solana "NFT"/"cNFT", Bitcoin "inscription". Comparing that
 * string inline at each call site is how the two spellings drift apart.
 */

import type { WalletToken, WalletCollectible, SendAsset, NftStandard } from '../types/wallet'

export type ChainType =
  | 'evm' | 'solana' | 'cardano' | 'tron' | 'dogecoin'
  | 'bitcoin' | 'monero' | 'zcash' | 'midnight' | 'polkadot'

/**
 * Chain-config id → transfer family. Anything unrecognised is EVM: that is not a
 * guess but the rule for user-added custom chains, whose ids are `custom-<id>`.
 *
 * Every non-EVM chain in chain-config MUST appear here. Polkadot is the reason
 * that's stated as a rule: it has no send path at all (address derivation and
 * balance reads only), so letting it fall through to the EVM default would have
 * offered a Send button that routes a Substrate asset to an EVM signer.
 * chain-parity.test.ts pins the full list.
 */
export function getChainType(chainId: string): ChainType {
  if (chainId === 'solana')   return 'solana'
  if (chainId === 'cardano')  return 'cardano'
  if (chainId === 'tron')     return 'tron'
  if (chainId === 'dogecoin') return 'dogecoin'
  if (chainId === 'bitcoin')  return 'bitcoin'
  if (chainId === 'monero')   return 'monero'
  if (chainId === 'zcash')    return 'zcash'
  if (chainId === 'midnight') return 'midnight'
  if (chainId === 'polkadot') return 'polkadot'
  return 'evm'
}

/** Families whose fungible tokens this wallet can transfer today. */
const TOKEN_SEND_CHAINS: ReadonlySet<ChainType> = new Set<ChainType>([
  'evm',      // ERC-20 (incl. every custom chain and the AGW smart account)
  'solana',   // SPL
  'cardano',  // native assets
  'tron',     // TRC-20
])

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * Can this row's asset be sent from the Tokens tab?
 *
 * Excluded on purpose:
 *  - no rawBalance — Bitcoin runes/BRC-20 and Midnight DUST never populate it,
 *    and `balance` alone is a rounded display string we must not do maths on.
 *  - the zero address — chains that list their own native coin as a
 *    pseudo-token (Monad's MON). That coin is sendable from the Networks tab,
 *    where it routes through the native path instead of an ERC-20 transfer.
 */
export function canSendToken(token: WalletToken): boolean {
  if (!token.rawBalance || token.rawBalance === '0') return false
  if (!TOKEN_SEND_CHAINS.has(getChainType(token.chain))) return false
  if (token.contractAddress.toLowerCase() === ZERO_ADDRESS) return false
  return true
}

/**
 * Normalize the reported contract type to the transfer semantics we implement.
 * null = we hold it and can show it, but cannot move it yet.
 */
export function nftStandard(nft: WalletCollectible): NftStandard | null {
  const t = nft.contractType.trim().toLowerCase().replace(/[-_\s]/g, '')

  // ERC and TRC share the same transfer ABI, so they share a branch.
  if (t === 'erc721'  || t === 'trc721')  return 'erc721'
  if (t === 'erc1155' || t === 'trc1155') return 'erc1155'
  if (t === 'cip25')       return 'cardano'
  // Solana: an uncompressed NFT is an SPL mint with supply 1. A cNFT lives in a
  // merkle tree and needs a proof the collectibles fetcher never requests, so it
  // is deliberately not sendable rather than sendable-and-broken.
  if (t === 'nft')         return 'spl'
  if (t === 'cnft')        return null
  // Bitcoin inscriptions need a satpoint and a Taproot spending path; bitcoin.ts
  // structurally excludes that address so it can never burn one by accident.
  if (t === 'inscription') return null
  return null
}

/** Can this NFT be sent? */
export function canSendNft(nft: WalletCollectible): boolean {
  return nftStandard(nft) !== null
}

/** User-facing reason a held NFT has no Send button. null when it does. */
export function nftSendBlockedReason(nft: WalletCollectible): string | null {
  if (canSendNft(nft)) return null
  const t = nft.contractType.trim().toLowerCase().replace(/[-_\s]/g, '')
  if (t === 'cnft') {
    return 'Compressed NFTs can’t be sent from the wallet yet — use a Solana marketplace for now.'
  }
  if (t === 'inscription') {
    return 'Ordinals can’t be sent from the wallet yet. Sending one safely needs inscription-aware coin control, which isn’t built — moving it with an ordinary Bitcoin send would destroy it.'
  }
  return 'Sending isn’t supported for this asset type yet.'
}

/**
 * Build the bridge descriptor for an NFT.
 *
 * Note the Solana case. For SPL the thing you transfer is the MINT, and the
 * collectibles fetcher puts the mint in `tokenId` while `contractAddress` holds
 * the *collection group* (falling back to the mint only when ungrouped). Doing
 * this swap here — rather than at the call site — is why callers can't get it
 * backwards.
 */
export function nftToSendAsset(nft: WalletCollectible): SendAsset | null {
  const standard = nftStandard(nft)
  if (!standard) return null

  if (standard === 'spl') {
    return { kind: 'nft', contractAddress: nft.tokenId, tokenId: nft.tokenId, standard }
  }
  if (standard === 'cardano') {
    // Cardano splits the asset unit for display: policy id in contractAddress,
    // hex asset name in tokenId. The ledger wants them concatenated again.
    return {
      kind: 'nft',
      contractAddress: nft.contractAddress,
      tokenId: nft.tokenId,
      standard,
    }
  }
  return {
    kind: 'nft',
    contractAddress: nft.contractAddress,
    tokenId: nft.tokenId,
    standard,
    ...(standard === 'erc1155' ? { quantity: nft.quantity ?? '1' } : {}),
  }
}

/** Build the bridge descriptor for a fungible token row. */
export function tokenToSendAsset(token: WalletToken): SendAsset {
  return {
    kind: 'token',
    contractAddress: token.contractAddress,
    decimals: token.decimals,
    symbol: token.symbol,
  }
}

/**
 * Exact base-units → decimal string, without going through a float.
 * parseFloat on an 18-decimal balance silently loses low-order digits, which is
 * precisely the bug that made `balance` unusable for sends.
 */
export function formatUnits(raw: string, decimals: number): string {
  const neg = raw.startsWith('-')
  const digits = (neg ? raw.slice(1) : raw).replace(/^0+(?=\d)/, '')
  if (decimals <= 0) return (neg ? '-' : '') + digits
  const padded = digits.padStart(decimals + 1, '0')
  const int = padded.slice(0, padded.length - decimals)
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, '')
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`
}

/**
 * Decimal string → exact base units. Returns null when the input isn't a plain
 * decimal or carries more fraction digits than the asset has.
 */
export function parseUnits(amount: string, decimals: number): string | null {
  const s = amount.trim()
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null
  const [int = '', frac = ''] = s.split('.')
  if (frac.length > decimals) return null
  const combined = `${int}${frac.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '')
  return combined === '' ? '0' : combined
}
