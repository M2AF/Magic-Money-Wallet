import { describe, expect, it } from 'vitest'
import { tokenExplorerUrl } from './token-explorer'
import { consumeBack, registerBackHandler } from './back-handler'

const POLICY = 'b025efe5b44b43ed154419c66b0efc9cf148fd98f464e261018c89e8'
const UNIT = POLICY + '444953393837'

describe('tokenExplorerUrl', () => {
  it('builds the vetted Cardanoscan URL on mainnet', () => {
    expect(tokenExplorerUrl({ chain: 'cardano', contractAddress: UNIT }, 'mainnet'))
      .toBe(`https://cardanoscan.io/token/${UNIT}`)
  })
  it('adds the programmable tab only for cip113 holdings', () => {
    expect(tokenExplorerUrl({ chain: 'cardano', contractAddress: UNIT, source: 'cip113' }, 'mainnet'))
      .toBe(`https://cardanoscan.io/token/${UNIT}?tab=programmable`)
  })
  it('never routes testnet tokens to the mainnet explorer', () => {
    expect(tokenExplorerUrl({ chain: 'cardano', contractAddress: UNIT }, 'testnet')).toBeNull()
  })
  it('withholds links for unvetted chains and malformed units', () => {
    expect(tokenExplorerUrl({ chain: 'ethereum', contractAddress: UNIT }, 'mainnet')).toBeNull()
    expect(tokenExplorerUrl({ chain: 'cardano', contractAddress: 'asset1abc' }, 'mainnet')).toBeNull()
    expect(tokenExplorerUrl({ chain: 'cardano', contractAddress: UNIT.toUpperCase() }, 'mainnet')).toBeNull()
    expect(tokenExplorerUrl({ chain: 'cardano', contractAddress: POLICY + '4' }, 'mainnet')).toBeNull()
    expect(tokenExplorerUrl({ chain: 'cardano', contractAddress: UNIT + '/../x' }, 'mainnet')).toBeNull()
  })
})

describe('back-handler', () => {
  it('newest overlay consumes Back; none registered means not consumed', () => {
    expect(consumeBack()).toBe(false)
    const calls: string[] = []
    const off1 = registerBackHandler(() => calls.push('a'))
    const off2 = registerBackHandler(() => calls.push('b'))
    expect(consumeBack()).toBe(true)
    off2()
    expect(consumeBack()).toBe(true)
    off1()
    expect(consumeBack()).toBe(false)
    expect(calls).toEqual(['b', 'a'])
  })
})
