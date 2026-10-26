import { encodeFunctionData, getAddress, isAddress, parseAbi } from 'viem'
import type { AgentContractCall, AgentSpendingPolicy, AgentTransaction } from '../shared/agent-execution'

// Sourcify exact-match source + live eth_getCode, 2026-10-25. Non-proxy deployment.
export const EMOGOTCHI = '0xC0A0808cbAF507b80df92b22feD8D3810eAB45d5'
export const EMOGOTCHI_CODE_HASH = '0x6b1b2801096bd8d3fd5245ecdd050d565d801863c915e12cc4178dc7fca411d1'
export const MAX_AGENT_CALL_GAS = 5_000_000n
export const EMOGOTCHI_ABI = parseAbi([
  'function feed(uint256 id) payable', 'function wash(uint256 id) payable', 'function play(uint256 id) payable',
  'function sleep(uint256 id) payable', 'function clean(uint256 id) payable', 'function pet(uint256 id,uint256 count)',
  'function ownerOf(uint256 id) view returns (address)',
])
const names = ['feed', 'wash', 'play', 'sleep', 'clean', 'pet'] as const
export function agentTokenId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,77}$/.test(value) || BigInt(value) >= 2n ** 256n) throw new Error('Use a positive uint256 token ID as a decimal string.')
  return value
}
export function emogotchiCall(contract: unknown, name: unknown, args: unknown, value: unknown): { call: AgentContractCall; valueRaw: string } {
  if (typeof contract !== 'string' || !isAddress(contract, { strict: true }) || getAddress(contract) !== EMOGOTCHI) throw new Error('Contract is not allowlisted.')
  if (typeof name !== 'string' || !names.includes(name as typeof names[number])) throw new Error('Function is not allowlisted. revive and setName require a separate owner capability and are blocked here.')
  if (!Array.isArray(args) || args.length !== (name === 'pet' ? 2 : 1)) throw new Error('Incorrect contract arguments.')
  const id = agentTokenId(args[0])
  if (value !== (name === 'pet' ? '0' : '1')) throw new Error('Care requires exactly 1 MON; pet is nonpayable and requires value "0".')
  let data: string
  if (name === 'pet') {
    const count = agentTokenId(args[1])
    if (BigInt(count) > 20n) throw new Error('Pet count must be 1 to 20.')
    data = encodeFunctionData({ abi: EMOGOTCHI_ABI, functionName: 'pet', args: [BigInt(id), BigInt(count)] })
  } else data = encodeFunctionData({ abi: EMOGOTCHI_ABI, functionName: name as Exclude<typeof names[number], 'pet'>, args: [BigInt(id)] })
  return { call: { function: name as typeof names[number], args: [...args], data }, valueRaw: name === 'pet' ? '0' : '1000000000000000000' }
}
export function validateAgentCall(tx: AgentTransaction, policy?: AgentSpendingPolicy): void {
  if (!tx.call) return
  const checked = emogotchiCall(tx.recipient, tx.call.function, tx.call.args, tx.call.function === 'pet' ? '0' : '1')
  if (tx.chainId !== 143 || tx.mode !== 'autonomous' || checked.call.data !== tx.call.data || checked.valueRaw !== tx.valueRaw) throw new Error('Changed contract call binding.')
  if (policy && (policy.chainId !== 143 || !policy.emogotchiTokenIds?.includes(tx.call.args[0]))) throw new Error('Token ID is outside the owner-authorized Emogotchi policy.')
}
