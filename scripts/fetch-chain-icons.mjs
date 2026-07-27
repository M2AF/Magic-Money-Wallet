// Regenerates the bundled chain logos used by the Networks tab
// (src/renderer/assets/chains/*.webp).
//
// The icons are fetched ONCE here and committed, so the app never makes a
// runtime request for them — the dashboard stays offline-capable and no third
// party learns which chains a user holds.
//
//   node scripts/fetch-chain-icons.mjs
//
// Chains absent from this map (e.g. midnight, user-added custom chains) fall
// back to the glowing colour dot in ChainCard.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src/renderer/assets/chains')
const SIZE = 48 // rendered at 22px, so 48px covers 2x DPI

// chainId -> DefiLlama chain-icon slug (mostly identical to our ids).
const SLUGS = {
  ethereum: 'ethereum', arbitrum: 'arbitrum', optimism: 'optimism', base: 'base',
  polygon: 'polygon', avalanche: 'avalanche', blast: 'blast', gnosis: 'gnosis',
  monad: 'monad', abstract: 'abstract', apechain: 'apechain', robinhood: 'robinhood',
  ronin: 'ronin', soneium: 'soneium', worldchain: 'world-chain', zora: 'zora',
  hyperevm: 'hyperevm', solana: 'solana', cardano: 'cardano', bitcoin: 'bitcoin',
  polkadot: 'polkadot', tron: 'tron', dogecoin: 'doge', monero: 'monero', zcash: 'zcash'
}

// Chains whose DefiLlama asset is wrong/blank — pulled from the canonical
// ethereum-lists/chains icon instead. Base's Llama icon is a plain blue square
// with the logomark missing.
const OVERRIDES = {
  base: 'https://ipfs.io/ipfs/QmaxRoHpxZd8PqccAynherrMznMufG6sdmHZLihkECXmZv'
}

await mkdir(OUT_DIR, { recursive: true })

let failures = 0
for (const [chainId, slug] of Object.entries(SLUGS)) {
  const url = OVERRIDES[chainId] ?? `https://icons.llamao.fi/icons/chains/rsz_${slug}.jpg`
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const src = Buffer.from(await res.arrayBuffer())
    const out = await sharp(src)
      .resize(SIZE, SIZE, { fit: 'cover' })
      .webp({ quality: 88 })
      .toBuffer()
    await writeFile(resolve(OUT_DIR, `${chainId}.webp`), out)
    console.log(`✓ ${chainId} (${out.length} B)`)
  } catch (err) {
    failures++
    console.error(`✗ ${chainId}: ${err instanceof Error ? err.message : err}`)
  }
}

if (failures) {
  console.error(`\n${failures} icon(s) failed — those chains keep the colour-dot fallback.`)
  process.exit(1)
}
