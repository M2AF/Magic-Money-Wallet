/**
 * NEAR Intents 1Click client. Fixtures are REAL keyless 1Click responses
 * (2026-10-28): a dry and a non-dry quote for 25 ADA -> SOL to this wallet's own
 * addresses, and the status of that (never funded) deposit address. Every
 * negative is derived from them. Nothing reaches a network.
 */
import { describe, it, expect } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519'
import { base58 } from '@scure/base'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  parseOneClickQuoteResponse, verifyOneClickQuoteSignature, checkExecutableQuote, checkCardanoDepositAddress,
  findOneClickAsset, fetchOneClickStatus, oneClickQuoteRequest, oneClickQuoteHash, ONE_CLICK_CARDANO_ADA, MIN_DEADLINE_HEADROOM_MS,
  type OneClickToken,
} from './near-intents-client'

const FIX = join(__dirname, '__fixtures__', 'near-intents')
const rec = JSON.parse(readFileSync(join(FIX, 'ada-sol-quotes.json'), 'utf8'))
const tokens = (JSON.parse(readFileSync(join(FIX, 'tokens-subset.json'), 'utf8')).tokens as Array<Record<string, unknown>>).map(t => ({
  assetId: t.assetId, decimals: t.decimals, blockchain: t.blockchain, symbol: t.symbol, price: t.price ?? null, contractAddress: t.contractAddress ?? null,
})) as OneClickToken[]
const CARDANO = 'addr1q950qv0ks9t29mavulaa5jr3sk2s50r5jfsddydjs0pazrfh32tdpt7zttt4mhl6t9purm4c9rv555z7r5mulq78aleqcg9c9h'
const SOLANA = '3noTuHnQdHkat2w5rBx18vAACMzFUvB5LodEe5vMN98d'
const SOL = rec.tokenSol.assetId as string

const live = () => parseOneClickQuoteResponse(structuredClone(rec.live.body))
const dry = () => parseOneClickQuoteResponse(structuredClone(rec.dry.body))
const want = (over: Partial<Parameters<typeof checkExecutableQuote>[1]> = {}) => ({
  destinationAsset: SOL, amountLovelace: '25000000', slippageBps: 100, refundTo: CARDANO, recipient: SOLANA,
  approvedMinOutRaw: rec.live.body.quote.minAmountOut, now: Date.parse(rec.recordedAt), ...over,
})

describe('quote signatures (1Click manager key)', () => {
  it('verifies real dry and non-dry quotes', () => {
    expect(verifyOneClickQuoteSignature(dry())).toBe(true)
    expect(verifyOneClickQuoteSignature(live())).toBe(true)
  })

  it('fails when any signed field changes: deposit address, minimum, recipient, amount', () => {
    for (const mutate of [
      (b: any) => { b.quote.depositAddress = 'addr1vxhqhx5u45f2geynxxf97szc4ccydt2h3ef07mjzxz4lnfqxgv7c6' },
      (b: any) => { b.quote.minAmountOut = '1' },
      (b: any) => { b.quoteRequest.recipient = 'So11111111111111111111111111111111111111112' },
      (b: any) => { b.quoteRequest.amount = '26000000' },
      (b: any) => { b.timestamp = new Date(0).toISOString() },
    ]) {
      const b = structuredClone(rec.live.body); mutate(b)
      expect(verifyOneClickQuoteSignature(parseOneClickQuoteResponse(b))).toBe(false)
    }
  })

  it('fails against any other key', () => {
    expect(verifyOneClickQuoteSignature(live(), 'ed25519:' + '1'.repeat(44))).toBe(false)
  })
})

