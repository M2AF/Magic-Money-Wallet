import { describe, it, expect } from 'vitest'
import { bech32 } from '@scure/base'
import { blake2b } from '@noble/hashes/blake2b'
import { encodeFunctionData, toFunctionSelector, type Hex } from 'viem'
import {
  encodeCardanoRecipient, buildCardanoDepositRequest, validateCardanoDepositRequest,
  decodeDepositToRemoteCalldata, XRESERVE_ETHEREUM_MAINNET, XRESERVE_DEPOSIT_ABI, DEPOSIT_TO_REMOTE_SELECTOR,
  XReserveCardanoError, type CardanoDepositInput, type ProposedEvmCall,
} from './xreserve-cardano-deposit'

// ── Independent fixtures ──────────────────────────────────────────────────────
//
// CIP-19 (cardano-foundation/CIPs, CIP-0019 "Test Vectors") publishes one
// payment key, one stake key and one script, and the address of every type
// built from them. The EXPECTED credentials below are derived from those keys
// and that script directly (blake2b-224 of the verification key; the script
// hash as published) — never from the addresses, and never from the encoder.
const CIP19 = {
  paymentVk: 'addr_vk1w0l2sr2zgfm26ztc6nl9xy8ghsk5sh6ldwemlpmp9xylzy4dtf7st80zhd',
  stakeVk: 'stake_vk1px4j0r2fk7ux5p23shz8f3y5y2qam7s954rgf3lg5merqcj6aetsft99wu',
  script: 'script1cda3khwqv60360rp5m7akt50m6ttapacs8rqhn5w342z7r35m37',
  mainnet: {
    0: 'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x',
    1: 'addr1z8phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gten0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs9yc0hh',
    2: 'addr1yx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerkr0vd4msrxnuwnccdxlhdjar77j6lg0wypcc9uar5d2shs2z78ve',
    3: 'addr1x8phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gt7r0vd4msrxnuwnccdxlhdjar77j6lg0wypcc9uar5d2shskhj42g',
    4: 'addr1gx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer5pnz75xxcrzqf96k',
    5: 'addr128phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtupnz75xxcrtw79hu',
    6: 'addr1vx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzers66hrl8',
    7: 'addr1w8phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtcyjy7wx',
    14: 'stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw',
    15: 'stake178phkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtcccycj5',
  } as Record<number, string>,
  testnet: {
    0: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae',
    1: 'addr_test1zrphkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gten0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgsxj90mg',
    2: 'addr_test1yz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerkr0vd4msrxnuwnccdxlhdjar77j6lg0wypcc9uar5d2shsf5r8qx',
    3: 'addr_test1xrphkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gt7r0vd4msrxnuwnccdxlhdjar77j6lg0wypcc9uar5d2shs4p04xh',
    6: 'addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz',
    7: 'addr_test1wrphkx6acpnf78fuvxn0mkew3l0fd058hzquvz7w36x4gtcl6szpr',
  } as Record<number, string>,
  /** CIP-19's Byron example (base58). */
  byron: '37btjrVyb4KDXBNC4haBVPCrro8AQPHwvCMp3RFhhSVWwfFmZ6wwzSK6JK1hY6wHNmtrpTf1kdbva8TCneM2YsiXT7mrzT21EacHnPpz5YyUdj64na',
}
const hexOf = (b: Uint8Array) => Buffer.from(b).toString('hex')
const bech32Bytes = (s: string) => bech32.fromWords(bech32.decode(s as `${string}1${string}`, 1000).words)
const KEY_HASH = hexOf(blake2b(bech32Bytes(CIP19.paymentVk), { dkLen: 28 }))
const STAKE_HASH = hexOf(blake2b(bech32Bytes(CIP19.stakeVk), { dkLen: 28 }))
const SCRIPT_HASH = hexOf(bech32Bytes(CIP19.script))

/**
 * A REAL Ethereum mainnet deposit to Cardano: tx 0x9695d030fb33ac1267ca78847684331ec6a87b508fe51cfbc91d01d560504fa2,
 * to 0x8888…e3Ce, value 0, chainId 1 (read via eth_getTransactionByHash on 2026-09-27). Its hookData is 95 ZERO
 * bytes — a form Circle's quickstart does not produce (see "unresolved" below).
 */
