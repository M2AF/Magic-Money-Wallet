/**
 * midnight-send.ts — NIGHT (unshielded) send + native DUST registration.
 * Supports both `mainnet` and `preprod` (see MidnightNetwork below) — all
 * live-fund verification (2026-07-21) was done against Preprod; Mainnet uses
 * the identical code path with different endpoints/networkId, unverified
 * with real funds as of this writing.
 *
 * ELECTRON MAIN ONLY for now (same doctrine as monero.ts/midnight-ledger.ts —
 * WASM-heavy, per-target porting is a later phase). Wired into ipc-handlers.ts
 * (wallet:get-midnight-dust-status / register-midnight-dust / send-midnight)
 * and SendModal's 'registering' step — extension/Capacitor simply omit the
 * WalletBridge methods (see wallet.ts's optional-method convention), so the
 * Send button never renders there. Network is never a manual choice: it's
 * derived from Testnet/Privacy Mode (midnightNetworkFor in chain-config.ts).
 *
 * Uses the STABLE wallet-sdk line (1.2.0 + facade/unshielded-wallet/dust-wallet/
 * prover-client + ledger-v8), NOT the 2.0.0-beta.2/ledger-v9 line — that beta
 * emits a v12 tx format live Preprod/Mainnet indexers don't accept. ledger-v8
 * was verified (2026-07-20) to derive byte-for-byte identical keys/addresses
 * to ledger-v9 from the same wallet-sdk-hd role keys, so the existing
 * Lace-verified receive-address derivation (midnight.ts) is untouched.
 *
 * Local proving ONLY: makeWasmProvingService({keyMaterialProvider}) is passed
 * explicitly into WalletFacade.init — the default is a REMOTE proof server
 * (DefaultProvingConfiguration = ServerProvingConfiguration in
 * wallet-sdk-capabilities), which would leak witness data. Never omit this.
 *
 * DUST first-sync cost: the DUST wallet walks a NETWORK-WIDE merkle tree (not
 * scoped to our address) — 2026-07-20 measurement: default batchUpdates
 * (size:10/spacing:4) sustains ~185 events/s; {size:200,spacing:0} sustains
 * ~600 events/s (~3.3x) with no correctness or memory difference observed.
 * At that rate Mainnet's ~144k events ≈ 4 minutes, Preprod's ~1.3M ≈ 36
 * minutes (desktop; unverified on constrained mobile hardware — real device
 * numbers are the actual gate for shipping this to Mainnet, per the 1.0
 * roadmap). There is no checkpoint/start-index API — a fresh wallet always
 * walks from zero. `restoreDustState`/`onDustStateSerialized` below exist so
 * a multi-minute (or, unoptimized, multi-hour) sync survives an app restart
 * instead of restarting from scratch — inventing our own tree-skip logic
 * instead would risk building invalid witnesses; only use the SDK's own
 * serializeState()/restore().
 *
 * ⚠ serializeState() is ONLY safe to call once caught up to the tip
 * (appliedIndex >= highestRelevantWalletIndex). Verified 2026-07-21: a
 * checkpoint captured mid-backlog (blind interval, no catch-up gate) could
 * not be read back by either the direct ledger.DustLocalState.deserialize()
 * or a full DustWallet.restore() — both failed with "out of range for u64".
 * A controlled test — same wallet, fully caught up, 60s idle, single
 * serializeState() call — round-tripped cleanly on both paths. The persist
 * timer below gates on that condition; don't remove the gate.
 */

import { deriveMidnightRoleKeys } from './midnight-crypto'
import type { KeyMaterialProvider } from './midnight-proving-keys'

export type MidnightNetwork = 'mainnet' | 'preprod'

const NETWORKS: Record<MidnightNetwork, { indexerHttp: string; indexerWs: string; nodeRpc: string; networkId: MidnightNetwork }> = {
  mainnet: {
    indexerHttp: 'https://indexer.mainnet.midnight.network/api/v4/graphql',
    indexerWs: 'wss://indexer.mainnet.midnight.network/api/v4/graphql/ws',
    nodeRpc: 'https://rpc.mainnet.midnight.network',
    networkId: 'mainnet',
  },
  preprod: {
    indexerHttp: 'https://indexer.preprod.midnight.network/api/v4/graphql',
    indexerWs: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    nodeRpc: 'https://rpc.preprod.midnight.network',
    networkId: 'preprod',
  },
}

