/**
 * The dependency-free parser must read exactly what web3.js reads — it replaced
 * `VersionedTransaction.deserialize` in the fee and execution checks.
 */
import { describe, it, expect } from 'vitest'
import {
  Keypair, PublicKey, TransactionMessage, VersionedTransaction, SystemProgram, AddressLookupTableAccount,
  Transaction, ComputeBudgetProgram,
} from '@solana/web3.js'
import { parseSolanaTransaction, base58Encode, base64ToBytes } from './solana-transaction'

const blockhash = Keypair.generate().publicKey.toBase58()

function v0(opts: { signers?: Keypair[]; lookups?: AddressLookupTableAccount[] } = {}) {
  const payer = Keypair.generate()
  const signers = [payer, ...(opts.signers ?? [])]
  const lookupKey = Keypair.generate().publicKey
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: lookupKey, lamports: 5 }),
    ...(opts.signers ?? []).map(s => SystemProgram.transfer({ fromPubkey: s.publicKey, toPubkey: payer.publicKey, lamports: 1 })),
  ]
  const message = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions })
    .compileToV0Message(opts.lookups)
  const tx = new VersionedTransaction(message)
  tx.sign(signers)
  return { tx, bytes: tx.serialize(), payer }
}

function expectSameAsWeb3(bytes: Uint8Array) {
  const ours = parseSolanaTransaction(bytes)
  const theirs = VersionedTransaction.deserialize(bytes)
  expect(ours.version).toBe(theirs.version)
  expect(ours.staticAccountKeys).toEqual(theirs.message.staticAccountKeys.map(k => k.toBase58()))
  expect(ours.header).toEqual(theirs.message.header)
  expect(ours.recentBlockhash).toBe(theirs.message.recentBlockhash)
  expect(ours.instructions.map(i => [i.programIdIndex, i.accountIndexes, Array.from(i.data)]))
    .toEqual(theirs.message.compiledInstructions.map(i => [i.programIdIndex, i.accountKeyIndexes, Array.from(i.data)]))
  expect(ours.addressTableLookups).toEqual(theirs.message.addressTableLookups.map(l => ({
    accountKey: l.accountKey.toBase58(), writableIndexes: l.writableIndexes, readonlyIndexes: l.readonlyIndexes,
  })))
}

describe('parseSolanaTransaction matches web3.js', () => {
  it('a signed v0 transaction', () => {
    expectSameAsWeb3(v0().bytes)
  })

  it('a v0 transaction with an address lookup table', () => {
    const lookedUp = Keypair.generate().publicKey
    const table = new AddressLookupTableAccount({
      key: Keypair.generate().publicKey,
      state: { deactivationSlot: BigInt('18446744073709551615'), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: [lookedUp] },
    })
    const payer = Keypair.generate()
    const msg = new TransactionMessage({
      payerKey: payer.publicKey, recentBlockhash: blockhash,
      instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: lookedUp, lamports: 1 })],
    }).compileToV0Message([table])
    const bytes = new VersionedTransaction(msg).serialize()
    expect(parseSolanaTransaction(bytes).addressTableLookups).toHaveLength(1)
    expectSameAsWeb3(bytes)
  })

  it('two required signers and base64 input', () => {
    const { bytes } = v0({ signers: [Keypair.generate()] })
    const view = parseSolanaTransaction(Buffer.from(bytes).toString('base64'))
    expect(view.header.numRequiredSignatures).toBe(2)
    expectSameAsWeb3(bytes)
  })

  it('a legacy transaction', () => {
    const payer = Keypair.generate()
    const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: blockhash })
      .add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }))
    tx.sign(payer)
    const bytes = tx.serialize()
    expect(parseSolanaTransaction(bytes).version).toBe('legacy')
    expectSameAsWeb3(bytes)
  })
})

describe('parseSolanaTransaction refuses what web3.js refuses', () => {
  it('truncation', () => {
    const { bytes } = v0()
    for (const cut of [1, 40, 70, bytes.length - 40]) {
      expect(() => parseSolanaTransaction(bytes.subarray(0, cut))).toThrow()
      expect(() => VersionedTransaction.deserialize(bytes.subarray(0, cut))).toThrow()
    }
  })

  it('a message version other than 0', () => {
    const bytes = Uint8Array.from(v0().bytes)
    bytes[65] = 0x81
    expect(() => parseSolanaTransaction(bytes)).toThrow(/version 1/)
    expect(() => VersionedTransaction.deserialize(bytes)).toThrow()
  })

  it('a signature count that does not match the required signers', () => {
    const { bytes } = v0()
    const extra = new Uint8Array(bytes.length + 64)
    extra[0] = 2
    extra.set(bytes.subarray(1, 65), 1)
    extra.set(bytes.subarray(65), 129)
    expect(() => parseSolanaTransaction(extra)).toThrow(/signature count/)
    expect(() => VersionedTransaction.deserialize(extra)).toThrow()
  })
})

describe('encoding helpers', () => {
  it('base58 and base64 agree with the platform', () => {
    const key = Keypair.generate().publicKey
    expect(base58Encode(key.toBytes())).toBe(key.toBase58())
    expect(base58Encode(new PublicKey('11111111111111111111111111111111').toBytes())).toBe('11111111111111111111111111111111')
    const raw = Uint8Array.from({ length: 257 }, (_, i) => (i * 37) % 256)
    for (const n of [0, 1, 2, 3, 257]) {
      expect(Array.from(base64ToBytes(Buffer.from(raw.subarray(0, n)).toString('base64')))).toEqual(Array.from(raw.subarray(0, n)))
    }
    expect(() => base64ToBytes('not base64!')).toThrow()
  })
})
