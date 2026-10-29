/**
 * chained-swap-handler.ts — router entry for multi-hop swaps, shared by
 * Electron's ipc-handlers.ts and the extension/native wallet-handlers.ts.
 *
 *   swap:chainQuote    plan the hops and their minimums (read-only)
 *   swap:chainStart    record the approved plan and run its first hop
 *   swap:chainAdvance  move a swap forward (status poll; idempotent)
 *   swap:chainList     this wallet's multi-hop swaps
 *
 * Addresses and the wallet identity are this wallet's own; the renderer supplies
 * tokens, the amount and slippage only. Approval is the plan the wallet itself
 * produced: chainStart refuses a plan id it did not issue, or one that expired.
 */

import type { WalletConfig } from './secure-store'
import { isTestnet } from './chain-config'
import { getSwapQuote, getCrossSwapStatus, estimateCardanoSwap, type NormalizedSwapQuote, type SwapQuoteRequest } from './swap-proxy'
import { bindSwapIntent, buildSwapIdentity, type SwapIdentityAddresses } from './swap-intent'
import { executeBoundSwap } from './swap-executor'
import { listSessions } from './swap-sessions'
import { measureDelivery } from './swap-delivery'
import { evmReadClient } from './tx-sender'
import {
  planChainedSwap, createChainedSwap, advanceChainedSwap, chainedSwapStore, ChainedSwapLocked, ChainedSwapError,
  type ChainedSwapDeps, type ChainedPlan, type ChainedSwap, type ChainHop,
} from './chained-swap'

export const CHAINED_SWAP_CHANNELS = ['swap:chainQuote', 'swap:chainStart', 'swap:chainAdvance', 'swap:chainList'] as const

export interface ChainedSwapHost {
  loadConfig(): Promise<WalletConfig>
  loadAddresses(): Promise<(SwapIdentityAddresses & { cardano?: string }) | null>
  loadMnemonic(): Promise<string>
  loadChainedSwaps(): Promise<Record<string, string>>
  saveChainedSwaps(map: Record<string, string>): Promise<void>
}

const EVM_CHAIN_IDS: Record<string, number> = {
  ethereum: 1, base: 8453, arbitrum: 42161, optimism: 10, monad: 143, polygon: 137, avalanche: 43114,
  robinhood: 4663, abstract: 2741, gnosis: 100,
}
/** ADA kept for a Cardano order when its quote states no cost (fees + the 2 ADA deposit, generously). */
const CARDANO_RESERVE_FALLBACK = 5_000_000n
/** Network reads (quote, fee, status) are bounded; a hung read must not hold a swap's lock. Execution is not. */
const READ_TIMEOUT_MS = 60_000
function bounded<T>(p: Promise<T>, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined
  return Promise.race([p, new Promise<never>((_, reject) => { t = setTimeout(() => reject(new ChainedSwapError(`${what} timed out`)), READ_TIMEOUT_MS) })])
    .finally(() => clearTimeout(t))
}
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const randomId = () => { const b = new Uint8Array(12); globalThis.crypto.getRandomValues(b); return 'chain-' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('') }

/** Plans this process issued, briefly, so a start can only approve the plan the wallet produced. */
const PLANS = new Map<string, { plan: ChainedPlan; walletId: string; expiresAt: number }>()
const PLAN_TTL_MS = 90_000
/** Bound quotes between bind and execute (same step; never persisted). */
const BOUND = new Map<string, NormalizedSwapQuote>()

