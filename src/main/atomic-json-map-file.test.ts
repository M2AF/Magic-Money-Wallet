/**
 * The desktop tracking file: interruption at any step keeps the previous
 * records, and a damaged file is reported, never read as empty. Real files in a
 * temp directory; failures are injected into a wrapped `fs`.
 */
import { describe, it, expect, afterEach } from 'vitest'
import * as nodeFs from 'fs'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readJsonMapFile, writeJsonMapFileAtomic, readJsonObjectFile, writeJsonObjectFileAtomic, JsonMapFileError, type JsonMapFs } from './atomic-json-map-file'
import { mapTrackingStore } from './xreserve-testnet-deposit'
import { parseSendJournal } from './xreserve-testnet-send-journal'
import { bech32 } from '@scure/base'

const dirs: string[] = []
afterEach(() => { while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true }) })
function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), 'mm-atomic-'))
  dirs.push(dir)
  return { dir, path: join(dir, 'xreserve-tracking.json') }
}
const realFs: JsonMapFs = {
  existsSync: nodeFs.existsSync, readFileSync: nodeFs.readFileSync, writeFileSync: nodeFs.writeFileSync, renameSync: nodeFs.renameSync,
  unlinkSync: nodeFs.unlinkSync, openSync: nodeFs.openSync, fsyncSync: nodeFs.fsyncSync, closeSync: nodeFs.closeSync, mkdirSync: nodeFs.mkdirSync,
}
/** `realFs` with one step failing, as a crash or full disk at that point would. */
const failingAt = (step: 'writeFileSync' | 'fsyncSync' | 'renameSync'): JsonMapFs => ({
  ...realFs,
  [step]: (...args: unknown[]) => {
    if (step === 'writeFileSync') nodeFs.writeFileSync(args[0] as string, '{"half":')   // a torn temp file
    throw new Error(`${step} failed`)
  },
})

describe('atomic JSON map file', () => {
  it('preserves nested swap evidence and the previous file on interrupted replacement', () => {
    const { dir, path } = tempFile()
    const record = { order: { sourceTxHash: 'ab'.repeat(32), sellAmountRaw: '9007199254740993000', state: 'unknown' } }
    writeJsonObjectFileAtomic(realFs, dir, path, record)
    expect(readJsonObjectFile(realFs, path)).toEqual(record)
    for (const step of ['writeFileSync', 'fsyncSync', 'renameSync'] as const) {
      expect(() => writeJsonObjectFileAtomic(failingAt(step), dir, path, {})).toThrow(JsonMapFileError)
      expect(readJsonObjectFile(realFs, path)).toEqual(record)
    }
  })
  it('writes, reads back, and replaces the whole map', () => {
    const { dir, path } = tempFile()
    expect(readJsonMapFile(realFs, path)).toEqual({})   // missing = empty
    writeJsonMapFileAtomic(realFs, dir, path, { a: '1', b: '2' })
    expect(readJsonMapFile(realFs, path)).toEqual({ a: '1', b: '2' })
    writeJsonMapFileAtomic(realFs, dir, path, { b: '3' })
    expect(readJsonMapFile(realFs, path)).toEqual({ b: '3' })
    expect(existsSync(`${path}.tmp`)).toBe(false)
  })

  for (const step of ['writeFileSync', 'fsyncSync', 'renameSync'] as const) {
    it(`an interruption at ${step} keeps the previous file intact and reports the failure`, () => {
      const { dir, path } = tempFile()
      writeJsonMapFileAtomic(realFs, dir, path, { kept: 'yes' })
      const before = readFileSync(path, 'utf-8')
      expect(() => writeJsonMapFileAtomic(failingAt(step), dir, path, { kept: 'no', extra: 'x' }))
        .toThrow(JsonMapFileError)
      expect(readFileSync(path, 'utf-8')).toBe(before)
      expect(readJsonMapFile(realFs, path)).toEqual({ kept: 'yes' })
      expect(existsSync(`${path}.tmp`)).toBe(false)
    })
  }

  it('a leftover temp file from a crash does not affect reads', () => {
    const { dir, path } = tempFile()
    writeJsonMapFileAtomic(realFs, dir, path, { a: '1' })
    writeFileSync(`${path}.tmp`, '{"torn":')
    expect(readJsonMapFile(realFs, path)).toEqual({ a: '1' })
    writeJsonMapFileAtomic(realFs, dir, path, { a: '2' })   // and the next write replaces it
    expect(readJsonMapFile(realFs, path)).toEqual({ a: '2' })
  })

  for (const [name, text] of [['truncated JSON', '{"a":"1",'], ['an array', '["a"]'], ['a non-string value', '{"a":1}'], ['empty', '']] as const) {
    it(`a damaged file (${name}) is reported, never read as empty`, () => {
      const { path } = tempFile()
      writeFileSync(path, text)
      expect(() => readJsonMapFile(realFs, path)).toThrow(JsonMapFileError)
    })
  }

  it('a damaged file refuses the next save, so its records are never overwritten with a fresh map', async () => {
    const { dir, path } = tempFile()
    writeFileSync(path, '{"xreserve-inbound:v1:testnet:w:a:0xabc":"{…record…}", TORN')
    const damaged = readFileSync(path, 'utf-8')
    const store = mapTrackingStore(async () => readJsonMapFile(realFs, path), async (m) => writeJsonMapFileAtomic(realFs, dir, path, m))
    await expect(store.save('new', '{}')).rejects.toThrow(JsonMapFileError)
    await expect(store.load('new')).rejects.toThrow(JsonMapFileError)
    expect(readFileSync(path, 'utf-8')).toBe(damaged)
  })
})

describe('send journal schema', () => {
  const good = {
    v: 1, kind: 'xreserve-send-journal', identity: { walletId: 'w', accountId: 'account-0', environment: 'testnet' },
    sender: `0x${'aa'.repeat(20)}`, chainId: 11155111, xReserve: '0x008888878f94c0d87defdf0b07f46b93c1934442', nonce: 3,
    txHash: `0x${'ab'.repeat(32)}`,
    approved: {
      recipient: bech32.encode('addr_test', bech32.toWords(Uint8Array.from([0x60, ...Buffer.from('1c'.repeat(28), 'hex')])), 1000),
      amountRaw: '20000000', maxFeeRaw: '10000000',
    },
    confirmations: { ethereum: 12, cardano: 10 }, cardanoTipAtSubmission: { blockHeight: 5 }, createdAt: 1,
  }

  it('accepts exactly the closed schema and refuses anything else', () => {
    expect(parseSendJournal(JSON.stringify(good))).toMatchObject({ nonce: 3, txHash: good.txHash })
  })

  it('refuses extra fields (no calldata or signed bytes), wrong chain or contract, mainnet identity, bad hashes', () => {
    const bad = [
      { ...good, calldata: '0xfaadb53b' }, { ...good, serialized: '0x02f8' }, { ...good, chainId: 1 },
      { ...good, xReserve: '0x8888888199b2df864bf678259607d6d5ebb4e3ce' },
      { ...good, identity: { ...good.identity, environment: 'mainnet' } }, { ...good, txHash: '0x12' }, { ...good, nonce: -1 },
      { ...good, approved: { ...good.approved, amountRaw: '0' } },
    ]
    for (const b of bad) expect(parseSendJournal(JSON.stringify(b))).toBeNull()
    expect(parseSendJournal('{"v":1')).toBeNull()
  })
})
