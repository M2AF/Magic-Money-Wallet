/**
 * solana-tx-inspect.ts — read-only Solana transaction decoder (shared)
 *
 * The counterpart to cardano-tx-inspect.ts, but built on a different principle
 * because the two chains hide different things.
 *
 * Cardano's eUTXO model states inputs and outputs explicitly, so a static decode
 * tells you exactly what moves. Solana transactions just invoke programs, and a
 * program can do anything — a drainer looks like an ordinary instruction to any
 * decoder that only reads the wire format. So this module does BOTH:
 *
 *   1. Static decode — what the transaction SAYS it does. Recognises System,
 *      SPL Token / Token-2022, Associated Token Account, Memo and Compute
 *      Budget, and flags the instructions that hand away control (SetAuthority,
 *      Approve, CloseAccount, Assign) plus any program it doesn't know.
 *   2. Simulation — what the transaction ACTUALLY does. Runs it against RPC
 *      with signature verification off and diffs our own accounts before/after,
 *      producing real SOL and SPL balance deltas. This is what catches a
 *      drainer hiding behind an opaque program, and is the approach Backpack
 *      takes for the same reason.
 *
 * Never throws: every failure degrades to a summary that says what it could not
 * establish. A decoder crash must never read as "signing is broken".
 */

import { base58 } from '@scure/base'
import type { WalletConfig } from './secure-store'
import { heliusRpcUrl } from './api-proxy'
import { activeSolanaRpcs, isTestnet } from './chain-config'

// ── Known programs ────────────────────────────────────────────────────────────

export const SYSTEM_PROGRAM       = '11111111111111111111111111111111'
export const TOKEN_PROGRAM        = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const TOKEN_2022_PROGRAM   = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
export const ATA_PROGRAM          = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
export const COMPUTE_BUDGET       = 'ComputeBudget111111111111111111111111111111'
export const MEMO_PROGRAM         = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'
export const MEMO_PROGRAM_LEGACY  = 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo'

const PROGRAM_NAMES: Record<string, string> = {
  [SYSTEM_PROGRAM]:      'System',
  [TOKEN_PROGRAM]:       'SPL Token',
  [TOKEN_2022_PROGRAM]:  'Token-2022',
  [ATA_PROGRAM]:         'Associated Token Account',
  [COMPUTE_BUDGET]:      'Compute Budget',
  [MEMO_PROGRAM]:        'Memo',
  [MEMO_PROGRAM_LEGACY]: 'Memo',
}

/** SPL token account layout: mint(32) ‖ owner(32) ‖ amount(u64 LE) ‖ … */
const TOKEN_ACCOUNT_AMOUNT_OFFSET = 64
const TOKEN_ACCOUNT_MINT_OFFSET = 0

// ── Instruction decoding ──────────────────────────────────────────────────────

export interface DecodedInstruction {
  programId: string
  /** Friendly program name, or a truncated id when unrecognised. */
  program: string
  /** e.g. 'Transfer', 'SetAuthority'. Empty when the program is unknown. */
  kind: string
  detail?: string
  /** False when we don't recognise the program at all. */
  known: boolean
  /** True for instructions that hand away control of an account or funds. */
  dangerous: boolean
}

function readU32LE(d: Uint8Array, off: number): number {
  return (d[off] | (d[off + 1] << 8) | (d[off + 2] << 16) | (d[off + 3] << 24)) >>> 0
}

function readU64LE(d: Uint8Array, off: number): bigint {
  let v = 0n
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[off + i] ?? 0)
  return v
}

/** SPL Token instruction discriminators that give away control. */
const TOKEN_INSTRUCTIONS: Record<number, { kind: string; dangerous: boolean }> = {
  3:  { kind: 'Transfer',         dangerous: false },
  4:  { kind: 'Approve',          dangerous: true  },   // delegate can spend later
  5:  { kind: 'Revoke',           dangerous: false },
  6:  { kind: 'SetAuthority',     dangerous: true  },   // hands over the account
  7:  { kind: 'MintTo',           dangerous: false },
  8:  { kind: 'Burn',             dangerous: true  },
  9:  { kind: 'CloseAccount',     dangerous: true  },
  12: { kind: 'TransferChecked',  dangerous: false },
  13: { kind: 'ApproveChecked',   dangerous: true  },
  15: { kind: 'BurnChecked',      dangerous: true  },
}

