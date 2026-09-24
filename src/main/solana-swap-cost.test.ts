/**
 * Upfront SOL for a quoted Solana swap, read from the transaction.
 *
 * The two routes that failed on 2026-09-22 with System Program error 0x1:
 *   Jupiter Tilcayo -> SOL: needs fees + a TEMPORARY wrapped-SOL account
 *     (165 bytes, 1,488,440 lamports at current rent, closed back in-tx).
 *     Measured live 2026-09-23: 1,493,511 lamports required vs the 1,470,621
 *     the wallet held — 22,890 short, exactly the failure seen.
 *   LI.FI Tilcayo -> Monad (Mayan): statically 63,029 lamports of fees, but a
 *     successful simulation took 2,252,509 — the bridge program funds accounts
 *     internally, which only a simulation can see.
 */
import { describe, expect, it } from 'vitest'
import {
  Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, SystemProgram,
  type Connection,
} from '@solana/web3.js'
import {
  analyzeSolanaInstructions, tokenAccountSize, estimateSolanaSwapCost, wrappedSolAccountOf,
  type ResolvedInstruction,
} from './solana-swap-cost'
import {
  solanaRequiredLamports, solanaShortfallMessage, maxSolSaleLamports, type SolanaUpfrontCost,
} from '../shared/solana-upfront-cost'

const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
const CB = 'ComputeBudget111111111111111111111111111111'
const SYS = '11111111111111111111111111111111'
const WSOL = 'So11111111111111111111111111111111111111112'
const JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
const PAYER = '3noTuHnQdHkat2w5rBx18vAACMzFUvB5LodEe5vMN98d'

const le = (n: bigint, bytes: number) => { const b = new Uint8Array(bytes); let v = n; for (let i = 0; i < bytes; i++) { b[i] = Number(v & 0xffn); v >>= 8n } return b }
const cat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length } return out }
const cuLimit = (n: number): ResolvedInstruction => ({ programId: CB, accounts: [], data: cat(new Uint8Array([2]), le(BigInt(n), 4)) })
const cuPrice = (micro: number): ResolvedInstruction => ({ programId: CB, accounts: [], data: cat(new Uint8Array([3]), le(BigInt(micro), 8)) })
const ataCreate = (ata: string, mint: string, prog = TOKEN): ResolvedInstruction => ({ programId: ATA, accounts: [PAYER, ata, PAYER, mint, SYS, prog], data: new Uint8Array([1]) })
const transfer = (to: string, lamports: bigint): ResolvedInstruction => ({ programId: SYS, accounts: [PAYER, to], data: cat(le(2n, 4), le(lamports, 8)) })
const close = (acct: string): ResolvedInstruction => ({ programId: TOKEN, accounts: [acct, PAYER, PAYER], data: new Uint8Array([9]) })
const router: ResolvedInstruction = { programId: JUP, accounts: [PAYER, 'x'], data: new Uint8Array([1]) }

describe('analyzeSolanaInstructions', () => {
  const wsol = wrappedSolAccountOf(PAYER)

  it('Jupiter Tilcayo -> SOL shape: fee + temporary wrapped-SOL account, router opaque', () => {
    const s = analyzeSolanaInstructions(PAYER, 1, [cuLimit(1_400_000), cuPrice(50), ataCreate(wsol, WSOL), router, close(wsol)])
    expect(s.baseFeeLamports).toBe(5000n)
    expect(s.priorityFeeLamports).toBe(70n)                 // ceil(50 x 1.4M / 1e6)
    expect(s.ataCreates.map(a => a.ata)).toEqual([wsol])
    expect(s.closedToPayer).toEqual([wsol])
    expect(s.opaquePrograms).toEqual([JUP])
  })

  it('selling SOL: the transfer to the payer\'s own wrapped-SOL account is the SALE, not a cost', () => {
    const s = analyzeSolanaInstructions(PAYER, 1, [ataCreate(wsol, WSOL), transfer(wsol, 10_000_000n), router])
    expect(s.wrapLamports).toBe(10_000_000n)
    expect(s.otherTransferLamports).toBe(0n)
  })

  it('SOL sent anywhere else is a cost', () => {
    const s = analyzeSolanaInstructions(PAYER, 1, [transfer('TipAccount11111111111111111111111111111111', 5_000n)])
    expect(s.otherTransferLamports).toBe(5_000n)
  })

  it('an ATA created by someone ELSE costs the payer nothing', () => {
    const other: ResolvedInstruction = { ...ataCreate(wsol, WSOL), accounts: ['Solver111', wsol, PAYER, WSOL, SYS, TOKEN] }
    expect(analyzeSolanaInstructions(PAYER, 1, [other]).ataCreates).toHaveLength(0)
  })

  it('default compute limit when none is set: 200k per instruction, capped', () => {
    expect(analyzeSolanaInstructions(PAYER, 1, [cuPrice(1_000_000), router]).priorityFeeLamports).toBe(200_000n)
  })
})

