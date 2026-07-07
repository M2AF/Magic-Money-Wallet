import { describe, it, expect } from 'vitest'
import { EVM_CHAINS as SENDER_CHAINS, TESTNET_EVM_SENDERS } from './tx-sender'
import { EVM_CHAINS as CONFIG_CHAINS, TESTNET_EVM_CHAINS } from './chain-config'
import { EVM_CHAIN_ID as SWAP_CHAIN_IDS } from './swap-executor'

/**
 * Chain-parity invariants (audit M-8). EVM chain metadata lives in two shapes —
 * chain-config.ts (balances/UI) and tx-sender.ts (viem senders) — plus the swap
 * executor's source-chain list. Drift between them has already shipped one bug
 * (BSC: swap quotes rendered, sends threw). These tests pin the contract:
 * anything advertised must be sendable, with matching ids and symbols.
 */
describe('chain parity', () => {
  it('every chain-config EVM chain has a sender with matching chainId + symbol', () => {
    for (const def of CONFIG_CHAINS) {
      const sender = SENDER_CHAINS[def.id]
      expect(sender, `tx-sender has no entry for '${def.id}'`).toBeDefined()
      expect(sender.chain.id, `chainId mismatch for '${def.id}'`).toBe(def.chainId)
      expect(sender.nativeSymbol, `native symbol mismatch for '${def.id}'`).toBe(def.nativeSymbol)
    }
  })

  it('every swap-executor source chain has a sender with the same chainId (BSC regression)', () => {
    for (const [id, chainId] of Object.entries(SWAP_CHAIN_IDS)) {
      const sender = SENDER_CHAINS[id]
      expect(sender, `swap layer advertises '${id}' but tx-sender cannot send on it`).toBeDefined()
      expect(sender.chain.id, `swap/send chainId mismatch for '${id}'`).toBe(chainId)
    }
  })

  it('every testnet chain-config EVM chain has a testnet sender with matching chainId', () => {
    for (const def of TESTNET_EVM_CHAINS) {
      const sender = TESTNET_EVM_SENDERS[def.id]
      expect(sender, `testnet tx-sender has no entry for '${def.id}'`).toBeDefined()
      expect(sender.chain.id, `testnet chainId mismatch for '${def.id}'`).toBe(def.chainId)
    }
  })

  it('testnet senders are a subset of mainnet senders (no invented chains)', () => {
    // Not equality: BSC has a mainnet sender purely for the swap layer but is
    // deliberately absent from Testnet Mode (chain-config hides it there).
    const mainnetIds = new Set(Object.keys(SENDER_CHAINS))
    for (const id of Object.keys(TESTNET_EVM_SENDERS)) {
      expect(mainnetIds.has(id), `testnet sender '${id}' has no mainnet counterpart`).toBe(true)
    }
  })
})
