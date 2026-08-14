/**
 * spl-transfer.ts — SPL token / NFT transfer instructions, hand-rolled.
 *
 * Deliberately built on the @solana/web3.js primitives the wallet already ships
 * rather than pulling in @solana/spl-token: the layouts used here are two fixed
 * byte encodings that have never changed, and the dependency would ship to all
 * four targets including both mobile WebViews and the extension bundle.
 *
 * Covers classic SPL Token and Token-2022. It does NOT cover compressed NFTs —
 * those live in a merkle tree and need a Bubblegum instruction plus a proof the
 * collectibles fetcher never requests, so they are gated in the UI instead.
 */

import {
  Connection,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js'

export const TOKEN_PROGRAM_ID      = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

/** Instruction discriminators (single byte, first field of the data buffer). */
const IX_TRANSFER_CHECKED = 12
const IX_ATA_CREATE_IDEMPOTENT = 1

export interface SplMintInfo {
  decimals: number
  programId: PublicKey
}

/**
 * Read a mint's decimals and owning token program.
 *
 * Both matter: decimals because transferChecked asserts them on-chain, and the
 * program id because Token-2022 mints are otherwise identical but live under a
 * different program — deriving the ATA with the wrong one produces a valid-
 * looking address that simply doesn't exist.
 */
export async function getSplMintInfo(connection: Connection, mint: PublicKey): Promise<SplMintInfo> {
  const info = await connection.getParsedAccountInfo(mint)
  const value = info.value
  if (!value) throw new Error('That token mint does not exist on this network')

  const owner = value.owner
  if (!owner.equals(TOKEN_PROGRAM_ID) && !owner.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error('That address is not an SPL token mint')
  }

  const data = value.data
  if (!('parsed' in data) || data.parsed?.type !== 'mint') {
    throw new Error('Could not read the token mint — try again in a moment')
  }
  const decimals = (data.parsed.info as { decimals?: number }).decimals
  if (typeof decimals !== 'number') {
    throw new Error('Could not read the token’s decimals')
  }

  return { decimals, programId: owner }
}

/** Derive the associated token account for (owner, mint) under `programId`. */
export function associatedTokenAddress(
  mint: PublicKey, owner: PublicKey, programId: PublicKey
): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), programId.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
  return address
}

/**
 * Create the recipient's associated token account, idempotently.
 *
 * The idempotent variant is what makes this safe to include unconditionally:
 * if the account already exists the instruction is a no-op instead of failing
 * the whole transaction, which removes a check-then-act race with any other
 * transfer landing at the same time.
 */
export function createAtaIdempotentIx(opts: {
  payer: PublicKey
  ata: PublicKey
  owner: PublicKey
  mint: PublicKey
  programId: PublicKey
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: opts.payer,             isSigner: true,  isWritable: true },
      { pubkey: opts.ata,               isSigner: false, isWritable: true },
      { pubkey: opts.owner,             isSigner: false, isWritable: false },
      { pubkey: opts.mint,              isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: opts.programId,         isSigner: false, isWritable: false },
    ],
    data: Buffer.from([IX_ATA_CREATE_IDEMPOTENT]),
  })
}

/**
 * TransferChecked: 1 byte tag, u64 amount (LE), 1 byte decimals.
 *
 * Preferred over the plain Transfer instruction because the program verifies the
 * decimals we believe the mint has. If our reading were ever wrong the transfer
 * reverts rather than moving an amount off by a factor of ten.
 */
export function transferCheckedIx(opts: {
  source: PublicKey
  mint: PublicKey
  destination: PublicKey
  owner: PublicKey
  amount: bigint
  decimals: number
  programId: PublicKey
}): TransactionInstruction {
  const data = Buffer.alloc(10)
  data.writeUInt8(IX_TRANSFER_CHECKED, 0)
  data.writeBigUInt64LE(opts.amount, 1)
  data.writeUInt8(opts.decimals, 9)

  return new TransactionInstruction({
    programId: opts.programId,
    keys: [
      { pubkey: opts.source,      isSigner: false, isWritable: true },
      { pubkey: opts.mint,        isSigner: false, isWritable: false },
      { pubkey: opts.destination, isSigner: false, isWritable: true },
      { pubkey: opts.owner,       isSigner: true,  isWritable: false },
    ],
    data,
  })
}

/**
 * Build the full instruction list for an SPL transfer: create the recipient's
 * ATA if needed, then move the tokens.
 *
 * `rawAmount` is in base units — the caller converts, because only it knows
 * whether the figure came from a user-typed decimal (token send) or is a fixed
 * 1 (NFT send).
 */
export async function buildSplTransferIxs(opts: {
  connection: Connection
  mint: PublicKey
  from: PublicKey
  to: PublicKey
  rawAmount: bigint
  /** Skips the mint read when the caller already knows both values. */
  mintInfo?: SplMintInfo
}): Promise<TransactionInstruction[]> {
  const { connection, mint, from, to, rawAmount } = opts
  if (rawAmount <= 0n) throw new Error('Amount must be greater than 0')

  const { decimals, programId } = opts.mintInfo ?? await getSplMintInfo(connection, mint)

  const sourceAta = associatedTokenAddress(mint, from, programId)
  const destAta   = associatedTokenAddress(mint, to, programId)

  // Confirm the sender actually holds enough before building anything, so an
  // insufficient balance reads as a sentence rather than a simulation failure.
  const sourceBalance = await connection.getTokenAccountBalance(sourceAta).catch(() => null)
  if (!sourceBalance) {
    throw new Error('This wallet holds no account for that token')
  }
  if (BigInt(sourceBalance.value.amount) < rawAmount) {
    throw new Error('Amount exceeds your token balance')
  }

  const ixs: TransactionInstruction[] = []

  // Only add the create instruction when the destination is genuinely missing —
  // it costs the sender rent (~0.002 SOL), so we don't pay it needlessly.
  const destInfo = await connection.getAccountInfo(destAta).catch(() => null)
  if (!destInfo) {
    ixs.push(createAtaIdempotentIx({ payer: from, ata: destAta, owner: to, mint, programId }))
  }

  ixs.push(transferCheckedIx({
    source: sourceAta, mint, destination: destAta, owner: from,
    amount: rawAmount, decimals, programId,
  }))

  return ixs
}
