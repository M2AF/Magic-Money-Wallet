/**
 * midnight-send.ts — NIGHT (unshielded) send + native DUST registration, Preprod only.
 *
 * ELECTRON MAIN ONLY for now (same doctrine as monero.ts/midnight-ledger.ts —
 * WASM-heavy, per-target porting is a later phase). Not yet wired into
 * wallet-handlers.ts or any UI; this is the validated core, exercised against
 * a real funded Preprod test wallet before it's trusted with anything else.
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
 */

import { deriveMidnightRoleKeys } from './midnight-crypto'

const PREPROD_INDEXER_HTTP = 'https://indexer.preprod.midnight.network/api/v4/graphql'
const PREPROD_INDEXER_WS = 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws'
const PREPROD_NODE_RPC = 'https://rpc.preprod.midnight.network'
const NETWORK_ID = 'preprod'
const STARS = 1e6

export interface MidnightSendHandle {
  facade: import('@midnightntwrk/wallet-sdk-facade').WalletFacade
  unshieldedAddress: string
  ledger: typeof import('@midnight-ntwrk/ledger-v8')
}

/**
 * Builds and starts a WalletFacade against Preprod for the given raw BIP-39
 * seed. Waits for the unshielded + dust wallets to sync before returning.
 */
export async function openMidnightSendWallet(seed: Uint8Array, accountIndex: number): Promise<MidnightSendHandle> {
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
  const wasmProverEffect = await import(/* @vite-ignore */ '@midnightntwrk/wallet-sdk-prover-client/effect')

  // TotalCostParameters: wallet-side fee-safety margin (the report observed
  // the SDK's own default 5-block margin on live Preprod/Mainnet).
  const costParameters = { feeBlocksMargin: 5 }
  const newTxHistory = () => new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries)

  const indexerClientConnection = {
    indexerHttpUrl: PREPROD_INDEXER_HTTP,
    indexerWsUrl: PREPROD_INDEXER_WS,
  }

  const unshieldedKeystore = createKeystore(keys.nightKey, NETWORK_ID)
  const unshieldedPublicKey = PublicKey.fromKeyStore(unshieldedKeystore)

  const unshieldedConfig = { networkId: NETWORK_ID, indexerClientConnection, costParameters, txHistoryStorage: newTxHistory() }
  const unshieldedWallet = UnshieldedWallet(unshieldedConfig).startWithPublicKey(unshieldedPublicKey)
  await unshieldedWallet.start()
  console.error('[midnight-send] unshielded .start() resolved')

  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys.dustKey)
  const dustConfig = { networkId: NETWORK_ID, indexerClientConnection, costParameters, txHistoryStorage: newTxHistory() }
  // dustParameters come from the chain's live ledger parameters, not a
  // hardcoded constant (they can change on a network upgrade).
  const paramsRes = await fetch(PREPROD_INDEXER_HTTP, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{ block { ledgerParameters } }' }),
  })
  const paramsJson = await paramsRes.json() as { data?: { block?: { ledgerParameters?: string } } }
  const rawParamsHex = paramsJson.data?.block?.ledgerParameters
  if (!rawParamsHex) throw new Error('Could not fetch live ledger parameters from the Preprod indexer')
  const rawParams = Buffer.from(rawParamsHex, 'hex')
  const dustParameters = ledger.LedgerParameters.deserialize(rawParams).dust

  const dustWallet = DustWallet(dustConfig).startWithSecretKey(dustSecretKey, dustParameters)
  await dustWallet.start(dustSecretKey)
  console.error('[midnight-send] dust .start() resolved')

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys.zswapKey)
  const shieldedConfig = {
    networkId: NETWORK_ID,
    provingServerUrl: new URL('http://127.0.0.1:6300'), // unused: WASM proving overrides this
    relayURL: new URL(PREPROD_NODE_RPC.replace(/^http/, 'ws')),
    indexerClientConnection,
    costParameters,
    txHistoryStorage: newTxHistory(),
  }
  const shieldedWallet = ShieldedWallet(shieldedConfig).startWithSecretKeys(shieldedSecretKeys)
  await shieldedWallet.start(shieldedSecretKeys)
  console.error('[midnight-send] shielded .start() resolved')

  const keyMaterialProvider = wasmProverEffect.WasmProver.makeDefaultKeyMaterialProvider()
  const provingService = () => provingCaps.makeWasmProvingService({ keyMaterialProvider })
  const relayURL = new URL(PREPROD_NODE_RPC.replace(/^http/, 'ws'))

  const facadeConfiguration = {
    networkId: NETWORK_ID,
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
  console.error('[midnight-send] facade.init() resolved')
  await facade.start(shieldedSecretKeys, dustSecretKey)
  console.error('[midnight-send] facade.start() resolved')
  // Wait on unshielded + dust directly, not facade.waitForSyncedState() (which
  // also blocks on the shielded sub-wallet — unused for an unshielded-only
  // NIGHT send, and not something we've validated syncs correctly yet).
  await Promise.all([unshieldedWallet.waitForSyncedState(), dustWallet.waitForSyncedState()])
  console.error('[midnight-send] unshielded + dust synced')

  const unshieldedAddressInstance = new addrFmt.UnshieldedAddress(Buffer.from(ledger.addressFromKey(unshieldedKeystore.getPublicKey()), 'hex'))
  const unshieldedAddress = addrFmt.UnshieldedAddress.codec.encode(NETWORK_ID, unshieldedAddressInstance).asString()

  return { facade, unshieldedAddress, ledger }
}
