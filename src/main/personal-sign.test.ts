import { describe, it, expect } from 'vitest'
import { toHex, recoverMessageAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { isHexPayload, personalSignMessage, personalSignPreview } from './personal-sign'

// What this file guards: a `personal_sign` signature that recovers to the
// address we claimed to sign with. The bug it was written for produced a
// perfectly well-formed signature over the WRONG digest — nothing threw, and
// the only symptom was ChainLens answering "EVM signature mismatch".

const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const account = privateKeyToAccount(KEY)
const NONCE = 'a3f1'.repeat(16)
const chainlensMessage = `ChainLens login\nAddress: ${account.address}\nNonce: ${NONCE}`

describe('isHexPayload', () => {
  it('accepts 0x-prefixed whole bytes, including empty', () => {
    expect(isHexPayload('0x')).toBe(true)
    expect(isHexPayload('0xdeadBEEF')).toBe(true)
  })

  it('rejects anything a dApp meant as text', () => {
    expect(isHexPayload(chainlensMessage)).toBe(false)
    expect(isHexPayload('deadbeef')).toBe(false)   // no 0x — text, per MetaMask
    expect(isHexPayload('0xabc')).toBe(false)      // odd length is not bytes
    expect(isHexPayload('0xzz')).toBe(false)
  })
})

describe('personalSignMessage', () => {
  it('recovers to the signer when the dApp sends hex', async () => {
    const signature = await account.signMessage({ message: personalSignMessage(toHex(chainlensMessage)) })
    expect(await recoverMessageAddress({ message: chainlensMessage, signature })).toBe(account.address)
  })

  it('recovers to the signer when the dApp sends plain text', async () => {
    const signature = await account.signMessage({ message: personalSignMessage(chainlensMessage) })
    expect(await recoverMessageAddress({ message: chainlensMessage, signature })).toBe(account.address)
  })

  it('hex and text payloads of the same message produce the same signature', async () => {
    const fromHex = await account.signMessage({ message: personalSignMessage(toHex(chainlensMessage)) })
    const fromText = await account.signMessage({ message: personalSignMessage(chainlensMessage) })
    expect(fromHex).toBe(fromText)
  })

  // The regression itself, pinned. `{ raw: <text> }` makes viem read the text
  // AS hex: it derives the EIP-191 length prefix from the character count and
  // hashes something unrelated. Silent, and wrong.
  it('is not the same as the old unconditional { raw } form', async () => {
    const broken = await account.signMessage({ message: { raw: chainlensMessage as `0x${string}` } })
    expect(await recoverMessageAddress({ message: chainlensMessage, signature: broken }))
      .not.toBe(account.address)
  })
})

describe('personalSignPreview', () => {
  it('decodes hex so the approval prompt shows the message, not an empty box', () => {
    expect(personalSignPreview(toHex(chainlensMessage))).toBe(chainlensMessage)
  })

  it('passes plain text through untouched', () => {
    expect(personalSignPreview(chainlensMessage)).toBe(chainlensMessage)
  })

  it('shows the hex itself when the bytes are not text', () => {
    const digest = `0x${'ff'.repeat(32)}`
    expect(personalSignPreview(digest)).toBe(digest)
  })
})
