/**
 * The Midnight proving keys are the one place this wallet feeds attacker-
 * relevant bytes straight into a prover, so the size + SHA-256 gate must hold
 * on every target. The check runs on WebCrypto (shared by Electron, the
 * extension's offscreen document and the Android WebView) — these tests pin
 * that it still accepts the real vendored keys and still fails closed.
 */
import { describe, expect, it } from 'vitest'
import { makeKeyMaterialProvider } from './midnight-proving-keys'
import { makeLocalKeyMaterialProvider } from './midnight-proving-keys-node'

describe('midnight proving keys', () => {
  it('loads and verifies the vendored dust spend circuit', async () => {
    const provider = makeLocalKeyMaterialProvider()
    const material = await provider.lookupKey('midnight/dust/spend')
    expect(material).toBeDefined()
    expect(material!.proverKey.length).toBe(2175671)
    expect(material!.verifierKey.length).toBe(1351)
    expect(material!.ir.length).toBe(2555)
  })

  it('loads the vendored BLS params for k=13 only', async () => {
    const provider = makeLocalKeyMaterialProvider()
    expect((await provider.getParams(13)).length).toBe(1573252)
    await expect(provider.getParams(12)).rejects.toThrow(/No bundled BLS params/)
  })

  it('returns undefined for circuits we deliberately do not bundle', async () => {
    // Shielded (zswap) circuits are intentionally absent — this wallet never
    // constructs shielded transactions.
    expect(await makeLocalKeyMaterialProvider().lookupKey('midnight/zswap/spend')).toBeUndefined()
  })

  it('fails closed when the bytes do not match the pinned hash', async () => {
    // Correct length for EVERY file, wrong content — the size check passes, so
    // this exercises the SHA-256 comparison specifically.
    const sizes: Record<string, number> = {
      'dust-9-spend.prover': 2175671, 'dust-9-spend.verifier': 1351, 'dust-9-spend.bzkir': 2555,
    }
    const tampered = makeKeyMaterialProvider(async name => new Uint8Array(sizes[name] ?? 0))
    await expect(tampered.lookupKey('midnight/dust/spend')).rejects.toThrow(/SHA-256 mismatch/)
  })

  it('fails closed when the byte length is wrong', async () => {
    const truncated = makeKeyMaterialProvider(async () => new Uint8Array(10))
    await expect(truncated.lookupKey('midnight/dust/spend')).rejects.toThrow(/size mismatch/)
  })
})
