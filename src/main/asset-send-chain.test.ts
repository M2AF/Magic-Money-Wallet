import { describe, it, expect } from 'vitest'
import { cardanoAssetFor } from './tx-sender'
import { tronTransferCall, tronAddrParam } from './tron'
import type { SendAsset } from './tx-sender'

/**
 * Per-chain non-native transfer encoding for the two chains that hand-roll it:
 * Cardano (unit reassembly) and Tron (ABI parameter blobs built by string
 * concatenation rather than through viem). Both are places where a silent
 * off-by-one in hex packing would produce a transaction that broadcasts fine
 * and moves the wrong thing.
 */

const POLICY  = 'a'.repeat(56)          // 28-byte policy id, hex
const ASSET   = '4d794e465431'          // "MyNFT1", hex
const TO_ADDR = 'TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9'
const FROM_ADDR = 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ'

describe('cardanoAssetFor', () => {
  it('rejoins policy id + asset name into the ledger unit for a CNFT', () => {
    // The collectibles fetcher splits the unit for DISPLAY. Sending needs it
    // whole again; concatenating in the wrong order would name a different asset.
    const asset: SendAsset = {
      kind: 'nft', contractAddress: POLICY, tokenId: ASSET, standard: 'cardano',
    }
    expect(cardanoAssetFor(asset, '0')).toEqual({ unit: `${POLICY}${ASSET}`, quantity: 1n })
  })

  it('uses the whole stored unit for a fungible native asset', () => {
    // Fungible tokens keep the full unit in contractAddress — no rejoining.
    const asset: SendAsset = {
      kind: 'token', contractAddress: `${POLICY}${ASSET}`, decimals: 6,
    }
    expect(cardanoAssetFor(asset, '1.5')).toEqual({ unit: `${POLICY}${ASSET}`, quantity: 1_500_000n })
  })

  it('respects the asset’s own decimals', () => {
    const zeroDec: SendAsset = { kind: 'token', contractAddress: 'unit', decimals: 0 }
    expect(cardanoAssetFor(zeroDec, '42').quantity).toBe(42n)
  })

  it('refuses a zero amount', () => {
    const asset: SendAsset = { kind: 'token', contractAddress: 'unit', decimals: 6 }
    expect(() => cardanoAssetFor(asset, '0')).toThrow(/greater than 0/)
  })

  it('refuses a non-Cardano NFT standard', () => {
    const asset: SendAsset = {
      kind: 'nft', contractAddress: '0xabc', tokenId: '1', standard: 'erc721',
    }
    expect(() => cardanoAssetFor(asset, '0')).toThrow(/Cannot send a erc721 asset on Cardano/)
  })
})

describe('tronTransferCall', () => {
  it('encodes a TRC-20 transfer', () => {
    const asset: SendAsset = { kind: 'token', contractAddress: 'Tcontract', decimals: 6 }
    const { selector, parameter } = tronTransferCall(asset, FROM_ADDR, TO_ADDR, '1.5')
    expect(selector).toBe('transfer(address,uint256)')
    // address word + uint256 word
    expect(parameter).toHaveLength(128)
    expect(parameter.slice(0, 64)).toBe(tronAddrParam(TO_ADDR))
    expect(BigInt(`0x${parameter.slice(64, 128)}`)).toBe(1_500_000n)
  })

  it('encodes a TRC-721 safeTransferFrom with from, to and tokenId', () => {
    const asset: SendAsset = {
      kind: 'nft', contractAddress: 'Tcontract', tokenId: '42', standard: 'erc721',
    }
    const { selector, parameter } = tronTransferCall(asset, FROM_ADDR, TO_ADDR, '1')
    expect(selector).toBe('safeTransferFrom(address,address,uint256)')
    expect(parameter).toHaveLength(192)
    expect(parameter.slice(0, 64)).toBe(tronAddrParam(FROM_ADDR))
    expect(parameter.slice(64, 128)).toBe(tronAddrParam(TO_ADDR))
    expect(BigInt(`0x${parameter.slice(128, 192)}`)).toBe(42n)
  })

  it('encodes a TRC-1155 safeTransferFrom with a correctly offset empty bytes tail', () => {
    const asset: SendAsset = {
      kind: 'nft', contractAddress: 'Tcontract', tokenId: '7', standard: 'erc1155', quantity: '3',
    }
    const { selector, parameter } = tronTransferCall(asset, FROM_ADDR, TO_ADDR, '1')
    expect(selector).toBe('safeTransferFrom(address,address,uint256,uint256,bytes)')
    // from, to, id, amount, offset, length = 6 words
    expect(parameter).toHaveLength(384)
    const word = (i: number) => parameter.slice(i * 64, (i + 1) * 64)
    expect(word(0)).toBe(tronAddrParam(FROM_ADDR))
    expect(word(1)).toBe(tronAddrParam(TO_ADDR))
    expect(BigInt(`0x${word(2)}`)).toBe(7n)
    expect(BigInt(`0x${word(3)}`)).toBe(3n)
    // The dynamic `bytes` head must point past all five head words (5 × 32 = 160).
    expect(BigInt(`0x${word(4)}`)).toBe(160n)
    expect(BigInt(`0x${word(5)}`)).toBe(0n)   // zero-length data
  })

  it('defaults TRC-1155 quantity to 1', () => {
    const asset: SendAsset = {
      kind: 'nft', contractAddress: 'Tcontract', tokenId: '7', standard: 'erc1155',
    }
    const { parameter } = tronTransferCall(asset, FROM_ADDR, TO_ADDR, '1')
    expect(BigInt(`0x${parameter.slice(192, 256)}`)).toBe(1n)
  })

  it('refuses a Solana/Cardano standard on Tron', () => {
    for (const standard of ['spl', 'cardano'] as const) {
      const asset: SendAsset = { kind: 'nft', contractAddress: 'T', tokenId: '1', standard }
      expect(() => tronTransferCall(asset, FROM_ADDR, TO_ADDR, '1')).toThrow(/Cannot send/)
    }
  })

  it('refuses a zero amount and a zero quantity', () => {
    expect(() => tronTransferCall(
      { kind: 'token', contractAddress: 'T', decimals: 6 }, FROM_ADDR, TO_ADDR, '0'
    )).toThrow(/greater than 0/)
    expect(() => tronTransferCall(
      { kind: 'nft', contractAddress: 'T', tokenId: '1', standard: 'erc1155', quantity: '0' },
      FROM_ADDR, TO_ADDR, '1'
    )).toThrow(/at least 1/)
  })
})
