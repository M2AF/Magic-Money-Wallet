import { describe, expect, it } from 'vitest'
import {
  activeMidnightNetwork,
  assertNetworkSupported,
  buildLegacyState,
  decodeMidnightSignPayload,
  formatMidnightConnect,
  formatMidnightSignData,
  formatMidnightTransfer,
  midnightServiceUris,
  MidnightUnavailableError,
  nightToStars,
  splitShieldedAddress,
  NIGHT_TOKEN_TYPE,
  STARS_PER_NIGHT,
} from './midnight-connector'
import type { WalletConfig } from './secure-store'

const cfg = (o: Partial<WalletConfig>) => o as WalletConfig

describe('activeMidnightNetwork', () => {
  it('maps Testnet Mode to Preprod and Privacy Mode to Mainnet', () => {
    expect(activeMidnightNetwork(cfg({ testnetMode: true }))).toBe('preprod')
    expect(activeMidnightNetwork(cfg({ privacyMode: true }))).toBe('mainnet')
  })

  it('tells the user WHICH switch to flip when neither mode is on', () => {
    // Midnight keys are only derived in these modes, so a dApp connecting with
    // both off must get an actionable message, not an opaque failure.
    let err: unknown
    try { activeMidnightNetwork(cfg({})) } catch (e) { err = e }
    expect(err).toBeInstanceOf(MidnightUnavailableError)
    expect((err as Error).message).toMatch(/Privacy Mode/)
    expect((err as Error).message).toMatch(/Testnet Mode/)
  })

  it('lets Testnet Mode win when both flags are somehow set', () => {
    // midnightNetworkFor guards privacy on !testnetMode; assert we inherit that
    // rather than silently serving mainnet keys to a testnet dApp.
    expect(activeMidnightNetwork(cfg({ testnetMode: true, privacyMode: true }))).toBe('preprod')
  })
})

describe('assertNetworkSupported', () => {
  it('accepts a matching network and its common aliases', () => {
    expect(() => assertNetworkSupported('mainnet', 'mainnet')).not.toThrow()
    expect(() => assertNetworkSupported('preprod', 'preprod')).not.toThrow()
    expect(() => assertNetworkSupported('testnet', 'preprod')).not.toThrow()
    expect(() => assertNetworkSupported('MAINNET', 'mainnet')).not.toThrow()
    // 'undeployed' is deliberately NOT an alias for preprod — it is Midnight's
    // local dev network, and treating it as preprod would silently connect a
    // local-dev dApp to a real testnet.
  })

  it('accepts an unspecified network', () => {
    expect(() => assertNetworkSupported(undefined, 'mainnet')).not.toThrow()
  })

  it('rejects a mismatch and says which switch to flip', () => {
    expect(() => assertNetworkSupported('preprod', 'mainnet')).toThrow(/Testnet Mode/)
    expect(() => assertNetworkSupported('mainnet', 'preprod')).toThrow(/Privacy Mode/)
  })

  it('rejects an unknown network name rather than guessing', () => {
    expect(() => assertNetworkSupported('devnet', 'mainnet')).toThrow(/Unknown Midnight network/)
  })
})

describe('midnightServiceUris', () => {
  it('returns the endpoints for the active network', () => {
    const main = midnightServiceUris('mainnet')
    expect(main.indexerUri).toContain('indexer.mainnet.midnight.network')
    expect(main.indexerWsUri).toMatch(/^wss:/)
    expect(main.substrateNodeUri).toContain('rpc.mainnet')
    expect(main.networkId).toBe('mainnet')

    expect(midnightServiceUris('preprod').indexerUri).toContain('preprod')
  })

  it('does NOT advertise a prover server', () => {
    // The SDK default is a remote prover, which would ship witness data — the
    // private inputs of a shielded transaction — off the device. We prove
    // locally, so there is deliberately no URI to hand out.
    expect(midnightServiceUris('mainnet').proverServerUri).toBeUndefined()
    expect(midnightServiceUris('preprod').proverServerUri).toBeUndefined()
  })

  it('hands out a copy so a dApp cannot mutate our table', () => {
    const a = midnightServiceUris('mainnet')
    a.indexerUri = 'https://evil.example'
    expect(midnightServiceUris('mainnet').indexerUri).toContain('midnight.network')
  })
})

