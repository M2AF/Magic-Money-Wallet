/**
 * solana-swap-cost.ts — how much SOL a quoted Solana swap transaction needs UP
 * FRONT, read from the transaction itself.
 *
 * WHY
 *
 * The swap screen reserved a flat 0.001 SOL for "fees". Field report
 * 2026-09-22: the wallet held 0.001470621 SOL, passed that check, and both a
 * Jupiter route (Tilcayo -> SOL) and a LI.FI route (Tilcayo -> Monad) then
 * failed in simulation with System Program error 0x1 while the Associated Token
 * Program created a token account — whose rent (1,488,440 lamports for 165
 * bytes at the time) plus fees exceeded the balance. A flat constant cannot know
 * whether a route creates accounts, how many, of what size (Token-2022 accounts
 * are larger, and their size depends on the MINT's extensions), whether they
 * already exist, or what the rent currently is (it has changed: accounts funded
 * at 2,039,280 lamports now need 1,488,440).
 *
 * WHAT IT READS
 *
 *   fees      5,000 lamports per required signature (base) plus the priority fee
 *             the ComputeBudget instructions set (unit price x unit limit)
 *   accounts  Associated-Token-Account creations paid by the fee payer, sized
 *             per token program and mint extensions, costed at CURRENT rent
 *             (getMinimumBalanceForRentExemption), and skipped when the account
 *             already exists; System CreateAccount(WithSeed) paid by the payer
 *   transfers SOL the payer sends in the transaction: to its own wrapped-SOL
 *             account (that is the SOL being SOLD), or elsewhere (a cost)
 *
 * WHAT IT CANNOT READ
 *
 * A program the payer is handed to (Jupiter's router, a bridge program) may
 * create or fund accounts through its own internal calls. That is invisible to
 * a static read, so the result says `complete: false` and the figure is a
 * LOWER BOUND ("at least"), never a falsely precise total. Simulation remains
 * the final check before signing.
 */

import {
  PublicKey, VersionedTransaction, type Connection, type AddressLookupTableAccount,
} from '@solana/web3.js'
import type { SolanaNewAccount, SolanaUpfrontCost } from '../shared/solana-upfront-cost'
export type { SolanaNewAccount, SolanaUpfrontCost } from '../shared/solana-upfront-cost'
export { solanaRequiredLamports, solanaCostShortfall, solanaShortfallMessage } from '../shared/solana-upfront-cost'

const SYSTEM_PROGRAM = '11111111111111111111111111111111'
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111'
const WSOL_MINT = 'So11111111111111111111111111111111111111112'

/** Programs whose instructions this module fully understands the SOL effect of. */
const KNOWN_PROGRAMS = new Set([
  SYSTEM_PROGRAM, TOKEN_PROGRAM, TOKEN_2022_PROGRAM, ATA_PROGRAM, COMPUTE_BUDGET,
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
])

export const LAMPORTS_PER_SIGNATURE = 5000n
/** Solana's default compute-unit limit per non-ComputeBudget instruction, and the cap. */
const DEFAULT_CU_PER_INSTRUCTION = 200_000n
const MAX_CU = 1_400_000n

/** An instruction with its accounts already resolved to base58 addresses. */
export interface ResolvedInstruction {
  programId: string
  accounts: string[]
  data: Uint8Array
}

export interface StaticSolanaCost {
  signatures: number
  baseFeeLamports: bigint
  priorityFeeLamports: bigint
  /** ATA creations paid by the fee payer, before checking whether they exist. */
  ataCreates: Array<{ ata: string; owner: string; mint: string; tokenProgram: string }>
  /** System-program account creations paid by the fee payer. */
  systemCreates: Array<{ address: string; lamports: bigint; space: bigint }>
  /** SOL the payer sends to its own wrapped-SOL account — the amount being sold. */
  wrapLamports: bigint
  /** SOL the payer sends anywhere else — a cost on top of the sale. */
  otherTransferLamports: bigint
  /** Token accounts closed back to the payer in the same transaction (rent returns). */
  closedToPayer: string[]
  /** Programs handed the payer whose internal effects cannot be read statically. */
  opaquePrograms: string[]
}

