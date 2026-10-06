/**
 * journey-handler.ts — the router entry for journey discovery and the
 * read-only journey list, shared by Electron's ipc-handlers.ts and the
 * extension/native wallet-handlers.ts.
 *
 *   swap:journeyPlan  discover every route family for a pair (journey-providers.ts)
 *   journey:list      restore THIS wallet's persisted journeys (journey-store.ts)
 *   journey:recheck   re-read one journey's sent steps by their saved hashes
 *                     (journey-recheck.ts); never re-sends
 *   journey:cbadaReview     live terms of a Base -> Solana cbADA transfer for
 *                           THIS wallet (cbada-ccip-approval.ts); read-only
 *   journey:cbadaAuthorize  store a reviewed proposal's terms as a new journey's
 *                           immutable authorization; takes only the proposal id
 *   journey:cancel          stop this wallet's journey if nothing was sent
 *
 * Nothing here signs or sends. Writes go through the store's progress guard: a
 * recovered CCIP message id, a newly authorized journey, a cancelled unsent one. The renderer supplies tokens, amounts and
 * a journey id; addresses and the wallet identity are this wallet's own.
 */

import { isTestnet, activePublicRpcs, activeSolanaRpcs } from './chain-config'
import type { WalletConfig } from './secure-store'
import { getSwapQuote } from './swap-proxy'
import { prepareXReserveWithdrawal } from './xreserve-withdrawal-prepare'
import { prepareForwardedWithdrawal } from './xreserve-forwarded-prepare'
import { XRESERVE_MAINNET } from './xreserve-network'
import type { HttpFetchFn } from './xreserve-cardano-provider'
import { baseCcipReadsWithFallback } from './cbada-ccip'
import { planJourneys, type JourneyDeps } from './journey-providers'
import { journeyMapStore, restoreJourneys } from './journey-store'
import { recheckJourney, liveRecheckReads, type RecheckReads, type LegEvidence } from './journey-recheck'
import { solanaDeliveryReads } from './cbada-solana-delivery'
import { blockfrostFetch } from './api-proxy'
import { reviewCbAdaTransfer, authorizeCbAdaTransfer, cancelUnsentStoredJourney, type ApprovalWallet } from './cbada-ccip-approval'
import { evmReadClient } from './tx-sender'
import type { PublicClient } from 'viem'
import { buildSwapIdentity } from './swap-intent'
import { fetchMarketData } from './balance-fetcher'
import { isValidSwapAddress, normalizeSwapAddress } from '../shared/swap-token-identity'
import { journeyPairSupported, type JourneyPlanEnvelope, type JourneyListSummary, type CbAdaTermsReview } from '../shared/journey-candidate'

export const JOURNEY_CHANNELS = [
  'swap:journeyPlan', 'journey:list', 'journey:recheck', 'journey:cbadaReview', 'journey:cbadaAuthorize', 'journey:cancel',
] as const

export interface JourneyHost {
  loadConfig(): Promise<WalletConfig>
  loadAddresses(): Promise<{ cardano?: string; evm?: string; solana?: string } | null>
  loadJourneys(): Promise<Record<string, string>>
  saveJourneys(map: Record<string, string>): Promise<void>
  fetchFn?: HttpFetchFn
  /** Tests only. */
  deps?: JourneyDeps
  /** Tests only. */
  recheckReads?: RecheckReads
  /** Tests only. */
  baseClient?: PublicClient
}

/** The current wallet's identity: the same public-address fingerprint swap sessions use. */
async function currentWallet(host: JourneyHost) {
  const config = await host.loadConfig()
  const addresses = await host.loadAddresses()
  if (!addresses) return null
  const id = buildSwapIdentity(addresses as never, '', '', isTestnet(config))
  return { config, addresses, walletId: id.walletId, accountIndex: id.accountIndex }
}

type Envelope<T> = { ok: true; value: T } | { ok: false; message: string }
const failure = (e: unknown, fallbackMessage: string) => ({ ok: false as const, message: e instanceof Error ? e.message : fallbackMessage })

async function approvalWallet(host: JourneyHost): Promise<(ApprovalWallet & { config: WalletConfig }) | string> {
  const me = await currentWallet(host)
  if (!me) return 'No wallet is set up.'
  if (isTestnet(me.config)) return 'cbADA transfers are mainnet-only.'
  const { evm, solana } = me.addresses
  if (!evm || !solana) return 'This account has no Base or Solana address.'
  return { walletId: me.walletId, evm, solana, accountIndex: me.accountIndex, config: me.config }
}

