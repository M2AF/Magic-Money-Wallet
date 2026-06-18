import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import path from 'path'
import { copyFileSync, mkdirSync, existsSync, renameSync, rmSync, readFileSync, writeFileSync } from 'fs'

// __dirname is available in CJS context (Vite's Node API runs as CJS here)
const r = (...p: string[]) => path.resolve(__dirname, ...p)

export default defineConfig({
  plugins: [
    nodePolyfills({
      globals: { Buffer: true, process: true, global: true },
      protocolImports: true
    }),
    react(),
    {
      name: 'copy-extension-assets',
      closeBundle() {
        mkdirSync(r('dist-extension'), { recursive: true })
        copyFileSync(r('src/extension/manifest.json'), r('dist-extension/manifest.json'))
        const logo = r('src/renderer/assets/logo.png')
        if (existsSync(logo)) {
          for (const size of [16, 48, 128]) {
            copyFileSync(logo, r(`dist-extension/icon${size}.png`))
          }
        }
        // Vite nests HTML at its source path — move to root and fix asset paths
        const nested = r('dist-extension/src/extension/popup.html')
        if (existsSync(nested)) {
          let html = readFileSync(nested, 'utf-8')
          // Vite built paths relative to the nested location (e.g. ../../popup.js)
          // After moving to root they become simply ./popup.js
          html = html.replace(/src="[^"]*\/popup\.js"/g, 'src="./popup.js"')
          html = html.replace(/href="[^"]*\/popup\.css"/g, 'href="./popup.css"')
          writeFileSync(r('dist-extension/popup.html'), html)
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
    ]
  },

  base: './',

  build: {
    outDir: 'dist-extension',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: {
        popup:      r('src/extension/popup.html'),
        background: r('src/extension/background.ts'),
        content:    r('src/extension/content.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: '[name][extname]',
      }
    }
  }
})
