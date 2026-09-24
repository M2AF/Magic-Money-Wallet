import { describe, expect, it } from 'vitest'
// @ts-expect-error -- untyped Worker modules, imported only to prove parity
import { EVM_CHAIN_IDS as WORKER_QUOTE_IDS } from '../../cloudflare-worker/swap-proxy.js'
// @ts-expect-error -- untyped Worker modules, imported only to prove parity
import { EVM_CHAIN_IDS as WORKER_TOKEN_IDS } from '../../cloudflare-worker/tokens.js'
import { EVM_CHAIN_ID as EXECUTOR_IDS } from './swap-executor'
import { EVM_SWAP_CHAINS } from '../shared/swap-token-identity'

/**
 * The EVM chain set is written out in four places — the Worker's quote router
 * and token discovery, the wallet's identity core, and the executor. They
 * drifted: the network expansion updated two of them and left discovery and the
 * identity core at the original 8, so /tokens returned nothing for Robinhood and
 * the wallet rejected every Robinhood address as malformed. This fails if any
 * copy gains or loses a chain, or maps one to a different numeric id.
 */
describe('one EVM chain set, four copies', () => {
  const executor = Object.keys(EXECUTOR_IDS).sort()

  it('discovery (tokens.js) matches the executor, ids included', () => {
    expect(Object.keys(WORKER_TOKEN_IDS).sort()).toEqual(executor)
    for (const c of executor) expect(WORKER_TOKEN_IDS[c], c).toBe(EXECUTOR_IDS[c])
  })

  it('quote routing (swap-proxy.js) matches the executor, ids included', () => {
    expect(Object.keys(WORKER_QUOTE_IDS).sort()).toEqual(executor)
    for (const c of executor) expect(WORKER_QUOTE_IDS[c], c).toBe(EXECUTOR_IDS[c])
  })

  it('the identity core accepts exactly those chains', () => {
    expect([...EVM_SWAP_CHAINS].sort()).toEqual(executor)
  })
})