const REAL_MAINNET_CALLDATA =
  '0xfaadb53b00000000000000000000000000000000000000000000000000000000713f8ff9'
  + '0000000000000000000000000000000000000000000000000000000000002714'
  + '000000011c75c5b878c190e7861f938a23e8d1c6914fc23f5df9058d678363c9'
  + '000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
  + '0000000000000000000000000000000000000000000000000000000000989680'
  + '00000000000000000000000000000000000000000000000000000000000000c0'
  + '000000000000000000000000000000000000000000000000000000000000005f'
  + '0'.repeat(192)

const reject = (fn: () => unknown, pattern: RegExp) => {
  expect(fn).toThrow(XReserveCardanoError)
  expect(fn).toThrow(pattern)
}

describe('independent fixtures are what they claim to be', () => {
  it('CIP-19 keys and script give 28-byte hashes, and the depositToRemote selector is 0xfaadb53b', () => {
    expect(KEY_HASH).toHaveLength(56)
    expect(STAKE_HASH).toHaveLength(56)
    expect(SCRIPT_HASH).toHaveLength(56)
    expect(toFunctionSelector('depositToRemote(uint256,uint32,bytes32,address,uint256,bytes)')).toBe(DEPOSIT_TO_REMOTE_SELECTOR)
    expect(REAL_MAINNET_CALLDATA.slice(0, 10)).toBe(DEPOSIT_TO_REMOTE_SELECTOR)
  })
})

describe('encodeCardanoRecipient — every supported form, checked against CIP-19', () => {
  const cases: Array<[number, 'key' | 'script', string, ('key' | 'script' | null), string | null]> = [
    [0, 'key', KEY_HASH, 'key', STAKE_HASH],
    [1, 'script', SCRIPT_HASH, 'key', STAKE_HASH],
    [2, 'key', KEY_HASH, 'script', SCRIPT_HASH],
    [3, 'script', SCRIPT_HASH, 'script', SCRIPT_HASH],
    [6, 'key', KEY_HASH, null, null],
    [7, 'script', SCRIPT_HASH, null, null],
  ]
  for (const [type, payKind, payHash, stakeKind, stakeHash] of cases) {
    it(`type ${type}: ${stakeKind ? 'base' : 'enterprise'}, ${payKind} payment${stakeKind ? `, ${stakeKind} stake` : ''}`, () => {
      const e = encodeCardanoRecipient(CIP19.mainnet[type])
      expect(e.addressType).toBe(type)
      expect(e.payment).toEqual({ kind: payKind, hash: payHash })
      expect(e.remoteRecipient).toBe(`0x${payKind === 'key' ? '00000001' : '00000002'}${payHash}`)
      expect((e.remoteRecipient.length - 2) / 2).toBe(32)
      if (stakeKind) {
        expect(e.addressKind).toBe('base')
        expect(e.stake).toEqual({ kind: stakeKind, hash: stakeHash })
        expect(e.hookData).toBe(`0x${'00'.repeat(66)}${stakeKind === 'key' ? '01' : '02'}${stakeHash}`)
        expect((e.hookData.length - 2) / 2).toBe(95)
      } else {
        expect(e.addressKind).toBe('enterprise')
        expect(e.stake).toBeNull()
        expect(e.hookData).toBe('0x')
      }
    })
  }
})