function baseClient(host: JourneyHost, config: WalletConfig): PublicClient {
  if (host.baseClient) return host.baseClient
  const client = evmReadClient(8453, config)
  if (!client) throw new Error('Base is not available in this wallet.')
  return client
}

export async function handleCbAdaReview(arg: unknown, host: JourneyHost): Promise<Envelope<CbAdaTermsReview>> {
  try {
    const w = await approvalWallet(host)
    if (typeof w === 'string') return { ok: false, message: w }
    const amountRaw = obj(arg) ? arg.amountRaw : undefined
    return { ok: true, value: await reviewCbAdaTransfer(amountRaw, w, baseClient(host, w.config), Date.now()) }
  } catch (e) {
    return failure(e, 'The transfer terms could not be read.')
  }
}

export async function handleCbAdaAuthorize(arg: unknown, host: JourneyHost): Promise<Envelope<{ journeyId: string }>> {
  try {
    const w = await approvalWallet(host)
    if (typeof w === 'string') return { ok: false, message: w }
    // Only the proposal id crosses this boundary; every term is the reviewed one held here.
    const proposalId = obj(arg) ? arg.proposalId : undefined
    const store = journeyMapStore(() => host.loadJourneys(), (m) => host.saveJourneys(m))
    const j = await authorizeCbAdaTransfer(proposalId, w, store, Date.now())
    return { ok: true, value: { journeyId: j.id } }
  } catch (e) {
    return failure(e, 'The terms could not be saved.')
  }
}

export async function handleJourneyCancel(arg: unknown, host: JourneyHost): Promise<Envelope<{ journeyId: string }>> {
  try {
    const id = obj(arg) && typeof arg.journeyId === 'string' ? arg.journeyId : ''
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return { ok: false, message: 'Invalid journey.' }
    const me = await currentWallet(host)
    if (!me) return { ok: false, message: 'No wallet is set up.' }
    const store = journeyMapStore(() => host.loadJourneys(), (m) => host.saveJourneys(m))
    await cancelUnsentStoredJourney(id, me.walletId, store)
    return { ok: true, value: { journeyId: id } }
  } catch (e) {
    return failure(e, 'The journey could not be cancelled.')
  }
}

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const COINGECKO: Record<string, string> = { base: 'ethereum', ethereum: 'ethereum', solana: 'solana', cardano: 'cardano' }

function token(v: unknown, chain: string) {
  if (!obj(v) || typeof v.address !== 'string' || typeof v.symbol !== 'string' || v.symbol.length > 32
      || !Number.isInteger(v.decimals) || (v.decimals as number) < 0 || (v.decimals as number) > 30) return null
  if (!isValidSwapAddress(chain, v.address)) return null
  return { chain, address: normalizeSwapAddress(chain, v.address), symbol: v.symbol, decimals: v.decimals as number }
}

const addressFor = (a: { cardano?: string; evm?: string; solana?: string }, chain: string) =>
  chain === 'cardano' ? a.cardano : chain === 'solana' ? a.solana : a.evm

export async function handleJourneyPlan(arg: unknown, host: JourneyHost): Promise<JourneyPlanEnvelope> {
  try {
    const config = await host.loadConfig()
    if (isTestnet(config)) return { ok: false, message: 'Route discovery across networks is mainnet-only.' }
    if (!obj(arg) || typeof arg.fromChain !== 'string' || typeof arg.toChain !== 'string' || !journeyPairSupported(arg.fromChain, arg.toChain)) {
      return { ok: false, message: 'No route family serves this pair.' }
    }
    const from = token(arg.fromToken, arg.fromChain)
    const to = token(arg.toToken, arg.toChain)
    if (!from || !to) return { ok: false, message: 'Unsupported token.' }
    if (typeof arg.sellAmountRaw !== 'string' || !/^[1-9][0-9]{0,77}$/.test(arg.sellAmountRaw)) return { ok: false, message: 'Invalid amount.' }
    if (!Number.isInteger(arg.slippageBps) || (arg.slippageBps as number) <= 0 || (arg.slippageBps as number) >= 10_000) return { ok: false, message: 'Invalid slippage.' }
    const addresses = await host.loadAddresses()
    const sourceAddress = addresses && addressFor(addresses, arg.fromChain)
    const recipient = addresses && addressFor(addresses, arg.toChain)
    if (!sourceAddress || !recipient) return { ok: false, message: 'This account has no address on one of these networks.' }

    const prices = new Map<string, number | null>()
    const deps: JourneyDeps = host.deps ?? {
      quote: (req) => getSwapQuote(req, config),
      prepareEthereum: (input) => prepareXReserveWithdrawal(input, { network: XRESERVE_MAINNET, fetchFn: host.fetchFn }),
      prepareSolana: (input) => prepareForwardedWithdrawal(input, { fetchFn: host.fetchFn }),
      ccip: baseCcipReadsWithFallback(activePublicRpcs(config).base ?? []),
      async nativeUsd(chain) {
        const id = COINGECKO[chain]
        if (!id) return null
        if (!prices.has(id)) {
          try { const m = await fetchMarketData([id], config); prices.set(id, m[id]?.price > 0 ? m[id].price : null) } catch { prices.set(id, null) }
        }
        return prices.get(id) ?? null
      },
    }
    const value = await planJourneys({
      source: from as never, sellAmountRaw: arg.sellAmountRaw, destination: to as never,
      sourceAddress, recipient, slippageBps: arg.slippageBps as number,
    }, deps)
    return { ok: true, value }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Routes could not be discovered.' }
  }
}

