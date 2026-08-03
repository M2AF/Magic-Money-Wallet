import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import wasm from 'vite-plugin-wasm'
import path from 'path'
import { copyFileSync, mkdirSync, existsSync, renameSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'fs'

// __dirname is available in CJS context (Vite's Node API runs as CJS here)
const r = (...p: string[]) => path.resolve(__dirname, ...p)

// Regenerate wallet-icon.ts from the source logo PNG before bundling.
// Uses sharp (dev dep) to resize 1054×1054 → 128×128 and inline as base64.
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

export default defineConfig({
  plugins: [
    nodePolyfills({
      globals: { Buffer: true, process: true, global: true },
      protocolImports: true
    }),
    // ledger-v9 (Midnight) ships ESM-integrated WASM — only the offscreen
    // document's lazy chunk loads it (the SW proxies via offscreen-rpc; real
    // top-level await is fine in page-context chunks with target esnext).
    wasm(),
    react(),
    {
      name: 'generate-wallet-icon',
      async buildStart() { await generateWalletIcon() },
    },
    {
      name: 'copy-extension-assets',
      closeBundle() {
        mkdirSync(r('dist-extension'), { recursive: true })
        copyFileSync(r('src/extension/manifest.json'), r('dist-extension/manifest.json'))
        // Midnight proving keys (~3.7 MB): the offscreen document fetches these
        // via chrome.runtime.getURL to prove a NIGHT send locally. They must also
        // be listed in the manifest's web_accessible_resources.
        const keysSrc = r('resources/midnight-keys')
        if (existsSync(keysSrc)) {
          mkdirSync(r('dist-extension/midnight-keys'), { recursive: true })
          for (const f of readdirSync(keysSrc)) {
            // Skip the vendoring provenance sidecar: its pinned hashes are
            // duplicated in src/main/midnight-proving-keys.ts (nothing reads the
            // file at runtime), and a second manifest.json anywhere in the
            // package makes the Chrome Web Store reject the upload.
            if (f === 'manifest.json') continue
            copyFileSync(`${keysSrc}/${f}`, r(`dist-extension/midnight-keys/${f}`))
          }
        }
        const logo = r('src/renderer/assets/logo.png')
        if (existsSync(logo)) {
          for (const size of [16, 48, 128]) {
            copyFileSync(logo, r(`dist-extension/icon${size}.png`))
          }
        }
        // Vite nests HTML at its source path — move to root and fix asset paths
        const nestedDir = r('dist-extension/src/extension')
        const htmlFiles = [
          { nested: 'popup.html',     js: 'popup.js',     css: 'popup.css' },
          { nested: 'sidepanel.html', js: 'sidepanel.js', css: 'sidepanel.css' },
          { nested: 'offscreen.html', js: 'offscreen.js', css: 'offscreen.css' },
        ]
        for (const f of htmlFiles) {
          const src = `${nestedDir}/${f.nested}`
          if (existsSync(src)) {
            let html = readFileSync(src, 'utf-8')
            html = html.replace(new RegExp(`src="[^"]*/${f.js}"`, 'g'),  `src="./${f.js}"`)
            html = html.replace(new RegExp(`href="[^"]*/${f.css}"`, 'g'), `href="./${f.css}"`)
            writeFileSync(r(`dist-extension/${f.nested}`), html)
          }
        }
        if (existsSync(r('dist-extension/src'))) {
          rmSync(r('dist-extension/src'), { recursive: true, force: true })
        }
      }
    }
  ],

  resolve: {
    alias: [
      // Full-string match for bare module specifiers
      { find: 'electron', replacement: r('src/extension/stubs/electron.ts') },
      // Full-match regexes for relative imports — '^' and '$' ensure the ENTIRE
      // import string is replaced, not just the matched suffix
      {
        find: /^\.\/secure-store(\.ts)?$/,
        replacement: r('src/extension/chrome-store.ts')
      },
      {
        find: /^\.\.\/main\/secure-store(\.ts)?$/,
        replacement: r('src/extension/chrome-store.ts')
      },
      {
        find: /^\.\.\/main\/supabase-sync(\.ts)?$/,
        replacement: r('src/extension/stubs/supabase-sync-stub.ts')
      },
      // Privacy-chain WASM backends: the MV3 service worker can't run Workers
      // or dynamic import(), so Monero + Midnight route through the offscreen
      // document (which imports the real browser backends directly).
      {
        find: /^\.\/monero(\.ts)?$/,
        replacement: r('src/extension/monero-sw.ts')
      },
      {
        find: /^\.\/midnight-ledger(\.ts)?$/,
        replacement: r('src/extension/midnight-ledger.ts')
      },
    ]
  },

  base: './',

  build: {
    outDir: 'dist-extension',
    // Modern-Chrome-only target: required for native top-level await in the
    // wasm-init chunks (ledger-v9) — those chunks only load in page contexts
    // (offscreen document / WebView), never in the service worker.
    target: 'esnext',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: {
        popup:      r('src/extension/popup.html'),
        sidepanel:  r('src/extension/sidepanel.html'),
        offscreen:  r('src/extension/offscreen.html'),
        background: r('src/extension/background.ts'),
        content:    r('src/extension/content.ts'),
        inject:     r('src/extension/inject.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: '[name][extname]',
      }
    }
  }
})
