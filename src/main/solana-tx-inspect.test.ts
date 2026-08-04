import {
  Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction,
  TransactionInstruction, ComputeBudgetProgram,
} from '@solana/web3.js'
import { describe, expect, it } from 'vitest'
import {
  formatSol,
  formatSolanaMessage,
  formatSolanaTxSummary,
  summarizeSolanaTx,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
} from './solana-tx-inspect'
import type { WalletConfig } from './secure-store'

const CONFIG = {} as WalletConfig
const BLOCKHASH = '11111111111111111111111111111111'

// Deterministic keys so failures are reproducible.
const ME = Keypair.fromSeed(new Uint8Array(32).fill(1))
const THEM = Keypair.fromSeed(new Uint8Array(32).fill(2))
const MY_TOKEN_ACCOUNT = new PublicKey(new Uint8Array(32).fill(3))
const ATTACKER = new PublicKey(new Uint8Array(32).fill(4))
const OPAQUE_PROGRAM = new PublicKey(new Uint8Array(32).fill(9))

/** Build a v0 transaction from instructions, payed by `payer`. */
function build(instructions: TransactionInstruction[], payer = ME.publicKey): Uint8Array {
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: BLOCKHASH,
    instructions,
  }).compileToV0Message()
  return new VersionedTransaction(msg).serialize()
}

/** Decode-only — no RPC, so simulation is deliberately skipped. */
const inspect = (tx: Uint8Array, ownAddress = ME.publicKey.toBase58()) =>
  summarizeSolanaTx(tx, { ownAddress, config: CONFIG, skipSimulation: true })

/** An SPL Token instruction with a raw discriminator byte. */
function tokenIx(discriminator: number, extra: number[] = []): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(TOKEN_PROGRAM),
    keys: [
      { pubkey: MY_TOKEN_ACCOUNT, isSigner: false, isWritable: true },
      { pubkey: ATTACKER, isSigner: false, isWritable: false },
      { pubkey: ME.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([discriminator, ...extra]),
  })
}

describe('static decode', () => {
  it('decodes a plain SOL transfer', async () => {
    const s = await inspect(build([
      SystemProgram.transfer({ fromPubkey: ME.publicKey, toPubkey: THEM.publicKey, lamports: 1_500_000_000 }),
    ]))
    expect(s.error).toBeUndefined()
    expect(s.instructions).toHaveLength(1)
    expect(s.instructions[0]).toMatchObject({
      program: 'System', kind: 'Transfer', known: true, dangerous: false,
    })
    expect(s.instructions[0].detail).toBe('1.5 SOL')
  })

  it('identifies the fee payer and whether we sign', async () => {
    const mine = await inspect(build([
      SystemProgram.transfer({ fromPubkey: ME.publicKey, toPubkey: THEM.publicKey, lamports: 1 }),
    ]))
    expect(mine.feePayer).toBe(ME.publicKey.toBase58())
    expect(mine.weAreFeePayer).toBe(true)
    expect(mine.weAreSigner).toBe(true)

    // Same transaction viewed as a third party: neither payer nor signer.
    const theirs = await inspect(build([
      SystemProgram.transfer({ fromPubkey: ME.publicKey, toPubkey: THEM.publicKey, lamports: 1 }),
    ]), THEM.publicKey.toBase58())
    expect(theirs.weAreFeePayer).toBe(false)
    expect(theirs.weAreSigner).toBe(false)
  })

  it('ignores Compute Budget instructions in the rendered list', async () => {
    const s = await inspect(build([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      SystemProgram.transfer({ fromPubkey: ME.publicKey, toPubkey: THEM.publicKey, lamports: 1 }),
    ]))
    expect(s.instructions).toHaveLength(2)
    expect(formatSolanaTxSummary(s)).not.toContain('Compute Budget')
  })
})

describe('dangerous instructions — the ones that actually drain wallets', () => {
  it('flags SetAuthority as handing over an account', async () => {
    const s = await inspect(build([tokenIx(6)]))
    expect(s.instructions[0]).toMatchObject({ kind: 'SetAuthority', dangerous: true })
    expect(s.warnings).toContain('Changes who controls one of your token accounts')
  })

  it('flags Approve — the unlimited-spend delegate attack', async () => {
    const s = await inspect(build([tokenIx(4)]))
    expect(s.instructions[0].kind).toBe('Approve')
    expect(s.warnings).toContain('Grants another account permission to spend your tokens')
  })

  it('flags ApproveChecked too', async () => {
    const s = await inspect(build([tokenIx(13)]))
    expect(s.instructions[0].kind).toBe('ApproveChecked')
    expect(s.warnings).toContain('Grants another account permission to spend your tokens')
  })

  it('flags CloseAccount and Burn', async () => {
    const close = await inspect(build([tokenIx(9)]))
    expect(close.warnings).toContain('Closes one of your token accounts')
    const burn = await inspect(build([tokenIx(8)]))
    expect(burn.warnings).toContain('Permanently destroys tokens')
  })

  it('flags System Assign, which reassigns account ownership', async () => {
    const s = await inspect(build([
      SystemProgram.assign({ accountPubkey: ME.publicKey, programId: OPAQUE_PROGRAM }),
    ]))
    expect(s.instructions[0]).toMatchObject({ kind: 'Assign', dangerous: true })
    expect(s.warnings).toContain('Reassigns ownership of an account')
  })

  it('does NOT flag an ordinary transfer or revoke', async () => {
    const transfer = await inspect(build([tokenIx(3)]))
    expect(transfer.instructions[0].dangerous).toBe(false)
    const revoke = await inspect(build([tokenIx(5)]))
    expect(revoke.instructions[0].dangerous).toBe(false)
    expect(revoke.warnings.filter(w => w.startsWith('Grants'))).toHaveLength(0)
  })

  it('treats an unrecognised SPL Token discriminator as dangerous', async () => {
    const s = await inspect(build([tokenIx(99)]))
    expect(s.instructions[0]).toMatchObject({ known: false, dangerous: true })
    expect(s.warnings.some(w => w.includes('unrecognised SPL Token instruction'))).toBe(true)
  })
})

