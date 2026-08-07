/**
 * gen-webauthn-vectors.mjs — MagicMoney Wallet
 *
 * Emits src/main/__fixtures__/webauthn-vectors.json: the cross-language contract
 * for the seed-derived WebAuthn authenticator. The TypeScript core (Phase 1) and
 * the Android provider's Java port (Phase 4) must BOTH reproduce every byte in
 * this file. If they disagree, a passkey created on one will not open on the
 * other and the user's only recourse is the seed phrase they can no longer use.
 *
 * Run:  node scripts/gen-webauthn-vectors.mjs
 *
 * Regenerating is a deliberate act. `webauthn-authenticator.test.ts` asserts the
 * committed file, so an accidental spec change shows up as a failing test, not
 * as a silently rewritten fixture.
 *
 * The mnemonics below are PUBLIC test phrases (Foundry/Anvil's and BIP-39's own
 * all-`abandon` vector). Nothing here is a secret; the private keys are included
 * on purpose so a Java mismatch can be localised to derivation vs encoding.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outFile = join(root, 'src', 'main', '__fixtures__', 'webauthn-vectors.json')

// The core is TypeScript; bundle it to CJS the same way `npm run test:tor` does
// rather than adding a TS runner dependency.
const stage = mkdtempSync(join(tmpdir(), 'mm-webauthn-vectors-'))
const bundle = join(stage, 'core.cjs')
try {
  // Relative source path + cwd: the repo path contains spaces, which a shell-
  // spawned npx would split on Windows.
  execFileSync('npx', [
    'esbuild', 'src/main/webauthn-authenticator.ts',
    '--bundle', '--platform=node', '--format=cjs', `--outfile=${bundle}`,
  ], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })

  const core = await import(`file://${bundle.replace(/\\/g, '/')}`)
  const {
    deriveWebauthnRoot, deriveCredentialMacKey, deriveCredentialKey,
    makeCredentialId, buildAttestationObject, buildAssertion,
    rpIdHash, coseKeyFromPublicKey, toHex, base64url,
    WEBAUTHN_SPEC_VERSION, CRED_ID_VERSION, MAGICMONEY_AAGUID, SIGN_COUNT,
  } = core.default ?? core

  const FOUNDRY = 'test test test test test test test test test test test junk'
  const BIP39_ZERO = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

  // Fixed nonces: a real registration draws these from the CSPRNG, but a test
  // vector has to pin them or nothing downstream is reproducible.
  const nonceA = Uint8Array.from(Array.from({ length: 16 }, (_, i) => i))
  const nonceB = Uint8Array.from(Array.from({ length: 16 }, (_, i) => 0xff - i * 3))
  const nonceC = Uint8Array.from(Array.from({ length: 16 }, (_, i) => (i * 37 + 5) & 0xff))

  // Fixed clientDataHashes. Deterministic (RFC 6979) signing means the signature
  // bytes are part of the contract, so these must be pinned too.
  const { createHash } = await import('node:crypto')
  const sha = (s) => new Uint8Array(createHash('sha256').update(s).digest())

  const cases = [
    { label: 'foundry/account0/chainlensnft.info', mnemonic: FOUNDRY, accountIndex: 0, rpId: 'chainlensnft.info', nonce: nonceA, clientData: 'magicmoney-vector-1' },
    { label: 'foundry/account0/example.com', mnemonic: FOUNDRY, accountIndex: 0, rpId: 'example.com', nonce: nonceB, clientData: 'magicmoney-vector-2' },
    // Same mnemonic, different account ⇒ a distinct passkey identity.
    { label: 'foundry/account1/chainlensnft.info', mnemonic: FOUNDRY, accountIndex: 1, rpId: 'chainlensnft.info', nonce: nonceA, clientData: 'magicmoney-vector-3' },
    // Different mnemonic, IDENTICAL rpId + nonce ⇒ must differ everywhere.
    { label: 'bip39-zero/account0/chainlensnft.info', mnemonic: BIP39_ZERO, accountIndex: 0, rpId: 'chainlensnft.info', nonce: nonceA, clientData: 'magicmoney-vector-4' },
    { label: 'bip39-zero/account0/webauthn.io', mnemonic: BIP39_ZERO, accountIndex: 0, rpId: 'webauthn.io', nonce: nonceC, clientData: 'magicmoney-vector-5' },
  ]

  const vectors = []
  for (const c of cases) {
    const rootKey = await deriveWebauthnRoot(c.mnemonic, c.accountIndex)
    const macKey = deriveCredentialMacKey(rootKey)
    const key = deriveCredentialKey(rootKey, c.rpId, c.nonce)
    const credentialId = makeCredentialId(rootKey, c.rpId, c.nonce)
    const att = buildAttestationObject({ root: rootKey, rpId: c.rpId, nonce: c.nonce })
    const clientDataHash = sha(c.clientData)
    const assertion = buildAssertion({ root: rootKey, rpId: c.rpId, credentialId, clientDataHash })

    vectors.push({
      label: c.label,
      mnemonic: c.mnemonic,
      accountIndex: c.accountIndex,
      rpId: c.rpId,
      nonce: toHex(c.nonce),
      webauthnRoot: toHex(rootKey),
      macKey: toHex(macKey),
      rpIdHash: toHex(rpIdHash(c.rpId)),
      scalarCounter: key.counter,
      privateKey: toHex(key.privateKey),
      publicKeyUncompressed: toHex(key.publicKey),
      publicKeyX: toHex(key.x),
      publicKeyY: toHex(key.y),
      coseKey: toHex(coseKeyFromPublicKey(key.publicKey)),
      credentialId: toHex(credentialId),
      credentialIdBase64url: base64url(credentialId),
      registration: {
        authData: toHex(att.authData),
        attestationObject: toHex(att.attestationObject),
      },
      assertion: {
        clientDataHashSource: c.clientData,
        clientDataHash: toHex(clientDataHash),
        authenticatorData: toHex(assertion.authenticatorData),
        signatureDer: toHex(assertion.signature),
      },
    })
  }

  const doc = {
    $comment: 'CONTRACT — the TypeScript core and the Android Java port must both reproduce every value here byte-for-byte. Regenerate with `node scripts/gen-webauthn-vectors.mjs`. Mnemonics and private keys are PUBLIC test values; nothing here is secret.',
    spec: {
      version: WEBAUTHN_SPEC_VERSION,
      rootSalt: 'magicmoney/webauthn',
      rootInfo: 'v1 for accountIndex 0, otherwise v1/<accountIndex>',
      macKeyInfo: 'cred-id-mac',
      credentialIdFormat: '0x01 || nonce(16) || HMAC-SHA256(macKey, rpIdHash||nonce)[0..15]',
      credentialIdVersion: CRED_ID_VERSION,
      scalarDerivation: 'HKDF-Expand(root, info=rpIdHash(32)||nonce(16)||ctr(1), 32), rejection-sampled into [1, n-1]; ctr starts at 0',
      aaguid: toHex(MAGICMONEY_AAGUID),
      signCount: SIGN_COUNT,
      flags: 'UP|UV|BE|BS (|AT on registration) = 0x5d registration, 0x1d assertion',
      attestationFormat: 'none',
      signature: 'ES256 over SHA-256(authenticatorData || clientDataHash), RFC 6979 deterministic k, low-S normalised, ASN.1 DER',
    },
    vectors,
    // Every one of these must be REJECTED by parseCredentialId. Deriving a
    // different key from a mangled id instead of throwing is the bug this
    // section exists to prevent.
    tamper: (() => {
      const v = vectors[0]
      const idHex = v.credentialId
      const bytes = Uint8Array.from(idHex.match(/../g).map((h) => parseInt(h, 16)))
      const flip = (i, bit) => { const b = bytes.slice(); b[i] ^= bit; return toHex(b) }
      return {
        rpId: v.rpId,
        mnemonic: v.mnemonic,
        accountIndex: v.accountIndex,
        mustReject: [
          { why: 'version byte flipped', credentialId: flip(0, 0x01) },
          { why: 'first nonce bit flipped', credentialId: flip(1, 0x01) },
          { why: 'last nonce byte flipped', credentialId: flip(16, 0x80) },
          { why: 'first tag bit flipped', credentialId: flip(17, 0x01) },
          { why: 'last tag bit flipped', credentialId: flip(32, 0x01) },
          { why: 'truncated', credentialId: idHex.slice(0, -2) },
          { why: 'extended', credentialId: idHex + '00' },
          { why: 'empty', credentialId: '' },
          { why: 'minted for a different rpId', credentialId: vectors[1].credentialId },
          { why: 'minted by a different mnemonic', credentialId: vectors[3].credentialId },
        ],
      }
    })(),
  }

  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, JSON.stringify(doc, null, 2) + '\n')
  console.log(`wrote ${outFile} — ${vectors.length} vectors, ${doc.tamper.mustReject.length} tamper cases`)
} finally {
  rmSync(stage, { recursive: true, force: true })
}
