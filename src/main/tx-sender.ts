/**
 * tx-sender.ts — MagicMoney Wallet Phase 2
 *
 * Transaction building, signing, and broadcasting for EVM, Solana, Cardano.
 * All private key material is derived here and never returned to the caller.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Chain
} from 'viem'
import { mainnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js'
import { mnemonicToEntropy } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { getEvmPrivateKey, getSolanaKeypair } from './wallet-core'
import {
  getCardanoSpendingKey,
  buildCardanoTx,
  decodeCardanoAddress,
  type CardanoUtxo
} from './cardano-pure'
import type { WalletConfig } from './secure-store'

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface SendResult {
  txHash: string
  explorerUrl: string
}

export interface FeeEstimate {
  fee: string          // human-readable, e.g. "0.000021"
  feeSymbol: string    // e.g. "ETH"
  feeUsd: string | null
}

// ─── EVM ──────────────────────────────────────────────────────────────────────

const EVM_CHAINS: Record<string, { chain: Chain; rpcUrl: (key: string) => string; explorer: string }> = {
  ethereum: {
    chain: mainnet,
    rpcUrl: (key) => `https://eth-mainnet.g.alchemy.com/v2/${key}`,
    explorer: 'https://etherscan.io/tx'
  }
}

export async function estimateEvmFee(
  from: string,
  to: string,
  amountEth: string,
  config: WalletConfig,
  network = 'ethereum'
): Promise<FeeEstimate> {
  const { chain, rpcUrl } = EVM_CHAINS[network] ?? EVM_CHAINS.ethereum
  const transport = http(rpcUrl(config.alchemyKey))
  const client = createPublicClient({ chain, transport })

  const gasEstimate = await client.estimateGas({
    account: from as `0x${string}`,
    to: to as `0x${string}`,
    value: parseEther(amountEth)
  })
  const gasPrice = await client.getGasPrice()
  const feeWei = gasEstimate * gasPrice
  const feeEth = Number(feeWei) / 1e18

  let feeUsd: string | null = null
  try {
    const priceRes = await fetch(
      `https://api.g.alchemy.com/prices/v1/${config.alchemyKey}/tokens/by-symbol?symbols=ETH`
    )
    const priceJson = await priceRes.json() as {
      data?: Array<{ prices?: Array<{ value: string }> }>
    }
    const price = Number(priceJson.data?.[0]?.prices?.[0]?.value ?? 0)
    if (price > 0) feeUsd = `$${(feeEth * price).toFixed(4)}`
  } catch { /* price optional */ }

  return { fee: feeEth.toFixed(8), feeSymbol: 'ETH', feeUsd }
}

export async function sendEvmTransaction(
  mnemonic: string,
  to: string,
  amountEth: string,
  config: WalletConfig,
  network = 'ethereum',
  accountIndex = 0
): Promise<SendResult> {
  const { chain, rpcUrl, explorer } = EVM_CHAINS[network] ?? EVM_CHAINS.ethereum
  const pk = await getEvmPrivateKey(mnemonic, accountIndex)
  const account = privateKeyToAccount(pk)
  const transport = http(rpcUrl(config.alchemyKey))
  const walletClient = createWalletClient({ chain, transport, account })

  const hash = await walletClient.sendTransaction({
    to: to as `0x${string}`,
    value: parseEther(amountEth)
  })

  return { txHash: hash, explorerUrl: `${explorer}/${hash}` }
}

// ─── Solana ───────────────────────────────────────────────────────────────────

export async function estimateSolanaFee(config: WalletConfig): Promise<FeeEstimate> {
  // Simple transfers on Solana cost 5000 lamports (0.000005 SOL)
  const feeLamports = 5000
  const feeSol = feeLamports / LAMPORTS_PER_SOL

  let feeUsd: string | null = null
  try {
    const priceRes = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
    )
    const priceJson = await priceRes.json() as { solana?: { usd: number } }
    const price = priceJson.solana?.usd ?? 0
    if (price > 0) feeUsd = `$${(feeSol * price).toFixed(6)}`
  } catch { /* price optional */ }

  return { fee: feeSol.toFixed(9), feeSymbol: 'SOL', feeUsd }
}

