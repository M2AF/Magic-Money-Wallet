import { ed25519 } from '@noble/curves/ed25519'
import { blake2b } from '@noble/hashes/blake2b'
import { mnemonicToEntropy } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { describe, expect, it } from 'vitest'
import {
  addrToBytes,
  addressToHex,
  bytesToHex,
  cborArray,
  cborBool,
  cborBytes,
  cborInt,
  cborMap,
  cborText,
  cip30SignData,
  hexToBytes,
} from './cardano-cip30'
import { deriveCardanoAddress } from './cardano-pure'

const MNEMONIC = 'test test test test test test test test test test test junk'

function readCborBytes(bytes: Uint8Array, offset: number): { value: Uint8Array; next: number } {
  const first = bytes[offset]
  expect(first >> 5).toBe(2)
  const additional = first & 0x1f
  let length: number
  let headerLength: number
  if (additional < 24) {
    length = additional
    headerLength = 1
  } else if (additional === 24) {
    length = bytes[offset + 1]
    headerLength = 2
  } else if (additional === 25) {
    length = (bytes[offset + 1] << 8) | bytes[offset + 2]
    headerLength = 3
  } else {
    throw new Error('Unsupported test CBOR byte-string length')
  }
  const start = offset + headerLength
  return { value: bytes.slice(start, start + length), next: start + length }
}

describe('CIP-30 signData', () => {
  it('returns a CIP-8 COSE_Sign1 that verifies over the un-hashed Sig_structure', async () => {
    const entropy = mnemonicToEntropy(MNEMONIC, wordlist)
    const address = deriveCardanoAddress(entropy)
    const addressHex = addressToHex(address)
    const payload = new TextEncoder().encode('Strike:ownership-proof')
    const payloadHex = bytesToHex(payload)

    const result = await cip30SignData(addressHex, payloadHex, MNEMONIC, 0)
    const coseSign1 = hexToBytes(result.signature)
    expect(coseSign1[0]).toBe(0x84) // four-element COSE_Sign1 array

    const protectedHeader = readCborBytes(coseSign1, 1)
    const expectedProtectedHeader = cborMap([
      [cborInt(1), cborInt(-8)],
      [cborText('address'), cborBytes(addrToBytes(addressHex))],
    ])
    expect(protectedHeader.value).toEqual(expectedProtectedHeader)

    const expectedUnprotectedHeader = cborMap([
      [cborText('hashed'), cborBool(false)],
    ])
    expect(coseSign1.slice(
      protectedHeader.next,
      protectedHeader.next + expectedUnprotectedHeader.length,
    )).toEqual(expectedUnprotectedHeader)

    const signedPayload = readCborBytes(
      coseSign1,
      protectedHeader.next + expectedUnprotectedHeader.length,
    )
    expect(signedPayload.value).toEqual(payload)
    const signature = readCborBytes(coseSign1, signedPayload.next)
    expect(signature.next).toBe(coseSign1.length)

    const coseKey = hexToBytes(result.key)
    const publicKey = coseKey.slice(-32)
    expect(coseKey).toEqual(cborMap([
      [cborInt(1), cborInt(1)],
      [cborInt(3), cborInt(-8)],
      [cborInt(-1), cborInt(6)],
      [cborInt(-2), cborBytes(publicKey)],
    ]))
    expect(blake2b(publicKey, { dkLen: 28 })).toEqual(addrToBytes(addressHex).slice(1, 29))

    const sigStructure = cborArray([
      cborText('Signature1'),
      cborBytes(protectedHeader.value),
      cborBytes(new Uint8Array(0)),
      cborBytes(payload),
    ])
    expect(ed25519.verify(signature.value, sigStructure, publicKey)).toBe(true)
  })
})
