/**
 * stablecoin-route-handler.ts — the one router entry for the read-only
 * stablecoin route preview (`swap:stablecoinPlan`), shared by Electron's
 * ipc-handlers.ts and the extension/native wallet-handlers.ts.
 *
 * Read-only: it quotes the swap legs through the existing quote path and
 * reports the bridge's capability. It never signs, stores or submits anything,
 * and the plan is always `executable: false`. The renderer supplies only the
 * tokens, amount and slippage; the Cardano depositor and the destination
 * recipient are this wallet's OWN addresses from the privileged store.
 *
 * No bridge fee ceiling is supplied: Circle publishes no withdrawal fee
 * schedule, and choosing one is a product decision not yet made. So the bridge
 * leg reports `needs-fee-cap` and Circle is not called; both swap legs are
 * still discovered.
 */

import { isTestnet } from './chain-config'
import type { WalletConfig } from './secure-store'
import { getSwapQuote } from './swap-proxy'
import { prepareXReserveWithdrawal } from './xreserve-withdrawal-prepare'
import { prepareForwardedWithdrawal } from './xreserve-forwarded-prepare'
import { XRESERVE_MAINNET } from './xreserve-network'
import type { HttpFetchFn } from './xreserve-cardano-provider'
import { planStablecoinRoute, type StablecoinRouteDeps } from './stablecoin-route-plan'
import { isValidSwapAddress, normalizeSwapAddress } from '../shared/swap-token-identity'
import type { StablecoinPlanRequest, StablecoinPlanEnvelope } from '../shared/stablecoin-route'
export type { StablecoinPlanRequest, StablecoinPlanEnvelope }

export const STABLECOIN_PLAN_CHANNEL = 'swap:stablecoinPlan'

export interface StablecoinPlanHost {
  loadConfig(): Promise<WalletConfig>
  loadAddresses(): Promise<{ cardano?: string; evm?: string; solana?: string } | null>
  fetchFn?: HttpFetchFn
  /** Tests only. */
  deps?: StablecoinRouteDeps
}

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function token(v: unknown, chain: string): StablecoinPlanRequest['fromToken'] | null {
  if (!obj(v) || typeof v.address !== 'string' || typeof v.symbol !== 'string' || v.symbol.length > 32
      || !Number.isInteger(v.decimals) || (v.decimals as number) < 0 || (v.decimals as number) > 30) return null
  if (!isValidSwapAddress(chain, v.address)) return null
  return { address: normalizeSwapAddress(chain, v.address), symbol: v.symbol, decimals: v.decimals as number }
}

export async function handleStablecoinPlan(arg: unknown, host: StablecoinPlanHost): Promise<StablecoinPlanEnvelope> {
  try {
    const config = await host.loadConfig()
    if (isTestnet(config)) return { ok: false, message: 'The stablecoin route is mainnet-only.' }
    if (!obj(arg) || (arg.toChain !== 'ethereum' && arg.toChain !== 'solana')) return { ok: false, message: 'Unsupported destination.' }
    const from = token(arg.fromToken, 'cardano')
    const to = token(arg.toToken, arg.toChain)
    if (!from || !to) return { ok: false, message: 'Unsupported token.' }
    if (typeof arg.sellAmountRaw !== 'string' || !/^[1-9][0-9]{0,77}$/.test(arg.sellAmountRaw)) return { ok: false, message: 'Invalid amount.' }
    if (!Number.isInteger(arg.slippageBps) || (arg.slippageBps as number) <= 0 || (arg.slippageBps as number) >= 10_000) {
      return { ok: false, message: 'Invalid slippage.' }
    }
    const addresses = await host.loadAddresses()
    const recipient = arg.toChain === 'ethereum' ? addresses?.evm : addresses?.solana
    if (!addresses?.cardano || !recipient) return { ok: false, message: 'This account has no address on one of these networks.' }

    const deps: StablecoinRouteDeps = host.deps ?? {
      quote: (req) => getSwapQuote(req, config),
      prepareEthereum: (input) => prepareXReserveWithdrawal(input, { network: XRESERVE_MAINNET, fetchFn: host.fetchFn }),
      prepareSolana: (input) => prepareForwardedWithdrawal(input, { fetchFn: host.fetchFn }),
    }
    const plan = await planStablecoinRoute({
      source: from, sellAmountRaw: arg.sellAmountRaw,
      destination: { chain: arg.toChain, token: to, recipient },
      cardanoAddress: addresses.cardano, slippageBps: arg.slippageBps as number,
    }, deps)
    return { ok: true, value: plan }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'The route could not be planned.' }
  }
}