export async function sendSolanaTransaction(
  mnemonic: string,
  to: string,
  amountSol: string,
  config: WalletConfig,
  accountIndex = 0
): Promise<SendResult> {
  const keypair = await getSolanaKeypair(mnemonic, accountIndex)
  const connection = new Connection(
    `https://mainnet.helius-rpc.com/?api-key=${config.heliusKey}`,
    'confirmed'
  )

  const lamports = Math.round(parseFloat(amountSol) * LAMPORTS_PER_SOL)
  if (lamports <= 0) throw new Error('Amount must be greater than 0')

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: new PublicKey(to),
      lamports
    })
  )

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = keypair.publicKey
  tx.sign(keypair)

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed'
  })

  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight })

  return { txHash: sig, explorerUrl: `https://solscan.io/tx/${sig}` }
}

// ─── Cardano ──────────────────────────────────────────────────────────────────

const BLOCKFROST_BASE = 'https://cardano-mainnet.blockfrost.io/api/v0'

async function fetchUtxos(address: string, blockfrostKey: string): Promise<CardanoUtxo[]> {
  const res = await fetch(`${BLOCKFROST_BASE}/addresses/${address}/utxos`, {
    headers: { project_id: blockfrostKey }
  })
  if (res.status === 404) return []
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(`Blockfrost ${res.status}: ${body.message ?? res.statusText}`)
  }

  const utxos = await res.json() as Array<{
    tx_hash: string
    tx_index: number
    amount: Array<{ unit: string; quantity: string }>
  }>

  return utxos.map(u => ({
    txHash: u.tx_hash,
    txIndex: u.tx_index,
    lovelace: BigInt(u.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0')
  }))
}

export async function estimateCardanoFee(
  _address: string,
  config: WalletConfig
): Promise<FeeEstimate> {
  // Fixed 0.17 ADA — adequate for a simple transfer (real min ≈ 0.16 ADA for ~280 bytes)
  const feeLovelace = 170000n
  const feeAda = Number(feeLovelace) / 1e6

  let feeUsd: string | null = null
  try {
    const priceRes = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=cardano&vs_currencies=usd'
    )
    const priceJson = await priceRes.json() as { cardano?: { usd: number } }
    const price = priceJson.cardano?.usd ?? 0
    if (price > 0) feeUsd = `$${(feeAda * price).toFixed(4)}`
  } catch { /* price optional */ }

  return { fee: feeAda.toFixed(6), feeSymbol: 'ADA', feeUsd }
}

export async function sendCardanoTransaction(
  mnemonic: string,
  fromAddress: string,
  toAddress: string,
  amountAda: string,
  config: WalletConfig,
  accountIndex = 0
): Promise<SendResult> {
  const cleaned = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ')
  const entropy = mnemonicToEntropy(cleaned, wordlist)
  const spendKey = getCardanoSpendingKey(entropy, accountIndex)

  const amountLovelace = BigInt(Math.round(parseFloat(amountAda) * 1_000_000))
  if (amountLovelace <= 0n) throw new Error('Amount must be greater than 0')

  // Fetch UTXOs and select enough to cover amount + fee
  const allUtxos = await fetchUtxos(fromAddress, config.blockfrostKey)
  if (allUtxos.length === 0) throw new Error('No UTXOs found — address has no funds on-chain')

  // Sort descending by value, pick until we have enough
  allUtxos.sort((a, b) => (b.lovelace > a.lovelace ? 1 : -1))
  const FEE = 170000n
  const needed = amountLovelace + FEE

  const selected: CardanoUtxo[] = []
  let sum = 0n
  for (const utxo of allUtxos) {
    selected.push(utxo)
    sum += utxo.lovelace
    if (sum >= needed) break
  }
  if (sum < needed) {
    throw new Error(
      `Insufficient funds: have ${(Number(sum) / 1e6).toFixed(6)} ADA, need ${(Number(needed) / 1e6).toFixed(6)} ADA`
    )
  }

  const toAddrBytes = decodeCardanoAddress(toAddress)
  const fromAddrBytes = decodeCardanoAddress(fromAddress)

  const { txCbor, txHash } = buildCardanoTx(
    selected,
    toAddrBytes,
    fromAddrBytes,
    amountLovelace,
    spendKey
  )

  // Submit via Blockfrost
  const submitRes = await fetch(`${BLOCKFROST_BASE}/tx/submit`, {
    method: 'POST',
    headers: {
      project_id: config.blockfrostKey,
      'Content-Type': 'application/cbor'
    },
    body: txCbor
  })

  if (!submitRes.ok) {
    const body = await submitRes.json().catch(() => ({})) as { message?: string }
    throw new Error(`Submit failed (${submitRes.status}): ${body.message ?? submitRes.statusText}`)
  }

  return {
    txHash,
    explorerUrl: `https://cardanoscan.io/transaction/${txHash}`
  }
}

