import { describe, expect, it, vi } from 'vitest'
import { tokenDetailsCapabilities, tokenDetailsIdentity, tokenDetailsKey, resolveTokenReceive,
  type TokenDetailsContext, type TokenDetailsHolding, type TokenRestrictionFacts } from './token-details'

const owner = '0x1111111111111111111111111111111111111111'
const smart = '0x2222222222222222222222222222222222222222'
const token: TokenDetailsHolding = { chain: 'ethereum', contractAddress: '0x3333333333333333333333333333333333333333',
  decimals: 18, rawBalance: '123456789012345678901234567890' }
const context: TokenDetailsContext = { accountIndex: 0, accountAddress: owner, mode: 'mainnet', chainId: 'ethereum',
  chainType: 'evm', addresses: { accountIndex: 0, evm: owner, agw: smart, agwOwned: true } }
const valid = vi.fn(() => ({ valid: true }))
const available = { state: 'available' as const, reason: '' }
const caps = (holding = token, ctx = context) => tokenDetailsCapabilities(holding, ctx,
  { sendSupported: true, swapSupported: true, receive: available, activityScope: 'network' })

describe('token panel identity and receive', () => {
  it('preserves exact identifier and raw balance without modifying the holding', () => {
    const before = JSON.stringify(token)
    expect(tokenDetailsIdentity(token, context).tokenIdentifier).toBe(token.contractAddress)
    expect(JSON.stringify(token)).toBe(before)
    expect(token.rawBalance).toBe('123456789012345678901234567890')
  })
  it('binds selection to account, wallet, mode, network, source address and deployment', () => {
    const key = tokenDetailsKey(token, context)
    for (const changed of [
      { ...context, accountIndex: 1 }, { ...context, accountAddress: smart },
      { ...context, mode: 'testnet' as const }, { ...context, mode: 'privacy' as const },
      { ...context, chainId: 'base' }, { ...context, addresses: { ...context.addresses, evm: smart } },
    ]) expect(tokenDetailsKey(token, changed)).not.toBe(key)
    expect(tokenDetailsKey({ ...token, source: 'agw' }, context)).not.toBe(key)
    expect(tokenDetailsKey({ ...token, programmable: { deploymentId: 'bootstrap-a' } }, context))
      .not.toBe(tokenDetailsKey({ ...token, programmable: { deploymentId: 'bootstrap-b' } }, context))
    expect(tokenDetailsKey({ ...token, source: 'cip113' }, context)).not.toBe(tokenDetailsKey(
      { ...token, source: 'cip113' }, { ...context, addresses: { ...context.addresses, cardano: 'changed-owner-address' } }))
  })
  it('does not collapse case-sensitive Solana identifiers', () => {
    const ctx = { ...context, chainId: 'solana', chainType: 'solana' as const }
    expect(tokenDetailsKey({ ...token, chain: 'solana', contractAddress: 'MintAbC' }, ctx))
      .not.toBe(tokenDetailsKey({ ...token, chain: 'solana', contractAddress: 'Mintabc' }, ctx))
  })
  it('uses the EOA for an ordinary token and the exact same address for QR', async () => {
    const check = vi.fn(() => ({ valid: true }))
    const result = await resolveTokenReceive(token, context, check)
    expect(result.capability.state).toBe('available')
    expect(result.address).toBe(owner)
    expect(result.qrPayload).toBe(result.address)
    expect(check).toHaveBeenCalledWith('ethereum', owner)
  })
  it('uses the owned AGW address, never its signer/EOA', async () => {
    const result = await resolveTokenReceive({ ...token, chain: 'abstract', source: 'agw' },
      { ...context, chainId: 'abstract' }, valid)
    expect(result.address).toBe(smart)
    expect(result.identity.source).toBe('agw')
    expect(result.address).not.toBe(owner)
    const agw = { ...token, chain: 'abstract', source: 'agw' as const }
    expect(tokenDetailsKey(agw, { ...context, chainId: 'abstract' })).not.toBe(tokenDetailsKey(agw,
      { ...context, chainId: 'abstract', addresses: { ...context.addresses, agwOwned: false } }))
  })
  it('does not offer AGW receiving on another chain, testnet, or without ownership', async () => {
    const agw = { ...token, chain: 'abstract', source: 'agw' as const }
    for (const ctx of [
      { ...context, chainId: 'abstract', addresses: { ...context.addresses, agwOwned: false } },
      { ...context, chainId: 'abstract', mode: 'testnet' as const },
    ]) expect((await resolveTokenReceive(agw, ctx, valid)).address).toBeNull()
    expect((await resolveTokenReceive({ ...token, source: 'agw' }, context, valid)).address).toBeNull()
  })
  it('rejects account/network/family mismatches before checking an address', async () => {
    const check = vi.fn(() => ({ valid: true }))
    for (const ctx of [
      { ...context, accountIndex: 1 }, { ...context, chainId: 'base' },
      { ...context, chainType: 'solana' as const },
    ]) expect((await resolveTokenReceive(token, ctx, check)).capability.state).toBe('failed')
    expect(check).not.toHaveBeenCalled()
  })
  it('withholds an unavailable, invalid, or asset-identifier receive address', async () => {
    expect((await resolveTokenReceive(token, { ...context, addresses: { accountIndex: 0 } }, valid)).capability.state).toBe('unknown')
    expect((await resolveTokenReceive(token, { ...context, addresses: { accountIndex: 0, evm: token.contractAddress } }, valid)).address).toBeNull()
    expect((await resolveTokenReceive(token, context, () => ({ valid: false, reason: 'Wrong network' }))).capability.reason).toBe('Wrong network')
    expect((await resolveTokenReceive(token, context, () => { throw new Error('offline') })).capability.state).toBe('failed')
  })
  it('does not guess Bitcoin special-asset or programmable receive addresses', async () => {
    const special = await resolveTokenReceive({ ...token, chain: 'bitcoin', contractAddress: 'rune:TEST' },
      { ...context, chainId: 'bitcoin', chainType: 'bitcoin' }, valid)
    expect(special.capability.state).toBe('unsupported')
    expect(special.qrPayload).toBeNull()
    expect((await resolveTokenReceive({ ...token, chain: 'cardano', programmable: { deploymentId: 'bootstrap' } },
      { ...context, chainId: 'cardano', chainType: 'cardano' }, valid)).qrPayload).toBeNull()
  })
})