describe('tokenAccountSize', () => {
  const mintWith = (types: number[], dataLens: number[]) => {
    const tlv = types.map((t, i) => cat(le(BigInt(t), 2), le(BigInt(dataLens[i]), 2), new Uint8Array(dataLens[i])))
    return cat(new Uint8Array(165), new Uint8Array([1]), ...tlv)
  }
  it('classic SPL token account: 165', () => {
    expect(tokenAccountSize(TOKEN, null)).toEqual({ size: 165, complete: true })
  })
  it('Token-2022 with no mint extensions: 170 (measured on the user\'s own accounts)', () => {
    expect(tokenAccountSize(TOKEN22, mintWith([], []))).toEqual({ size: 170, complete: true })
  })
  it('PYUSD\'s real extension set -> 187 (measured on-chain)', () => {
    const m = mintWith([3, 12, 1, 4, 16, 14, 18, 19], [32, 32, 108, 65, 64, 64, 64, 100])
    expect(tokenAccountSize(TOKEN22, m)).toEqual({ size: 187, complete: true })
  })
  it('an unknown mint extension type is flagged, not guessed', () => {
    expect(tokenAccountSize(TOKEN22, mintWith([99], [4])).complete).toBe(false)
  })
})

/** A scripted RPC: which accounts exist, the payer's balance, and rent by size. */
function fakeRpc(opts: { exists: Set<string>; balance: number; mints?: Record<string, Uint8Array>; simPost?: number | null; simErr?: unknown }) {
  const calls = { simulate: 0 }
  const conn = {
    async getAddressLookupTable() { return { value: null } },
    async getMultipleAccountsInfo(keys: PublicKey[]) {
      return keys.map(k => {
        const a = k.toBase58()
        if (a === PAYER) return { lamports: opts.balance, data: Buffer.alloc(0) }
        if (opts.mints?.[a]) return { lamports: 1, data: Buffer.from(opts.mints[a]) }
        return opts.exists.has(a) ? { lamports: 2_039_280, data: Buffer.alloc(165) } : null
      })
    },
    // Current mainnet values, read 2026-09-23.
    async getMinimumBalanceForRentExemption(size: number) { return ({ 165: 1_488_440, 170: 1_513_840, 187: 1_620_520 } as Record<number, number>)[size] ?? 890_880 + size * 3_480 },
    async simulateTransaction() {
      calls.simulate++
      return { value: { err: opts.simErr ?? null, accounts: opts.simPost == null ? null : [{ lamports: opts.simPost }] } }
    },
  }
  return { conn: conn as unknown as Connection, calls }
}

function buildTx(payer: PublicKey, ixs: TransactionInstruction[]): string {
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: '11111111111111111111111111111111', instructions: ixs }).compileToV0Message()
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64')
}