describe('buildLegacyState', () => {
  it('fills both the legacy and current encodings the ≤3.x API expects', () => {
    const s = buildLegacyState({ unshielded: 'mn_addr_x', shielded: 'mn_shield-addr_y' })
    expect(s.address).toBe('mn_addr_x')
    expect(s.addressLegacy).toBe('mn_addr_x')
    expect(s.coinPublicKey).toBe('mn_shield-addr_y')
    expect(s.coinPublicKeyLegacy).toBe('mn_shield-addr_y')
    expect(s.encryptionPublicKey).toBe('mn_shield-addr_y')
  })

  it('degrades to empty strings rather than undefined', () => {
    // dApps string-concatenate these; undefined would surface as "undefined".
    const s = buildLegacyState({})
    expect(s.address).toBe('')
    expect(s.coinPublicKey).toBe('')
  })
})

describe('nightToStars', () => {
  it('converts NIGHT to Stars at 1e6', () => {
    expect(nightToStars(1)).toBe(STARS_PER_NIGHT)
    expect(nightToStars('2.5')).toBe(2_500_000n)
    expect(nightToStars(0.000001)).toBe(1n)
  })

  it('rounds rather than truncating', () => {
    // Truncation turned 0.1 NIGHT into 99999 Stars via float error.
    expect(nightToStars(0.1)).toBe(100_000n)
    expect(nightToStars(0.3)).toBe(300_000n)
  })

  it('rejects zero, negative and non-numeric amounts', () => {
    expect(() => nightToStars(0)).toThrow(/greater than 0/)
    expect(() => nightToStars(-1)).toThrow(/greater than 0/)
    expect(() => nightToStars('abc')).toThrow(/greater than 0/)
  })
})

describe('prompt text', () => {
  it('names the network so a testnet transfer is never mistaken for mainnet', () => {
    const preprod = formatMidnightConnect('https://a.example', 'preprod', { unshielded: 'mn_addr_1' })
    expect(preprod).toContain('Preprod (testnet)')
    expect(formatMidnightConnect('https://a.example', 'mainnet', {})).toContain('Mainnet')
  })

  it('states the grant and that transfers still need approval', () => {
    const text = formatMidnightConnect('https://a.example', 'mainnet', { unshielded: 'mn_addr_1' })
    expect(text).toContain('mn_addr_1')
    expect(text).toContain('NIGHT balance')
    expect(text).toContain('still needs your approval')
    expect(text).toMatch(/proves locally/)
  })

  it('formats a transfer with the amount, recipient and network', () => {
    const text = formatMidnightTransfer('mn_addr_dest', 2_500_000n, 'preprod')
    expect(text).toContain('2.5 NIGHT')
    expect(text).toContain('mn_addr_dest')
    expect(text).toContain('Preprod (testnet)')
    expect(text).toContain('DUST')
  })

  it('renders a whole-number amount without a trailing dot', () => {
    expect(formatMidnightTransfer('x', STARS_PER_NIGHT, 'mainnet')).toContain('1 NIGHT')
  })
})

describe('constants', () => {
  it('uses the all-zero token type for native NIGHT', () => {
    expect(NIGHT_TOKEN_TYPE).toHaveLength(64)
    expect(NIGHT_TOKEN_TYPE).toMatch(/^0+$/)
  })
})

