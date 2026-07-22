/**
 * midnight-ledger.ts — EXTENSION (service worker) loader: proxies the whole
 * Midnight derivation (HD role keys + ledger-v9 address crypto) to the offscreen
 * document, where the ESM/WASM packages can actually load — the SW can neither
 * import() a bare package nor run WASM codegen. Aliased over
 * src/main/midnight-ledger.ts by vite.extension.config.ts.
 *
 * The seed travels hex-encoded (Chrome messages are JSON). It stays inside the
 * extension trust zone (same origin/CSP as the popup that can already reveal it).
 */

import { callOffscreen } from './offscreen-rpc'
import type { MidnightAddresses } from '../main/midnight'

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

export async function deriveWithLedger(
  seed: Uint8Array,
  accountIndex: number,
  network: 'mainnet' | 'preprod' = 'mainnet'
): Promise<MidnightAddresses> {
  return callOffscreen<MidnightAddresses>('mn:derive', { seed: hex(seed), accountIndex, network })
}