const u32 = (d: Uint8Array, o: number) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0
const u64 = (d: Uint8Array, o: number) => {
  let v = 0n
  for (let i = 7; i >= 0; i--) v = (v << 8n) + BigInt(d[o + i] ?? 0)
  return v
}

/** The payer's own associated wrapped-SOL account, under the classic token program. */
export function wrappedSolAccountOf(payer: string): string {
  return PublicKey.findProgramAddressSync(
    [new PublicKey(payer).toBytes(), new PublicKey(TOKEN_PROGRAM).toBytes(), new PublicKey(WSOL_MINT).toBytes()],
    new PublicKey(ATA_PROGRAM),
  )[0].toBase58()
}

/**
 * Everything knowable about the SOL a transaction takes from `payer`, from the
 * instructions alone. Pure: no network access.
 */
export function analyzeSolanaInstructions(
  payer: string, signatures: number, instructions: ResolvedInstruction[],
): StaticSolanaCost {
  let cuLimit: bigint | null = null
  let cuPriceMicro = 0n
  let nonBudget = 0n
  const out: StaticSolanaCost = {
    signatures, baseFeeLamports: LAMPORTS_PER_SIGNATURE * BigInt(signatures), priorityFeeLamports: 0n,
    ataCreates: [], systemCreates: [], wrapLamports: 0n, otherTransferLamports: 0n,
    closedToPayer: [], opaquePrograms: [],
  }
  const wsolAccount = wrappedSolAccountOf(payer)

  for (const ix of instructions) {
    const d = ix.data
    switch (ix.programId) {
      case COMPUTE_BUDGET:
        if (d[0] === 2) cuLimit = BigInt(u32(d, 1))
        else if (d[0] === 3) cuPriceMicro = u64(d, 1)
        continue
      case ATA_PROGRAM: {
        // [] or [0] = Create, [1] = CreateIdempotent; accounts: payer, ata, owner, mint, system, token program.
        if ((d.length === 0 || d[0] === 0 || d[0] === 1) && ix.accounts[0] === payer) {
          out.ataCreates.push({ ata: ix.accounts[1], owner: ix.accounts[2], mint: ix.accounts[3], tokenProgram: ix.accounts[5] })
        }
        break
      }
      case SYSTEM_PROGRAM: {
        const kind = u32(d, 0)
        if (ix.accounts[0] !== payer) break
        if (kind === 0) out.systemCreates.push({ address: ix.accounts[1], lamports: u64(d, 4), space: u64(d, 12) })
        else if (kind === 3) {
          // CreateAccountWithSeed: base(32) | seed(u64 len + bytes) | lamports | space | owner
          const seedLen = Number(u64(d, 36))
          const at = 44 + seedLen
          out.systemCreates.push({ address: ix.accounts[1], lamports: u64(d, at), space: u64(d, at + 8) })
        } else if (kind === 2) {
          const lamports = u64(d, 4)
          if (ix.accounts[1] === wsolAccount) out.wrapLamports += lamports
          else out.otherTransferLamports += lamports
        }
        break
      }
      case TOKEN_PROGRAM:
      case TOKEN_2022_PROGRAM:
        // CloseAccount (9): account, destination, owner. Rent returns to `destination`.
        if (d[0] === 9 && ix.accounts[1] === payer) out.closedToPayer.push(ix.accounts[0])
        break
      default:
        if (!KNOWN_PROGRAMS.has(ix.programId) && ix.accounts.includes(payer) && !out.opaquePrograms.includes(ix.programId)) {
          out.opaquePrograms.push(ix.programId)
        }
    }
    nonBudget++
  }
  const limit = cuLimit ?? (() => {
    const def = DEFAULT_CU_PER_INSTRUCTION * nonBudget
    return def > MAX_CU ? MAX_CU : def
  })()
  // Priority fee = ceil(unit price in micro-lamports x unit limit / 1e6).
  out.priorityFeeLamports = (cuPriceMicro * limit + 999_999n) / 1_000_000n
  return out
}