const SYSTEM_INSTRUCTIONS: Record<number, { kind: string; dangerous: boolean }> = {
  0:  { kind: 'CreateAccount',         dangerous: false },
  1:  { kind: 'Assign',                dangerous: true  },   // reassigns account owner
  2:  { kind: 'Transfer',              dangerous: false },
  3:  { kind: 'CreateAccountWithSeed', dangerous: false },
  8:  { kind: 'Allocate',              dangerous: false },
  10: { kind: 'TransferWithSeed',      dangerous: false },
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id
}

function decodeInstruction(programId: string, data: Uint8Array): DecodedInstruction {
  const program = PROGRAM_NAMES[programId]

  if (programId === SYSTEM_PROGRAM) {
    const code = data.length >= 4 ? readU32LE(data, 0) : -1
    const info = SYSTEM_INSTRUCTIONS[code]
    const detail = (code === 2 || code === 10) && data.length >= 12
      ? `${formatSol(readU64LE(data, 4))} SOL`
      : undefined
    return {
      programId, program: program!, known: !!info,
      kind: info?.kind ?? `Unknown (${code})`,
      detail, dangerous: info?.dangerous ?? true,
    }
  }

  if (programId === TOKEN_PROGRAM || programId === TOKEN_2022_PROGRAM) {
    const code = data.length >= 1 ? data[0] : -1
    const info = TOKEN_INSTRUCTIONS[code]
    return {
      programId, program: program!, known: !!info,
      kind: info?.kind ?? `Unknown (${code})`,
      dangerous: info?.dangerous ?? true,
    }
  }

  if (programId === MEMO_PROGRAM || programId === MEMO_PROGRAM_LEGACY) {
    let text = ''
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(data) } catch { /* binary memo */ }
    return {
      programId, program: 'Memo', kind: 'Memo', known: true, dangerous: false,
      detail: isPrintable(text) ? text.slice(0, 120) : undefined,
    }
  }

  if (program) {
    // ATA / Compute Budget — structural, nothing to warn about.
    return { programId, program, kind: '', known: true, dangerous: false }
  }

  // An unrecognised program can do anything. Say so rather than staying silent.
  return { programId, program: shortId(programId), kind: '', known: false, dangerous: false }
}

function isPrintable(text: string): boolean {
  if (text.length === 0) return false
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    if (c === 0x0a || c === 0x09) continue
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return false
  }
  return true
}

// ── Balance deltas via simulation ─────────────────────────────────────────────

export interface TokenDelta {
  mint: string
  /** Raw base-unit change; negative means leaving the wallet. */
  amount: bigint
  decimals: number | null
}

interface RpcAccount { lamports: number; data: [string, string] | string | null; owner: string }

async function rpc<T>(
  url: string, method: string, params: unknown[], timeoutMs: number
): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    const json = await res.json() as { result?: T; error?: { message?: string } }
    if (json.error) return null
    return json.result ?? null
  } catch { return null }
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function tokenAmountOf(dataB64: string | null): { mint: string; amount: bigint } | null {
  if (!dataB64) return null
  try {
    const bytes = decodeBase64(dataB64)
    if (bytes.length < TOKEN_ACCOUNT_AMOUNT_OFFSET + 8) return null
    return {
      mint: base58.encode(bytes.slice(TOKEN_ACCOUNT_MINT_OFFSET, TOKEN_ACCOUNT_MINT_OFFSET + 32)),
      amount: readU64LE(bytes, TOKEN_ACCOUNT_AMOUNT_OFFSET),
    }
  } catch { return null }
}

function accountDataB64(acc: RpcAccount | null): string | null {
  if (!acc?.data) return null
  return Array.isArray(acc.data) ? acc.data[0] : (typeof acc.data === 'string' ? acc.data : null)
}

// ── Summary ───────────────────────────────────────────────────────────────────

