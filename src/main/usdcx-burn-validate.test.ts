/**
 * Pre-signing check of an IOG-built USDCx burn. Read-only; nothing is built,
 * signed or sent here.
 *
 * PUBLIC base case: the public mainnet burn 887333810e… (fixture), whose spent
 * input is resolved here from the ledger equation (its single output plus fee
 * and burn). Every negative is derived from it by byte swaps, as in
 * xreserve-cardano-burn-proof.test.ts.
 *
 * PRIVATE case: the user's own unsigned Portal build (2026-10-06) lives OUTSIDE
 * this public repo; it runs only where that file exists.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { blake2b } from '@noble/hashes/blake2b'
import { validateUsdcxBurnBuild, type BurnBuildValidationInput, type ResolvedTxOutput } from './usdcx-burn-validate'
import { decodeCbor, decodeTxBody, type CborMap } from './cardano-tx-inspect'
import { splitRoot } from './xreserve-cardano-mint-proof'
import { hexToBytesStrict } from './cardano-swap-validate'
import type { XReserveBurnTerms } from '../shared/stablecoin-journey'

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
const fx = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'iog', 'cardano-burn-887333810e.json'), 'utf8')) as {
  cbor: string; terms: { encoded: string; burnAmountRaw: string; remoteDepositor: string }; releaseAmountRaw: string; recipient: string
}
const SERVICE_KEY = 'e5d5e3df40975c35219f1b9de17716f5d09ffc4fa431a83bcaebd55c'
const DEPOSITOR = '0de0a107f07feebfcc64637534d669093fe4c7cfcff0488e3a8f9236'
const SERVICE_ADDRESS = 'addr1q8jatc7lgzt4cdfpnudemcthzm6ap8luf7jrr2pmet4a2hzuds90umjlesfs86mzwgp5xwaz2eye6kd0azzgly8quv7skegkvl'

const parts = splitRoot(hexToBytesStrict(fx.cbor))
const body = decodeTxBody(parts.body)
const OWN = body.outputs[0].address

const terms = (over: Partial<XReserveBurnTerms> = {}): XReserveBurnTerms => ({
  network: 'mainnet', encoded: fx.terms.encoded.toLowerCase(), burnAmountRaw: fx.terms.burnAmountRaw,
  remoteDepositor: fx.terms.remoteDepositor.toLowerCase(), releaseAmountRaw: fx.releaseAmountRaw, releaseRecipient: fx.recipient, approvedAt: 1, ...over,
})

/** The spent input, reconstructed so that inputs − fee − burn = outputs. */
function resolvedFor(over: { inputAddress?: string; collateralAddress?: string; drop?: 'input' | 'collateral' } = {}): Map<string, ResolvedTxOutput> {
  const out = body.outputs[0]
  const assets = new Map(out.value.assets.map(a => [a.unit, a.quantity] as [string, bigint]))
  for (const m of body.mint) assets.set(m.unit, (assets.get(m.unit) ?? 0n) - m.quantity)
  const m = new Map<string, ResolvedTxOutput>()
  if (over.drop !== 'input') m.set(`${body.inputs[0].txHash}#${body.inputs[0].index}`, { address: over.inputAddress ?? OWN, lovelace: out.value.lovelace + body.fee, assets })
  if (over.drop !== 'collateral') m.set(`${body.collateral[0].txHash}#${body.collateral[0].index}`, { address: over.collateralAddress ?? SERVICE_ADDRESS, lovelace: 49_094_427_598n, assets: new Map() })
  return m
}

function input(over: Partial<BurnBuildValidationInput> = {}): BurnBuildValidationInput {
  return {
    terms: terms(), unsignedTxCbor: fx.cbor,
    wallet: { ownAddresses: [OWN], paymentKeyHash: DEPOSITOR },
    resolved: resolvedFor(),
    policy: { maxFeeLovelace: 2_000_000n, maxTotalCollateralLovelace: 5_000_000n, serviceWitnessKeyHashes: [SERVICE_KEY] },
    ...over,
  }
}

/**
 * Swap a byte string inside the body; the transaction id changes with it.
 * `occurrences` pins how often it appears; only the FIRST is replaced (the
 * change output precedes the collateral return, which repeats the address).
 */
function withBody(from: string, to: string, occurrences = 1): string {
  const b = hex(parts.body)
  expect(b.split(from).length - 1, `body contains ${from} ${occurrences}x`).toBe(occurrences)
  return `84${b.replace(from, to)}${hex(parts.witnessSet)}${hex(parts.isValid)}${hex(parts.auxData)}`
}
const failed = (r: ReturnType<typeof validateUsdcxBurnBuild>) => r.checks.filter(c => !c.ok).map(c => c.id)