// Measured 2026-07-20 as the sweet spot — size:1000 was only marginally
// faster than size:200 (diminishing returns), and a smaller batch keeps peak
// memory/main-thread pauses lower for constrained targets (Android WebView).
//
// spacing:1 (was 0) — 2026-08-04. spacing:0 never yields, so the ~36-minute
// Preprod backlog above saturated the Electron main process and the whole app
// stopped responding: the Send NIGHT progress bar froze, approval windows would
// not paint, and users restarted the app — which, because serializeState() only
// checkpoints once caught up (see the warning above), threw away every event
// synced so far and restarted from zero. An unusable loop.
//
// The cost of yielding is arithmetic, not a guess: one yield per 200-event
// batch over ~1.3M events is ~6,500 yields. At ~1ms each that is ~6.5 seconds
// added to a ~36-minute sync — under 0.5% — in exchange for a UI that keeps
// running throughout. Do not set this back to 0.
//
// This is mitigation, not the fix. The sync still runs on the main process;
// moving it to a utilityProcess is the real answer.
const DUST_BATCH_UPDATES = { size: 200, spacing: 1 }
// How often to snapshot dust sync progress to disk via serializeState().
const PERSIST_INTERVAL_MS = 15_000

export interface DustSyncProgress {
  appliedIndex: number
  highestRelevantWalletIndex: number
  isConnected: boolean
}

export interface OpenMidnightSendWalletOptions {
  /** Previously persisted DustWallet.serializeState() output, if any. */
  restoreDustState?: string
  /** Fired periodically (every PERSIST_INTERVAL_MS) with a fresh serialized snapshot. */
  onDustStateSerialized?: (serialized: string) => void
  /** Fired on every dust sync state tick — drive a "Preparing transaction fees — X%" UI from this. */
  onDustProgress?: (progress: DustSyncProgress) => void
  /**
   * Integrity-checked proving keys. Injected because the byte source differs
   * per target (Electron reads disk, extension/Android fetch a packaged asset)
   * and this module must stay node-free to run in all three. Never swap in the
   * SDK's default provider — it fetches from a dev S3 bucket, and its REMOTE
   * proving path would leak witness data (see the header note).
   */
  keyMaterialProvider: KeyMaterialProvider
}

export interface MidnightSendHandle {
  network: MidnightNetwork
  facade: import('@midnightntwrk/wallet-sdk-facade').WalletFacade
  unshieldedWallet: import('@midnightntwrk/wallet-sdk-unshielded-wallet').UnshieldedWallet
  dustWallet: import('@midnightntwrk/wallet-sdk-dust-wallet').DustWallet
  unshieldedAddress: string
  ledger: typeof import('@midnight-ntwrk/ledger-v8')
  dustSecretKey: import('@midnight-ntwrk/ledger-v8').DustSecretKey
  shieldedSecretKeys: import('@midnight-ntwrk/ledger-v8').ZswapSecretKeys
  nightVerifyingKey: import('@midnight-ntwrk/ledger-v8').SignatureVerifyingKey
  signNightSegment: (data: Uint8Array) => import('@midnight-ntwrk/ledger-v8').Signature
  /** Resolves once BOTH unshielded and dust are synced (not just the facade). */
  waitForSendReady: () => Promise<void>
  stopDustPersistence: () => void
}

/**
 * Builds a WalletFacade against the given Midnight network for the given raw
 * BIP-39 seed. Starts unshielded (fast) and dust (slow — see file doc)
 * syncing but does NOT block on dust sync completing; call waitForSendReady()
 * when the caller actually needs to send/register (mirrors the "show NIGHT
 * balance now, fees syncing in background" product design).
 */