export async function handleJourneyList(host: JourneyHost): Promise<{ ok: true; value: JourneyListSummary } | { ok: false; message: string }> {
  try {
    const me = await currentWallet(host)
    if (!me) return { ok: false, message: 'No wallet is set up.' }
    const restored = await restoreJourneys(journeyMapStore(() => host.loadJourneys(), (m) => host.saveJourneys(m)))
    const mine = restored.active.filter(j => j.walletId === me.walletId)
    const myIds = new Set(mine.map(j => j.id))
    return { ok: true, value: {
      active: mine.map(j => ({ id: j.id, bridge: j.bridge, createdAt: j.createdAt,
        legs: j.legs.map(l => ({ role: l.role, chain: l.chain, state: l.state, txHash: l.txHash, providerRef: l.providerRef, approvalTxHash: l.approvalTxHash,
          approvedInputRaw: l.approvedInputRaw, inputSymbol: l.input.symbol, outputSymbol: l.output.symbol })),
        authorization: j.authorization,
        cancellable: j.legs.every(l => !l.txHash && !l.approvalTxHash) })),
      awaitingEvidence: restored.awaitingEvidence.filter(a => myIds.has(a.journeyId)).length,
      finished: restored.finished.filter(j => j.walletId === me.walletId).length,
      otherWallets: restored.active.length - mine.length,
      unreadable: restored.unreadable,
    } }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Journeys could not be read.' }
  }
}

export async function handleJourneyRecheck(arg: unknown, host: JourneyHost): Promise<{ ok: true; value: { journeyId: string; legs: LegEvidence[] } } | { ok: false; message: string }> {
  try {
    const id = obj(arg) && typeof arg.journeyId === 'string' ? arg.journeyId : ''
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return { ok: false, message: 'Invalid journey.' }
    const me = await currentWallet(host)
    if (!me) return { ok: false, message: 'No wallet is set up.' }
    const store = journeyMapStore(() => host.loadJourneys(), (m) => host.saveJourneys(m))
    const journey = await store.get(id)
    // Another wallet's journey is not this wallet's to read.
    if (!journey || journey.walletId !== me.walletId) return { ok: false, message: 'This journey does not belong to the current wallet.' }
    const fetchFn = (host.fetchFn ?? fetch) as typeof fetch
    const reads = host.recheckReads ?? liveRecheckReads(
      activePublicRpcs(me.config), activeSolanaRpcs(me.config),
      (path) => blockfrostFetch(path, me.config, 12_000),
      solanaDeliveryReads(activeSolanaRpcs(me.config), fetchFn), fetchFn,
    )
    const r = await recheckJourney(journey, store, reads, { evm: me.addresses.evm }, Date.now())
    return { ok: true, value: { journeyId: id, legs: r.legs } }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'The journey could not be checked.' }
  }
}

export async function handleJourney(channel: string, arg: unknown, host: JourneyHost): Promise<unknown> {
  if (channel === 'swap:journeyPlan') return handleJourneyPlan(arg, host)
  if (channel === 'journey:list') return handleJourneyList(host)
  if (channel === 'journey:recheck') return handleJourneyRecheck(arg, host)
  if (channel === 'journey:cbadaReview') return handleCbAdaReview(arg, host)
  if (channel === 'journey:cbadaAuthorize') return handleCbAdaAuthorize(arg, host)
  if (channel === 'journey:cancel') return handleJourneyCancel(arg, host)
  return { ok: false, message: 'Unknown journey request.' }
}