async function depsFor(host: ChainedSwapHost) {
  const config = await host.loadConfig()
  const addresses = await host.loadAddresses()
  if (!addresses?.cardano || !addresses.solana || !addresses.evm) throw new ChainedSwapError('This account has no address on one of these networks.')
  const testnet = isTestnet(config)
  if (testnet) throw new ChainedSwapError('Multi-step swaps are mainnet-only.')
  const identity = (from: string, to: string) => buildSwapIdentity(addresses as SwapIdentityAddresses, from, to, testnet)
  const store = chainedSwapStore(() => host.loadChainedSwaps(), (m) => host.saveChainedSwaps(m))
  const own = { cardano: addresses.cardano, solana: addresses.solana, evm: addresses.evm }
  const addressFor = (chain: string) => chain === 'cardano' ? own.cardano : chain === 'solana' ? own.solana : own.evm

  async function feeReserveFor(chain: string, quote: NormalizedSwapQuote): Promise<bigint> {
    if (chain === 'cardano') {
      // What the order costs in ADA on top of the sale, read from its own transaction.
      const c = quote.cardanoCost
      const over = c && /^[0-9]+$/.test(c.adaSpentLovelace) ? BigInt(c.adaSpentLovelace) - BigInt(quote.sellAmountRaw) : null
      return over != null && over > 0n ? over + 300_000n : CARDANO_RESERVE_FALLBACK
    }
    // A NEAR deposit is a plain transfer: a Solana transfer fee, or an EVM transfer's gas.
    if (quote.provider === 'near-intents' && chain === 'solana') return 1_000_000n
    if (chain === 'solana') {
      const cost = quote.solanaCost?.costLamports
      return cost && /^[0-9]+$/.test(cost) ? BigInt(cost) * 2n + 10_000n : 10_000_000n
    }
    const chainId = EVM_CHAIN_IDS[chain]
    const client = chainId ? evmReadClient(chainId, config) : null
    const fees = client ? await client.estimateFeesPerGas().catch(() => null) : null
    if (!fees?.maxFeePerGas) throw new ChainedSwapError(`The ${chain} gas price could not be read.`)
    const gas = quote.provider === 'near-intents' ? 100_000n
      : quote.estimatedGasRaw && /^[1-9][0-9]*$/.test(quote.estimatedGasRaw) ? BigInt(quote.estimatedGasRaw) : 300_000n
    return gas * fees.maxFeePerGas * 2n
  }

  const deps: ChainedSwapDeps = {
    quote: (req) => bounded(getSwapQuote(req, config), 'The quote'),
    estimateCardano: (req) => bounded(estimateCardanoSwap(req), 'The Cardano estimate'),
    addresses: own,
    feeReserve: (chain, quote) => bounded(feeReserveFor(chain, quote), 'Reading the network fee'),
    bind(req: SwapQuoteRequest, quote: NormalizedSwapQuote) {
      const bound = bindSwapIntent(req, quote, identity(req.fromChain, req.toChain))
      BOUND.set(bound.intentId as string, bound)
      return bound.intentId as string
    },
    async execute(intentId) {
      const bound = BOUND.get(intentId)
      BOUND.delete(intentId)
      if (!bound) throw new ChainedSwapError('The approved step is no longer held; it will be quoted again.')
      let mnemonic: string
      try { mnemonic = await host.loadMnemonic() } catch { throw new ChainedSwapLocked() }
      if (!mnemonic) throw new ChainedSwapLocked()
      const r = await executeBoundSwap(bound, mnemonic, config, addresses as SwapIdentityAddresses, testnet)
      return { txHash: r.txHash, requestId: r.requestId ?? null }
    },
    status: (hop: ChainHop) => bounded((async () => {
      const recipient = addressFor(hop.toChain)
      if (hop.kind === 'dest-dex' || hop.kind === 'src-dex') {
        // Same-chain on the destination: measure the credit in the swap transaction itself.
        const m = await measureDelivery({ toChain: hop.toChain, destTxHash: hop.txHash as string, recipient, tokenAddress: hop.toToken }, config)
        if (m && BigInt(m.amountRaw) >= BigInt(hop.approvedMinOutRaw)) return { state: 'completed', deliveredRaw: m.amountRaw, message: null }
        if (m) return { state: 'partial', deliveredRaw: m.amountRaw, message: 'The last step delivered less than its approved minimum.' }
        return { state: 'bridging', deliveredRaw: null, message: 'Waiting for the last step to confirm.' }
      }
      const s = await getCrossSwapStatus({
        provider: hop.provider as never, txHash: hop.txHash as string, fromChain: hop.fromChain, toChain: hop.toChain,
        requestId: hop.requestId, expectedToTokenAddress: hop.toToken, recipient, minBuyAmountRaw: hop.approvedMinOutRaw,
      }, config)
      // Measured on chain; except a native EVM payout, which leaves no Transfer
      // event — there the provider figure is used, as on single swaps. If it
      // overstated, the next hop's own transaction fails (no funds are at risk).
      const nativeEvm = hop.kind === 'near-intents' && hop.toChain !== 'solana' && /^0xe{40}$/i.test(hop.toToken)
      const measured = s.deliveredAmountSource === 'onchain' || hop.kind === 'cardano-dex' || (nativeEvm && s.state === 'completed')
        ? s.delivered?.amountRaw ?? null : null
      return { state: s.state ?? 'unknown', deliveredRaw: measured, message: s.message ?? null }
    })(), 'Checking the step'),
    async sentFor(intentId) {
      // Sessions are found by identity, whose addresses depend only on the address
      // family (every EVM chain shares one): try every family pair.
      const families = ['cardano', 'solana', 'ethereum'] as const
      for (const [from, to] of families.flatMap(f => families.map(t => [f, t] as const))) {
        const list = await listSessions(identity(from, to))
        const s = list.find(x => x.id === intentId)
        if (s) return { txHash: s.sourceTxHash ?? null, requestId: s.providerRequestId ?? null }
      }
      return null
    },
    store,
    now: () => Date.now(),
    newId: randomId,
  }
  return { deps, config, identity, store }
}