describe('encodeCardanoRecipient — refuses everything else', () => {
  it('every testnet form, although it carries the same credentials', () => {
    for (const addr of Object.values(CIP19.testnet)) reject(() => encodeCardanoRecipient(addr), /testnet/)
  })
  it('pointer addresses (types 4, 5)', () => {
    reject(() => encodeCardanoRecipient(CIP19.mainnet[4]), /Pointer/)
    reject(() => encodeCardanoRecipient(CIP19.mainnet[5]), /Pointer/)
  })
  it('reward (stake) addresses', () => {
    reject(() => encodeCardanoRecipient(CIP19.mainnet[14]), /reward/i)
    reject(() => encodeCardanoRecipient(CIP19.mainnet[15]), /reward/i)
  })
  it('Byron addresses', () => {
    reject(() => encodeCardanoRecipient(CIP19.byron), /Byron/)
  })

  const reencode = (bytes: Uint8Array, prefix = 'addr') => bech32.encode(prefix, bech32.toWords(bytes), 1000)
  const baseBytes = bech32Bytes(CIP19.mainnet[0])
  const entBytes = bech32Bytes(CIP19.mainnet[6])

  it('truncated or over-long payloads, with a valid checksum', () => {
    reject(() => encodeCardanoRecipient(reencode(baseBytes.slice(0, 56))), /expected 57 bytes, got 56/)
    reject(() => encodeCardanoRecipient(reencode(new Uint8Array([...baseBytes, 0]))), /expected 57 bytes, got 58/)
    reject(() => encodeCardanoRecipient(reencode(entBytes.slice(0, 28))), /expected 29 bytes, got 28/)
    reject(() => encodeCardanoRecipient(reencode(new Uint8Array([...entBytes, 0]))), /expected 29 bytes, got 30/)
    // An enterprise header on a base-length payload, and vice versa.
    reject(() => encodeCardanoRecipient(reencode(new Uint8Array([0x61, ...baseBytes.slice(1)]))), /expected 29 bytes/)
    reject(() => encodeCardanoRecipient(reencode(new Uint8Array([0x01, ...entBytes.slice(1)]))), /expected 57 bytes/)
    reject(() => encodeCardanoRecipient(reencode(new Uint8Array(0))), /empty/)
  })

  it('a mainnet prefix over a testnet header (network ID checked, not only the prefix)', () => {
    reject(() => encodeCardanoRecipient(reencode(new Uint8Array([0x00, ...baseBytes.slice(1)]))), /not for Cardano mainnet/)
  })

  it('a bad checksum, a foreign prefix, uppercase, whitespace, and non-strings', () => {
    const a = CIP19.mainnet[0]
    const flipped = a.slice(0, 20) + (a[20] === 'q' ? 'p' : 'q') + a.slice(21)
    reject(() => encodeCardanoRecipient(flipped), /Not a valid/)
    reject(() => encodeCardanoRecipient(reencode(baseBytes, 'addx')), /Unexpected address prefix/)
    reject(() => encodeCardanoRecipient(a.toUpperCase()), /lowercase/)
    reject(() => encodeCardanoRecipient(` ${a}`), /whitespace/)
    reject(() => encodeCardanoRecipient(''), /required/)
    reject(() => encodeCardanoRecipient(undefined as unknown as string), /required/)
  })
})

describe('buildCardanoDepositRequest', () => {
  const approved: CardanoDepositInput = { recipient: CIP19.mainnet[0], amountRaw: 123_456_789n, maxFeeRaw: 1_500_000n }

  it('pins chain, contract, USDC, domain and zero ETH, and round-trips through the ABI', () => {
    const r = buildCardanoDepositRequest(approved)
    expect(r.chainId).toBe(1)
    expect(r.to).toBe('0x8888888199b2Df864bf678259607d6D5EBb4e3Ce')
    expect(r.value).toBe(0n)
    expect(r.data.slice(0, 10)).toBe(DEPOSIT_TO_REMOTE_SELECTOR)
    const back = decodeDepositToRemoteCalldata(r.data)
    expect(back).toEqual({
      value: 123_456_789n, remoteDomain: 10004,
      remoteRecipient: `0x00000001${KEY_HASH}`, localToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      maxFee: 1_500_000n, hookData: `0x${'00'.repeat(66)}01${STAKE_HASH}`,
    })
  })

  it('takes integer base units only, requires a positive amount and an EXPLICIT maximum fee', () => {
    reject(() => buildCardanoDepositRequest({ ...approved, amountRaw: 0n }), /positive/)
    reject(() => buildCardanoDepositRequest({ ...approved, amountRaw: -1n }), /out of range/)
    reject(() => buildCardanoDepositRequest({ ...approved, amountRaw: '1.5' }), /integer/)
    reject(() => buildCardanoDepositRequest({ ...approved, amountRaw: '01' }), /integer/)
    reject(() => buildCardanoDepositRequest({ ...approved, amountRaw: 20 as unknown as bigint }), /integer/)
    reject(() => buildCardanoDepositRequest({ ...approved, maxFeeRaw: undefined as unknown as bigint }), /stated explicitly/)
    reject(() => buildCardanoDepositRequest({ ...approved, maxFeeRaw: -1n }), /out of range/)
    reject(() => buildCardanoDepositRequest({ ...approved, amountRaw: 1n << 256n }), /out of range/)
    expect(buildCardanoDepositRequest({ ...approved, maxFeeRaw: 0n }).params.maxFee).toBe(0n)
    expect(buildCardanoDepositRequest({ ...approved, amountRaw: '1', maxFeeRaw: '0' }).params.value).toBe(1n)
  })

  it('an enterprise recipient carries empty hookData', () => {
    const r = buildCardanoDepositRequest({ ...approved, recipient: CIP19.mainnet[6] })
    expect(decodeDepositToRemoteCalldata(r.data).hookData).toBe('0x')
    expect(decodeDepositToRemoteCalldata(r.data).remoteRecipient).toBe(`0x00000001${KEY_HASH}`)
  })
})