describe('estimateSolanaSwapCost', () => {
  const payer = new PublicKey(PAYER)
  const wsol = new PublicKey(wrappedSolAccountOf(PAYER))
  const ataIx = (ata: PublicKey, mint: string, prog = TOKEN) => new TransactionInstruction({
    programId: new PublicKey(ATA), data: Buffer.from([1]),
    keys: [payer, ata, payer, new PublicKey(mint), SystemProgram.programId, new PublicKey(prog)].map((p, i) =>
      ({ pubkey: p, isSigner: i === 0, isWritable: i < 2 })),
  })
  const closeIx = (acct: PublicKey) => new TransactionInstruction({
    programId: new PublicKey(TOKEN), data: Buffer.from([9]),
    keys: [{ pubkey: acct, isSigner: false, isWritable: true }, { pubkey: payer, isSigner: false, isWritable: true }, { pubkey: payer, isSigner: true, isWritable: false }],
  })
  const routerIx = new TransactionInstruction({ programId: new PublicKey(JUP), data: Buffer.from([1]), keys: [{ pubkey: payer, isSigner: true, isWritable: true }] })
  const jupTx = buildTx(payer, [ataIx(wsol, WSOL), routerIx, closeIx(wsol)])

  it('the reported Jupiter failure: required > balance, and the message says by how much', async () => {
    const { conn } = fakeRpc({ exists: new Set(), balance: 1_470_621 })
    const c = await estimateSolanaSwapCost(jupTx, PAYER, conn, { paysOutSolToPayer: true })
    expect(c!.newAccounts).toEqual([expect.objectContaining({ size: 165, rentLamports: '1488440', refundedInTx: true })])
    expect(c!.requiredLamports).toBe('1493440')                 // 5,000 fee + 1,488,440 rent
    expect(c!.complete).toBe(false)                             // the router is opaque
    const msg = solanaShortfallMessage(c!)
    expect(msg).toMatch(/needs at least 0\.001493 SOL up front/)
    expect(msg).toMatch(/temporary account/)
    expect(msg).toMatch(/Add at least 0\.000023 SOL/)
  })

  it('output is SOL, so no simulation measurement is attempted (proceeds would net out)', async () => {
    const { conn, calls } = fakeRpc({ exists: new Set(), balance: 67_000_000, simPost: 90_000_000 })
    const c = await estimateSolanaSwapCost(jupTx, PAYER, conn, { paysOutSolToPayer: true })
    expect(calls.simulate).toBe(0)
    expect(c!.measuredLamports).toBeNull()
    expect(solanaShortfallMessage(c!)).toBeNull()
  })

  it('an account that already EXISTS costs no rent', async () => {
    const { conn } = fakeRpc({ exists: new Set([wsol.toBase58()]), balance: 10_000 })
    const c = await estimateSolanaSwapCost(jupTx, PAYER, conn, { paysOutSolToPayer: true })
    expect(c!.newAccounts).toHaveLength(0)
    expect(c!.requiredLamports).toBe('5000')
    expect(solanaShortfallMessage(c!)).toBeNull()
  })

  it('a Token-2022 output account is sized from the MINT and costed at current rent', async () => {
    const PYUSD = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo'
    const ata = Keypair.generate().publicKey
    const tlv = (t: number, n: number) => cat(le(BigInt(t), 2), le(BigInt(n), 2), new Uint8Array(n))
    const mint = cat(new Uint8Array(165), new Uint8Array([1]), tlv(1, 108), tlv(14, 64))
    const { conn } = fakeRpc({ exists: new Set(), balance: 10_000_000, mints: { [PYUSD]: mint } })
    const c = await estimateSolanaSwapCost(buildTx(payer, [ataIx(ata, PYUSD, TOKEN22), routerIx]), PAYER, conn)
    expect(c!.newAccounts[0]).toMatchObject({ size: 187, rentLamports: '1620520', tokenProgram: TOKEN22, refundedInTx: false })
  })

  it('the Mayan case: a successful simulation\'s larger consumption becomes the requirement', async () => {
    // Static read: fees only. Simulation: 2,252,509 lamports actually taken.
    const { conn } = fakeRpc({ exists: new Set(), balance: 67_157_259, simPost: 67_157_259 - 2_252_509 })
    const c = await estimateSolanaSwapCost(buildTx(payer, [routerIx]), PAYER, conn, { paysOutSolToPayer: false })
    expect(c!.requiredLamports).toBe('5000')
    expect(c!.measuredLamports).toBe('2252509')
    expect(solanaRequiredLamports(c!)).toEqual({ lamports: 2_252_509n, exact: true })
  })

  it('a FAILED simulation is not a measurement', async () => {
    const { conn } = fakeRpc({ exists: new Set(), balance: 1_000, simErr: { InstructionError: [0, { Custom: 1 }] } })
    const c = await estimateSolanaSwapCost(buildTx(payer, [routerIx]), PAYER, conn)
    expect(c!.measuredLamports).toBeNull()
    expect(c!.simulationError).toMatch(/InstructionError/)
  })
})

describe('Max for a native SOL sale', () => {
  const cost = (over: Partial<SolanaUpfrontCost>): SolanaUpfrontCost => ({
    baseFeeLamports: '5000', priorityFeeLamports: '0', newAccounts: [], rentLamports: '1488440',
    otherTransferLamports: '0', saleLamports: '10000000', requiredLamports: '11493440', costLamports: '1493440',
    balanceLamports: '67157259', complete: true, incompleteReason: null, measuredLamports: null, simulationError: null, ...over,
  })
  it('leaves exactly the non-sale requirement', () => {
    expect(maxSolSaleLamports(cost({}), 67_157_259n)).toBe(67_157_259n - 1_493_440n)
  })
  it('never goes negative', () => {
    expect(maxSolSaleLamports(cost({}), 1_000n)).toBe(0n)
  })
  it('Max\'s result passes the same shortfall rule the button and pre-sign check use', () => {
    const max = maxSolSaleLamports(cost({}), 67_157_259n)
    const atMax = cost({ saleLamports: max.toString(), requiredLamports: (max + 1_493_440n).toString() })
    expect(solanaShortfallMessage(atMax)).toBeNull()
  })
})