export interface SolanaTxSummary {
  /** Fee payer, base58. */
  feePayer: string
  /** Are we the fee payer? A dApp making US pay for its transaction is notable. */
  weAreFeePayer: boolean
  /** Does the transaction actually require our signature? */
  weAreSigner: boolean
  /** Net lamport change for our wallet (simulation). Negative = leaving. */
  netSol: bigint | null
  tokenDeltas: TokenDelta[]
  instructions: DecodedInstruction[]
  /** Distinct unrecognised program ids. */
  unknownPrograms: string[]
  warnings: string[]
  /**
   * 'ok'      — simulated, deltas are real.
   * 'failed'  — the transaction reverts in simulation; signing it likely wastes a fee.
   * 'skipped' — no RPC / timed out; static decode only, deltas unknown.
   */
  simulation: 'ok' | 'failed' | 'skipped'
  simulationError?: string
  /** Set when the transaction could not be parsed at all. */
  error?: string
  rawLength: number
}

export interface InspectOptions {
  /** Our Solana address, base58. */
  ownAddress: string
  config: WalletConfig
  timeoutMs?: number
  /** Skip the RPC round-trip (unit tests, offline). */
  skipSimulation?: boolean
}

function emptySummary(rawLength: number): SolanaTxSummary {
  return {
    feePayer: '', weAreFeePayer: false, weAreSigner: false, netSol: null,
    tokenDeltas: [], instructions: [], unknownPrograms: [], warnings: [],
    simulation: 'skipped', rawLength,
  }
}

/**
 * Decode and simulate a Solana transaction. Never throws.
 *
 * @param txBytes the serialized (unsigned or partially signed) transaction
 */
export async function summarizeSolanaTx(
  txBytes: Uint8Array,
  opts: InspectOptions
): Promise<SolanaTxSummary> {
  const summary = emptySummary(txBytes.length)

  // ── Static decode ──────────────────────────────────────────────────────────
  let accountKeys: string[] = []
  let numRequiredSignatures = 0
  try {
    const { VersionedTransaction } = await import('@solana/web3.js')
    const tx = VersionedTransaction.deserialize(txBytes)
    const msg = tx.message

    accountKeys = msg.staticAccountKeys.map(k => k.toBase58())
    numRequiredSignatures = msg.header.numRequiredSignatures
    summary.feePayer = accountKeys[0] ?? ''
    summary.weAreFeePayer = summary.feePayer === opts.ownAddress
    // Only the first numRequiredSignatures static keys are signers.
    summary.weAreSigner = accountKeys.slice(0, numRequiredSignatures).includes(opts.ownAddress)

    for (const ix of msg.compiledInstructions) {
      const programId = accountKeys[ix.programIdIndex]
      if (!programId) continue
      summary.instructions.push(decodeInstruction(programId, Uint8Array.from(ix.data)))
    }

    summary.unknownPrograms = [...new Set(
      summary.instructions.filter(i => !i.known).map(i => i.programId)
    )]
  } catch (err) {
    return { ...summary, error: err instanceof Error ? err.message : String(err) }
  }

  // ── Simulation ─────────────────────────────────────────────────────────────
  // Static decode says what the transaction claims; this establishes what it
  // actually does to our balances, which is the only reliable signal when an
  // instruction belongs to a program we cannot read.
  if (!opts.skipSimulation) {
    await simulateInto(summary, txBytes, opts)
  }

  summary.warnings = buildWarnings(summary)
  return summary
}