/**
 * Bytes a new associated token account needs.
 *
 * Classic SPL token accounts are 165 bytes. A Token-2022 associated account is
 * 165 + 1 (account type) + the ImmutableOwner extension (4), plus any account
 * extension the MINT requires — measured on-chain 2026-09-23: a plain
 * Token-2022 mint's accounts are 170 bytes; PYUSD's (transfer fee + transfer
 * hook) are 187 = 170 + TransferFeeAmount (4+8) + TransferHookAccount (4+1).
 * Returns `complete: false` for a mint extension type this does not know.
 */
export function tokenAccountSize(tokenProgram: string, mintData: Uint8Array | null): { size: number; complete: boolean } {
  if (tokenProgram !== TOKEN_2022_PROGRAM) return { size: 165, complete: true }
  let size = 165 + 1 + 4          // base + account type + ImmutableOwner
  let complete = true
  if (!mintData) return { size, complete: false }
  // Mint TLV extensions start at 166 (82-byte mint padded to 165, then the type byte).
  const REQUIRED_ACCOUNT_EXT: Record<number, number> = {
    1: 4 + 8,     // TransferFeeConfig      -> TransferFeeAmount
    9: 4 + 0,     // NonTransferable        -> NonTransferableAccount
    14: 4 + 1,    // TransferHook           -> TransferHookAccount
    26: 4 + 0,    // Pausable               -> PausableAccount
  }
  const KNOWN_MINT_EXT = new Set([1, 3, 4, 6, 9, 10, 12, 14, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26])
  let o = 166
  while (o + 4 <= mintData.length) {
    const type = mintData[o] | (mintData[o + 1] << 8)
    const len = mintData[o + 2] | (mintData[o + 3] << 8)
    if (type === 0) break
    size += REQUIRED_ACCOUNT_EXT[type] ?? 0
    if (!KNOWN_MINT_EXT.has(type)) complete = false
    o += 4 + len
  }
  return { size, complete }
}

/** Resolve a serialized transaction's instructions, including lookup-table accounts. */
async function resolveInstructions(
  tx: VersionedTransaction, connection: Connection,
): Promise<ResolvedInstruction[]> {
  const msg = tx.message
  const tables: AddressLookupTableAccount[] = []
  for (const l of msg.addressTableLookups ?? []) {
    const t = (await connection.getAddressLookupTable(l.accountKey)).value
    if (!t) throw new Error(`lookup table ${l.accountKey.toBase58()} not found`)
    tables.push(t)
  }
  const keys = msg.getAccountKeys({ addressLookupTableAccounts: tables })
  return msg.compiledInstructions.map(ci => ({
    programId: keys.get(ci.programIdIndex)!.toBase58(),
    accounts: ci.accountKeyIndexes.map(i => keys.get(i)!.toBase58()),
    data: ci.data,
  }))
}

/**
 * The upfront SOL the quoted transaction needs, at CURRENT rent, skipping
 * accounts that already exist. Null when the transaction cannot be read at all.
 */
