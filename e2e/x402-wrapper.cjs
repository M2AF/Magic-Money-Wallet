// Public-seed, disposable-profile USDC fixture. Intercepts every EVM RPC; no
// transaction or signed authorization is sent to a real chain or provider.
require('./electron-wrapper.cjs')
const { net } = require('electron')
const { decodeFunctionData, encodeAbiParameters, hashDomain, parseAbi } = require('viem')
const fs = require('fs'), path = require('path')
const token = '0x036cbd53842c5426634e7929541ec2318f3dcf7e'
const abi = parseAbi(['function DOMAIN_SEPARATOR() view returns (bytes32)', 'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)', 'function authorizationState(address,bytes32) view returns (bool)', 'function transfer(address,uint256) returns (bool)'])
const separator = hashDomain({ domain: { name: 'USDC', version: '2', chainId: 84532n, verifyingContract: token },
  types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }] } })
const word = (type, value) => encodeAbiParameters([{ type }], [value])
function rpcResult(call, url) {
  const params = call.params || []
  switch (call.method) {
    case 'eth_chainId': return /base/.test(url) ? '0x14a34' : '0xaa36a7'
    case 'eth_getCode': return '0x'
    case 'eth_getBalance': return '0x0'
    case 'eth_getTransactionCount': return '0x0'
    case 'eth_gasPrice': return '0x3b9aca00'
    case 'eth_estimateGas': return '0x5208'
    case 'eth_call': {
      const tx = params[0] || {}
      if ((tx.to || '').toLowerCase() !== token) return word('uint256', 0n)
      const decoded = decodeFunctionData({ abi, data: tx.data })
      if (decoded.functionName === 'DOMAIN_SEPARATOR') return word('bytes32', separator)
      if (decoded.functionName === 'decimals') return word('uint8', 6)
      if (decoded.functionName === 'balanceOf') return word('uint256', 100000000n)
      if (decoded.functionName === 'authorizationState') return word('bool', false)
      if (decoded.functionName === 'transfer') return word('bool', true)
      throw new Error('Unexpected USDC call')
    }
    case 'eth_sendRawTransaction': throw new Error('No on-chain submission permitted in x402 fixture')
    default: return '0x0'
  }
}
function intercept(original) {
  return async (input, init) => {
    let body; try { body = JSON.parse((init && init.body) || 'null') } catch { /* not RPC */ }
    const calls = Array.isArray(body) ? body : [body]
    if (!calls.some(c => c && typeof c.method === 'string' && c.method.startsWith('eth_'))) return original(input, init)
    const url = typeof input === 'string' ? input : input.url || String(input)
    const replies = calls.map(call => {
      try { return { jsonrpc: '2.0', id: call.id, result: rpcResult(call, url) } }
      catch { return { jsonrpc: '2.0', id: call.id, error: { code: -32000, message: 'Offline x402 fixture denied call' } } }
    })
    return new Response(JSON.stringify(Array.isArray(body) ? replies : replies[0]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}
globalThis.fetch = intercept(globalThis.fetch.bind(globalThis))
net.fetch = intercept(net.fetch.bind(net))