export async function openMidnightSendWallet(
  seed: Uint8Array,
  accountIndex: number,
  network: MidnightNetwork,
  options: OpenMidnightSendWalletOptions
): Promise<MidnightSendHandle> {
  const net = NETWORKS[network]
  const hdMod = await import(/* @vite-ignore */ '@midnight-ntwrk/wallet-sdk-hd')
  const keys = deriveMidnightRoleKeys(hdMod, seed, accountIndex)
  if (!keys) throw new Error('Midnight HD key derivation out of bounds')

  const ledger = await import(/* @vite-ignore */ '@midnight-ntwrk/ledger-v8')
  const { WalletFacade } = await import(/* @vite-ignore */ '@midnightntwrk/wallet-sdk-facade')
  const { UnshieldedWallet, createKeystore, PublicKey } = await import(/* @vite-ignore */ '@midnightntwrk/wallet-sdk-unshielded-wallet')
  const { DustWallet } = await import(/* @vite-ignore */ '@midnightntwrk/wallet-sdk-dust-wallet')
  const { ShieldedWallet } = await import(/* @vite-ignore */ '@midnightntwrk/wallet-sdk-shielded')
  const { InMemoryTransactionHistoryStorage } = await import(/* @vite-ignore */ '@midnightntwrk/wallet-sdk-abstractions')
  const { WalletEntrySchema, mergeWalletEntries } = await import(/* @vite-ignore */ '@midnightntwrk/wallet-sdk-facade')
  const addrFmt = await import(/* @vite-ignore */ '@midnightntwrk/wallet-sdk-address-format')
  const provingCaps = await import(/* @vite-ignore */ '@midnightntwrk/wallet-sdk-capabilities/proving')

  // TotalCostParameters: wallet-side fee-safety margin (the report observed
  // the SDK's own default 5-block margin on live Preprod/Mainnet).
  const costParameters = { feeBlocksMargin: 5 }
  const newTxHistory = () => new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries)

  const indexerClientConnection = {
    indexerHttpUrl: net.indexerHttp,
    indexerWsUrl: net.indexerWs,
  }

  const unshieldedKeystore = createKeystore(keys.nightKey, net.networkId)
  const unshieldedPublicKey = PublicKey.fromKeyStore(unshieldedKeystore)
  const nightVerifyingKey = unshieldedKeystore.getPublicKey()

  const unshieldedConfig = { networkId: net.networkId, indexerClientConnection, costParameters, txHistoryStorage: newTxHistory() }
  const unshieldedWallet = UnshieldedWallet(unshieldedConfig).startWithPublicKey(unshieldedPublicKey)
  await unshieldedWallet.start()

  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys.dustKey)
  // dustParameters come from the chain's live ledger parameters, not a
  // hardcoded constant (they can change on a network upgrade).
  const paramsRes = await fetch(net.indexerHttp, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{ block { ledgerParameters } }' }),
  })
  const paramsJson = await paramsRes.json() as { data?: { block?: { ledgerParameters?: string } } }
  const rawParamsHex = paramsJson.data?.block?.ledgerParameters
  if (!rawParamsHex) throw new Error(`Could not fetch live ledger parameters from the ${network} indexer`)
  const rawParams = Buffer.from(rawParamsHex, 'hex')
  const dustParameters = ledger.LedgerParameters.deserialize(rawParams).dust

  const dustConfig = {
    networkId: net.networkId,
    indexerClientConnection,
    costParameters,
    txHistoryStorage: newTxHistory(),
    // Not on DustWallet's public .d.ts, but DustWallet() forwards the whole
    // configuration object into makeDefaultSyncService() at runtime (see
    // v1/V1Builder.js) — measured effective 2026-07-20.
    batchUpdates: DUST_BATCH_UPDATES,
  }
  const dustWallet = options.restoreDustState
    ? DustWallet(dustConfig).restore(options.restoreDustState)
    : DustWallet(dustConfig).startWithSecretKey(dustSecretKey, dustParameters)
  await dustWallet.start(dustSecretKey)

  // Only ever serializeState() when caught up to the tip (appliedIndex >=
  // highestRelevantWalletIndex). Measured 2026-07-21: checkpoints captured
  // WHILE actively processing a large batched backlog produce a state that
  // ledger.DustLocalState.deserialize() cannot read back ("out of range for
  // u64") on either the direct WASM call or the full DustWallet.restore()
  // path — a controlled quiescent-only test (same wallet, same code) round
  // tripped cleanly. This is a real correctness requirement, not caution.
  let caughtUp = false
  let persistTimer: ReturnType<typeof setInterval> | null = null
  const dustSub = dustWallet.state.subscribe((state) => {
    const { appliedIndex, highestRelevantWalletIndex, isConnected } = state.state.progress
    caughtUp = isConnected && appliedIndex >= highestRelevantWalletIndex
    options.onDustProgress?.({
      appliedIndex: Number(appliedIndex),
      highestRelevantWalletIndex: Number(highestRelevantWalletIndex),
      isConnected,
    })
  })
  if (options.onDustStateSerialized) {
    persistTimer = setInterval(() => {
      if (!caughtUp) return
      dustWallet.serializeState().then(options.onDustStateSerialized).catch(() => { /* best-effort */ })
    }, PERSIST_INTERVAL_MS)
  }
  const stopDustPersistence = () => {
    dustSub.unsubscribe()
    if (persistTimer) clearInterval(persistTimer)
  }

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys.zswapKey)
  const shieldedConfig = {
    networkId: net.networkId,
    provingServerUrl: new URL('http://127.0.0.1:6300'), // unused: WASM proving overrides this
    relayURL: new URL(net.nodeRpc.replace(/^http/, 'ws')),
    indexerClientConnection,
    costParameters,
    txHistoryStorage: newTxHistory(),
  }
  const shieldedWallet = ShieldedWallet(shieldedConfig).startWithSecretKeys(shieldedSecretKeys)
  await shieldedWallet.start(shieldedSecretKeys)

  const provingService = () => provingCaps.makeWasmProvingService({ keyMaterialProvider: options.keyMaterialProvider })
  const relayURL = new URL(net.nodeRpc.replace(/^http/, 'ws'))

  const facadeConfiguration = {
    networkId: net.networkId,
    indexerClientConnection,
    costParameters,
    txHistoryStorage: newTxHistory(),
    provingServerUrl: new URL('http://127.0.0.1:6300'), // unused: provingService overrides this
    relayURL,
  }

  const facade = await WalletFacade.init({
    configuration: facadeConfiguration,
    shielded: () => shieldedWallet,
    unshielded: () => unshieldedWallet,
    dust: () => dustWallet,
    provingService,
  })
  await facade.start(shieldedSecretKeys, dustSecretKey)

  const unshieldedAddressInstance = new addrFmt.UnshieldedAddress(Buffer.from(ledger.addressFromKey(nightVerifyingKey), 'hex'))
  const unshieldedAddress = addrFmt.UnshieldedAddress.codec.encode(net.networkId, unshieldedAddressInstance).asString()

  return {
    network,
    facade,
    unshieldedWallet,
    dustWallet,
    unshieldedAddress,
    ledger,
    dustSecretKey,
    shieldedSecretKeys,
    nightVerifyingKey,
    signNightSegment: (data: Uint8Array) => unshieldedKeystore.signData(data),
    // Not facade.waitForSyncedState() — that also blocks on the shielded
    // sub-wallet, which is required by WalletFacade.init but unused here.
    waitForSendReady: () => Promise.all([unshieldedWallet.waitForSyncedState(), dustWallet.waitForSyncedState()]).then(() => undefined),
    stopDustPersistence,
  }
}

