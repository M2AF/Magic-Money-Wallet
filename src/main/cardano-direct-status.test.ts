/**
 * Status of a Danogo pool swap: it settles IN its own transaction, so once
 * Cardano has it the swap is complete, and the delivered amount is measured
 * from the wallet's own net change. Blockfrost is mocked; the values mirror the
 * recorded 2 USDCx -> ADA and 20 ADA -> USDCx builds (__fixtures__/minswap).
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const bf = vi.hoisted(() => ({ handler: null as null | ((path: string) => { status: number; body?: unknown }) }))
vi.mock('./api-proxy', async (orig) => ({
  ...(await orig<typeof import('./api-proxy')>()),
  blockfrostFetch: vi.fn(async (path: string) => {
    const r = bf.handler!(path)
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status })
  }),
}))

import { getCrossSwapStatus } from './swap-proxy'
import { encodeCardanoAddress } from './cardano-tx-inspect'
import { MINSWAP_AGGREGATOR_FEE_KEY_HASH } from './cardano-swap-validate'
import { CARDANO_LOVELACE } from '../shared/swap-token-identity'
import type { WalletConfig } from './secure-store'

const FIX = join(__dirname, '__fixtures__', 'minswap')
const POOL_ADDR = (JSON.parse(readFileSync(join(FIX, 'usdcx-ada-danogo-2.json'), 'utf8')) as { poolInput: { address: string } }).poolInput.address
const WALLET = 'addr1q8008tnk6x22qh7xl38znc5p6c52hp8wtfrxaq0yrer9az8fahsvrvjs2nte6d95crak93gphy32u868qqtx3s4r5dxqxpj8mk'
const AGG = encodeCardanoAddress(Uint8Array.from([0x61, ...Buffer.from(MINSWAP_AGGREGATOR_FEE_KEY_HASH, 'hex')]))
const USDCX = '1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378'
const TX = 'cd'.repeat(32)
const config = { network: 'mainnet' } as unknown as WalletConfig
const amt = (a: Record<string, string>) => Object.entries(a).map(([unit, quantity]) => ({ unit, quantity }))

function chain(utxos: unknown, fees = '484774', meta: Record<string, unknown> = {}) {
  bf.handler = (path) => {
    if (path === `txs/${TX}/utxos`) return utxos === null ? { status: 404, body: { error: 'Not Found' } } : { status: 200, body: utxos }
    if (path === `txs/${TX}`) return { status: 200, body: { hash: TX, block_height: 123, valid_contract: true, fees, ...meta } }
    return { status: 404, body: {} }
  }
}

const status = (to: string, min: string) => getCrossSwapStatus({
  provider: 'minswap', txHash: TX, fromChain: 'cardano', toChain: 'cardano',
  expectedToTokenAddress: to, recipient: WALLET, minBuyAmountRaw: min,
}, config)

describe('Danogo direct swap status', () => {
  it('not on Cardano yet: submitted, not a verdict', async () => {
    chain(null)
    const s = await status(CARDANO_LOVELACE, '7450965')
    expect(s.state).toBe('source-submitted')
  })

  it('ADA bought: completed, delivered = net ADA + network fee + aggregator fee (the pool payout)', async () => {
    chain({
      inputs: [
        { address: WALLET, amount: amt({ lovelace: '2000000', [USDCX]: '4196650' }), tx_hash: 'a5'.repeat(32), output_index: 2 },
        { address: POOL_ADDR, amount: amt({ lovelace: '363882238442', [USDCX]: '59052644695' }), tx_hash: '52'.repeat(32), output_index: 0 },
      ],
      outputs: [
        { address: POOL_ADDR, amount: amt({ lovelace: '363874787477', [USDCX]: '59054644695' }), output_index: 0 },
        { address: AGG, amount: amt({ lovelace: '850000' }), output_index: 1 },
        { address: WALLET, amount: amt({ lovelace: '8116191', [USDCX]: '2196650' }), output_index: 2 },
      ],
    })
    const s = await status(CARDANO_LOVELACE, '7450965')
    expect(s.state).toBe('completed')
    expect(s.delivered?.amountRaw).toBe('7450965')
    expect(s.destTxHash).toBe(TX)
  })

  it('token bought: completed, delivered = the wallet\'s net token change', async () => {
    chain({
      inputs: [
        { address: WALLET, amount: amt({ lovelace: '259907060' }), tx_hash: 'a5'.repeat(32), output_index: 1 },
        { address: POOL_ADDR, amount: amt({ lovelace: '921133499', [USDCX]: '1851683169' }), tx_hash: '64'.repeat(32), output_index: 0 },
      ],
      outputs: [
        { address: POOL_ADDR, amount: amt({ lovelace: '941233499', [USDCX]: '1846384603' }), output_index: 0 },
        { address: AGG, amount: amt({ lovelace: '850000' }), output_index: 1 },
        { address: WALLET, amount: amt({ lovelace: '238479331', [USDCX]: '5298566' }), output_index: 2 },
      ],
    }, '477729')
    const s = await status(USDCX, '5298566')
    expect(s.state).toBe('completed')
    expect(s.delivered?.amountRaw).toBe('5298566')
  })

  it('a pool transaction that delivers nothing to the wallet is not reported as complete', async () => {
    chain({
      inputs: [{ address: WALLET, amount: amt({ lovelace: '259907060' }), tx_hash: 'a5'.repeat(32), output_index: 1 }],
      outputs: [{ address: POOL_ADDR, amount: amt({ lovelace: '941233499', [USDCX]: '1846384603' }), output_index: 0 }],
    }, '477729')
    const s = await status(USDCX, '5298566')
    expect(s.state).not.toBe('completed')
  })

  it('a phase-2-failed transaction is failed even if the provider lists its unrealized outputs', async () => {
    chain({
      inputs: [{ address: WALLET, amount: amt({ lovelace: '259907060' }), tx_hash: 'a5'.repeat(32), output_index: 1 }],
      outputs: [
        { address: POOL_ADDR, amount: amt({ lovelace: '941233499', [USDCX]: '1846384603' }), output_index: 0 },
        { address: WALLET, amount: amt({ lovelace: '238479331', [USDCX]: '5298566' }), output_index: 2 },
      ],
    }, '477729', { valid_contract: false })
    const s = await status(USDCX, '5298566')
    expect(s.state).toBe('failed')
    expect(s.providerSubstatus).toBe('SCRIPT_FAILED')
    expect(s.delivered).toBeUndefined()
  })

  it('missing or mismatched validity evidence remains unknown, not completed', async () => {
    const tx = {
      inputs: [{ address: WALLET, amount: amt({ lovelace: '259907060' }), tx_hash: 'a5'.repeat(32), output_index: 1 }],
      outputs: [
        { address: POOL_ADDR, amount: amt({ lovelace: '941233499', [USDCX]: '1846384603' }), output_index: 0 },
        { address: WALLET, amount: amt({ lovelace: '238479331', [USDCX]: '5298566' }), output_index: 2 },
      ],
    }
    chain(tx, '477729', { valid_contract: null })
    expect((await status(USDCX, '5298566')).state).toBe('unknown')
    chain(tx, '477729', { hash: 'ab'.repeat(32) })
    expect((await status(USDCX, '5298566')).state).toBe('unknown')
  })
})
