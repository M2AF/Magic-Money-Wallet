/**
 * xreserve-testnet-handlers.ts — the one router entry for the Testnet Mode
 * xReserve Sepolia → Preprod test, shared by Electron's ipc-handlers.ts and the
 * extension/native wallet-handlers.ts so the two cannot drift.
 *
 * Every call returns a JSON-safe envelope — `{ ok: true, value }` or
 * `{ ok: false, code, message, submitted }` — because Electron IPC keeps only
 * an error's message and the extension bridge carries JSON only; the panel
 * needs the typed code. Addresses, keys and the signing seed come from the
 * privileged layer's own stores, never from the renderer's arguments.
 */

import { buildSwapIdentity, type SwapIdentityAddresses } from './swap-intent'
import { isTestnet } from './chain-config'
import type { WalletConfig } from './secure-store'
import {
  getTestnetDepositState, prepareTestnetDeposit, approveTestnetDeposit, checkTestnetApproval, depositTestnet,
  recoverTestnetDeposits, dismissCorruptPendingSend,
  checkTestnetDeposit, validatePreprodKey, validateCardanoSource, defaultTestnetOps, mapTrackingStore, createTrackingWriteQueue, TestnetDepositError,
  type TestnetContext, type TestnetOps,
} from './xreserve-testnet-deposit'
import type { InboundReads } from './xreserve-inbound-status'
import type { HttpFetchFn } from './xreserve-cardano-provider'

export const XRESERVE_TESTNET_CHANNELS = [
  'xreserve:testnet-state',
  'xreserve:testnet-set-key',
  'xreserve:testnet-set-source',
  'xreserve:testnet-prepare',
  'xreserve:testnet-approve',
  'xreserve:testnet-approval-status',
  'xreserve:testnet-deposit',
  'xreserve:testnet-check',
  'xreserve:testnet-recover',
  'xreserve:testnet-dismiss-corrupt',
] as const
export type XReserveTestnetChannel = typeof XRESERVE_TESTNET_CHANNELS[number]

import type { XReserveTestnetEnvelope } from '../shared/xreserve-testnet-wire'
export type { XReserveTestnetEnvelope }

/** What each router supplies from its own platform store. */
export interface XReserveTestnetHost {
  loadConfig(): Promise<WalletConfig>
  saveConfig(patch: Partial<WalletConfig>): Promise<void>
  /** The account's EFFECTIVE addresses (Testnet Mode substitutes addr_test…). */
  loadAddresses(): Promise<(SwapIdentityAddresses & { cardano?: string }) | null>
  /** The unlocked seed; only asked for when a transaction will be signed. */
  loadMnemonic(): Promise<string>
  loadTracking(): Promise<Record<string, string>>
  saveTracking(map: Record<string, string>): Promise<void>
  /**
   * The platform's fetch for status and Koios reads. Electron main passes
   * Chromium's `net.fetch` (Node's fetch can hang there; see swap-proxy.ts);
   * the extension and the native WebViews use the global fetch.
   */
  fetchFn?: HttpFetchFn
  /** Tests only: chain operations and status reads in place of the network. */
  ops?: (config: WalletConfig, mnemonic: string | null, accountIndex: number, fetchFn?: HttpFetchFn) => TestnetOps
  reads?: InboundReads
}

/**
 * ONE queue for every tracking write in this process. Each router call builds
 * its own store object, but they all read-modify-write the same persisted map
 * (one platform store per process: Electron main, the extension service worker,
 * or the native WebView), so the queue must outlive any single call.
 */
const TRACKING_WRITES = createTrackingWriteQueue()