describe('validateUsdcxBurnBuild — public burn as base case', () => {
  it('accepts the burn against its own approved terms, and still never enables signing', () => {
    const r = validateUsdcxBurnBuild(input())
    expect(failed(r)).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.txHash).toBe('887333810ea503013f1e17c503ed6e691940e177e82f88baa76d19409de76e86')
    expect(r.signingEnabled).toBe(false)
    expect(r.pendingIogConfirmation.sort()).toEqual(['collateral-arrangement', 'reference-inputs', 'validity', 'witnesses'])
    expect(r.checks.find(c => c.id === 'validity')?.detail).toMatch(/No ledger validity interval/)
  })

  it('terms that disagree with the intent fail: recipient, release amount, burn amount, depositor', () => {
    expect(failed(validateUsdcxBurnBuild(input({ terms: terms({ releaseRecipient: '0x' + '11'.repeat(20) }) })))).toContain('terms')
    expect(failed(validateUsdcxBurnBuild(input({ terms: terms({ releaseAmountRaw: '2799000000' }) })))).toContain('terms')
    const burn = failed(validateUsdcxBurnBuild(input({ terms: terms({ burnAmountRaw: '2801000000' }) })))
    expect(burn).toEqual(expect.arrayContaining(['terms', 'mint']))
    expect(failed(validateUsdcxBurnBuild(input({ wallet: { ownAddresses: [OWN], paymentKeyHash: '11'.repeat(28) } })))).toEqual(expect.arrayContaining(['terms', 'required-signers']))
    expect(validateUsdcxBurnBuild(input({ terms: terms({ network: 'preprod' as never }) })).ok).toBe(false)
  })

  it('fails closed when a spent or collateral input cannot be resolved', () => {
    expect(failed(validateUsdcxBurnBuild(input({ resolved: resolvedFor({ drop: 'input' }) })))).toEqual(expect.arrayContaining(['inputs', 'outputs']))
    expect(failed(validateUsdcxBurnBuild(input({ resolved: resolvedFor({ drop: 'collateral' }) })))).toEqual(expect.arrayContaining(['collateral', 'collateral-arrangement']))
  })

  it('refuses spending another party\'s input, and this wallet\'s coins as collateral', () => {
    expect(failed(validateUsdcxBurnBuild(input({ resolved: resolvedFor({ inputAddress: SERVICE_ADDRESS }) })))).toContain('inputs')
    expect(failed(validateUsdcxBurnBuild(input({ resolved: resolvedFor({ collateralAddress: OWN }) })))).toContain('collateral')
  })

  it('refuses a change output sent to anyone else', () => {
    const addr = hex(body.outputs[0].addressBytes)
    const other = addr.slice(0, 2) + 'ab'.repeat(28) + addr.slice(58)
    expect(failed(validateUsdcxBurnBuild(input({ unsignedTxCbor: withBody(addr, other, 2) })))).toContain('outputs')
  })

  it('refuses a transaction whose value does not balance against its resolved inputs (a higher fee)', () => {
    const fee = '1a' + body.fee.toString(16).padStart(8, '0')
    const more = '1a' + (body.fee + 1n).toString(16).padStart(8, '0')
    expect(failed(validateUsdcxBurnBuild(input({ unsignedTxCbor: withBody(`02${fee}`, `02${more}`) })))).toContain('outputs')
  })

  it('refuses a fee above the approved ceiling', () => {
    expect(failed(validateUsdcxBurnBuild(input({ policy: { maxFeeLovelace: 300_000n, maxTotalCollateralLovelace: 5_000_000n, serviceWitnessKeyHashes: [SERVICE_KEY] } })))).toEqual(['fee'])
  })

  it('refuses a withdrawal from any script other than the pinned burn validator', () => {
    const from = 'f1d74de93a7e4940462c4509f59c712889422506f8b63dcfd0c266dc7b'
    expect(failed(validateUsdcxBurnBuild(input({ unsignedTxCbor: withBody(from, 'f1' + 'cd'.repeat(28)) })))).toContain('commitment')
  })

  it('refuses a mainnet build that names another network', () => {
    const addr = hex(body.outputs[0].addressBytes)
    expect(failed(validateUsdcxBurnBuild(input({ unsignedTxCbor: withBody(addr, '00' + addr.slice(2), 2) })))).toEqual(expect.arrayContaining(['network']))
  })

  it('refuses pre-attached signatures from a key that is not an allowed service key', () => {
    expect(failed(validateUsdcxBurnBuild(input({ policy: { maxFeeLovelace: 2_000_000n, maxTotalCollateralLovelace: 5_000_000n, serviceWitnessKeyHashes: ['22'.repeat(28)] } })))).toEqual(['witnesses'])
  })

  it('refuses a pre-attached signature that does not sign this transaction body', () => {
    const witness = hex(parts.witnessSet)
    const vkeys = (decodeCbor(parts.witnessSet) as CborMap).getInt(0) as unknown[][]
    const signature = hex(vkeys[0][1] as Uint8Array)
    const changed = `${signature.slice(0, -2)}${signature.endsWith('00') ? '01' : '00'}`
    expect(witness.includes(signature)).toBe(true)
    const unsignedTxCbor = `84${hex(parts.body)}${witness.replace(signature, changed)}${hex(parts.isValid)}${hex(parts.auxData)}`
    expect(failed(validateUsdcxBurnBuild(input({ unsignedTxCbor })))).toContain('witnesses')
  })

  it('returns a refusal for malformed runtime terms instead of throwing', () => {
    const malformed = input({ terms: { ...terms(), burnAmountRaw: 'invalid' } })
    const r = validateUsdcxBurnBuild(malformed)
    expect(r.ok).toBe(false)
    expect(r.signingEnabled).toBe(false)
    expect(failed(r)).toContain('unreadable')
  })

  it('refuses any pre-attached signature from a key that is neither the service key nor this wallet', () => {
    // The public burn also carries its depositor's signature; for a different wallet that key is foreign.
    const r = validateUsdcxBurnBuild(input({ wallet: { ownAddresses: [OWN], paymentKeyHash: '11'.repeat(28) } }))
    expect(failed(r)).toContain('witnesses')
  })

  it('refuses unbounded collateral', () => {
    expect(failed(validateUsdcxBurnBuild(input({ policy: { maxFeeLovelace: 2_000_000n, maxTotalCollateralLovelace: 100_000n, serviceWitnessKeyHashes: [SERVICE_KEY] } })))).toEqual(['collateral'])
  })

  it('refuses a transaction marked invalid, and unreadable bytes', () => {
    const flipped = `84${hex(parts.body)}${hex(parts.witnessSet)}f4${hex(parts.auxData)}`
    expect(failed(validateUsdcxBurnBuild(input({ unsignedTxCbor: flipped })))).toContain('decode')
    const bad = validateUsdcxBurnBuild(input({ unsignedTxCbor: 'zz' }))
    expect(bad.ok).toBe(false)
    expect(bad.txHash).toBeNull()
  })

  it('the transaction id is the body hash', () => {
    expect(validateUsdcxBurnBuild(input()).txHash).toBe(hex(blake2b(parts.body, { dkLen: 32 })))
  })
})

