// scripts/convert-apphub.js
// Converts the ChainLens app-hub-data.js into a typed TS module for the renderer.
// Run with: node scripts/convert-apphub.js
//
// Source file is resolved in this order:
//   1. APPHUB_SRC env variable (absolute path)
//   2. ../chainlens/app-hub-data.js  (sibling ChainLens repo at C:\Users\balla\Desktop\ChainLens\chainlens)
//   3. ChainLens_Files/app-hub-data.js  (legacy local copy fallback)

const fs  = require('fs')
const vm  = require('vm')
const path = require('path')

const candidates = [
  process.env.APPHUB_SRC,
  path.join(__dirname, '../../chainlens/app-hub-data.js'),
  path.join(__dirname, '../ChainLens_Files/app-hub-data.js'),
].filter(Boolean)

const srcPath = candidates.find(p => fs.existsSync(p))
if (!srcPath) {
  console.error('Could not find app-hub-data.js. Set APPHUB_SRC env variable or place the file at:')
  candidates.slice(1).forEach(p => console.error(' ', p))
  process.exit(1)
}
console.log(`Reading from: ${srcPath}`)

const outPath = path.join(__dirname, '../src/renderer/data/app-hub.ts')

const code = fs.readFileSync(srcPath, 'utf-8')
const ctx  = { window: {} }
vm.createContext(ctx)
vm.runInNewContext(code, ctx)

const data = ctx.window.appHubData

// Google faviconV2 returns 404 for http:// URLs — upgrade to https://
data.apps.forEach(app => {
  if (app.favicon) {
    app.favicon = app.favicon.replace(/url=http:\/\//g, 'url=https://')
  }
})

const ts = `// AUTO-GENERATED — do not edit by hand.
// Source: ChainLens_Files/app-hub-data.js
// Regenerate: node scripts/convert-apphub.js

export interface AppEntry {
  id: string
  name: string
  website: string
  category: string
  chains: string[]
  featured: boolean
  favicon: string
  description: string
  chainCount: number
  coverage: number
}

export interface ChainDef    { id: string; label: string; count?: number }
export interface CategoryDef { name: string; short: string; count: number }

export interface AppHubData {
  totalApps:   number
  totalChains: number
  chains:      ChainDef[]
  categories:  CategoryDef[]
  chainStats:  Array<{ id: string; count: number }>
  apps:        AppEntry[]
}

const APP_HUB: AppHubData = ${JSON.stringify(data, null, 2)}

export default APP_HUB
`

fs.writeFileSync(outPath, ts, 'utf-8')
console.log(`✓ Generated ${outPath}`)
console.log(`  ${data.apps.length} apps across ${data.totalChains} chains, ${data.categories.length} categories`)