async function context(host: XReserveTestnetHost, signing: boolean): Promise<TestnetContext> {
  const config = await host.loadConfig()
  const addresses = await host.loadAddresses()
  if (!addresses) throw new TestnetDepositError('no-wallet', 'No wallet is set up.')
  const identity = buildSwapIdentity(addresses, '', '', isTestnet(config))
  const store = mapTrackingStore(() => host.loadTracking(), (m) => host.saveTracking(m), TRACKING_WRITES)
  return {
    config,
    wallet: {
      walletId: identity.walletId, accountIndex: identity.accountIndex,
      evmAddress: addresses.evm, cardanoAddress: addresses.cardano,
    },
    ops: (host.ops ?? defaultTestnetOps)(config, signing ? await host.loadMnemonic() : null, identity.accountIndex, host.fetchFn),
    store,
    listStored: store.list,
    fetchFn: host.fetchFn,
  }
}

export async function handleXReserveTestnet(
  channel: string, arg: unknown, host: XReserveTestnetHost,
): Promise<XReserveTestnetEnvelope> {
  try {
    switch (channel as XReserveTestnetChannel) {
      case 'xreserve:testnet-state':
        return { ok: true, value: await getTestnetDepositState(await context(host, false)) }

      case 'xreserve:testnet-set-key': {
        const config = await host.loadConfig()
        if (!isTestnet(config)) throw new TestnetDepositError('not-testnet', 'The Preprod key is only used in Testnet Mode.')
        await host.saveConfig({ blockfrostPreprodKey: validatePreprodKey((arg as { key?: unknown } | null)?.key) })
        return { ok: true, value: true }
      }

      case 'xreserve:testnet-set-source': {
        const config = await host.loadConfig()
        if (!isTestnet(config)) throw new TestnetDepositError('not-testnet', 'The Cardano Preprod source is only used in Testnet Mode.')
        await host.saveConfig({ xreservePreprodSource: validateCardanoSource((arg as { source?: unknown } | null)?.source) })
        return { ok: true, value: true }
      }

      case 'xreserve:testnet-prepare': {
        const a = (arg ?? {}) as { amount?: unknown; maxFee?: unknown }
        return { ok: true, value: await prepareTestnetDeposit({ amount: a.amount, maxFee: a.maxFee }, await context(host, false)) }
      }

      // Action 1: the exact-amount approval only. Never sends a deposit.
      case 'xreserve:testnet-approve':
        return { ok: true, value: await approveTestnetDeposit((arg as { intentId?: unknown } | null)?.intentId, await context(host, true)) }

      // Read-only: the approval's confirmation, and the terms again once confirmed.
      case 'xreserve:testnet-approval-status':
        return { ok: true, value: await checkTestnetApproval((arg as { intentId?: unknown } | null)?.intentId, await context(host, false)) }

      // Action 2: the deposit, with the terms the user just confirmed.
      case 'xreserve:testnet-deposit': {
        const a = (arg ?? {}) as { intentId?: unknown; expected?: unknown }
        return { ok: true, value: await depositTestnet({ intentId: a.intentId, expected: a.expected }, await context(host, true)) }
      }

      case 'xreserve:testnet-check': {
        const a = (arg ?? {}) as { sourceTxHash?: unknown; auditDue?: unknown }
        return { ok: true, value: await checkTestnetDeposit({ sourceTxHash: a.sourceTxHash, auditDue: a.auditDue }, await context(host, false), host.reads) }
      }

      // Read-only on Sepolia; may start tracking or clear resolved records. Never sends.
      case 'xreserve:testnet-recover':
        return { ok: true, value: await recoverTestnetDeposits(await context(host, false)) }

      case 'xreserve:testnet-dismiss-corrupt':
        return { ok: true, value: await dismissCorruptPendingSend((arg as { key?: unknown } | null)?.key, await context(host, false)) }

      default:
        return { ok: false, code: 'unknown-channel', message: 'Unknown xReserve testnet request.', submitted: [] }
    }
  } catch (e) {
    if (e instanceof TestnetDepositError) return { ok: false, code: e.code, message: e.message, submitted: [...e.submitted] }
    return { ok: false, code: 'error', message: e instanceof Error ? e.message : 'Unexpected error.', submitted: [] }
  }
}
