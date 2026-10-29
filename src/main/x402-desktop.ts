/** Fixed EIP-3009 capability. Never exports a key, arbitrary signer or broadcast API. */
import { app, safeStorage } from 'electron'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { encodeFunctionData, getAddress, hashDomain, parseAbi, recoverTypedDataAddress, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { evmReadClient } from './tx-sender'
import { getEvmPrivateKey } from './wallet-core'
import { loadConfig, loadMnemonic } from './secure-store'
import { readJsonObjectFile, writeJsonObjectFileAtomic } from './atomic-json-map-file'
import { X402Core, validateX402Ledger, type X402Port } from './x402-core'
import type { X402PaymentView, X402PaymentPayload } from '../shared/x402'
import { validateX402Proposal } from './x402-validation'

export const X402_AUTH_TYPES = { TransferWithAuthorization: [
  { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
  { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
] } as const
const domainTypes = { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }] } as const
const abi = parseAbi([
  'function DOMAIN_SEPARATOR() view returns (bytes32)', 'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)', 'function authorizationState(address, bytes32) view returns (bool)',
  'function transfer(address to, uint256 value) returns (bool)',
])
export function x402TypedData(view: X402PaymentView) {
  const checked = validateX402Proposal({ requestId: view.requestId, resourceUrl: view.resourceUrl, paymentRequired: view.paymentRequired }, view.environment)
  if (checked.chainId !== view.chainId || checked.asset !== view.asset || checked.domainName !== view.domainName || checked.amountRaw !== view.authorization.value
    || checked.recipient !== view.authorization.to || view.from !== view.authorization.from) throw new Error('Changed x402 signing fields.')
  return { domain: { name: checked.domainName, version: '2', chainId: checked.chainId, verifyingContract: getAddress(checked.asset) },
    types: X402_AUTH_TYPES, primaryType: 'TransferWithAuthorization' as const,
    message: { from: getAddress(view.from), to: getAddress(checked.recipient), value: BigInt(checked.amountRaw),
      validAfter: BigInt(view.authorization.validAfter), validBefore: BigInt(view.authorization.validBefore), nonce: view.authorization.nonce as Hex } }
}
export function createDesktopX402(port: Pick<X402Port, 'enabled' | 'context' | 'authorize' | 'account' | 'audit' | 'pendingProposals'>): X402Core {
  const dir = join(app.getPath('userData'), 'agent-access'), path = join(dir, 'x402.enc.json')
  const secure = () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
  const assertAuthority = (view: X402PaymentView) => {
    if (!port.enabled() || port.context() !== view.context || Date.now() >= view.expiresAt) throw new Error('x402 context or expiry changed.')
    const auth = port.authorize(view.clientId), account = port.account(auth, view.policyId)
    if (account.address !== view.from || account.accountIndex !== view.accountIndex || view.accountIndex < 1000 || auth.environment !== view.environment) throw new Error('Isolated signing account changed.')
  }
  async function check(view: X402PaymentView) {
    assertAuthority(view)
    const typed = x402TypedData(view), rpc = evmReadClient(view.chainId, loadConfig())
    if (!rpc) throw new Error('The x402 payment network is unavailable.')
    try {
      if (await rpc.getChainId() !== view.chainId) throw new Error('wrong chain')
      const [separator, decimals, balance, used, code] = await Promise.all([
        rpc.readContract({ address: typed.domain.verifyingContract, abi, functionName: 'DOMAIN_SEPARATOR' }),
        rpc.readContract({ address: typed.domain.verifyingContract, abi, functionName: 'decimals' }),
        rpc.readContract({ address: typed.domain.verifyingContract, abi, functionName: 'balanceOf', args: [typed.message.from] }),
        rpc.readContract({ address: typed.domain.verifyingContract, abi, functionName: 'authorizationState', args: [typed.message.from, typed.message.nonce] }),
        rpc.getCode({ address: typed.message.from }),
      ])
      if (separator.toLowerCase() !== hashDomain({ domain: { ...typed.domain, chainId: BigInt(view.chainId) }, types: domainTypes }).toLowerCase() || decimals !== 6
        || balance < typed.message.value || used !== false || (code && code !== '0x')) throw new Error('token/account checks failed')
      // Simulate the same token transfer WITHOUT disclosing a spendable signature
      // to an RPC node. The facilitator later verifies EIP-3009 settlement.
      const simulated = await rpc.call({ account: typed.message.from, to: typed.domain.verifyingContract,
        data: encodeFunctionData({ abi, functionName: 'transfer', args: [typed.message.to, typed.message.value] }) })
      if (simulated.data !== `0x${'0'.repeat(63)}1`) throw new Error('transfer simulation returned false')
    } catch { throw new Error('USDC payment checks failed. Check the payment network, balance, token domain and nonce; no authorization was released.') }
    assertAuthority(view)
  }
  return new X402Core({ ...port, check,
    load() {
      if (!secure()) throw new Error('OS secure storage is required for x402.')
      const raw = readJsonObjectFile(fs, path)
      if (!fs.existsSync(path)) return { version: 1, limits: [], payments: [] }
      if (raw.version !== 1 || typeof raw.sealed !== 'string') throw new Error('Invalid x402 journal; preserve it for recovery.')
      let parsed: unknown
      try { parsed = JSON.parse(safeStorage.decryptString(Buffer.from(raw.sealed, 'base64'))) } catch { throw new Error('Cannot authenticate the x402 journal; it was left untouched.') }
      validateX402Ledger(parsed); return parsed
    },
    save(state) {
      if (!secure()) throw new Error('OS secure storage is unavailable; x402 is blocked.')
      writeJsonObjectFileAtomic(fs, dir, path, { version: 1, sealed: safeStorage.encryptString(JSON.stringify(state)).toString('base64') })
    },
    async sign(view): Promise<X402PaymentPayload> {
      // Recheck immediately before key use; only this fixed domain/type is signed.
      await check(view); assertAuthority(view)
      const typed = x402TypedData(view), account = privateKeyToAccount(await getEvmPrivateKey(loadMnemonic(), view.accountIndex))
      assertAuthority(view)
      if (account.address !== typed.message.from) throw new Error('Isolated key does not match the sender.')
      const signature = await account.signTypedData(typed)
      if (await recoverTypedDataAddress({ ...typed, signature }) !== account.address) throw new Error('x402 signature verification failed.')
      assertAuthority(view)
      return { x402Version: 2, resource: structuredClone(view.paymentRequired.resource), accepted: structuredClone(view.paymentRequired.accepts[0]),
        payload: { signature, authorization: structuredClone(view.authorization) }, ...(view.paymentRequired.extensions ? { extensions: {} } : {}) }
    },
  })
}