describe('checkExecutableQuote — before the deposit is ever paid', () => {
  it('accepts the real non-dry quote for exactly the requested swap', () => {
    const r = checkExecutableQuote(live(), want())
    expect(r.depositAddress).toBe(rec.live.body.quote.depositAddress)
  })

  it('refuses a dry quote (no deposit address) and any request mismatch', () => {
    expect(() => checkExecutableQuote(dry(), want())).toThrow()
    expect(() => checkExecutableQuote(live(), want({ recipient: 'So11111111111111111111111111111111111111112' }))).toThrow(/does not match/)
    expect(() => checkExecutableQuote(live(), want({ refundTo: 'addr1vxhqhx5u45f2geynxxf97szc4ccydt2h3ef07mjzxz4lnfqxgv7c5' }))).toThrow(/does not match/)
    expect(() => checkExecutableQuote(live(), want({ amountLovelace: '24000000' }))).toThrow(/does not match/)
    expect(() => checkExecutableQuote(live(), want({ destinationAsset: 'nep141:eth.omft.near' }))).toThrow(/does not match/)
    expect(() => checkExecutableQuote(live(), want({ slippageBps: 50 }))).toThrow(/does not match/)
  })

  it('refuses when the guaranteed minimum fell below what the user approved', () => {
    const higher = (BigInt(rec.live.body.quote.minAmountOut) + 1n).toString()
    expect(() => checkExecutableQuote(live(), want({ approvedMinOutRaw: higher }))).toThrow(/price moved/)
  })

  it('refuses a deposit address that expires too soon', () => {
    const deadline = Date.parse(rec.live.body.quote.deadline)
    expect(() => checkExecutableQuote(live(), want({ now: deadline - MIN_DEADLINE_HEADROOM_MS + 1 }))).toThrow(/expires too soon/)
  })

  it('refuses a correctly signed quote that requires a deposit memo, or names a script deposit address', () => {
    // Re-signed with a test key so only the checked field differs.
    const priv = ed25519.utils.randomPrivateKey()
    const key = 'ed25519:' + base58.encode(ed25519.getPublicKey(priv))
    const resign = (mutate: (b: any) => void) => {
      const b = structuredClone(rec.live.body); mutate(b)
      const r = parseOneClickQuoteResponse(b)
      r.signature = 'ed25519:' + base58.encode(ed25519.sign(new TextEncoder().encode(oneClickQuoteHash(r)), priv))
      return r
    }
    expect(() => checkExecutableQuote(resign(() => {}), want(), key)).not.toThrow()
    expect(() => checkExecutableQuote(resign(b => { b.quote.depositMemo = '12345' }), want(), key)).toThrow(/memo/)
    expect(() => checkExecutableQuote(resign(b => { b.quote.depositAddress = 'addr1z8snz7c4974vzdpxu65ruphl3zjdvtxw8strf2c2tmqnxz2j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq0xmsha' }), want(), key)).toThrow(/plain key address/)
    // ...and the pinned 1Click key never accepts the test key's signature.
    expect(() => checkExecutableQuote(resign(() => {}), want())).toThrow(/signature/)
  })

  it('refuses a tampered quote even when its terms look right', () => {
    const b = structuredClone(rec.live.body); b.quote.amountOut = (BigInt(b.quote.amountOut) * 2n).toString()
    expect(() => checkExecutableQuote(parseOneClickQuoteResponse(b), want())).toThrow(/signature/)
  })
})

describe('checkCardanoDepositAddress', () => {
  it('accepts mainnet key addresses (base, enterprise) only', () => {
    expect(checkCardanoDepositAddress(rec.live.body.quote.depositAddress, CARDANO)).toBeNull()
    expect(checkCardanoDepositAddress(CARDANO, 'addr1vxhqhx5u45f2geynxxf97szc4ccydt2h3ef07mjzxz4lnfqxgv7c5')).toBeNull()
    expect(checkCardanoDepositAddress(CARDANO, CARDANO)).toMatch(/own address/)
    // Script address (the Minswap V2 order script) and a testnet address are refused.
    expect(checkCardanoDepositAddress('addr1z8snz7c4974vzdpxu65ruphl3zjdvtxw8strf2c2tmqnxz2j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq0xmsha', CARDANO)).toMatch(/plain key address/)
    expect(checkCardanoDepositAddress('addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz', CARDANO)).toMatch(/mainnet/)
    expect(checkCardanoDepositAddress('not-an-address', CARDANO)).toMatch(/not a Cardano address/)
  })
})

describe('findOneClickAsset — by chain, exact contract and decimals', () => {
  it('maps native SOL and Circle USDC on Solana, and refuses lookalikes', () => {
    expect(findOneClickAsset(tokens, 'solana', 'So11111111111111111111111111111111111111112', 9, true)?.assetId).toBe(SOL)
    expect(findOneClickAsset(tokens, 'solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 6, false)?.symbol).toBe('USDC')
    expect(findOneClickAsset(tokens, 'solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 9, false)).toBeNull()
    expect(findOneClickAsset(tokens, 'solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1w', 6, false)).toBeNull()
    expect(findOneClickAsset(tokens, 'cardano', 'lovelace', 6, true)).toBeNull()
  })

  it('maps EVM contracts case-insensitively and native ETH', () => {
    expect(findOneClickAsset(tokens, 'ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6, false)?.symbol).toBe('USDC')
    expect(findOneClickAsset(tokens, 'ethereum', '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 18, true)?.symbol).toBe('ETH')
  })
})

describe('status', () => {
  it('reads the real status of the unfunded deposit address', async () => {
    const fetchFn = async () => new Response(JSON.stringify(rec.status.body), { status: 200 })
    const s = await fetchOneClickStatus(rec.live.body.quote.depositAddress, fetchFn)
    expect(s?.status).toBe('PENDING_DEPOSIT')
  })

  it('an unknown status is UNRECOGNIZED, never success', async () => {
    const fetchFn = async () => new Response(JSON.stringify({ ...rec.status.body, status: 'DONE_MAYBE' }), { status: 200 })
    expect((await fetchOneClickStatus('x', fetchFn))?.status).toBe('UNRECOGNIZED')
  })
})

it('the request names Cardano ADA as the origin and this wallet as refund recipient', () => {
  expect(oneClickQuoteRequest({ dry: true, destinationAsset: SOL, amountLovelace: '1', slippageBps: 100, refundTo: CARDANO, recipient: SOLANA, deadline: 'd' }))
    .toMatchObject({ originAsset: ONE_CLICK_CARDANO_ADA, refundTo: CARDANO, refundType: 'ORIGIN_CHAIN', recipientType: 'DESTINATION_CHAIN', depositType: 'ORIGIN_CHAIN' })
})
