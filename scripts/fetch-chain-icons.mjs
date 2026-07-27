// Regenerates the bundled chain logos used by the Networks tab
// (src/renderer/assets/chains/*.webp).
//
// The icons are fetched ONCE here and committed, so the app never makes a
// runtime request for them — the dashboard stays offline-capable and no third
// party learns which chains a user holds.
//
//   node scripts/fetch-chain-icons.mjs
//
// Chains absent from this map (e.g. user-added custom chains) fall back to the
// glowing colour dot in ChainCard.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(HERE, '../src/renderer/assets/chains')
const SRC_DIR = resolve(HERE, 'chain-icon-sources')
const SIZE = 48 // rendered at 22px, so 48px covers 2x DPI

// chainId -> DefiLlama chain-icon slug (mostly identical to our ids).
const SLUGS = {
  ethereum: 'ethereum', arbitrum: 'arbitrum', optimism: 'optimism', base: 'base',
  polygon: 'polygon', avalanche: 'avalanche', blast: 'blast', gnosis: 'gnosis',
  monad: 'monad', abstract: 'abstract', apechain: 'apechain', robinhood: 'robinhood',
  ronin: 'ronin', soneium: 'soneium', worldchain: 'world-chain', zora: 'zora',
  hyperevm: 'hyperevm', solana: 'solana', cardano: 'cardano', bitcoin: 'bitcoin',
  polkadot: 'polkadot', tron: 'tron', dogecoin: 'doge', monero: 'monero', zcash: 'zcash',
  // Not on DefiLlama — rasterized from the vendored brand SVG below.
  midnight: null
}

// Chains whose mark comes from a file committed in scripts/chain-icon-sources/
// instead of a URL. Midnight's official asset (midnight.network/brand-hub) sits
// behind a bot checkpoint that refuses scripted fetches, so the SVG is vendored
// to keep this script reproducible and offline.
const LOCAL_SOURCES = {
  midnight: 'midnight.svg'
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
  try {
    let src
    if (LOCAL_SOURCES[chainId]) {
      src = await readFile(resolve(SRC_DIR, LOCAL_SOURCES[chainId]))
    } else {
      const url = OVERRIDES[chainId] ?? `https://icons.llamao.fi/icons/chains/rsz_${slug}.jpg`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      src = Buffer.from(await res.arrayBuffer())
    }
    // `contain` + a transparent pad keeps round/!square logomarks whole (the
    // Llama tiles are already square, so this is a no-op for them), and alpha
    // is preserved so a white-on-transparent brand mark sits on the card's
    // own background instead of a white box.
    const out = await sharp(src, { density: 384 })
      .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
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