// ── Private: the user's own unsigned Portal build ─────────────────────────────
const PRIVATE = join(process.env.MM_PRIVATE_FIXTURES ?? join(__dirname, '..', '..', '..', 'private'), 'usdcx-portal-build-2026-10-06.json')

describe.runIf(existsSync(PRIVATE))('validateUsdcxBurnBuild — private Portal build (2026-10-06)', () => {
  const p = existsSync(PRIVATE) ? JSON.parse(readFileSync(PRIVATE, 'utf8')) as {
    unsignedTxCbor: string; terms: XReserveBurnTerms; wallet: { ownAddresses: string[]; paymentKeyHash: string }
    resolved: Array<{ ref: string; address: string; amount: Array<{ unit: string; quantity: string }> }>
  } : null
  const resolved = () => new Map(p!.resolved.map(r => [r.ref, {
    address: r.address,
    lovelace: BigInt(r.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0'),
    assets: new Map(r.amount.filter(a => a.unit !== 'lovelace').map(a => [a.unit, BigInt(a.quantity)] as [string, bigint])),
  }]))
  const run = (over: Partial<BurnBuildValidationInput> = {}) => validateUsdcxBurnBuild({
    terms: p!.terms, unsignedTxCbor: p!.unsignedTxCbor, wallet: p!.wallet, resolved: resolved(),
    policy: { maxFeeLovelace: 1_000_000n, maxTotalCollateralLovelace: 5_000_000n, serviceWitnessKeyHashes: [SERVICE_KEY] }, ...over,
  })

  it('passes every check against the terms the Portal prepared (unsigned: only the service key pre-signed)', () => {
    const r = run()
    expect(failed(r)).toEqual([])
    expect(r.txHash).toBe('018c50116735ae13d33ed7417d0271265ecda562bb2ae8e294310b933172ec0f')
    expect(r.signingEnabled).toBe(false)
  })

  it('fails for other approved terms (amount, recipient) and for unresolved evidence', () => {
    expect(failed(run({ terms: { ...p!.terms, releaseAmountRaw: '4000000' } }))).toContain('terms')
    expect(failed(run({ terms: { ...p!.terms, releaseRecipient: '0x' + '11'.repeat(20) } }))).toContain('terms')
    expect(run({ resolved: new Map() }).ok).toBe(false)
  })
})
