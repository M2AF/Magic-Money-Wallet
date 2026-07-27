/**
 * midnight-proving-keys-node.ts — Electron's on-disk byte-source for the
 * Midnight proving keys.
 *
 * Kept apart from midnight-proving-keys.ts so that core file stays free of
 * node: imports and can be bundled into the extension's offscreen document and
 * the Android WebView (see capacitor/midnight-proving-keys-web.ts for their
 * fetch-based source). Both feed the same size + SHA-256 gate.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeKeyMaterialProvider, type KeyByteSource, type KeyMaterialProvider } from './midnight-proving-keys'

const KEYS_DIR = join(__dirname, '..', '..', 'resources', 'midnight-keys')

const readFromDisk: KeyByteSource = async (filename) => {
  const buf = await readFile(join(KEYS_DIR, filename))
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}

/** Integrity-checked proving-key provider backed by resources/midnight-keys/. */
export function makeLocalKeyMaterialProvider(): KeyMaterialProvider {
  return makeKeyMaterialProvider(readFromDisk)
}