type UnprovenTransactionRecipe = Awaited<ReturnType<import('@midnightntwrk/wallet-sdk-facade').WalletFacade['registerNightUtxosForDustGeneration']>>

/**
 * Sanity check before submission: every guaranteed/fallible unshielded offer
 * must have exactly as many signatures as inputs. Catches double-signing
 * (or any other signature-count bug) locally instead of learning about it
 * from an opaque on-chain rejection — see the 2026-07-21 incident below.
 */
function assertOffersFullySigned(recipe: UnprovenTransactionRecipe): void {
  if (recipe.type !== 'UNPROVEN_TRANSACTION') return
  for (const intent of recipe.transaction.intents?.values() ?? []) {
    for (const offer of [intent.guaranteedUnshieldedOffer, intent.fallibleUnshieldedOffer]) {
      if (!offer) continue
      if (offer.inputs.length !== offer.signatures.length) {
        throw new Error(`Unshielded offer signature mismatch: ${offer.inputs.length} inputs, ${offer.signatures.length} signatures (expected equal)`)
      }
    }
  }
}

/**
 * Waits for the wallet's OWN synced state to observe the submitted NIGHT
 * UTXOs as registered — submitTransaction() resolving only means the RPC
 * accepted the extrinsic for broadcast, not that it landed. Tracks by VALUE
 * conservation, not UTXO identity: registerNightUtxosForDustGeneration()
 * registers via rotateUtxos (spends the input UTXO, creates a new one with
 * the SAME value but a DIFFERENT intentHash/outputNo) — matching on the
 * original intentHash never resolves. Checks totalCoins (not
 * availableCoins): the UTXOs are booked out of available while the
 * registration is in flight.
 */