async function simulateInto(
  summary: SolanaTxSummary, txBytes: Uint8Array, opts: InspectOptions
): Promise<void> {
  const timeout = opts.timeoutMs ?? 6_000
  // heliusRpcUrl is mainnet-only. In Testnet Mode the wallet operates on devnet,
  // and simulating against mainnet would report nonsense (unknown accounts, or
  // a confident "no balance change") for a transaction that is perfectly valid.
  const url = isTestnet(opts.config)
    ? (activeSolanaRpcs(opts.config)[0] ?? heliusRpcUrl(opts.config))
    : heliusRpcUrl(opts.config)

  // Which of our accounts to watch: our wallet, plus every SPL token account we own.
  const owned = await rpc<{ value: Array<{ pubkey: string; account: RpcAccount }> }>(
    url, 'getTokenAccountsByOwner',
    [opts.ownAddress, { programId: TOKEN_PROGRAM }, { encoding: 'base64' }],
    timeout,
  )
  const tokenAccounts = (owned?.value ?? []).map(v => v.pubkey)
  const watched = [opts.ownAddress, ...tokenAccounts]

  const pre = new Map<string, RpcAccount | null>()
  for (const v of owned?.value ?? []) pre.set(v.pubkey, v.account)

  // Our own lamports before the transaction.
  const preSelf = await rpc<{ value: RpcAccount | null }>(
    url, 'getAccountInfo', [opts.ownAddress, { encoding: 'base64' }], timeout,
  )
  pre.set(opts.ownAddress, preSelf?.value ?? null)

  const sim = await rpc<{
    value: {
      err: unknown
      logs?: string[] | null
      accounts?: Array<RpcAccount | null> | null
    }
  }>(
    url, 'simulateTransaction',
    [
      btoaBytes(txBytes),
      {
        encoding: 'base64',
        sigVerify: false,            // the transaction is not signed yet
        replaceRecentBlockhash: true, // the dApp's blockhash may already be stale
        commitment: 'processed',
        accounts: { encoding: 'base64', addresses: watched },
      },
    ],
    timeout,
  )

  if (!sim?.value) { summary.simulation = 'skipped'; return }

  if (sim.value.err) {
    summary.simulation = 'failed'
    summary.simulationError = typeof sim.value.err === 'string'
      ? sim.value.err
      : JSON.stringify(sim.value.err).slice(0, 160)
    return
  }

  summary.simulation = 'ok'
  const post = sim.value.accounts ?? []

  // SOL delta (index 0 == our wallet, matching `watched`).
  const preLamports = BigInt(pre.get(opts.ownAddress)?.lamports ?? 0)
  const postSelf = post[0]
  if (postSelf) summary.netSol = BigInt(postSelf.lamports) - preLamports

  // SPL token deltas.
  const deltas = new Map<string, bigint>()
  for (let i = 1; i < watched.length; i++) {
    const before = tokenAmountOf(accountDataB64(pre.get(watched[i]) ?? null))
    const after = tokenAmountOf(accountDataB64(post[i] ?? null))
    const mint = after?.mint ?? before?.mint
    if (!mint) continue
    const delta = (after?.amount ?? 0n) - (before?.amount ?? 0n)
    if (delta !== 0n) deltas.set(mint, (deltas.get(mint) ?? 0n) + delta)
  }
  summary.tokenDeltas = [...deltas].map(([mint, amount]) => ({ mint, amount, decimals: null }))
}

