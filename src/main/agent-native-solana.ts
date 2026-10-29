/** Wallet-built messages only. No server-supplied transactions or arbitrary programs. */
import { Connection, ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { base58 } from '@scure/base'
import { ed25519 } from '@noble/curves/ed25519'
import { sha256 } from '@noble/hashes/sha256'
import type { NativeTransaction, NativePlan } from '../shared/agent-native'
import { associatedTokenAddress, TOKEN_PROGRAM_ID, transferCheckedIx } from './spl-transfer'
import { getSolanaKeypair } from './wallet-core'
import { nativeAddress, validateNativeX402 } from './x402-native-validation'

const memoProgram = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')
function message(tx: NativeTransaction, blockhash: string) {
  const from = new PublicKey(tx.from), to = new PublicKey(tx.recipient)
  let payerKey = from, instructions: TransactionInstruction[]
  if (tx.x402) {
    const req = validateNativeX402({ requestId: tx.requestId, resourceUrl: tx.x402.resourceUrl, paymentRequired: tx.x402.required }, tx.network.includes('EtWTR') ? 'testnet' : 'mainnet').required.accepts[0]
    if (req.amount !== tx.amountRaw || req.payTo !== tx.recipient || req.asset !== tx.asset) throw new Error('Changed Solana payment binding.')
    payerKey = new PublicKey(req.extra.feePayer!)
    if (payerKey.equals(from) || payerKey.equals(new PublicKey(tx.asset))) throw new Error('x402 sponsor must be a separate fee payer.')
    const mint = new PublicKey(tx.asset)
    instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 40000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
      transferCheckedIx({ source: associatedTokenAddress(mint, from, TOKEN_PROGRAM_ID), mint, destination: associatedTokenAddress(mint, to, TOKEN_PROGRAM_ID), owner: from,
        amount: BigInt(tx.amountRaw), decimals: 6, programId: TOKEN_PROGRAM_ID }),
      new TransactionInstruction({ programId: memoProgram, keys: [], data: Buffer.from(req.extra.memo ?? tx.x402.nonce, 'utf8') })]
  } else instructions = [SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: BigInt(tx.amountRaw) }),
    // Two genuine sends in one blockhash window must not silently share one
    // signature/hash. Use a wallet-generated identity, never agent text.
    new TransactionInstruction({ programId: memoProgram, keys: [], data: Buffer.from(tx.id, 'utf8') })]
  return new TransactionMessage({ payerKey, recentBlockhash: blockhash, instructions }).compileToV0Message()
}
export function solanaNativeAdapter(connection: Connection, mnemonic: () => string, now = Date.now, assertAuthority: () => void = () => {}) {
  async function identity(tx: NativeTransaction) {
    const genesis = await connection.getGenesisHash()
    if (tx.network !== `solana:${genesis.slice(0, 32)}`) throw new Error('Solana RPC genesis mismatch.')
  }
  async function balances(tx: NativeTransaction) {
    nativeAddress(tx.from, tx.network); nativeAddress(tx.recipient, tx.network)
    const sender = await connection.getAccountInfo(new PublicKey(tx.from), 'confirmed')
    if (sender && (!Number.isSafeInteger(sender.lamports) || sender.lamports < 0)) throw new Error('Exact Solana balance unavailable.')
    if ((!sender && !tx.x402) || (sender && (sender.executable || !sender.owner.equals(SystemProgram.programId) || sender.data.length))) throw new Error('Solana sender must be a funded system account.')
    if (!tx.x402) {
      const dest = await connection.getAccountInfo(new PublicKey(tx.recipient), 'confirmed')
      if (dest && (dest.executable || !dest.owner.equals(SystemProgram.programId) || dest.data.length)) throw new Error('Native recipient must be a system account.')
      if (!dest && BigInt(tx.amountRaw) < BigInt(await connection.getMinimumBalanceForRentExemption(0))) throw new Error('Recipient needs rent-exempt minimum funding.')
    } else {
      const mint = new PublicKey(tx.asset), from = new PublicKey(tx.from), to = new PublicKey(tx.recipient)
      const [mintInfo, source, destination] = await Promise.all([connection.getAccountInfo(mint, 'confirmed'),
        connection.getAccountInfo(associatedTokenAddress(mint, from, TOKEN_PROGRAM_ID), 'confirmed'), connection.getAccountInfo(associatedTokenAddress(mint, to, TOKEN_PROGRAM_ID), 'confirmed')])
      if (!mintInfo || !mintInfo.owner.equals(TOKEN_PROGRAM_ID) || mintInfo.data.length !== 82 || mintInfo.data[44] !== 6 || mintInfo.data[45] !== 1) throw new Error('Invalid pinned USDC mint.')
      for (const [account, owner] of [[source, from], [destination, to]] as const) {
        if (!account || account.executable || !account.owner.equals(TOKEN_PROGRAM_ID) || account.data.length !== 165 || account.data[108] !== 1
          || !account.data.subarray(0, 32).equals(mint.toBuffer()) || !account.data.subarray(32, 64).equals(owner.toBuffer())) throw new Error('USDC ATA unavailable or invalid.')
      }
      if (source!.data.readBigUInt64LE(64) < BigInt(tx.amountRaw)) throw new Error('Insufficient isolated USDC balance.')
    }
    return sender
  }
  async function check(tx: NativeTransaction) {
    if (!tx.plan || now() >= tx.plan.expiresAt) throw new Error('Solana plan expired.')
    await identity(tx)
    const prepared = VersionedTransaction.deserialize(Buffer.from(tx.plan.unsigned, 'base64'))
    if (prepared.signatures.some(sig => sig.some(b => b !== 0)) || prepared.message.version !== 0 || prepared.message.addressTableLookups.length) throw new Error('Unsigned v0 message required.')
    if (!Buffer.from(message(tx, prepared.message.recentBlockhash).serialize()).equals(Buffer.from(prepared.message.serialize()))) throw new Error('Solana message does not match the stored intent.')
    if (!Number.isSafeInteger(tx.plan.lastValidBlockHeight) || await connection.getBlockHeight('confirmed') > tx.plan.lastValidBlockHeight!
      || !(await connection.isBlockhashValid(prepared.message.recentBlockhash, { commitment: 'confirmed' })).value) throw new Error('Solana blockhash expired.')
    const [sender, fee] = await Promise.all([balances(tx), connection.getFeeForMessage(prepared.message, 'confirmed')])
    if (fee.value === null || !Number.isSafeInteger(fee.value) || fee.value < 0) throw new Error('Solana fee unavailable.')
    const cost = tx.x402 ? 0n : BigInt(tx.amountRaw) + BigInt(fee.value)
    if (tx.plan.feeRaw !== (tx.x402 ? '0' : String(fee.value)) || tx.plan.totalRaw !== cost.toString() || BigInt(sender?.lamports ?? 0) < cost) throw new Error('Solana cost or funds changed.')
    const sim = await connection.simulateTransaction(prepared, { sigVerify: false, commitment: 'confirmed', replaceRecentBlockhash: false })
    if (sim.value.err) throw new Error('Unsigned Solana simulation failed.')
  }
  return {
    async build(tx: NativeTransaction): Promise<NativePlan> {
      await identity(tx)
      const block = await connection.getLatestBlockhash('confirmed'), msg = message(tx, block.blockhash)
      const fee = await connection.getFeeForMessage(msg, 'confirmed')
      if (fee.value === null || !Number.isSafeInteger(fee.value)) throw new Error('Solana fee unavailable.')
      const feeRaw = tx.x402 ? '0' : String(fee.value), totalRaw = tx.x402 ? '0' : (BigInt(tx.amountRaw) + BigInt(fee.value)).toString()
      const plan = { reviewId: '', expiresAt: Math.min(tx.expiresAt, now() + 60000), unsigned: Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64'),
        feeRaw, totalRaw, locks: [`sol-message:${Buffer.from(sha256(msg.serialize())).toString('hex')}`], lastValidBlockHeight: block.lastValidBlockHeight }
      await check({ ...tx, plan }); return plan
    }, check,
    async sign(tx: NativeTransaction) {
      await check(tx)
      assertAuthority()
      const key = await getSolanaKeypair(mnemonic(), tx.accountIndex)
      assertAuthority()
      if (key.publicKey.toBase58() !== tx.from) throw new Error('Isolated Solana key mismatch.')
      const signed = VersionedTransaction.deserialize(Buffer.from(tx.plan!.unsigned, 'base64')); signed.sign([key])
      const index = signed.message.staticAccountKeys.findIndex(k => k.equals(key.publicKey))
      if (index < 0 || !ed25519.verify(signed.signatures[index], signed.message.serialize(), key.publicKey.toBytes())) throw new Error('Solana signature verification failed.')
      assertAuthority()
      return { raw: Buffer.from(signed.serialize()).toString('base64'), hash: tx.x402 ? null : base58.encode(signed.signatures[0]) }
    },
    broadcast: (_tx: NativeTransaction, raw: string) => connection.sendRawTransaction(Buffer.from(raw, 'base64'), { skipPreflight: false, maxRetries: 0 }),
    async receipt(tx: NativeTransaction) {
      if (!tx.txHash || !tx.plan) return null
      await identity(tx)
      const [found, status] = await Promise.all([connection.getTransaction(tx.txHash, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }), connection.getSignatureStatuses([tx.txHash], { searchTransactionHistory: true })])
      if (!found || !status.value[0]) return null
      const original = VersionedTransaction.deserialize(Buffer.from(tx.plan.unsigned, 'base64'))
      if (!Buffer.from(found.transaction.message.serialize()).equals(Buffer.from(original.message.serialize())) || found.transaction.signatures[0] !== tx.txHash
        || !found.meta || BigInt(found.meta.fee) > BigInt(tx.plan.feeRaw)) throw new Error('Solana receipt differs from stored intent.')
      const block = await connection.getBlock(found.slot, { commitment: 'confirmed', transactionDetails: 'full', rewards: false, maxSupportedTransactionVersion: 0 })
      if (!block?.transactions.some(t => t.transaction.signatures[0] === tx.txHash)) throw new Error('Solana transaction is not in canonical block.')
      return { confirmations: status.value[0]!.confirmations ?? 1, finalized: status.value[0]!.confirmationStatus === 'finalized', reverted: found.meta.err !== null }
    },
  }
}
