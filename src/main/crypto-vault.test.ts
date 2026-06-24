import { describe, it, expect } from 'vitest'
import { encryptSecret, decryptSecret, isEncryptedBlob } from './crypto-vault'

// Locks in the C-1 password vault: a wrong password MUST fail, and a correct one
// MUST recover the exact phrase. A regression here would silently lock users out
// of (or wrongly expose) their funds.
describe('crypto-vault', () => {
  const SECRET = 'legal winner thank year wave sausage worth useful legal winner thank yellow'

  it('round-trips a secret with the correct password', async () => {
    const blob = await encryptSecret(SECRET, 'correct horse battery staple')
    expect(isEncryptedBlob(blob)).toBe(true)
    expect(await decryptSecret(blob, 'correct horse battery staple')).toBe(SECRET)
  })

  it('rejects a wrong password', async () => {
    const blob = await encryptSecret(SECRET, 'the-right-password')
    await expect(decryptSecret(blob, 'the-WRONG-password')).rejects.toThrow(/incorrect password/i)
  })

  it('uses a fresh salt + iv on every encryption (no nonce reuse)', async () => {
    const a = await encryptSecret('x', 'pw')
    const b = await encryptSecret('x', 'pw')
    expect(a.salt).not.toEqual(b.salt)
    expect(a.iv).not.toEqual(b.iv)
    expect(a.data).not.toEqual(b.data)
  })

  it('isEncryptedBlob distinguishes blobs from legacy raw strings', () => {
    expect(isEncryptedBlob({ salt: [1], iv: [2], data: [3] })).toBe(true)
    expect(isEncryptedBlob('legacy raw mnemonic')).toBe(false)
    expect(isEncryptedBlob(null)).toBe(false)
  })
})
