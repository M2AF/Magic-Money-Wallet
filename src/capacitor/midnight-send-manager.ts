/**
 * midnight-send-manager.ts — BROWSER Midnight send manager.
 *
 * Mirrors src/main/midnight-send-manager.ts (Electron) and runs in the two
 * browser contexts that can host WASM for a long-lived job:
 *   - the extension's OFFSCREEN document (the MV3 service worker can neither
 *     import() a bare package nor run WASM codegen, and dies after ~30s idle —
 *     the SW side proxies here, see extension/midnight-send-manager.ts)
 *   - the Android WebView (wallet-local.ts calls the shared handler in-process)
 * Selected by the vite `./midnight-send-manager` alias, exactly like the
 * midnight-ledger seam.
 *
 * Differences from the Electron manager, and only these:
 *   - proving keys come from packaged assets over fetch, not disk (same
 *     size + SHA-256 gate — see midnight-proving-keys-web.ts)
 *   - the DUST checkpoint lives in IndexedDB, not a file. NOT chrome.storage:
 *     that caps at 10 MB without the `unlimitedStorage` permission, and a
 *     serialized DUST state is an unbounded merkle snapshot.
 *
 * The API is async here (the extension proxy has to cross a message boundary),
 * whereas Electron's getMidnightDustStatus is sync. Callers await either way.
 */

import * as bip39 from '@scure/bip39'
import { normalizeMnemonic } from '../main/wallet-core'
import { makeWebKeyMaterialProvider } from './midnight-proving-keys-web'
import {
  openMidnightSendWallet,
  registerForDustGeneration,
  sendNight,
  type MidnightSendHandle,
  type MidnightNetwork,
  type DustSyncProgress,
} from '../main/midnight-send'

// ── DUST checkpoint persistence (IndexedDB) ──────────────────────────────────
// A fresh DUST wallet walks the network-wide merkle tree from zero (minutes),
// so surviving a restart matters even more here than on desktop: an offscreen
// document can be torn down, and Android can kill the WebView at any time.

const DB_NAME = 'mm-midnight'
const STORE = 'dust-checkpoints'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

async function loadCheckpoint(key: string): Promise<string | undefined> {
  try {
    const db = await openDb()
    return await new Promise<string | undefined>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : undefined)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return undefined   // a missing checkpoint only costs a re-sync
  }
}

async function saveCheckpoint(key: string, serialized: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(serialized, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch { /* best-effort: losing a checkpoint only costs a re-sync */ }
}

// ── Manager (mirrors the Electron one) ───────────────────────────────────────

interface ManagerState {
  key: string
  handlePromise: Promise<MidnightSendHandle>
  progress: DustSyncProgress | null
  error: string | null
}

let current: ManagerState | null = null

export function resetMidnightSendManager(): void {
  if (!current) return
  const closing = current
  current = null
  closing.handlePromise.then(h => h.stopDustPersistence()).catch(() => { /* never opened */ })
}

function keyFor(accountIndex: number, network: MidnightNetwork): string {
  return `${accountIndex}:${network}`
}

function getOrOpen(mnemonic: string, accountIndex: number, network: MidnightNetwork): ManagerState {
  const key = keyFor(accountIndex, network)
  if (current?.key === key) return current

  resetMidnightSendManager()
  const state: ManagerState = { key, progress: null, error: null, handlePromise: null as unknown as Promise<MidnightSendHandle> }
  current = state

  state.handlePromise = (async () => {
    const seed = await bip39.mnemonicToSeed(normalizeMnemonic(mnemonic))
    const restoreDustState = await loadCheckpoint(key)
    return openMidnightSendWallet(seed, accountIndex, network, {
      keyMaterialProvider: makeWebKeyMaterialProvider(),
      restoreDustState,
      onDustProgress: (p) => { if (current === state) state.progress = p },
      onDustStateSerialized: (serialized) => { void saveCheckpoint(key, serialized) },
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

/** Kicks off (or reuses) background sync and reports progress. Non-blocking. */
export async function getMidnightDustStatus(
  mnemonic: string, accountIndex: number, network: MidnightNetwork
): Promise<MidnightDustStatus> {
  const state = getOrOpen(mnemonic, accountIndex, network)
  const p = state.progress
  if (!p) return { ready: false, percent: 0, isConnected: false, error: state.error }
  const percent = p.highestRelevantWalletIndex > 0 ? Math.min(100, (100 * p.appliedIndex) / p.highestRelevantWalletIndex) : 0
  const ready = p.isConnected && p.appliedIndex >= p.highestRelevantWalletIndex && p.highestRelevantWalletIndex > 0
  return { ready, percent, isConnected: p.isConnected, error: state.error }
}

/** Registers unregistered NIGHT UTXOs for DUST generation. Waits for sync. */
export async function registerMidnightDustIfNeeded(
  mnemonic: string, accountIndex: number, network: MidnightNetwork
): Promise<{ registered: boolean; txId: string | null }> {
  const state = getOrOpen(mnemonic, accountIndex, network)
  const handle = await state.handlePromise
  await handle.waitForSendReady()

  const unshieldedState = await handle.unshieldedWallet.waitForSyncedState()
  const needsRegistration = unshieldedState.availableCoins.some(u => !u.meta.registeredForDustGeneration)
  if (!needsRegistration) return { registered: false, txId: null }

  const txId = await registerForDustGeneration(handle)
  return { registered: true, txId }
}

/** Sends NIGHT. Assumes registration + DUST readiness were already ensured. */
export async function sendMidnightNight(
  mnemonic: string, accountIndex: number, network: MidnightNetwork,
  toAddress: string, amountStars: bigint
): Promise<string> {
  const state = getOrOpen(mnemonic, accountIndex, network)
  const handle = await state.handlePromise
  return sendNight(handle, toAddress, amountStars)
}