describe('buildCardanoDepositRequest — hardened boundaries', () => {
  const approved: CardanoDepositInput = { recipient: CIP19.mainnet[0], amountRaw: 50_000_000n, maxFeeRaw: 5_000_000n }

  it('refuses a SCRIPT payment credential (types 1, 3, 7), though the encoder still describes them', () => {
    for (const type of [1, 3, 7]) {
      expect(encodeCardanoRecipient(CIP19.mainnet[type]).payment.kind).toBe('script')
      reject(() => buildCardanoDepositRequest({ ...approved, recipient: CIP19.mainnet[type] }), /script payment address/)
    }
  })

  it('builds for every KEY payment credential, including a script STAKING credential (type 2)', () => {
    for (const type of [0, 2, 6]) {
      expect(() => buildCardanoDepositRequest({ ...approved, recipient: CIP19.mainnet[type] })).not.toThrow()
    }
    const t2 = buildCardanoDepositRequest({ ...approved, recipient: CIP19.mainnet[2] })
    expect(t2.params.remoteRecipient).toBe(`0x00000001${KEY_HASH}`)
    expect(t2.params.hookData).toBe(`0x${'00'.repeat(66)}02${SCRIPT_HASH}`)
  })

  it('requires the maximum fee to be strictly below the amount, compared as integers', () => {
    reject(() => buildCardanoDepositRequest({ ...approved, maxFeeRaw: 50_000_000n }), /less than the deposit amount/)
    reject(() => buildCardanoDepositRequest({ ...approved, maxFeeRaw: 50_000_001n }), /less than the deposit amount/)
    reject(() => buildCardanoDepositRequest({ ...approved, amountRaw: 1n, maxFeeRaw: 1n }), /less than the deposit amount/)
    expect(buildCardanoDepositRequest({ ...approved, maxFeeRaw: 49_999_999n }).params.maxFee).toBe(49_999_999n)
    // Strings compare numerically, not as text ('9' > '10' as text).
    expect(() => buildCardanoDepositRequest({ ...approved, amountRaw: '10', maxFeeRaw: '9' })).not.toThrow()
    reject(() => buildCardanoDepositRequest({ ...approved, amountRaw: '9', maxFeeRaw: '10' }), /less than the deposit amount/)
    // Far past uint256 fails on range, before anything is encoded.
    reject(() => buildCardanoDepositRequest({ ...approved, maxFeeRaw: 1n << 300n }), /out of range/)
  })

  it('keeps an explicit zero maximum fee, and still refuses an omitted one', () => {
    expect(buildCardanoDepositRequest({ ...approved, maxFeeRaw: 0n }).params.maxFee).toBe(0n)
    expect(buildCardanoDepositRequest({ ...approved, amountRaw: 1n, maxFeeRaw: '0' }).params.maxFee).toBe(0n)
    reject(() => buildCardanoDepositRequest({ ...approved, maxFeeRaw: null as unknown as bigint }), /stated explicitly/)
  })

  it('never produces the unexplained 95-zero-byte hookData, for any supported recipient', () => {
    for (const type of [0, 2, 6]) {
      const r = buildCardanoDepositRequest({ ...approved, recipient: CIP19.mainnet[type] })
      expect(r.params.hookData).not.toBe(`0x${'00'.repeat(95)}`)
    }
  })
})

