// scripts/convert-apphub.js
// Converts ChainLens_Files/app-hub-data.js into a typed TS module for the renderer.
// Run with: node scripts/convert-apphub.js

const fs  = require('fs')
const vm  = require('vm')
const path = require('path')

const srcPath = path.join(__dirname, '../ChainLens_Files/app-hub-data.js')
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