const fail = (e: unknown, fallback: string) => ({ ok: false as const, message: e instanceof Error ? e.message : fallback })

export async function handleChainedSwap(channel: string, arg: unknown, host: ChainedSwapHost): Promise<unknown> {
  try {
    const { deps, identity, store } = await depsFor(host)
    const walletId = identity('cardano', 'cardano').walletId

    if (channel === 'swap:chainQuote') {
      if (!obj(arg)) return { ok: false, message: 'Invalid request.' }
      const plan = await planChainedSwap({
        fromChain: typeof arg.fromChain === 'string' && arg.fromChain ? arg.fromChain : 'cardano',
        fromToken: String(arg.fromToken), fromSymbol: String(arg.fromSymbol), fromDecimals: Number(arg.fromDecimals),
        toChain: String(arg.toChain), toToken: String(arg.toToken), toSymbol: String(arg.toSymbol), toDecimals: Number(arg.toDecimals),
        sellAmountRaw: String(arg.sellAmountRaw), slippageBps: Number(arg.slippageBps) || 100,
      }, deps)
      const planId = randomId()
      for (const [k, p] of PLANS) if (p.expiresAt < Date.now()) PLANS.delete(k)
      PLANS.set(planId, { plan, walletId, expiresAt: Math.min(plan.expiresAt, Date.now() + PLAN_TTL_MS) })
      return { ok: true, value: { planId, hops: plan.hops, routes: plan.routes, finalMinRaw: plan.finalMinRaw, finalExpectedRaw: plan.finalExpectedRaw, expiresAt: plan.expiresAt } }
    }

    if (channel === 'swap:chainStart') {
      const planId = obj(arg) && typeof arg.planId === 'string' ? arg.planId : ''
      const held = PLANS.get(planId)
      PLANS.delete(planId)
      if (!held || held.walletId !== walletId) return { ok: false, message: 'This plan expired or was already used. Get a fresh quote.' }
      if (held.expiresAt < Date.now()) return { ok: false, message: 'This plan expired. Get a fresh quote.' }
      const c = await createChainedSwap(held.plan, { walletId, accountIndex: identity('cardano', 'cardano').accountIndex }, deps)
      return { ok: true, value: await advanceChainedSwap(c.id, deps) }
    }

    if (channel === 'swap:chainAdvance') {
      const id = obj(arg) && typeof arg.id === 'string' ? arg.id : ''
      const existing = await store.get(id)
      if (!existing || existing.walletId !== walletId) return { ok: false, message: 'This swap does not belong to the current wallet.' }
      return { ok: true, value: await advanceChainedSwap(id, deps, { acceptNewMinimum: obj(arg) && arg.acceptNewMinimum === true, stop: obj(arg) && arg.stop === true }) }
    }

    if (channel === 'swap:chainList') {
      const all: ChainedSwap[] = await store.list()
      return { ok: true, value: all.filter(c => c.walletId === walletId).sort((a, b) => b.createdAt - a.createdAt) }
    }
    return { ok: false, message: 'Unknown request.' }
  } catch (e) {
    return fail(e, 'The swap could not be planned.')
  }
}
