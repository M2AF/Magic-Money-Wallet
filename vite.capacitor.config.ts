import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import path from 'path'
import { writeFileSync } from 'fs'

// __dirname is available in CJS context (Vite's Node API runs as CJS here)
const r = (...p: string[]) => path.resolve(__dirname, ...p)

// Regenerate wallet-icon.ts from the source logo PNG before bundling.
// Same as vite.extension.config.ts — Phase 3's dapp-inject bundle needs it.
async function generateWalletIcon() {
  const sharp = (await import('sharp')).default
  const buf = await sharp(r('src/renderer/assets/logo.png'))
    .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer()
  const dataUri = 'data:image/png;base64,' + buf.toString('base64')
  const ts = `export const WALLET_ICON = \`${dataUri}\`\n`
  writeFileSync(r('src/extension/wallet-icon.ts'), ts)
  writeFileSync(r('src/preload/wallet-icon.ts'), ts)
}

/**
 * Android/Capacitor build — clone of the extension recipe (node polyfills +
 * electron stub + storage alias swap), with two extra alias pivots:
 *   './chrome-store' → capacitor-store.ts   (Preferences-backed storage)
 *   './platform'     → platform-capacitor.ts (in-process bus instead of chrome.*)
 * Single SPA entry rooted at src/capacitor, so dist-capacitor/ is a flat
 * webDir Capacitor can serve directly.
 */
export default defineConfig({
  root: r('src/capacitor'),

  plugins: [
    nodePolyfills({
      globals: { Buffer: true, process: true, global: true },
      protocolImports: true
    }),
    react(),
    {
      name: 'generate-wallet-icon',
      async buildStart() { await generateWalletIcon() },
    },
  ],

  resolve: {
    alias: [
      // Full-string match for bare module specifiers
      { find: 'electron', replacement: r('src/extension/stubs/electron.ts') },
      // Full-match regexes for relative imports — '^' and '$' ensure the ENTIRE
      // import string is replaced, not just the matched suffix
      {
        find: /^\.\/secure-store(\.ts)?$/,
        replacement: r('src/capacitor/capacitor-store.ts')
      },
      {
        find: /^\.\.\/main\/secure-store(\.ts)?$/,
        replacement: r('src/capacitor/capacitor-store.ts')
      },
      {
        find: /^\.\/chrome-store(\.ts)?$/,
        replacement: r('src/capacitor/capacitor-store.ts')
      },
      {
        find: /^\.\/platform(\.ts)?$/,
        replacement: r('src/capacitor/platform-capacitor.ts')
      },
      {
        find: /^\.\.\/main\/supabase-sync(\.ts)?$/,
        replacement: r('src/extension/stubs/supabase-sync-stub.ts')
      },
    ]
  },

  base: './',

  build: {
    outDir: r('dist-capacitor'),
    emptyOutDir: true,
    // No store-review readability constraint (the extension ships un-minified
    // for CWS review); minify to keep the APK size down.
    minify: true,
    rollupOptions: {
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      }
    }
  }
})
