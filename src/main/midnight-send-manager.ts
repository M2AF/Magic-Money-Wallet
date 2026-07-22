/**
 * midnight-send-manager.ts — main-process singleton owning the live
 * MidnightSendHandle (facade + unshielded + dust wallets) for NIGHT sends.
 *
 * Electron main only (see midnight-send.ts's own doctrine). Lazily opens on
 * first use, keyed by account+network — only one handle open at a time.
 * Network has no manual switcher: it's derived from Testnet/Privacy Mode
 * (midnightNetworkFor in chain-config.ts), so switching either mode changes
 * the key; getOrOpen notices the mismatch and self-heals by tearing down the
 * old handle before opening the new one. Persists the DUST checkpoint to disk
 * (gated on caught-up inside midnight-send.ts) so a first sync survives an
 * app restart.
 */

import * as bip39 from '@scure/bip39'
import { normalizeMnemonic } from './wallet-core'
import { loadMidnightDustCheckpoint, saveMidnightDustCheckpoint } from './secure-store'
import {
  openMidnightSendWallet,
  registerForDustGeneration,
  sendNight,
  type MidnightSendHandle,
  type MidnightNetwork,
  type DustSyncProgress,
} from './midnight-send'

interface ManagerState {
  key: string
  handlePromise: Promise<MidnightSendHandle>
  progress: DustSyncProgress | null
  error: string | null
}

let current: ManagerState | null = null

/** Tears down the currently-open handle, if any. Safe to call when idle. */
export function resetMidnightSendManager(): void {
  if (!current) return
  const closing = current
  current = null
  closing.handlePromise.then((h) => h.stopDustPersistence()).catch(() => { /* never opened */ })
}

function keyFor(accountIndex: number, network: MidnightNetwork): string {
  return `${accountIndex}:${network}`
}

/** Opens (or reuses) the handle for this account+network. Does not block on sync. */
function getOrOpen(mnemonic: string, accountIndex: number, network: MidnightNetwork): ManagerState {
  const key = keyFor(accountIndex, network)
  if (current?.key === key) return current

  resetMidnightSendManager()
  const state: ManagerState = { key, progress: null, error: null, handlePromise: null as unknown as Promise<MidnightSendHandle> }
  current = state

  state.handlePromise = (async () => {
    const seed = await bip39.mnemonicToSeed(normalizeMnemonic(mnemonic))
    const restoreDustState = loadMidnightDustCheckpoint(accountIndex, network) ?? undefined
    return openMidnightSendWallet(seed, accountIndex, network, {
      restoreDustState,
      onDustProgress: (p) => { if (current === state) state.progress = p },
      onDustStateSerialized: (serialized) => saveMidnightDustCheckpoint(accountIndex, network, serialized),
    })
  })()
  state.handlePromise.catch((e) => { if (current === state) state.error = e instanceof Error ? e.message : String(e) })

  return state
}

export interface MidnightDustStatus {
  ready: boolean
  percent: number
  isConnected: boolean
  error: string | null
}

/**
 * Kicks off (or reuses) background sync and reports current progress —
 * non-blocking, meant to be polled by the renderer every second or two to
 * drive a "Preparing Midnight transaction fees — X%" indicator.
 */
export function getMidnightDustStatus(mnemonic: string, accountIndex: number, network: MidnightNetwork): MidnightDustStatus {
  const state = getOrOpen(mnemonic, accountIndex, network)
  const p = state.progress
  if (!p) return { ready: false, percent: 0, isConnected: false, error: state.error }
  const percent = p.highestRelevantWalletIndex > 0 ? Math.min(100, (100 * p.appliedIndex) / p.highestRelevantWalletIndex) : 0
  const ready = p.isConnected && p.appliedIndex >= p.highestRelevantWalletIndex && p.highestRelevantWalletIndex > 0
  return { ready, percent, isConnected: p.isConnected, error: state.error }
}

/**
 * Registers any unregistered NIGHT UTXOs for DUST generation, if needed.
 * Blocks until DUST sync is ready first. Safe to call even when everything
 * is already registered (no-op, returns registered: false).
 */
export async function registerMidnightDustIfNeeded(
  mnemonic: string,
  accountIndex: number,
  network: MidnightNetwork
): Promise<{ registered: boolean; txId: string | null }> {
  const state = getOrOpen(mnemonic, accountIndex, network)
  const handle = await state.handlePromise
  await handle.waitForSendReady()

  const unshieldedState = await handle.unshieldedWallet.waitForSyncedState()
  const needsRegistration = unshieldedState.availableCoins.some((u) => !u.meta.registeredForDustGeneration)
  if (!needsRegistration) return { registered: false, txId: null }

  const txId = await registerForDustGeneration(handle)
  return { registered: true, txId }
}

/**
 * Sends NIGHT. Assumes the caller already ensured registration+DUST are
 * ready (registerMidnightDustIfNeeded + waitForSendReady) — this does NOT
 * re-check, so the UI can show a distinct "sending" phase after "preparing
 * fees" without redundant waits.
 */
export async function sendMidnightNight(
  mnemonic: string,
  accountIndex: number,
  network: MidnightNetwork,
  toAddress: string,
  amountStars: bigint
): Promise<string> {
  const state = getOrOpen(mnemonic, accountIndex, network)
  const handle = await state.handlePromise
  return sendNight(handle, toAddress, amountStars)
}
