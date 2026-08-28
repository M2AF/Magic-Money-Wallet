/**
 * Live smoke test for the on-chain token tier (src/main/onchain-tokens.ts).
 *
 * Hits REAL keyless public RPCs — no key, no proxy, no Alchemy — and proves the
 * whole path end to end: Multicall3 batched balanceOf, on-chain metadata reads,
 * and the Transfer-log discovery sweep. The unit tests are hermetic; this is the
 * one that would have caught a wrong Multicall3 encoding or a chain whose RPC
 * quietly changed its eth_getLogs limit.
 *
 *   node scripts/onchain-tier-smoke.mjs [chain] [address]
 *
 * Defaults to a Base address holding USDC. Exits non-zero if the tier returns
 * `undefined` (tier unavailable) on a chain that should work.
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const chain = process.argv[2] ?? 'base'
const address = process.argv[3] ?? '0x28C6c06298d514Db089934071355E5743bf21d60'

// The module imports secure-store (Electron `app`) for its caches. Stub those to
// in-memory maps so the smoke test exercises the RPC path, not the disk path.
const STUB = `
export const PUBLIC_RPCS = ${JSON.stringify(await readRpcs())}
let meta = {}, scan = {}
export async function loadTokenMetaCache() { return meta }
export function saveTokenMetaCache(m) { meta = m }
export async function loadTokenBalanceCache() { return {} }
export async function loadOnchainScanCache() { return scan }
export function saveOnchainScanCache(m) { scan = m }
`

async function readRpcs() {
  const src = await import('node:fs').then(fs => fs.promises.readFile('src/main/chain-config.ts', 'utf-8'))
  const m = src.match(/export const PUBLIC_RPCS: Record<string, string\[\]> = \{([\s\S]*?)\n\}/)
  if (!m) throw new Error('could not read PUBLIC_RPCS from chain-config.ts')
  const out = {}
  for (const line of m[1].split('\n')) {
    const row = line.match(/^\s*([a-z]+):\s*\[(.*)\],\s*$/)
    if (!row) continue
    out[row[1]] = [...row[2].matchAll(/'([^']+)'/g)].map(x => x[1])
  }
  return out
}

const dir = mkdtempSync(join(tmpdir(), 'mm-onchain-'))
try {
  await build({
    entryPoints: ['src/main/onchain-tokens.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: join(dir, 'onchain.mjs'),
    external: ['electron'],
    plugins: [{
      name: 'stub-stores',
      setup(b) {
        b.onResolve({ filter: /(secure-store|chain-config)$/ }, () => ({ path: 'stub', namespace: 'stub' }))
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: STUB, loader: 'js' }))
      },
    }],
  })

  const { fetchOnchainTokens } = await import(pathToFileURL(join(dir, 'onchain.mjs')).href)

  const config = { customTokens: [], testnetMode: false }
  console.log(`\nchain=${chain}  address=${address}`)
  const t0 = Date.now()
  const rows = await fetchOnchainTokens(chain, address, config)
  const ms = Date.now() - t0

  if (rows === undefined) {
    console.error(`\nFAIL: tier returned undefined (unavailable) after ${ms}ms`)
    process.exit(1)
  }
  console.log(`\n${rows.length} tokens held, in ${ms}ms — keyless, no indexer:\n`)
  for (const r of rows.slice(0, 25)) {
    const amount = Number(BigInt(r.rawBalance)) / 10 ** r.decimals
    console.log(
      '  ' + r.symbol.padEnd(12),
      amount.toLocaleString('en-US', { maximumFractionDigits: 6 }).padStart(22),
      ' ', r.name.slice(0, 30).padEnd(30), r.contractAddress
    )
  }
  if (rows.length > 25) console.log(`  … and ${rows.length - 25} more`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
