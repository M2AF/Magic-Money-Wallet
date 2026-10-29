import { app, safeStorage } from 'electron'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { Connection } from '@solana/web3.js'
import { mnemonicToEntropy } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { AgentNativeCore, validateNativeLedger, type NativePort } from './agent-native-core'
import { solanaNativeAdapter } from './agent-native-solana'
import { cardanoNativeAdapter } from './agent-native-cardano'
import { NATIVE_NETWORKS, type NativeTransaction } from '../shared/agent-native'
import { loadConfig, loadMnemonic } from './secure-store'
import { heliusRpcUrl } from './api-proxy'
import { getSolanaKeypair } from './wallet-core'
import { deriveCardanoAddress } from './cardano-pure'
import { readJsonObjectFile, writeJsonObjectFileAtomic } from './atomic-json-map-file'

export function createNativeExecution(port: Pick<NativePort, 'owner' | 'authorize' | 'audit' | 'x402Enabled' | 'pendingProposals'>) {
  const directory = join(app.getPath('userData'), 'agent-access'), path = join(directory, 'native-execution.enc.json')
  const secure = () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
  const adapter = (tx: NativeTransaction) => NATIVE_NETWORKS[tx.network].chain === 'solana'
    ? solanaNativeAdapter(new Connection(tx.network.includes('EtWTR') ? 'https://api.devnet.solana.com' : heliusRpcUrl(loadConfig()), { commitment: 'confirmed', fetch: (input, init) => globalThis.fetch(input, init) }), loadMnemonic, Date.now, () => engine.assertSigningAuthority(tx))
    : cardanoNativeAdapter(loadMnemonic, Date.now, fetch, () => engine.assertSigningAuthority(tx))
  const engine = new AgentNativeCore({ ...port,
    async address(index, network) {
      return NATIVE_NETWORKS[network].chain === 'solana' ? (await getSolanaKeypair(loadMnemonic(), index)).publicKey.toBase58()
        : deriveCardanoAddress(mnemonicToEntropy(loadMnemonic(), wordlist), index, network === 'cardano:preprod')
    },
    load() {
      if (!secure()) throw new Error('OS secure storage is required for native agent execution.')
      if (!fs.existsSync(path)) return { version: 1, nextIndex: 1000, policies: [], transactions: [], limits: [] }
      const raw = readJsonObjectFile(fs, path)
      if (raw.version !== 1 || typeof raw.sealed !== 'string') throw new Error('Invalid native journal. Preserve it for recovery.')
      let parsed: unknown
      try { parsed = JSON.parse(safeStorage.decryptString(Buffer.from(raw.sealed, 'base64'))) } catch { throw new Error('Cannot authenticate native journal. It was left untouched.') }
      validateNativeLedger(parsed); return parsed
    },
    save(state) {
      if (!secure()) throw new Error('OS secure storage unavailable. Native execution blocked.')
      writeJsonObjectFileAtomic(fs, directory, path, { version: 1, sealed: safeStorage.encryptString(JSON.stringify(state)).toString('base64') })
    },
    build(tx, locked) { const a = adapter(tx); return a.build(tx, locked) },
    check(tx) { return adapter(tx).check(tx) },
    sign(tx) { return adapter(tx).sign(tx) },
    broadcast(tx, raw) { return adapter(tx).broadcast(tx, raw) },
    receipt(tx) { return adapter(tx).receipt(tx) },
  })
  return engine
}
