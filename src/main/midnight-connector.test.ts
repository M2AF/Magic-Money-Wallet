import { describe, expect, it } from 'vitest'
import {
  activeMidnightNetwork,
  assertNetworkSupported,
  buildLegacyState,
  formatMidnightConnect,
  formatMidnightTransfer,
  midnightServiceUris,
  MidnightUnavailableError,
  nightToStars,
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
