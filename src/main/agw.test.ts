import { describe, it, expect, vi, afterEach } from 'vitest'
import { encodeFunctionResult, parseAbi, getAddress } from 'viem'
import { normalizeSignerKey, signerFromSecret, resolveAccountAgw, agwForSigner } from './agw'

// The gate this file guards: `agwOwned` decides whether the UI offers a Send that
// can actually be signed, and whether an imported portal signer key is kept on
// disk at all. Getting it wrong either strands the user in watch-only or, worse,
// shows a phantom smart wallet derived from a key that owns nothing.

const FOUNDRY = 'test test test test test test test test test test test junk'
const FOUNDRY_EVM = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const FOUNDRY_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

const EOA    = '0x1111111111111111111111111111111111111111'
const SIGNER = '0x2222222222222222222222222222222222222222'
const AGW    = '0x3333333333333333333333333333333333333333'
const OTHER  = '0x4444444444444444444444444444444444444444'

const OWNERS_ABI   = parseAbi(['function k1ListOwners() view returns (address[])'])
const RESOLVER_ABI = parseAbi(['function exclusiveWalletByRights(address vault, bytes24 rights) view returns (address)'])
const FACTORY_ABI  = parseAbi(['function getAddressForSalt(bytes32 salt) view returns (address)'])

const RESOLVER = '0x0000000078CC4Cc1C14E27c0fa35ED6E5E58825D'.toLowerCase()
const FACTORY  = '0x9B947df68D35281C972511B3E7BC875926f26C1A'.toLowerCase()

/**
 * Stub the Abstract RPC. `links` maps an EOA to the AGW the resolver reports,
 * `salts` maps an EOA to its counterfactual factory address, and `owners` maps an
 * AGW to its k1ListOwners result — omit an AGW entirely to model one that is not
 * deployed (eth_call returns '0x', which must read as "unknown", not "no owners").
 */
function stubRpc(opts: {
  links?: Record<string, string>
  salts?: Record<string, string>
  owners?: Record<string, string[]>
}) {
  const lower = (m: Record<string, unknown> = {}) =>
    Object.fromEntries(Object.entries(m).map(([k, v]) => [k.toLowerCase(), v]))
  const links = lower(opts.links) as Record<string, string>
  const salts = lower(opts.salts) as Record<string, string>
  const owners = lower(opts.owners) as Record<string, string[]>
  // Which EOA a call refers to is recoverable from the trailing 20 bytes of the
  // resolver's calldata; the factory hashes its input, so it is keyed by order.
  const saltOrder = Object.keys(salts)

  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
    const { params } = JSON.parse(init.body) as { params: [{ to: string; data: string }, string] }
    const to = params[0].to.toLowerCase()
    const data = params[0].data

    let result = '0x'
    if (to === RESOLVER) {
      const vault = `0x${data.slice(34, 74)}`
      // The real resolver echoes the input back when there is no link.
      const linked = links[vault] ?? vault
      result = encodeFunctionResult({ abi: RESOLVER_ABI, functionName: 'exclusiveWalletByRights', result: getAddress(linked) })
    } else if (to === FACTORY) {
      // Only one salted address is ever asked for per test, so the first entry is
      // the answer; tests that need none leave `salts` empty and get '0x'.
      const eoa = saltOrder[0]
      if (eoa) result = encodeFunctionResult({ abi: FACTORY_ABI, functionName: 'getAddressForSalt', result: getAddress(salts[eoa]) })
    } else if (owners[to]) {
      result = encodeFunctionResult({ abi: OWNERS_ABI, functionName: 'k1ListOwners', result: owners[to].map(o => getAddress(o)) })
    }
    return { json: async () => ({ jsonrpc: '2.0', id: 1, result }) }
  }))
}

afterEach(() => { vi.unstubAllGlobals() })

describe('normalizeSignerKey', () => {
  it('accepts what the Abstract portal exports, and the bare-hex form', () => {
    expect(normalizeSignerKey(FOUNDRY_KEY)).toBe(FOUNDRY_KEY)
    expect(normalizeSignerKey(FOUNDRY_KEY.slice(2))).toBe(FOUNDRY_KEY)
    expect(normalizeSignerKey(FOUNDRY_KEY.toUpperCase().replace('0X', '0x'))).toBe(FOUNDRY_KEY)
  })

  it('survives a clipboard round-trip', () => {
    expect(normalizeSignerKey(`  ${FOUNDRY_KEY}\n`)).toBe(FOUNDRY_KEY)
  })

  it('rejects anything that is not a 32-byte key', () => {
    expect(normalizeSignerKey('')).toBeNull()
    expect(normalizeSignerKey('0x1234')).toBeNull()
    expect(normalizeSignerKey(`${FOUNDRY_KEY}ff`)).toBeNull()
    expect(normalizeSignerKey(FOUNDRY)).toBeNull()
    expect(normalizeSignerKey(`0x${'z'.repeat(64)}`)).toBeNull()
  })
})