async function waitForRegistrationObserved(
  handle: MidnightSendHandle,
  nightUtxos: readonly { utxo: { value: bigint } }[],
  timeoutMs: number
): Promise<void> {
  const submittedValue = nightUtxos.reduce((sum, u) => sum + u.utxo.value, 0n)
  const registeredValue = (coins: readonly { utxo: { value: bigint }; meta: { registeredForDustGeneration: boolean } }[]) =>
    coins.filter((c) => c.meta.registeredForDustGeneration).reduce((sum, c) => sum + c.utxo.value, 0n)
  const baseline = registeredValue((await handle.unshieldedWallet.waitForSyncedState()).totalCoins)

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.unsubscribe()
      reject(new Error('Timed out waiting for the indexer/wallet to observe the DUST registration'))
    }, timeoutMs)
    const sub = handle.unshieldedWallet.state.subscribe((state) => {
      if (registeredValue(state.totalCoins) >= baseline + submittedValue) {
        clearTimeout(timer)
        sub.unsubscribe()
        resolve()
      }
    })
  })
}

/**
 * Registers every currently-unregistered NIGHT UTXO for DUST generation
 * (pays for its own fee out of any DUST already accrued —
 * waitForGeneratedDust blocks until that's true), waits for the wallet to
 * observe the registration land, then returns the tx id.
 *
 * ⚠ registerNightUtxosForDustGeneration() SIGNS INTERNALLY (see
 * createDustActionTransaction's "Step 5" in wallet-sdk-facade's source: it
 * calls this.signRecipe(...) itself using the signDustRegistration callback
 * passed in below) — do NOT call facade.signRecipe() again on its result.
 * 2026-07-21 incident: an earlier version of this function did call
 * signRecipe() a second time, appending a second set of signatures onto
 * offers that were already fully signed. The chain rejected it with
 * `1010: Invalid Transaction: Custom error: 192` — InputsSignaturesLengthMismatch
 * per Midnight's node source (more signatures than inputs). Root-caused by
 * Codex from https://github.com/midnightntwrk/midnight-node (types.rs) and
 * https://github.com/midnightntwrk/midnight-wallet (facade/src/index.ts).
 */
export async function registerForDustGeneration(handle: MidnightSendHandle): Promise<string> {
  const unshieldedState = await handle.unshieldedWallet.waitForSyncedState()
  const nightUtxos = unshieldedState.availableCoins.filter((u) => !u.meta.registeredForDustGeneration)
  if (nightUtxos.length === 0) throw new Error('No unregistered NIGHT UTXOs to register for DUST generation')

  const { fee } = await handle.facade.estimateRegistration(nightUtxos)
  await handle.facade.waitForGeneratedDust(nightUtxos, fee, { timeoutMs: 5 * 60_000 })

  const signedRecipe = await handle.facade.registerNightUtxosForDustGeneration(
    nightUtxos,
    handle.nightVerifyingKey,
    handle.signNightSegment,
  )
  assertOffersFullySigned(signedRecipe)

  const finalized = await handle.facade.finalizeRecipe(signedRecipe)
  const txId = await handle.facade.submitTransaction(finalized)
  // Log before the confirmation wait, not after -- if the wait times out
  // (indexer lag, not necessarily a failure) the tx id would otherwise be
  // lost since it's only returned on the success path below.
  console.error(`[midnight-send] registration submitted, tx id: ${txId}`)
  await waitForRegistrationObserved(handle, nightUtxos, 5 * 60_000)
  return txId
}

/**
 * Sends `amountStars` of native NIGHT (1 NIGHT = 1e6 Stars) to a
 * `toAddress` on the SAME network as `handle` (mn_addr1... for mainnet,
 * mn_addr_preprod1... for preprod — decode fails closed on a mismatch, since
 * MidnightBech32m.decode checks the network segment). Requires DUST to
 * already be generated (call registerForDustGeneration + wait first) —
 * payFees:true has the facade pull from the synced dust wallet automatically.
 */
export async function sendNight(handle: MidnightSendHandle, toAddress: string, amountStars: bigint): Promise<string> {
  const addrFmt = await import(/* @vite-ignore */ '@midnightntwrk/wallet-sdk-address-format')
  const parsed = addrFmt.MidnightBech32m.parse(toAddress)
  const receiverAddress = addrFmt.UnshieldedAddress.codec.decode(NETWORKS[handle.network].networkId, parsed)

  const recipe = await handle.facade.transferTransaction(
    [{
      type: 'unshielded',
      outputs: [{ type: handle.ledger.nativeToken().raw, receiverAddress, amount: amountStars }],
    }],
    { shieldedSecretKeys: handle.shieldedSecretKeys, dustSecretKey: handle.dustSecretKey },
    { ttl: new Date(Date.now() + 30 * 60_000), payFees: true },
  )
  const signed = await handle.facade.signRecipe(recipe, handle.signNightSegment)
  const finalized = await handle.facade.finalizeRecipe(signed)
  return handle.facade.submitTransaction(finalized)
}
