// Disposable-profile execution fixture only. All EVM RPC traffic is intercepted;
// actual derivation, signing, journal, IPC and MCP remain production code.
require('./electron-wrapper.cjs')
const { net } = require('electron')
const { keccak256, parseTransaction, recoverTransactionAddress } = require('viem')
const fs = require('fs')
const path = require('path')
const transactions = new Map()
const blockHash = '0x' + 'cc'.repeat(32)
const { mnemonicToAccount } = require('viem/accounts')
const { encodeAbiParameters } = require('viem')
const emogotchi = '0xc0a0808cbaf507b80df92b22fed8d3810eab45d5'
const code = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/main/__fixtures__/emogotchi-runtime.json'), 'utf8')).runtimeBytecode
const isolated = mnemonicToAccount('test test test test test test test test test test test junk', { accountIndex: 1000 }).address
const primary = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'
async function result(call, url) {
  const params = call.params || []
  const hex = n => '0x' + BigInt(n ?? 0n).toString(16)
  switch (call.method) {
    case 'eth_chainId': return /monad/.test(url) ? '0x8f' : '0x1'
    case 'eth_getCode': return params[0].toLowerCase() === emogotchi ? code : '0x'
    case 'eth_call': return (params[0].data || '').startsWith('0x6352211e') ? encodeAbiParameters([{ type: 'address' }], [isolated]) : '0x'
    case 'eth_estimateGas': return params[0].data ? '0x493e0' : '0x5208'
    case 'eth_gasPrice': return '0x174876e800'
    case 'eth_getBalance': return (params[0].toLowerCase() === primary || fs.existsSync(path.join(process.env.MM_TEST_USERDATA, 'fixture-funded'))) ? hex(10n ** 19n) : '0x0'
    case 'eth_getTransactionCount': return hex([...transactions.values()].filter(tx => tx.from.toLowerCase() === params[0].toLowerCase() && Number(tx.chainId) === (/monad/.test(url) ? 143 : 1)).length)
    case 'eth_sendRawTransaction': {
      const raw = params[0], hash = keccak256(raw), decoded = parseTransaction(raw)
      const from = await recoverTransactionAddress({ serializedTransaction: raw })
      transactions.set(hash, { hash, from, to: decoded.to, value: hex(decoded.value), nonce: hex(decoded.nonce), chainId: hex(decoded.chainId),
        gas: hex(decoded.gas), gasPrice: hex(decoded.gasPrice), input: decoded.data || '0x', type: '0x0', v: hex(decoded.v), r: decoded.r, s: decoded.s,
        blockHash, blockNumber: '0x64', transactionIndex: '0x0' })
      fs.appendFileSync(path.join(process.env.MM_TEST_USERDATA, 'fixture-submissions.jsonl'), JSON.stringify({ hash, from, to: decoded.to, value: hex(decoded.value), input: decoded.data || '0x', chainId: decoded.chainId }) + '\n')
      return hash
    }
    case 'eth_getTransactionByHash': return transactions.get(params[0]) || null
    case 'eth_getTransactionReceipt': {
      const tx = transactions.get(params[0]); if (!tx) return null
      return { transactionHash: tx.hash, transactionIndex: '0x0', from: tx.from, to: tx.to, blockHash, blockNumber: '0x64',
        gasUsed: tx.gas, cumulativeGasUsed: tx.gas, effectiveGasPrice: tx.gasPrice, status: '0x1', logs: [], logsBloom: '0x' + '00'.repeat(256), type: '0x0', contractAddress: null }
    }
    case 'eth_blockNumber': return '0x66'
    case 'eth_getBlockByNumber': return { hash: blockHash, number: '0x64', transactions: [], timestamp: '0x1', gasLimit: '0x1c9c380', gasUsed: '0x5208' }
    default: throw new Error('Unexpected offline RPC: ' + call.method)
  }
}
function intercept(original) {
  return async (input, init) => {
    let body
    try { body = JSON.parse((init && init.body) || 'null') } catch { /* not JSON RPC */ }
    const calls = Array.isArray(body) ? body : [body]
    if (!calls.some(c => c && typeof c.method === 'string' && c.method.startsWith('eth_'))) return original(input, init)
    const replies = await Promise.all(calls.map(async call => {
      try { return { jsonrpc: '2.0', id: call.id, result: await result(call, typeof input === 'string' ? input : input.url || String(input)) } }
      catch (e) { return { jsonrpc: '2.0', id: call.id, error: { code: -32000, message: String(e) } } }
    }))
    return new Response(JSON.stringify(Array.isArray(body) ? replies : replies[0]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}
globalThis.fetch = intercept(globalThis.fetch.bind(globalThis))
net.fetch = intercept(net.fetch.bind(net))