describe('networks the wallet does not serve', () => {
  it('names preview and undeployed specifically rather than "unknown"', () => {
    // These are real Midnight networks. Reporting them as unknown would read as
    // a wallet bug rather than an unsupported network.
    expect(() => assertNetworkSupported('preview', 'preprod')).toThrow(/does not support/)
    expect(() => assertNetworkSupported('undeployed', 'mainnet')).toThrow(/does not support/)
    expect(() => assertNetworkSupported('preview', 'preprod')).toThrow(/Mainnet.*Preprod/)
  })

  it('still rejects genuine nonsense as unknown', () => {
    expect(() => assertNetworkSupported('banana', 'mainnet')).toThrow(/Unknown Midnight network/)
  })
})

describe('decodeMidnightSignPayload', () => {
  const utf8 = (s: string) => Array.from(new TextEncoder().encode(s))

  it('signs the UTF-8 bytes of a text payload', () => {
    // The shape Pulse Finance sends: signData(message, { encoding: 'text' }).
    const msg = 'Pulse Finance note owner registration'
    const { bytes, display } = decodeMidnightSignPayload(msg, 'text')
    expect(Array.from(bytes)).toEqual(utf8(msg))
    expect(display).toBe(msg)
  })

  it('treats a bare string as text rather than guessing hex', () => {
    // "deadbeef" is valid hex AND a plausible message. Guessing would sign
    // 4 bytes while the prompt showed 8 characters.
    const { bytes, display } = decodeMidnightSignPayload('deadbeef')
    expect(Array.from(bytes)).toEqual(utf8('deadbeef'))
    expect(display).toBe('deadbeef')
  })

  it('decodes hex only when the dApp says the payload is hex', () => {
    const { bytes } = decodeMidnightSignPayload('deadbeef', 'hex')
    expect(Array.from(bytes)).toEqual([0xde, 0xad, 0xbe, 0xef])
    expect(Array.from(decodeMidnightSignPayload('0xdeadbeef', 'hex').bytes)).toEqual([0xde, 0xad, 0xbe, 0xef])
  })

  it('decodes base64, the third encoding the connector spec defines', () => {
    expect(Array.from(decodeMidnightSignPayload('SGk=', 'base64').bytes)).toEqual(utf8('Hi'))
  })

  it('rejects malformed hex and base64 instead of silently truncating', () => {
    // Buffer's decoders stop at (or skip) the first invalid character rather
    // than throwing, so a dApp could show a long plausible string and have a
    // short attacker-chosen prefix signed. Both must reject outright.
    expect(() => decodeMidnightSignPayload('aabbZZZZlongdeceptivetext', 'hex')).toThrow(/valid hex/)
    expect(() => decodeMidnightSignPayload('SGk=extra!!', 'base64')).toThrow(/valid base64/)
  })

  it('accepts raw bytes from either side of the IPC hop', () => {
    expect(Array.from(decodeMidnightSignPayload([1, 2, 3]).bytes)).toEqual([1, 2, 3])
    expect(Array.from(decodeMidnightSignPayload(Uint8Array.from([1, 2, 3])).bytes)).toEqual([1, 2, 3])
  })

  it('derives the displayed message FROM the bytes being signed', () => {
    // The prompt must never be able to disagree with what is signed, so the
    // display is a decoding of the bytes rather than a caption beside them.
    const { bytes, display } = decodeMidnightSignPayload('48690a', 'hex')
    expect(Array.from(bytes)).toEqual([0x48, 0x69, 0x0a])
    expect(display).toBe('Hi\n')
  })

  it('flags readable payloads as text and binary ones as not', () => {
    // This flag selects the SIGNING MODE (raw vs prefixed), so it is security-
    // relevant, not cosmetic — see signMidnightData.
    expect(decodeMidnightSignPayload('Pulse Finance note owner registration', 'text').text)
      .toBe('Pulse Finance note owner registration')
    expect(decodeMidnightSignPayload([0x00, 0x01, 0xff]).text).toBeNull()
    // Control characters read as binary: a transaction segment must never be
    // able to present itself as a message and get signed unprefixed.
    expect(decodeMidnightSignPayload([0x41, 0x07, 0x42]).text).toBeNull()
    expect(decodeMidnightSignPayload('48690a', 'hex').text).toBe('Hi\n')
  })

  it('shows hex when the bytes are not a readable message', () => {
    const binary = decodeMidnightSignPayload([0x00, 0x01, 0xff])
    expect(binary.display).toMatch(/3 bytes \(binary\)/)
    // Invalid UTF-8 must not be smuggled through as replacement characters.
    expect(binary.display).not.toContain('\uFFFD')

    const control = decodeMidnightSignPayload([0x41, 0x07, 0x42])
    expect(control.display).toMatch(/bytes \(binary\)/)
  })

  it('rejects payloads it cannot sign faithfully', () => {
    expect(() => decodeMidnightSignPayload('')).toThrow(/empty/)
    expect(() => decodeMidnightSignPayload('xyz', 'hex')).toThrow(/valid hex/)
    expect(() => decodeMidnightSignPayload('abc', 'hex')).toThrow(/valid hex/)
    expect(() => decodeMidnightSignPayload('hi', 'utf16')).toThrow(/Unsupported.*encoding/)
    expect(() => decodeMidnightSignPayload({ msg: 'hi' })).toThrow(/Unsupported/)
  })
})