describe('validateCardanoDepositRequest inherits the hardened rules', () => {
  const to = XRESERVE_ETHEREUM_MAINNET.xReserve
  const calldata = (recipient: Hex, hook: Hex, value: bigint, fee: bigint) => encodeFunctionData({
    abi: XRESERVE_DEPOSIT_ABI, functionName: 'depositToRemote',
    args: [value, 10004, recipient, XRESERVE_ETHEREUM_MAINNET.usdc, fee, hook],
  })

  it('a well-formed call to a script payment credential is refused', () => {
    const data = calldata(`0x00000002${SCRIPT_HASH}`, '0x', 50_000_000n, 5_000_000n)
    reject(() => validateCardanoDepositRequest({ chainId: 1, to, value: 0n, data },
      { recipient: CIP19.mainnet[7], amountRaw: 50_000_000n, maxFeeRaw: 5_000_000n }), /script payment address/)
  })

  it('a well-formed call whose approved fee cap is not below the amount is refused', () => {
    const e = encodeCardanoRecipient(CIP19.mainnet[0])
    const data = calldata(e.remoteRecipient, e.hookData, 50_000_000n, 50_000_000n)
    reject(() => validateCardanoDepositRequest({ chainId: 1, to, value: 0n, data },
      { recipient: CIP19.mainnet[0], amountRaw: 50_000_000n, maxFeeRaw: 50_000_000n }), /less than the deposit amount/)
  })

  it('an explicit zero fee cap validates', () => {
    const e = encodeCardanoRecipient(CIP19.mainnet[6])
    const data = calldata(e.remoteRecipient, e.hookData, 1n, 0n)
    expect(validateCardanoDepositRequest({ chainId: 1, to, value: 0n, data },
      { recipient: CIP19.mainnet[6], amountRaw: 1n, maxFeeRaw: 0n }).maxFee).toBe(0n)
  })
})

describe('validateCardanoDepositRequest — before any future signing', () => {
  const approved: CardanoDepositInput = { recipient: CIP19.mainnet[0], amountRaw: 25_000_000n, maxFeeRaw: 2_000_000n }
  const built = buildCardanoDepositRequest(approved)
  const good: ProposedEvmCall = { chainId: 1, to: built.to, value: 0n, data: built.data }
  const args = (over: Partial<Record<'value' | 'domain' | 'recipient' | 'token' | 'fee' | 'hook', unknown>> = {}) =>
    encodeFunctionData({
      abi: XRESERVE_DEPOSIT_ABI, functionName: 'depositToRemote',
      args: [
        (over.value ?? built.params.value) as bigint, (over.domain ?? 10004) as number,
        (over.recipient ?? built.params.remoteRecipient) as Hex, (over.token ?? built.params.localToken) as Hex,
        (over.fee ?? built.params.maxFee) as bigint, (over.hook ?? built.params.hookData) as Hex,
      ],
    })

  it('accepts exactly the approved call, in any address case and value spelling', () => {
    expect(validateCardanoDepositRequest(good, approved).value).toBe(25_000_000n)
    expect(() => validateCardanoDepositRequest({ ...good, to: built.to.toLowerCase(), value: '0x0', chainId: 1n }, approved)).not.toThrow()
    expect(() => validateCardanoDepositRequest({ ...good, data: built.data.toUpperCase().replace('0X', '0x') }, approved)).not.toThrow()
  })

  it('wrong chain', () => {
    for (const chainId of [8453, 11155111, 5042, 0]) reject(() => validateCardanoDepositRequest({ ...good, chainId }, approved), /Ethereum mainnet/)
  })
  it('wrong contract', () => {
    reject(() => validateCardanoDepositRequest({ ...good, to: '0x008888878f94C0d87defdf0B07f46B93C1934442' }, approved), /xReserve/)
    reject(() => validateCardanoDepositRequest({ ...good, to: 'not-an-address' }, approved), /xReserve/)
  })
  it('nonzero ETH value', () => {
    reject(() => validateCardanoDepositRequest({ ...good, value: 1n }, approved), /sends ETH/)
    reject(() => validateCardanoDepositRequest({ ...good, value: '0x1' }, approved), /sends ETH/)
    reject(() => validateCardanoDepositRequest({ ...good, value: 'lots' }, approved), /unreadable/)
  })
  it('wrong token', () => {
    reject(() => validateCardanoDepositRequest({ ...good, data: args({ token: '0xdAC17F958D2ee523a2206206994597C13D831ec7' }) }, approved), /other than Ethereum USDC/)
  })
  it('wrong domain (Stacks 10003)', () => {
    reject(() => validateCardanoDepositRequest({ ...good, data: args({ domain: 10003 }) }, approved), /remote domain/)
  })
  it('changed amount or maximum fee', () => {
    reject(() => validateCardanoDepositRequest({ ...good, data: args({ value: 25_000_001n }) }, approved), /different amount/)
    reject(() => validateCardanoDepositRequest({ ...good, data: args({ fee: 2_000_001n }) }, approved), /maximum fee/)
    reject(() => validateCardanoDepositRequest(good, { ...approved, maxFeeRaw: 1_999_999n }), /maximum fee/)
  })
  it('altered recipient: another credential, or the same one re-tagged as a script', () => {
    reject(() => validateCardanoDepositRequest({ ...good, data: args({ recipient: `0x00000001${'ab'.repeat(28)}` }) }, approved), /payment credential/)
    reject(() => validateCardanoDepositRequest({ ...good, data: args({ recipient: `0x00000002${KEY_HASH}` }) }, approved), /payment credential/)
  })
  it('altered hookData: another stake credential, a changed tag, a non-zero prefix, or emptied', () => {
    const h = built.params.hookData
    reject(() => validateCardanoDepositRequest({ ...good, data: args({ hook: `0x${'00'.repeat(66)}01${'cd'.repeat(28)}` }) }, approved), /hookData/)
    reject(() => validateCardanoDepositRequest({ ...good, data: args({ hook: `0x${'00'.repeat(66)}02${STAKE_HASH}` }) }, approved), /hookData/)
    reject(() => validateCardanoDepositRequest({ ...good, data: args({ hook: `0x01${h.slice(4)}` }) }, approved), /hookData/)
    reject(() => validateCardanoDepositRequest({ ...good, data: args({ hook: '0x' }) }, approved), /hookData/)
  })
  it('extra, truncated, re-selected or non-canonical calldata', () => {
    reject(() => validateCardanoDepositRequest({ ...good, data: `${built.data}00` }, approved), /extra or non-canonical/)
    reject(() => validateCardanoDepositRequest({ ...good, data: built.data.slice(0, -64) }, approved), /could not be decoded|non-canonical/)
    reject(() => validateCardanoDepositRequest({ ...good, data: `0x095ea7b3${built.data.slice(10)}` }, approved), /not a depositToRemote/)
    reject(() => validateCardanoDepositRequest({ ...good, data: 'zz' }, approved), /not hex/)
    // Dirty high bits in the uint32 domain word: decodes, but is not the canonical encoding.
    const dirty = built.data.slice(0, 10 + 64) + 'ff' + built.data.slice(10 + 64 + 2)
    reject(() => validateCardanoDepositRequest({ ...good, data: dirty }, approved), /could not be decoded|non-canonical|remote domain/)
  })
  it('a recipient approved on testnet can never be validated', () => {
    reject(() => validateCardanoDepositRequest(good, { ...approved, recipient: CIP19.testnet[0] }), /testnet/)
  })
})