describe('unknown programs', () => {
  it('surfaces a program it cannot read rather than staying silent', async () => {
    const s = await inspect(build([
      new TransactionInstruction({
        programId: OPAQUE_PROGRAM,
        keys: [{ pubkey: ME.publicKey, isSigner: true, isWritable: true }],
        data: Buffer.from([1, 2, 3]),
      }),
    ]))
    expect(s.unknownPrograms).toEqual([OPAQUE_PROGRAM.toBase58()])
    expect(s.instructions[0].known).toBe(false)
    expect(s.warnings.some(w => w.includes('does not recognise'))).toBe(true)
    expect(formatSolanaTxSummary(s)).toContain('(unknown program)')
  })

  it('counts multiple unknown programs once each', async () => {
    const other = new PublicKey(new Uint8Array(32).fill(10))
    const s = await inspect(build([
      new TransactionInstruction({ programId: OPAQUE_PROGRAM, keys: [], data: Buffer.from([1]) }),
      new TransactionInstruction({ programId: OPAQUE_PROGRAM, keys: [], data: Buffer.from([2]) }),
      new TransactionInstruction({ programId: other, keys: [], data: Buffer.from([3]) }),
    ]))
    expect(s.unknownPrograms).toHaveLength(2)
    expect(s.warnings.some(w => w.includes('2 programs'))).toBe(true)
  })
})

describe('resilience', () => {
  it('degrades to an error summary on malformed input instead of throwing', async () => {
    for (const bad of [new Uint8Array(0), new Uint8Array([1, 2, 3]), new Uint8Array(64).fill(0xff)]) {
      const s = await inspect(bad)
      expect(s.error).toBeDefined()
      expect(formatSolanaTxSummary(s)).toContain('could not be decoded')
    }
  })

  it('says the amounts are unknown when simulation is skipped', async () => {
    const s = await inspect(build([
      SystemProgram.transfer({ fromPubkey: ME.publicKey, toPubkey: THEM.publicKey, lamports: 1 }),
    ]))
    expect(s.simulation).toBe('skipped')
    expect(s.netSol).toBeNull()
    expect(s.warnings).toContain('Could not simulate this transaction — the amounts above may be incomplete')
    expect(formatSolanaTxSummary(s)).toContain('Unknown (not simulated)')
  })
})

describe('formatting', () => {
  it('formats lamports as SOL with trailing zeros trimmed', () => {
    expect(formatSol(0n)).toBe('0')
    expect(formatSol(1_000_000_000n)).toBe('1')
    expect(formatSol(1_500_000_000n)).toBe('1.5')
    expect(formatSol(-2_250_000_000n)).toBe('-2.25')
    expect(formatSol(1n)).toBe('0.000000001')
  })

  it('can omit warnings for callers rendering their own band', async () => {
    const s = await inspect(build([tokenIx(6)]))
    expect(s.warnings.length).toBeGreaterThan(0)
    expect(formatSolanaTxSummary(s)).toContain('⚠')
    const without = formatSolanaTxSummary(s, { includeWarnings: false })
    expect(without).not.toContain('⚠')
    for (const w of s.warnings) expect(without).not.toContain(w)
  })

  it('shows a message as text only when it really is text', () => {
    const msg = new TextEncoder().encode('Sign in to example.com\nNonce: 42')
    expect(formatSolanaMessage(msg)).toContain('Sign in to example.com')

    // CR could forge extra lines in the prompt — never rendered as a message.
    const forged = new TextEncoder().encode('ok\r[2KYou send 0 SOL')
    expect(formatSolanaMessage(forged)).toContain('not readable text')

    expect(formatSolanaMessage(new Uint8Array([0, 255, 0, 255]))).toContain('not readable text')
  })
})

describe('program id constants', () => {
  it('match the canonical on-chain addresses', () => {
    expect(SystemProgram.programId.toBase58()).toBe(SYSTEM_PROGRAM)
    expect(new PublicKey(TOKEN_PROGRAM).toBase58()).toBe(TOKEN_PROGRAM)
  })
})