describe('formatMidnightSignData', () => {
  it('shows the message and says signing moves no funds', () => {
    const detail = formatMidnightSignData('Pulse Finance note owner registration', 'mainnet')
    expect(detail).toContain('Pulse Finance note owner registration')
    expect(detail).toContain('unshielded (NIGHT) key')
    expect(detail).toContain('Midnight Mainnet')
    expect(detail).toMatch(/does not move any funds/)
  })

  it('names Preprod so a testnet signature is not mistaken for mainnet', () => {
    expect(formatMidnightSignData('hi', 'preprod')).toContain('Preprod (testnet)')
  })
})

describe('splitShieldedAddress', () => {
  // The repo's Lace-verified test wallet (wallet-core.test.ts). The expected
  // keys were taken from @midnightntwrk/wallet-sdk-address-format's own
  // ShieldedAddress codec, so this pins our split to the reference decoder.
  const SHIELDED = 'mn_shield-addr1l6xvefgt4w0m24ujr7rhydzj2tw5vmfm74ens9uu5ynj0kfhwn7n2ujd43n9wlnutvzpejzwp9wzzppm2wqfxc790kh9llyn772zrcq8t4qr4'

  it('returns the two component public keys as hex, matching the SDK codec', () => {
    expect(splitShieldedAddress(SHIELDED)).toEqual({
      coinPublicKey: 'fe8ccca50bab9fb557921f8772345252dd466d3bf57338179ca12727d93774fd',
      encryptionPublicKey: '35724dac66577e7c5b041cc84e095c21043b53809363c57dae5ffc93f79421e0',
    })
  })

  it('is hex, because dApps branch on that', () => {
    // Live dApps test these fields against /^[0-9a-f]*$/ and only derive the
    // shielded address from them on the hex branch. Bech32m — which the spec's
    // prose says — would silently take the fallback path everywhere.
    const { coinPublicKey, encryptionPublicKey } = splitShieldedAddress(SHIELDED)
    expect(coinPublicKey).toMatch(/^[0-9a-f]{64}$/)
    expect(encryptionPublicKey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('says nothing rather than handing back half a key', () => {
    expect(splitShieldedAddress(undefined)).toEqual({})
    expect(splitShieldedAddress('')).toEqual({})
    expect(splitShieldedAddress('not-an-address')).toEqual({})
    // A well-formed bech32m string that is not a 64-byte shielded payload.
    expect(splitShieldedAddress('mn_addr1m2vkj22w9r7g37yry7cawdj0pnsvyvryc6l0afw69vctellddrqq0gl5g2')).toEqual({})
  })
})