describe('action availability', () => {
  it('keeps current ordinary-token capabilities and labels network activity honestly', () => {
    expect(caps().send.state).toBe('available')
    expect(caps().swap.state).toBe('available')
    expect(caps().activity.reason).toContain('not filtered to this token')
  })
  it('does not invent support or use rounded/malformed balances', () => {
    for (const rawBalance of [undefined, '0', '000', '1,000', '-1', '1.5']) {
      expect(caps({ ...token, rawBalance }).send.state).toBe('unsupported')
    }
    expect(caps({ ...token, decimalsKnown: false }).send.state).toBe('unsupported')
    expect(tokenDetailsCapabilities(token, context, { sendSupported: false, swapSupported: false, receive: available }).send.state).toBe('unsupported')
    expect(tokenDetailsCapabilities(token, context, { sendSupported: false, swapSupported: false, receive: available }).activity.scope).toBe('none')
  })
  it('blocks wrong account context and unsupported AGW swapping', () => {
    expect(caps(token, { ...context, accountIndex: 2 }).receive.state).toBe('failed')
    expect(caps({ ...token, chain: 'abstract', source: 'agw' }, { ...context, chainId: 'abstract' }).swap.state).toBe('unsupported')
  })
  it('cannot enable programmable execution through generic Cardano support', () => {
    const holding = { ...token, chain: 'cardano', programmable: { deploymentId: 'bootstrap' } }
    const ctx = { ...context, chainId: 'cardano', chainType: 'cardano' as const }
    const input = { sendSupported: true, swapSupported: true, receive: available }
    expect(tokenDetailsCapabilities(holding, ctx, input).send.state).toBe('unknown')
    expect(tokenDetailsCapabilities(holding, ctx, { ...input, restrictions: { state: 'loading', reason: '' } }).swap.state).toBe('checking')
    const facts: TokenRestrictionFacts = { deploymentId: 'bootstrap', moduleId: 'module', checkedAt: 1,
      evidenceSource: 'fixture', canFreeze: true, currentlyFrozen: true, canSeize: null, canForceTransfer: null,
      transferRequirements: [], thirdPartyAuthority: null, upgradeAuthority: null }
    expect(tokenDetailsCapabilities(holding, ctx, { ...input, restrictions: { state: 'ready', value: facts, checkedAt: 1 } }).send.state).toBe('restricted')
    expect(tokenDetailsCapabilities(holding, ctx, { ...input, restrictions: { state: 'ready', value: { ...facts, currentlyFrozen: false }, checkedAt: 1 } }).send.state).toBe('unsupported')
    expect(tokenDetailsCapabilities(holding, ctx, { ...input, restrictions: { state: 'ready', value: { ...facts, deploymentId: 'another-deployment' }, checkedAt: 1 } }).send.state).toBe('unknown')
    expect(tokenDetailsCapabilities(holding, ctx, input).receive.state).toBe('unsupported')
    expect(holding.rawBalance).toBe(token.rawBalance)
  })
})
