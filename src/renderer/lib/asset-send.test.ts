import { describe, it, expect } from 'vitest'
import {
  getChainType, canSendToken, nftStandard, canSendNft, nftSendBlockedReason,
  nftToSendAsset, tokenToSendAsset, formatUnits, parseUnits,
} from './asset-send'
import type { WalletToken, WalletCollectible } from '../types/wallet'

function token(over: Partial<WalletToken> = {}): WalletToken {
  return {
    contractAddress: '0xaaaa', name: 'Test', symbol: 'TST', decimals: 6,
    balance: '1,234.56', rawBalance: '1234560000',
    usdValue: null, nativeEquivalent: null, nativeSymbol: 'ETH', logoUri: null,
    chain: 'ethereum', chainLabel: 'Ethereum', chainColor: '#fff',
    ...over,
  }
}

function nft(contractType: string, over: Partial<WalletCollectible> = {}): WalletCollectible {
  return {
    id: 'x', name: 'Test NFT', description: null, image: null, animationUrl: null,
    collectionName: null, chain: 'ethereum', chainLabel: 'Ethereum', chainColor: '#fff',
    tokenId: '42', contractAddress: '0xbbbb', contractType, traits: [],
    ...over,
  }
}

describe('getChainType', () => {
  it('maps the known non-EVM chains', () => {
    expect(getChainType('solana')).toBe('solana')
    expect(getChainType('cardano')).toBe('cardano')
    expect(getChainType('bitcoin')).toBe('bitcoin')
    expect(getChainType('midnight')).toBe('midnight')
  })

  it('treats everything else — including custom chains — as EVM', () => {
    expect(getChainType('ethereum')).toBe('evm')
    expect(getChainType('custom-9999')).toBe('evm')
  })
})

describe('nftStandard — the un-normalized contractType strings', () => {
  // Each spelling below is one a real data source actually emits. Alchemy and
  // Blockscout disagree on the dash, which is the whole reason this exists.
  it.each([
    ['ERC721',   'erc721'],    // Alchemy
    ['ERC-721',  'erc721'],    // Blockscout + the import flow
    ['erc-721',  'erc721'],
    ['TRC-721',  'erc721'],    // Tron — shares the ERC ABI
    ['ERC1155',  'erc1155'],   // Alchemy
    ['ERC-1155', 'erc1155'],   // Blockscout
    ['TRC-1155', 'erc1155'],   // Tron
    ['CIP25',    'cardano'],
    ['NFT',      'spl'],       // Solana, uncompressed
  ])('classifies %s as %s', (contractType, expected) => {
    expect(nftStandard(nft(contractType))).toBe(expected)
  })

  it.each(['cNFT', 'inscription', 'SomethingElse', ''])(
    'refuses to classify %s, so no Send button appears', (contractType) => {
      expect(nftStandard(nft(contractType))).toBeNull()
      expect(canSendNft(nft(contractType))).toBe(false)
      expect(nftSendBlockedReason(nft(contractType))).toBeTruthy()
    }
  )

  it('explains cNFTs and ordinals specifically, not generically', () => {
    expect(nftSendBlockedReason(nft('cNFT'))).toMatch(/[Cc]ompressed/)
    expect(nftSendBlockedReason(nft('inscription'))).toMatch(/[Oo]rdinal/)
  })
})

describe('canSendToken', () => {
  it('allows a normal ERC-20', () => {
    expect(canSendToken(token())).toBe(true)
  })

  it('refuses a token with no rawBalance — display strings are rounded', () => {
    // Bitcoin runes / BRC-20 / Midnight DUST land here. Failing closed means the
    // button is hidden rather than sending a rounded amount.
    expect(canSendToken(token({ rawBalance: undefined }))).toBe(false)
  })

  it('refuses a zero balance', () => {
    expect(canSendToken(token({ rawBalance: '0' }))).toBe(false)
  })

  it('refuses chains with no token transfer path', () => {
    expect(canSendToken(token({ chain: 'bitcoin', contractAddress: 'rune:UNCOMMONGOODS' }))).toBe(false)
    expect(canSendToken(token({ chain: 'midnight', contractAddress: 'midnight-dust' }))).toBe(false)
    expect(canSendToken(token({ chain: 'dogecoin' }))).toBe(false)
    expect(canSendToken(token({ chain: 'zcash' }))).toBe(false)
  })

  it('allows the chains that do have one', () => {
    for (const chain of ['ethereum', 'base', 'custom-42', 'solana', 'cardano', 'tron']) {
      expect(canSendToken(token({ chain })), chain).toBe(true)
    }
  })

  it('refuses the zero address — that is a native coin listed as a token', () => {
    // Monad lists native MON in the Tokens tab. Sending it as an ERC-20 would
    // call transfer() on the zero address; the Networks tab handles it natively.
    expect(canSendToken(token({ chain: 'monad', contractAddress: '0x0000000000000000000000000000000000000000' }))).toBe(false)
  })
})

