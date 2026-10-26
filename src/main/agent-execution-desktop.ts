/** Privileged desktop adapter. Keys and serialized signed transactions never cross IPC or MCP. */
import { app, safeStorage } from 'electron'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { getAddress, keccak256, parseTransaction, recoverTransactionAddress, type Hex, type TransactionSerialized } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { loadConfig, loadMnemonic } from './secure-store'
import { getEvmPrivateKey } from './wallet-core'
import { evmReadClient } from './tx-sender'
import { AgentExecutionCore, type AgentExecutionLedger, validateLedger } from './agent-execution-core'
import { readJsonObjectFile, writeJsonObjectFileAtomic } from './atomic-json-map-file'
import type { AgentExecutionAuth, AgentExecutionOwner, AgentSendPlan, AgentTransaction } from '../shared/agent-execution'
import { agentChainAllowed, agentNativeSymbol } from '../shared/agent-execution'
import { EMOGOTCHI, EMOGOTCHI_ABI, EMOGOTCHI_CODE_HASH, MAX_AGENT_CALL_GAS, validateAgentCall } from './agent-emogotchi'

export function createAgentExecution(owner: () => AgentExecutionOwner | null, authorize: (id: string) => AgentExecutionAuth): AgentExecutionCore {
  const dir = join(app.getPath('userData'), 'agent-access')
  const path = join(dir, 'execution.enc.json')
  const secureStorage = () => safeStorage.isEncryptionAvailable()
    && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
  const client = (chainId: number) => {
    if (![1, 11155111, 143].includes(chainId)) throw new Error('Execution is supported on Ethereum, Sepolia and Monad only.')
    const rpc = evmReadClient(chainId, loadConfig())
    if (!rpc) throw new Error('The requested network is not active.')
    return rpc
  }
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  const address = async (accountIndex: number) => {
    if (!Number.isInteger(accountIndex) || accountIndex < 0 || accountIndex > 1_000_000) throw new Error('Invalid signing account.')
    // One transient derived key. No private key is stored in execution state or returned to UI/agent.
    return privateKeyToAccount(await getEvmPrivateKey(loadMnemonic(), accountIndex)).address
  }
  const assertOwner = (tx: AgentTransaction) => {
    const current = owner()
    if (!current || current.context !== tx.context || !agentChainAllowed(current.chainId, tx.chainId)) throw new Error('Unlock the original account and network.')
    if (tx.mode === 'approval' && (current.accountIndex !== tx.accountIndex || !same(current.address, tx.from))) throw new Error('Signing account mismatch.')
    if (tx.mode !== 'approval' && tx.accountIndex < 1000) throw new Error('Autonomous and recovery sends require an isolated account.')
  }
  async function checkNetwork(chainId: number) {
    const rpc = client(chainId)
    let reported: number
    try { reported = await rpc.getChainId() } catch { throw new Error('Network verification unavailable. Check the RPC connection.') }
    if (reported !== chainId) throw new Error('RPC network does not match the authorized chain.')
    return rpc
  }
  async function prepare(tx: AgentTransaction) {
    assertOwner(tx)
    validateAgentCall(tx)
    if (!same(await address(tx.accountIndex), tx.from)) throw new Error('Derived sender does not match this request.')
    const rpc = await checkNetwork(tx.chainId)
    const from = getAddress(tx.from), to = getAddress(tx.recipient), value = BigInt(tx.valueRaw)
    const [fromCode, toCode, nonce, balance, gasPrice, gas] = await Promise.all([
      rpc.getCode({ address: from }), rpc.getCode({ address: to }), rpc.getTransactionCount({ address: from, blockTag: 'pending' }),
      rpc.getBalance({ address: from, blockTag: 'pending' }), rpc.getGasPrice(), rpc.estimateGas({ account: from, to, value, ...(tx.call ? { data: tx.call.data as Hex } : {}) }),
    ]).catch(() => { throw new Error('Transfer checks unavailable or simulation failed. Check the network, balance and recipient.') })
    if (fromCode && fromCode !== '0x') throw new Error('Delegated or contract senders are not supported.')
    if (tx.call) {
      if (!toCode || keccak256(toCode) !== EMOGOTCHI_CODE_HASH || gas < 21000n || gas > MAX_AGENT_CALL_GAS) throw new Error('Emogotchi code or gas limit does not match the allowlist.')
      let petOwner: string
      try { petOwner = await rpc.readContract({ address: EMOGOTCHI, abi: EMOGOTCHI_ABI, functionName: 'ownerOf', args: [BigInt(tx.call.args[0])] }) }
      catch { throw new Error('Cannot verify ownership of the allowed pet.') }
      if (!same(petOwner, from)) throw new Error('The isolated account must own this pet before it can care for it.')
    } else if ((toCode && toCode !== '0x') || gas > 21000n) throw new Error('Only plain native transfers between externally owned accounts are supported.')
    if (gasPrice <= 0n || !Number.isSafeInteger(nonce) || nonce < 0) throw new Error('Invalid fee or nonce from RPC.')
    const gasLimit = tx.call ? gas : 21000n
    const maxFee = gasLimit * gasPrice
    if (balance < value + maxFee) throw new Error(`Not enough ${agentNativeSymbol(tx.chainId)} for the amount and maximum network fee. Fund the displayed source account first.`)
    try { await rpc.call({ account: from, to, value, gas: gasLimit, gasPrice, ...(tx.call ? { data: tx.call.data as Hex } : {}) }) }
    catch { throw new Error('Transfer simulation failed. No transaction was submitted.') }
    assertOwner(tx)
    return { chainId: tx.chainId, network: tx.network, from: tx.from, to: tx.recipient, valueRaw: tx.valueRaw,
      gas: gasLimit.toString(), gasPriceRaw: gasPrice.toString(), maxFeeRaw: maxFee.toString(), totalRaw: (value + maxFee).toString(), nonce,
      ...(tx.call ? { data: tx.call.data } : {}) }
  }
  return new AgentExecutionCore({
    owner, authorize, address,
    async unused(address, chainId) {
      const rpc = await checkNetwork(chainId), account = getAddress(address)
      const [balance, nonce, code] = await Promise.all([rpc.getBalance({ address: account, blockTag: 'pending' }),
        rpc.getTransactionCount({ address: account, blockTag: 'pending' }), rpc.getCode({ address: account })])
        .catch(() => { throw new Error('Cannot verify the isolated account is unused. Try again when network reads are available.') })
      return balance === 0n && nonce === 0 && (!code || code === '0x')
    },
    load() {
      if (!secureStorage()) throw new Error('OS secure storage is required for execution.')
      const stored = readJsonObjectFile(fs, path)
      if (!fs.existsSync(path)) return { version: 1, nextAccountIndex: 1000, policies: [], transactions: [] }
      if (typeof stored.sealed !== 'string' || stored.version !== 1) throw new Error('Execution journal is invalid; it was left untouched.')
      let state: unknown
      try { state = JSON.parse(safeStorage.decryptString(Buffer.from(stored.sealed, 'base64'))) } catch { throw new Error('Execution journal cannot be authenticated. Do not delete it; preserve it for recovery.') }
      validateLedger(state)
      return state
    },
    save(state: AgentExecutionLedger) {
      if (!secureStorage()) throw new Error('OS secure storage is unavailable; signing is disabled.')
      writeJsonObjectFileAtomic(fs, dir, path, { version: 1, sealed: safeStorage.encryptString(JSON.stringify(state)).toString('base64') })
    },
    prepare,
    async sign(tx: AgentTransaction, plan: AgentSendPlan) {
      // Revalidate simulation, exact sender, funds, nonce and fee ceiling immediately before signing.
      const fresh = await prepare(tx)
      if (fresh.nonce !== plan.nonce || BigInt(fresh.gasPriceRaw) > BigInt(plan.gasPriceRaw) || BigInt(fresh.gas) > BigInt(plan.gas)
        || fresh.data !== plan.data || plan.data !== tx.call?.data) throw new Error('Nonce, calldata or fee changed. A fresh review is required.')
      assertOwner(tx)
      const account = privateKeyToAccount(await getEvmPrivateKey(loadMnemonic(), tx.accountIndex))
      assertOwner(tx)
      if (!same(account.address, plan.from)) throw new Error('Signing identity mismatch.')
      const raw = await account.signTransaction({ chainId: plan.chainId, type: 'legacy', to: getAddress(plan.to), value: BigInt(plan.valueRaw),
        nonce: plan.nonce, gas: BigInt(plan.gas), gasPrice: BigInt(plan.gasPriceRaw), ...(tx.call ? { data: tx.call.data as Hex } : {}) })
      const decoded = parseTransaction(raw)
      const sender = await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized })
      if (!same(sender, plan.from) || decoded.chainId !== plan.chainId || decoded.nonce !== plan.nonce || !same(decoded.to ?? '', plan.to)
        || (decoded.value ?? 0n) !== BigInt(plan.valueRaw) || decoded.gas !== BigInt(plan.gas) || decoded.gasPrice !== BigInt(plan.gasPriceRaw)
        || (decoded.data ?? '0x') !== (tx.call?.data ?? '0x')) throw new Error('Signed transaction failed verification.')
      assertOwner(tx)
      return { hash: keccak256(raw), raw }
    },
    async broadcast(raw: string, chainId: number) {
      // Network was checked during signing. Do not await between the core's final
      // permission check and handing the signed bytes to the transport.
      const rpc = client(chainId)
      // No transport retry of a send. A timeout returns to the durable hash journal.
      return rpc.request({ method: 'eth_sendRawTransaction', params: [raw as Hex] }, { retryCount: 0 })
    },
    async receipt(tx) {
      if (!tx.txHash || !tx.plan) return { state: 'unknown', confirmations: 0, finalized: false }
      const rpc = await checkNetwork(tx.chainId)
      try {
        const hash = tx.txHash as Hex
        const [receipt, transaction, height] = await Promise.all([rpc.getTransactionReceipt({ hash }), rpc.getTransaction({ hash }), rpc.getBlockNumber()])
        const canonical = await rpc.getBlock({ blockNumber: receipt.blockNumber })
        if (!same(transaction.from, tx.from) || !same(transaction.to ?? '', tx.recipient) || transaction.value !== BigInt(tx.valueRaw)
          || transaction.nonce !== tx.plan.nonce || transaction.chainId !== tx.chainId || receipt.transactionHash.toLowerCase() !== hash.toLowerCase()
          || canonical.hash !== receipt.blockHash || height < receipt.blockNumber || receipt.gasUsed > BigInt(tx.plan.gas)
          || (transaction.input ?? '0x') !== (tx.call?.data ?? '0x')
          || (tx.chainId === 143 && transaction.gas !== BigInt(tx.plan.gas))
          || receipt.effectiveGasPrice > BigInt(tx.plan.gasPriceRaw)) return { state: 'unknown', confirmations: 0, finalized: false }
        let finalized = false
        try { finalized = (await rpc.getBlock({ blockTag: 'finalized' })).number! >= receipt.blockNumber } catch { /* inclusion is distinct from finality */ }
        return { state: receipt.status === 'success' ? 'confirmed' : 'reverted', confirmations: Number(height - receipt.blockNumber + 1n), finalized }
      } catch { return { state: 'unknown', confirmations: 0, finalized: false } }
    },
  })
}
