import { ed25519 } from '@noble/curves/ed25519'
import { blake2b } from '@noble/hashes/blake2b'
import { mnemonicToEntropy } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  cborUint,
  cborValue,
  cip30GetBalance,
  cip30GetCollateral,
  cip30GetUtxos,
  cip30SignData,
  cip30SubmitTx,
  hexToBytes,
} from './cardano-cip30'
import { deriveCardanoAddress, decodeCardanoAddress } from './cardano-pure'
import type { WalletConfig } from './secure-store'

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

// ── Network scoping (Testnet Mode) ───────────────────────────────────────────
// Blockfrost project keys only answer for the network they were issued on, so
// every preprod read/broadcast has to go to Koios preprod instead. When it did
// not, mainnet Blockfrost 404'd the addr_test… address, cip30GetBalance threw,
// and CIP-30 connectors — which call getBalance() inside connect() and swallow
// the rejection — silently ended up with no wallet address at all.

const TESTNET_CONFIG = { testnetMode: true } as WalletConfig
const MAINNET_CONFIG = {} as WalletConfig

const PREPROD_ADDRESS = deriveCardanoAddress(mnemonicToEntropy(MNEMONIC, wordlist), 0, true)
const TOKEN_UNIT = 'b'.repeat(56) + bytesToHex(new TextEncoder().encode('GRAV'))

interface StubCall { url: string; init?: RequestInit }

/** Stub global fetch; returns the calls it recorded. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response): StubCall[] {
  const calls: StubCall[] = []
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, init })
    return Promise.resolve(handler(url, init))
  })
  return calls
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const koiosUtxoRow = {
  tx_hash: 'ab'.repeat(32),
  tx_index: 3,
  value: '145856928529',
  datum_hash: null,
  asset_list: [{ policy_id: TOKEN_UNIT.slice(0, 56), asset_name: TOKEN_UNIT.slice(56), quantity: '42' }],
}

afterEach(() => vi.unstubAllGlobals())

describe('CIP-30 reads follow Testnet Mode', () => {
  it('sums the preprod Koios UTxO set for getBalance and never calls Blockfrost', async () => {
    const calls = stubFetch(() => jsonResponse([koiosUtxoRow, { ...koiosUtxoRow, tx_index: 4, value: '1000000', asset_list: [] }]))

    const balance = await cip30GetBalance(PREPROD_ADDRESS, TESTNET_CONFIG)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://preprod.koios.rest/api/v1/address_utxos')
    expect(calls.some(c => c.url.includes('blockfrost'))).toBe(false)
    expect(balance).toBe(bytesToHex(cborValue(145857928529n, [{ unit: TOKEN_UNIT, quantity: '42' }])))
  })

  it('reports a zero balance for a preprod address with no history', async () => {
    stubFetch(() => jsonResponse([]))
    // Koios answers with an empty row set — that is "not funded yet", NOT an
    // error, and must not reject the dApp's connect flow.
    await expect(cip30GetBalance(PREPROD_ADDRESS, TESTNET_CONFIG)).resolves.toBe(bytesToHex(cborUint(0n)))
  })

  it('still surfaces a real preprod backend outage as an error', async () => {
    stubFetch(() => new Response('bad gateway', { status: 502 }))
    await expect(cip30GetBalance(PREPROD_ADDRESS, TESTNET_CONFIG)).rejects.toThrow(/Koios unavailable/)
  })

  it('encodes preprod UTxOs as CIP-30 TransactionUnspentOutputs', async () => {
    const calls = stubFetch(() => jsonResponse([koiosUtxoRow]))

    const utxos = await cip30GetUtxos(PREPROD_ADDRESS, TESTNET_CONFIG)

    expect(calls[0].url).toBe('https://preprod.koios.rest/api/v1/address_utxos')
    expect(utxos).toEqual([bytesToHex(cborArray([
      cborArray([cborBytes(hexToBytes(koiosUtxoRow.tx_hash)), cborUint(3)]),
      cborArray([
        cborBytes(decodeCardanoAddress(PREPROD_ADDRESS)),
        cborValue(145856928529n, [{ unit: TOKEN_UNIT, quantity: '42' }]),
      ]),
    ]))])
  })

  it('picks preprod collateral from pure-ADA UTxOs only', async () => {
    stubFetch(() => jsonResponse([
      koiosUtxoRow,                                                          // carries a token — not collateral
      { ...koiosUtxoRow, tx_index: 9, value: '6000000', asset_list: [] },     // pure ADA, covers 5 ADA
    ]))

    const collateral = await cip30GetCollateral(PREPROD_ADDRESS, TESTNET_CONFIG)

    expect(collateral).toEqual([bytesToHex(cborArray([
      cborArray([cborBytes(hexToBytes(koiosUtxoRow.tx_hash)), cborUint(9)]),
      cborArray([cborBytes(decodeCardanoAddress(PREPROD_ADDRESS)), cborUint(6000000n)]),
    ]))])
  })

  it('broadcasts preprod transactions through Koios preprod, never mainnet Blockfrost', async () => {
    const calls = stubFetch(() => jsonResponse('cd'.repeat(32)))

    const hash = await cip30SubmitTx('a10081820001', TESTNET_CONFIG)

    expect(hash).toBe('cd'.repeat(32))
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://preprod.koios.rest/api/v1/submittx')
    expect(calls.some(c => c.url.includes('blockfrost'))).toBe(false)
  })

  it('treats a mainnet Blockfrost 404 as an unused address, not a failure', async () => {
    // Blockfrost 404s an address it has never seen. Throwing here killed the
    // connect flow of any wallet whose Cardano address was still unfunded.
    stubFetch(() => new Response('{"status_code":404}', { status: 404 }))
    const address = deriveCardanoAddress(mnemonicToEntropy(MNEMONIC, wordlist))
    await expect(cip30GetBalance(address, MAINNET_CONFIG)).resolves.toBe(bytesToHex(cborUint(0n)))
  })
})