describe('nftToSendAsset', () => {
  it('uses the MINT for Solana, not the collection address', () => {
    // The fetcher puts the mint in tokenId and the collection group in
    // contractAddress. Transferring the collection address would be nonsense.
    const asset = nftToSendAsset(nft('NFT', {
      chain: 'solana', tokenId: 'MintAddr111', contractAddress: 'CollectionGroup222',
    }))
    expect(asset).toEqual({ kind: 'nft', contractAddress: 'MintAddr111', tokenId: 'MintAddr111', standard: 'spl' })
  })

  it('keeps Cardano policy id and asset name split for rejoining downstream', () => {
    const asset = nftToSendAsset(nft('CIP25', {
      chain: 'cardano', contractAddress: 'a'.repeat(56), tokenId: '4d794e4654',
    }))
    expect(asset).toMatchObject({ contractAddress: 'a'.repeat(56), tokenId: '4d794e4654', standard: 'cardano' })
  })

  it('carries quantity for ERC-1155 only', () => {
    expect(nftToSendAsset(nft('ERC1155', { quantity: '5' }))).toMatchObject({ standard: 'erc1155', quantity: '5' })
    expect(nftToSendAsset(nft('ERC1155'))).toMatchObject({ quantity: '1' })
    expect(nftToSendAsset(nft('ERC721', { quantity: '5' }))).not.toHaveProperty('quantity')
  })

  it('returns null for gated types', () => {
    expect(nftToSendAsset(nft('cNFT'))).toBeNull()
    expect(nftToSendAsset(nft('inscription'))).toBeNull()
  })
})

describe('tokenToSendAsset', () => {
  it('carries the contract address and decimals the encoder needs', () => {
    expect(tokenToSendAsset(token({ contractAddress: '0xUSDC', decimals: 6, symbol: 'USDC' })))
      .toEqual({ kind: 'token', contractAddress: '0xUSDC', decimals: 6, symbol: 'USDC' })
  })
})

describe('formatUnits / parseUnits — exact, never via float', () => {
  it('round-trips an 18-decimal value that a float would mangle', () => {
    const raw = '1234567890123456789'
    expect(formatUnits(raw, 18)).toBe('1.234567890123456789')
    expect(parseUnits('1.234567890123456789', 18)).toBe(raw)
    // The precision that parseFloat silently discards:
    expect(String(parseFloat('1.234567890123456789'))).not.toBe('1.234567890123456789')
  })

  it('formats without separators so the value is re-parsable', () => {
    expect(formatUnits('1234560000', 6)).toBe('1234.56')
    expect(formatUnits('1000000', 6)).toBe('1')
    expect(formatUnits('1', 6)).toBe('0.000001')
    expect(formatUnits('0', 6)).toBe('0')
  })

  it('handles zero-decimal assets', () => {
    expect(formatUnits('7', 0)).toBe('7')
    expect(parseUnits('7', 0)).toBe('7')
  })

  it('rejects more fraction digits than the asset has', () => {
    // Truncating here would send a different amount than the one displayed.
    expect(parseUnits('1.1234567', 6)).toBeNull()
    expect(parseUnits('1.5', 0)).toBeNull()
    expect(parseUnits('1.123456', 6)).toBe('1123456')
  })

  it('rejects non-numeric input', () => {
    for (const bad of ['', '.', 'abc', '1e5', '-1', '1.2.3']) {
      expect(parseUnits(bad, 6), bad).toBeNull()
    }
  })

  it('pads a bare fraction correctly', () => {
    expect(parseUnits('0.5', 6)).toBe('500000')
    expect(parseUnits('.5', 6)).toBe('500000')
  })
})