describe('a real mainnet deposit (independent ABI fixture)', () => {
  it('decodes to the pinned contract terms: USDC, Cardano, a key-hash recipient, 95-byte hookData', () => {
    const p = decodeDepositToRemoteCalldata(REAL_MAINNET_CALLDATA)
    expect(p.remoteDomain).toBe(XRESERVE_ETHEREUM_MAINNET.cardanoDomain)
    expect(p.localToken).toBe(XRESERVE_ETHEREUM_MAINNET.usdc)
    expect(p.value).toBe(1_899_991_033n)            // 0x713f8ff9 = 1,899.991033 USDC
    expect(p.maxFee).toBe(10_000_000n)
    expect(p.remoteRecipient).toBe('0x000000011c75c5b878c190e7861f938a23e8d1c6914fc23f5df9058d678363c9')
    expect((p.hookData.length - 2) / 2).toBe(95)
  })

  it('UNRESOLVED: its hookData is 95 zero bytes, a form the quickstart never produces — so it is not accepted', () => {
    const p = decodeDepositToRemoteCalldata(REAL_MAINNET_CALLDATA)
    expect(p.hookData).toBe(`0x${'00'.repeat(95)}`)
    // The same payment credential as an enterprise or base address never yields this hookData.
    const enterprise = bech32.encode('addr', bech32.toWords(new Uint8Array([0x61, ...Buffer.from('1c75c5b878c190e7861f938a23e8d1c6914fc23f5df9058d678363c9', 'hex')])), 1000)
    const proposal: ProposedEvmCall = { chainId: 1, to: XRESERVE_ETHEREUM_MAINNET.xReserve, value: 0n, data: REAL_MAINNET_CALLDATA }
    reject(() => validateCardanoDepositRequest(proposal, { recipient: enterprise, amountRaw: 1_899_991_033n, maxFeeRaw: 10_000_000n }), /hookData/)
  })
})