export async function estimateSolanaSwapCost(
  swapTransactionB64: string, payer: string, connection: Connection,
  opts: { paysOutSolToPayer: boolean } = { paysOutSolToPayer: false },
): Promise<SolanaUpfrontCost | null> {
  let tx: VersionedTransaction
  try { tx = VersionedTransaction.deserialize(Buffer.from(swapTransactionB64, 'base64')) } catch { return null }
  const instructions = await resolveInstructions(tx, connection)
  const s = analyzeSolanaInstructions(payer, tx.message.header.numRequiredSignatures, instructions)

  // Which accounts already exist (no rent), and the mints whose extensions size them.
  const creates = s.ataCreates
  const probe = [...new Set([...creates.map(c => c.ata), ...creates.map(c => c.mint), payer])]
  const infos = await connection.getMultipleAccountsInfo(probe.map(a => new PublicKey(a)))
  const info = new Map(probe.map((a, i) => [a, infos[i]]))

  let complete = s.opaquePrograms.length === 0
  const reasons: string[] = []
  if (!complete) {
    reasons.push(`the route hands your account to ${s.opaquePrograms.length} program(s) whose internal costs cannot be read before signing`)
  }

  const newAccounts: SolanaNewAccount[] = []
  const rentBySize = new Map<number, bigint>()
  const rentFor = async (size: number) => {
    if (!rentBySize.has(size)) rentBySize.set(size, BigInt(await connection.getMinimumBalanceForRentExemption(size)))
    return rentBySize.get(size)!
  }
  const seen = new Set<string>()
  for (const c of creates) {
    if (seen.has(c.ata) || info.get(c.ata)) continue   // exists already, or counted: no rent
    seen.add(c.ata)
    const mintInfo = info.get(c.mint)
    const sized = tokenAccountSize(c.tokenProgram, mintInfo ? new Uint8Array(mintInfo.data) : null)
    if (!sized.complete) { complete = false; reasons.push(`token account size for mint ${c.mint.slice(0, 6)}… is uncertain`) }
    newAccounts.push({
      address: c.ata, kind: 'token-account', mint: c.mint, tokenProgram: c.tokenProgram, size: sized.size,
      rentLamports: (await rentFor(sized.size)).toString(), refundedInTx: s.closedToPayer.includes(c.ata),
    })
  }
  for (const sc of s.systemCreates) {
    newAccounts.push({
      address: sc.address, kind: 'system-account', mint: null, tokenProgram: null, size: Number(sc.space),
      rentLamports: sc.lamports.toString(), refundedInTx: s.closedToPayer.includes(sc.address),
    })
  }

  const rent = newAccounts.reduce((a, n) => a + BigInt(n.rentLamports), 0n)
  const fees = s.baseFeeLamports + s.priorityFeeLamports
  const required = fees + rent + s.otherTransferLamports + s.wrapLamports
  const payerInfo = info.get(payer)

  // Measure by simulation when that measurement means something. A failed
  // simulation is NOT a measurement; its error is kept for the caller.
  let measured: bigint | null = null
  let simulationError: string | null = null
  if (!opts.paysOutSolToPayer && payerInfo) {
    try {
      const sim = await connection.simulateTransaction(tx, {
        sigVerify: false, replaceRecentBlockhash: true, accounts: { encoding: 'base64', addresses: [payer] },
      })
      const post = sim.value.accounts?.[0]?.lamports
      if (sim.value.err) simulationError = JSON.stringify(sim.value.err)
      else if (post != null) {
        const took = BigInt(payerInfo.lamports) - BigInt(post)
        if (took >= 0n) measured = took
      }
    } catch (e) {
      simulationError = e instanceof Error ? e.message : 'simulation unavailable'
    }
  }

  return {
    baseFeeLamports: s.baseFeeLamports.toString(),
    priorityFeeLamports: s.priorityFeeLamports.toString(),
    newAccounts,
    rentLamports: rent.toString(),
    otherTransferLamports: s.otherTransferLamports.toString(),
    saleLamports: s.wrapLamports.toString(),
    requiredLamports: required.toString(),
    costLamports: (required - s.wrapLamports).toString(),
    balanceLamports: payerInfo ? String(payerInfo.lamports) : '0',
    complete,
    incompleteReason: reasons.length ? reasons.join('; ') : null,
    measuredLamports: measured != null ? measured.toString() : null,
    simulationError,
  }
}

