// Disposable-profile execution fixture only. All ETH RPC traffic is intercepted;
// actual derivation, signing, journal, IPC and MCP remain production code.
require('./electron-wrapper.cjs')
const { net } = require('electron')
const { keccak256, parseTransaction, recoverTransactionAddress } = require('viem')
const fs = require('fs')
const path = require('path')
const transactions = new Map()
const blockHash = '0x' + 'cc'.repeat(32)
const primary = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'
async function result(call) {
  const params = call.params || []
  const hex = n => '0x' + BigInt(n).toString(16)
  switch (call.method) {
    case 'eth_chainId': return '0x1'
    case 'eth_getCode': case 'eth_call': return '0x'
    case 'eth_estimateGas': return '0x5208'
    case 'eth_gasPrice': return '0x3b9aca00'
    case 'eth_getBalance': return (params[0].toLowerCase() === primary || fs.existsSync(path.join(process.env.MM_TEST_USERDATA, 'fixture-funded'))) ? hex(10n ** 19n) : '0x0'
    case 'eth_getTransactionCount': return hex([...transactions.values()].filter(tx => tx.from.toLowerCase() === params[0].toLowerCase()).length)
    case 'eth_sendRawTransaction': {
      const raw = params[0], hash = keccak256(raw), decoded = parseTransaction(raw)
      const from = await recoverTransactionAddress({ serializedTransaction: raw })
      transactions.set(hash, { hash, from, to: decoded.to, value: hex(decoded.value), nonce: hex(decoded.nonce), chainId: hex(decoded.chainId),
        gas: hex(decoded.gas), gasPrice: hex(decoded.gasPrice), input: '0x', type: '0x0', v: hex(decoded.v), r: decoded.r, s: decoded.s,
        blockHash, blockNumber: '0x64', transactionIndex: '0x0' })
      fs.appendFileSync(path.join(process.env.MM_TEST_USERDATA, 'fixture-submissions.jsonl'), JSON.stringify({ hash, from, to: decoded.to, value: hex(decoded.value) }) + '\n')
      return hash
    }
    case 'eth_getTransactionByHash': return transactions.get(params[0]) || null
    case 'eth_getTransactionReceipt': {
      const tx = transactions.get(params[0]); if (!tx) return null
      return { transactionHash: tx.hash, transactionIndex: '0x0', from: tx.from, to: tx.to, blockHash, blockNumber: '0x64',
        gasUsed: '0x5208', cumulativeGasUsed: '0x5208', effectiveGasPrice: tx.gasPrice, status: '0x1', logs: [], logsBloom: '0x' + '00'.repeat(256), type: '0x0', contractAddress: null }
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
      try { return { jsonrpc: '2.0', id: call.id, result: await result(call) } }
      catch (e) { return { jsonrpc: '2.0', id: call.id, error: { code: -32000, message: String(e) } } }
    }))
    return new Response(JSON.stringify(Array.isArray(body) ? replies : replies[0]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}
globalThis.fetch = intercept(globalThis.fetch.bind(globalThis))
net.fetch = intercept(net.fetch.bind(net))