describe('signerFromSecret', () => {
  it('takes a private key and reports its address', async () => {
    const { privateKey, address } = await signerFromSecret(FOUNDRY_KEY)
    expect(privateKey).toBe(FOUNDRY_KEY)
    expect(address).toBe(FOUNDRY_EVM)
  })

  it('takes a recovery phrase and uses its account-0 EVM key', async () => {
    const { address } = await signerFromSecret(FOUNDRY)
    expect(address).toBe(FOUNDRY_EVM)
  })

  it('rejects a secret that is neither, without echoing it', async () => {
    await expect(signerFromSecret('hunter2')).rejects.toThrow(/not a signer key/)
    await expect(signerFromSecret('hunter2')).rejects.not.toThrow(/hunter2/)
  })

  it('rejects 64 hex characters that are not a valid curve scalar', async () => {
    await expect(signerFromSecret(`0x${'00'.repeat(32)}`)).rejects.toThrow(/secp256k1/)
  })
})

describe('agwForSigner', () => {
  it('finds the AGW the signer is linked to', async () => {
    stubRpc({ links: { [SIGNER]: AGW }, owners: { [AGW]: [SIGNER] } })
    expect(await agwForSigner(SIGNER)).toBe(getAddress(AGW))
  })

  it('falls back to the factory salt for a portal-created AGW', async () => {
    stubRpc({ salts: { [SIGNER]: AGW }, owners: { [AGW]: [SIGNER] } })
    expect(await agwForSigner(SIGNER)).toBe(getAddress(AGW))
  })

  it('refuses a counterfactual address the signer does not actually own', async () => {
    // deriveAgwAddress answers for ANY key; without the ownership check this
    // would surface a phantom smart wallet the user could send funds into.
    stubRpc({ salts: { [SIGNER]: AGW } })          // AGW absent from `owners` = not deployed
    expect(await agwForSigner(SIGNER)).toBeNull()
  })

  it('refuses a deployed AGW owned by someone else', async () => {
    stubRpc({ salts: { [SIGNER]: AGW }, owners: { [AGW]: [OTHER] } })
    expect(await agwForSigner(SIGNER)).toBeNull()
  })
})

describe('resolveAccountAgw', () => {
  it('is watch-only when the AGW is owned by a signer we do not hold', async () => {
    stubRpc({ links: { [EOA]: AGW }, owners: { [AGW]: [OTHER] } })
    expect(await resolveAccountAgw(EOA)).toEqual({ agw: getAddress(AGW), agwOwned: false, agwSignerActive: false })
  })

  it('becomes spendable once that signer key is imported', async () => {
    stubRpc({ links: { [EOA]: AGW }, owners: { [AGW]: [SIGNER] } })
    expect(await resolveAccountAgw(EOA, null, SIGNER)).toEqual({
      agw: getAddress(AGW), agwOwned: true, agwSignerActive: true
    })
  })

  it('discovers the AGW from the imported signer alone — nothing to paste', async () => {
    stubRpc({ salts: { [SIGNER]: AGW }, owners: { [AGW]: [SIGNER] } })
    const r = await resolveAccountAgw(EOA, null, SIGNER)
    expect(r.agw).toBe(getAddress(AGW))
    expect(r.agwOwned).toBe(true)
    expect(r.agwSignerActive).toBe(true)
  })

  it('prefers this wallet’s own key when it also owns the AGW', async () => {
    // Both can sign, so the send path stays on the seed-derived key and the
    // imported blob is never decrypted.
    stubRpc({ links: { [EOA]: AGW }, owners: { [AGW]: [EOA, SIGNER] } })
    expect(await resolveAccountAgw(EOA, null, SIGNER)).toEqual({
      agw: getAddress(AGW), agwOwned: true, agwSignerActive: false
    })
  })

  it('keeps a manual override as the AGW, and reports the signer useless there', async () => {
    stubRpc({ owners: { [OTHER]: [] }, salts: { [SIGNER]: AGW } })
    const r = await resolveAccountAgw(EOA, OTHER, SIGNER)
    expect(r.agw).toBe(getAddress(OTHER))
    expect(r.agwOwned).toBe(false)
    expect(r.agwSignerActive).toBe(false)
  })

  it('reports no AGW when nothing links and the signer owns nothing', async () => {
    stubRpc({})
    expect(await resolveAccountAgw(EOA, null, SIGNER)).toEqual({ agw: undefined, agwOwned: false })
  })

  it('ignores a malformed stored signer instead of throwing', async () => {
    stubRpc({ links: { [EOA]: AGW }, owners: { [AGW]: [OTHER] } })
    const r = await resolveAccountAgw(EOA, null, 'not-an-address')
    expect(r.agw).toBe(getAddress(AGW))
    expect(r.agwOwned).toBe(false)
  })
})
