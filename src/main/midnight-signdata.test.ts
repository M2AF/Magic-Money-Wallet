import { describe, expect, it } from 'vitest'
import { mnemonicToSeedSync } from '@scure/bip39'
import { bech32m } from '@scure/base'
import { normalizeMnemonic } from './wallet-core'
import { signWithLedger } from './midnight-ledger'

/**
 * Real ledger-v9 signing — no mocks.
 *
 * A Midnight dApp uses signData to bind an identity to the wallet's address, so
 * the property that actually matters is not "a signature came back" but "the
 * key that signed is the key behind the address we advertised". These tests
 * pin that against the same Lace-verified wallet as the derivation tests in
 * wallet-core.test.ts, so a regression in either half is caught here.
 *
 * They also pin the two signing MODES apart (see signMidnightData): readable
 * messages sign raw so live dApps can verify them, binary payloads sign behind
 * the spec's `midnight_signed_message:` prefix so signData can never be used as
 * an oracle for transaction bytes.
 */

// Same throwaway 24-word wallet Lace generated for the derivation vectors.
const LACE_PHRASE = 'fan crew offer depart cream maple scrap gallery guard chief exile foil pyramid live they march pilot bottom tuna inhale paddle glue across chimney'
const LACE_UNSHIELDED = 'mn_addr1m2vkj22w9r7g37yry7cawdj0pnsvyvryc6l0afw69vctellddrqq0gl5g2'

const seed = () => mnemonicToSeedSync(normalizeMnemonic(LACE_PHRASE))
const utf8 = (s: string) => new TextEncoder().encode(s)

// The message Pulse Finance actually asks the wallet to sign.
const MESSAGE_TEXT = 'Pulse Finance note owner registration'
const MESSAGE = utf8(MESSAGE_TEXT)
// A payload with no readable form — e.g. raw transaction bytes.
const BINARY = Uint8Array.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x80])

async function ledger() {
  return await import('@midnightntwrk/ledger-v9') as unknown as {
    addressFromKey(vk: { tag: string; value: string }): string
    verifySignature(vk: { tag: string; value: string }, data: Uint8Array, sig: { tag: string; value: string }): boolean
  }
}
const tagged = (value: string) => ({ tag: 'schnorr', value })

describe('signWithLedger', () => {
  it('signs with the key behind the advertised mn_addr… address', async () => {
    const { verifyingKey } = await signWithLedger(seed(), 0, MESSAGE, MESSAGE_TEXT)

    // Non-circular check: turn the returned verifying key back into an address
    // and require the SAME string Lace produced for this phrase. If signData
    // ever picked a different role key, a dApp would register an identity the
    // wallet's own address does not correspond to.
    const v9 = await ledger()
    const addressHex = v9.addressFromKey(tagged(verifyingKey))
    const address = bech32m.encode('mn_addr', bech32m.toWords(Buffer.from(addressHex, 'hex')), 250)

    expect(address).toBe(LACE_UNSHIELDED)
  }, 60_000)

  it('returns bare hex of the sizes dApps require', async () => {
    const { signature, verifyingKey } = await signWithLedger(seed(), 0, MESSAGE, MESSAGE_TEXT)

    // Pulse hex/base64-decodes verifyingKey and throws unless it is exactly 32
    // bytes, so ledger's { tag, value } wrapper must not leak through here.
    expect(verifyingKey).toMatch(/^[0-9a-f]{64}$/)
    expect(signature).toMatch(/^[0-9a-f]{128}$/)
  }, 60_000)

  describe('readable messages', () => {
    it('signs the raw bytes and echoes the message as `data`', async () => {
      // What live dApps verify against — Pulse's server rejects a prefixed
      // signature outright, and expects `data` to be the message itself.
      const { data, signature, verifyingKey } = await signWithLedger(seed(), 0, MESSAGE, MESSAGE_TEXT)
      const v9 = await ledger()

      expect(data).toBe(MESSAGE_TEXT)
      expect(v9.verifySignature(tagged(verifyingKey), MESSAGE, tagged(signature))).toBe(true)
      // Not over the prefixed form — that is the binary mode's job.
      const prefixed = Buffer.concat([
        Buffer.from(`midnight_signed_message:${MESSAGE.length}:`, 'utf-8'), Buffer.from(MESSAGE),
      ])
      expect(v9.verifySignature(tagged(verifyingKey), prefixed, tagged(signature))).toBe(false)
    }, 60_000)

    it('binds the signature to the exact message', async () => {
      const { signature, verifyingKey } = await signWithLedger(seed(), 0, MESSAGE, MESSAGE_TEXT)
      const v9 = await ledger()
      // A signature valid over different text would mean the message the user
      // approved is not the message that was signed.
      expect(v9.verifySignature(tagged(verifyingKey), utf8(MESSAGE_TEXT + '!'), tagged(signature))).toBe(false)
    }, 60_000)
  })

  describe('binary payloads', () => {
    it("prefixes with the spec's domain separator and returns the signed bytes", async () => {
      const { data, signature, verifyingKey } = await signWithLedger(seed(), 0, BINARY, null)
      const v9 = await ledger()

      // `midnight_signed_message:<payload byte length>:` — the length is the
      // PAYLOAD's, not the prefixed total.
      const expected = Buffer.concat([
        Buffer.from(`midnight_signed_message:${BINARY.length}:`, 'utf-8'), Buffer.from(BINARY),
      ])
      expect(Buffer.from(data, 'hex').equals(expected)).toBe(true)
      expect(v9.verifySignature(tagged(verifyingKey), Uint8Array.from(expected), tagged(signature))).toBe(true)
    }, 60_000)

    it('never yields a signature usable over the bare bytes', async () => {
      // The whole point of the separator: bytes signed as "data" cannot be
      // lifted out and presented as a signature over those bytes alone — e.g.
      // as a transaction segment the user never saw a transaction prompt for.
      const { signature, verifyingKey } = await signWithLedger(seed(), 0, BINARY, null)
      const v9 = await ledger()
      expect(v9.verifySignature(tagged(verifyingKey), BINARY, tagged(signature))).toBe(false)
    }, 60_000)
  })

  it('gives each account index its own signing identity', async () => {
    const [a, b] = await Promise.all([
      signWithLedger(seed(), 0, MESSAGE, MESSAGE_TEXT),
      signWithLedger(seed(), 1, MESSAGE, MESSAGE_TEXT),
    ])
    expect(a.verifyingKey).not.toBe(b.verifyingKey)
  }, 60_000)
})
