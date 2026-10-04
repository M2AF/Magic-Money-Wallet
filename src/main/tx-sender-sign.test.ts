/**
 * Sign-without-broadcast: the hash is known before anything reaches the network.
 * No network: a viem `custom` transport answers the read calls viem needs to
 * prepare the transaction, and records every method so a broadcast would show.
 */
import { describe, it, expect } from 'vitest'
import { custom, keccak256, parseTransaction, recoverTransactionAddress } from 'viem'
import { sepolia, mainnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { signPreparedEvmTransaction } from './tx-sender'

const PK = `0x${'11'.repeat(32)}` as const
const TO = '0x008888878f94C0d87defdf0B07f46B93C1934442'
const DATA = '0xfaadb53b' + '00'.repeat(64)

function fakeRpc() {
  const methods: string[] = []
  const transport = custom({
    async request({ method }: { method: string }) {
      methods.push(method)
      switch (method) {
        case 'eth_chainId': return '0xaa36a7'
        case 'eth_getBlockByNumber': return { baseFeePerGas: '0x3b9aca00', number: '0x10', timestamp: '0x1', transactions: [] }
        case 'eth_maxPriorityFeePerGas': return '0x5f5e100'
        case 'eth_estimateGas': return '0x30d40'
        case 'eth_getTransactionCount': return '0x99'
        case 'eth_sendRawTransaction': case 'eth_sendTransaction': throw new Error('must not broadcast')
        default: throw new Error(`unexpected ${method}`)
      }
    },
  })
  return { transport, methods }
}

describe('signPreparedEvmTransaction', () => {
  it('signs locally with the pinned nonce, never broadcasts, and returns the hash of exactly those bytes', async () => {
    const rpc = fakeRpc()
    const signed = await signPreparedEvmTransaction(PK, sepolia, rpc.transport, { to: TO, data: DATA, value: '0x0', chainId: 11155111, nonce: 7 })
    expect(signed.txHash).toBe(keccak256(signed.serialized))
    const tx = parseTransaction(signed.serialized)
    expect(tx).toMatchObject({ chainId: 11155111, nonce: 7, to: TO.toLowerCase(), data: DATA })
    expect(tx.value ?? 0n).toBe(0n)   // viem omits a zero value when parsing
    expect(await recoverTransactionAddress({ serializedTransaction: signed.serialized as never })).toBe(privateKeyToAccount(PK).address)
    expect(rpc.methods).not.toContain('eth_sendRawTransaction')
    expect(rpc.methods).not.toContain('eth_getTransactionCount')   // the pinned nonce is used, not re-read
  })

  it('refuses without a pinned nonce, or for a chain other than the transaction\'s', async () => {
    const rpc = fakeRpc()
    await expect(signPreparedEvmTransaction(PK, sepolia, rpc.transport, { to: TO, data: DATA, chainId: 11155111 } as never)).rejects.toThrow(/pinned nonce/)
    await expect(signPreparedEvmTransaction(PK, mainnet, rpc.transport, { to: TO, data: DATA, chainId: 11155111, nonce: 1 })).rejects.toThrow(/Refusing to sign/)
    expect(rpc.methods).toEqual([])
  })
})
