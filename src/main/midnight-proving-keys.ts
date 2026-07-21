/**
 * midnight-proving-keys.ts — local, SHA-256-pinned KeyMaterialProvider.
 *
 * @midnightntwrk/wallet-sdk-prover-client's makeDefaultKeyMaterialProvider()
 * fetches these same files LIVE from a hardcoded `-dev-` S3 bucket on every
 * cold start: no CORS headers (breaks in a browser/WebView), no integrity
 * manifest, and an in-memory-only cache (re-fetches on every app restart).
 * This is the vendored replacement: files ship in resources/midnight-keys/
 * (see manifest.json for provenance + hashes), verified against a pinned
 * SHA-256 before use, fails closed on any mismatch rather than silently
 * proving with untrusted bytes.
 *
 * Only the DUST spend circuit is bundled — sufficient for unshielded NIGHT
 * sends (the DUST fee spend is the only ZK proof such a transaction needs).
 * zswap/* (shielded) circuits are NOT bundled; this wallet does not
 * construct shielded transactions.
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const KEYS_DIR = join(__dirname, '..', '..', 'resources', 'midnight-keys')

const MANIFEST: Record<string, { bytes: number; sha256: string }> = {
  'dust-9-spend.prover': { bytes: 2175671, sha256: '996602da7ca386284e656c78ea03e55bffdba29475e6a67965c50de05e13efc2' },
  'dust-9-spend.verifier': { bytes: 1351, sha256: '3f1569ebcab0655c5c145b28947c74edc4e3f5c6b276e4404b661cf0905b49d3' },
  'dust-9-spend.bzkir': { bytes: 2555, sha256: '904181287e75b0fb596ba5fcc116c882ee5d28e3115304c93ebd913722ce5841' },
  'bls_midnight_2p13': { bytes: 1573252, sha256: 'd3324910969c4cc54143b8045b649e5c3a4bd5fb7b8f85fe1b770f640ce1c803' },
}

async function readPinned(filename: string): Promise<Uint8Array> {
  const pinned = MANIFEST[filename]
  if (!pinned) throw new Error(`No pinned manifest entry for ${filename}`)
  const buf = await readFile(join(KEYS_DIR, filename))
  if (buf.length !== pinned.bytes) {
    throw new Error(`Midnight proving key ${filename}: size mismatch (expected ${pinned.bytes}, got ${buf.length})`)
  }
  const actualHash = createHash('sha256').update(buf).digest('hex')
  if (actualHash !== pinned.sha256) {
    throw new Error(`Midnight proving key ${filename}: SHA-256 mismatch (expected ${pinned.sha256}, got ${actualHash})`)
  }
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}

export interface ProvingKeyMaterial {
  proverKey: Uint8Array
  verifierKey: Uint8Array
  ir: Uint8Array
}

export interface KeyMaterialProvider {
  lookupKey(keyLocation: string): Promise<ProvingKeyMaterial | undefined>
  getParams(k: number): Promise<Uint8Array>
}

/** Drop-in, integrity-checked replacement for wasmProverEffect's makeDefaultKeyMaterialProvider(). */
export function makeLocalKeyMaterialProvider(): KeyMaterialProvider {
  const cache = new Map<string, ProvingKeyMaterial>()
  const paramsCache = new Map<number, Uint8Array>()

  return {
    async lookupKey(keyLocation: string): Promise<ProvingKeyMaterial | undefined> {
      // Same keyLocation -> path mapping as the SDK's default provider
      // (WasmProver.js), restricted to the dust spend circuit we bundle.
      if (keyLocation !== 'midnight/dust/spend') return undefined
      const cached = cache.get(keyLocation)
      if (cached) return cached
      const [proverKey, verifierKey, ir] = await Promise.all([
        readPinned('dust-9-spend.prover'),
        readPinned('dust-9-spend.verifier'),
        readPinned('dust-9-spend.bzkir'),
      ])
      const result: ProvingKeyMaterial = { proverKey, verifierKey, ir }
      cache.set(keyLocation, result)
      return result
    },
    async getParams(k: number): Promise<Uint8Array> {
      const cached = paramsCache.get(k)
      if (cached) return cached
      if (k !== 13) throw new Error(`No bundled BLS params for k=${k} (only bls_midnight_2p13 is vendored)`)
      const data = await readPinned('bls_midnight_2p13')
      paramsCache.set(k, data)
      return data
    },
  }
}
