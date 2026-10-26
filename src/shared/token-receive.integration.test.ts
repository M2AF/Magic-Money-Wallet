import { beforeAll, describe, expect, it } from 'vitest'
import { deriveAddresses, deriveTestnetAddresses } from '../main/wallet-core'
import { validateAddress } from '../main/address-validate'
import { resolveTokenReceive, type TokenDetailsContext, type TokenDetailsHolding } from './token-details'

// Public test mnemonic only. These checks derive addresses; they never build/sign/broadcast.
const PUBLIC_TEST_WORDS = 'test test test test test test test test test test test junk'
let addresses: Awaited<ReturnType<typeof deriveAddresses>>
let testnet: Awaited<ReturnType<typeof deriveTestnetAddresses>>
beforeAll(async () => {
  addresses = await deriveAddresses(PUBLIC_TEST_WORDS, 0)
  testnet = await deriveTestnetAddresses(PUBLIC_TEST_WORDS, 0)
}, 30_000)

describe('receive resolution with the real wallet address validator', () => {
  it.each(['ethereum', 'solana', 'cardano', 'tron'] as const)('resolves %s to its actual account address', async chainId => {
    const family = chainId === 'ethereum' ? 'evm' : chainId
    const context: TokenDetailsContext = { accountIndex: 0, accountAddress: addresses.evm, mode: 'mainnet',
      chainId, chainType: family, addresses }
    const token: TokenDetailsHolding = { chain: chainId, contractAddress: 'test-asset-identifier', decimals: 6 }
    const result = await resolveTokenReceive(token, context, (chain, address) => validateAddress(chain, address))
    expect(result.capability.state).toBe('available')
    expect(result.address).toBe(addresses[family])
    expect(result.qrPayload).toBe(result.address)
  })
  it('accepts active Cardano preprod addresses and refuses mainnet addresses in testnet mode', async () => {
    const context: TokenDetailsContext = { accountIndex: 0, accountAddress: addresses.evm, mode: 'testnet',
      chainId: 'cardano', chainType: 'cardano', addresses: { ...addresses, cardano: testnet.cardano } }
    const token: TokenDetailsHolding = { chain: 'cardano', contractAddress: 'test-asset-identifier', decimals: 6 }
    const check = (chain: string, address: string) => validateAddress(chain, address, true)
    expect((await resolveTokenReceive(token, context, check)).address).toBe(testnet.cardano)
    expect((await resolveTokenReceive(token, { ...context, addresses }, check)).address).toBeNull()
  })
})
