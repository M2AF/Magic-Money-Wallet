// scripts/convert-apphub.js
// Converts the ChainLens app-hub-data.js into a typed TS module for the renderer.
// Run with: node scripts/convert-apphub.js
//
// Source file is resolved in this order:
//   1. APPHUB_SRC env variable (absolute path)
//   2. ChainLens_Files/app-hub-data.js  (the in-repo copy you edit — canonical source)
//   3. ../chainlens/app-hub-data.js  (sibling ChainLens repo fallback)

const fs  = require('fs')
const vm  = require('vm')
const path = require('path')

const candidates = [
  process.env.APPHUB_SRC,
  path.join(__dirname, '../ChainLens_Files/app-hub-data.js'),
  path.join(__dirname, '../../chainlens/app-hub-data.js'),
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

// Normalize each app to exactly the AppEntry shape below. The source data may
// carry incidental extra fields (e.g. categoryMeta) that the renderer doesn't
// use — stripping them here keeps the generated TS valid against AppEntry no
// matter what the source adds.
data.apps = data.apps.map(app => ({
  id:          app.id,
  name:        app.name,
  website:     app.website,
  category:    app.category,
  chains:      app.chains,
  featured:    !!app.featured,
  // Google faviconV2 returns 404 for http:// URLs — upgrade to https://
  favicon:     (app.favicon || '').replace(/url=http:\/\//g, 'url=https://'),
  description: app.description || '',
  chainCount:  app.chainCount,
  coverage:    app.coverage,
}))

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