function btoaBytes(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function buildWarnings(s: SolanaTxSummary): string[] {
  const w: string[] = []

  for (const ix of s.instructions) {
    if (!ix.dangerous) continue
    if (ix.kind === 'SetAuthority') w.push('Changes who controls one of your token accounts')
    else if (ix.kind.startsWith('Approve')) w.push('Grants another account permission to spend your tokens')
    else if (ix.kind === 'CloseAccount') w.push('Closes one of your token accounts')
    else if (ix.kind === 'Assign') w.push('Reassigns ownership of an account')
    else if (ix.kind.startsWith('Burn')) w.push('Permanently destroys tokens')
    else if (ix.kind.startsWith('Unknown')) w.push(`Contains an unrecognised ${ix.program} instruction`)
  }

  if (s.unknownPrograms.length > 0) {
    w.push(s.unknownPrograms.length === 1
      ? `Calls a program this wallet does not recognise (${shortId(s.unknownPrograms[0])})`
      : `Calls ${s.unknownPrograms.length} programs this wallet does not recognise`)
  }

  if (s.simulation === 'failed') {
    w.push('This transaction fails when simulated — signing it will likely just cost you a fee')
  } else if (s.simulation === 'skipped') {
    w.push('Could not simulate this transaction — the amounts above may be incomplete')
  }

  if (s.weAreFeePayer && !s.weAreSigner) {
    w.push('You are paying the fee for a transaction you do not otherwise sign')
  }

  // De-duplicate: the same instruction kind can legitimately appear many times.
  return [...new Set(w)]
}

// ── Presentation ──────────────────────────────────────────────────────────────

/** Lamports → SOL, trailing zeros trimmed. */
export function formatSol(lamports: bigint): string {
  const neg = lamports < 0n
  const abs = neg ? -lamports : lamports
  const whole = abs / 1_000_000_000n
  const frac = (abs % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '')
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`
}

function formatRaw(amount: bigint, decimals: number | null): string {
  if (decimals === null) return (amount < 0n ? '-' : '+') + (amount < 0n ? -amount : amount).toString()
  const neg = amount < 0n
  const abs = neg ? -amount : amount
  const d = BigInt(10) ** BigInt(decimals)
  const frac = (abs % d).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${neg ? '-' : '+'}${abs / d}${frac ? `.${frac}` : ''}`
}

export interface SolanaFormatOptions {
  /** Append the ⚠ lines. Off when the caller renders its own warning band. */
  includeWarnings?: boolean
}

/**
 * One plain-text block describing the transaction — the single source of truth
 * shared by the Electron approval window and the extension/mobile overlay,
 * exactly as with the Cardano formatter.
 */
export function formatSolanaTxSummary(
  s: SolanaTxSummary, opts: SolanaFormatOptions = {}
): string {
  const { includeWarnings = true } = opts

  if (s.error) {
    return [
      'This transaction could not be decoded.',
      'Only continue if you fully trust this site.',
      `\nReason: ${s.error}`,
      `\nSize: ${s.rawLength} bytes`,
    ].join('\n')
  }

  const lines: string[] = []
  const pad = (l: string): string => l.padEnd(16, ' ')

  if (s.netSol !== null && s.netSol !== 0n) {
    lines.push(`${pad(s.netSol < 0n ? 'You send' : 'You receive')}${s.netSol > 0n ? '+' : ''}${formatSol(s.netSol)} SOL`)
  }
  for (const t of s.tokenDeltas) {
    lines.push(`${pad('')}${formatRaw(t.amount, t.decimals)} ${shortId(t.mint)}`)
  }

  if (lines.length === 0) {
    lines.push(`${pad('Balance change')}${
      s.simulation === 'ok' ? 'None detected' : 'Unknown (not simulated)'
    }`)
  }

  lines.push(`${pad('Fee payer')}${s.weAreFeePayer ? 'You' : shortId(s.feePayer)}`)

  // What the transaction says it does, so an unreadable program is still visible.
  const shown = s.instructions.filter(i => i.programId !== COMPUTE_BUDGET)
  if (shown.length > 0) {
    lines.push('')
    lines.push('Instructions:')
    for (const ix of shown.slice(0, 8)) {
      const label = ix.kind ? `${ix.program} · ${ix.kind}` : ix.program
      lines.push(`  ${label}${ix.detail ? ` — ${ix.detail}` : ''}${ix.known ? '' : '  (unknown program)'}`)
    }
    if (shown.length > 8) lines.push(`  …and ${shown.length - 8} more`)
  }

  if (includeWarnings && s.warnings.length > 0) {
    lines.push('')
    for (const warning of s.warnings) lines.push(`⚠ ${warning}`)
  }

  return lines.join('\n')
}

/**
 * Solana message signing. Detects Sign In With Solana (SIWS) payloads and shows
 * their fields rather than a wall of text, and refuses to render anything with
 * control characters as a message — a payload containing CR or ANSI escapes
 * could otherwise forge extra lines in the prompt.
 */
export function formatSolanaMessage(messageBytes: Uint8Array): string {
  let text: string | null = null
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(messageBytes)
    if (isPrintable(decoded)) text = decoded
  } catch { /* not UTF-8 */ }

  if (!text) {
    return [
      'This message is not readable text — you cannot verify what it says.',
      'Only continue if you fully trust this site.',
      `\nSize: ${messageBytes.length} bytes`,
    ].join('\n')
  }
  return `Message:\n${text}`
}
