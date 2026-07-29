import { defineConfig, type Alias, type UserConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import wasm from 'vite-plugin-wasm'
import path from 'path'
import { writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'fs'

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

export interface CapacitorTargetOptions {
  /** Entry directory under src/ — 'capacitor' (Android) or 'ios'. */
  root: string
  /** Bundle output dir, which is also the Capacitor webDir for this target. */
  outDir: string
  /**
   * Aliases prepended to the shared table. Order matters: Vite takes the first
   * match, so a target-specific override of a shared seam must come first.
   */
  extraAliases?: Alias[]
}

/**
 * Shared recipe for the two Capacitor targets (Android + iOS).
 *
 * Both are the same SPA: node polyfills + electron stub + the storage/platform
 * alias swaps that repoint the shared core's seams at WebView implementations.
 * They differ only in entry root, output dir, and a small set of extra aliases
 * (iOS stubs out the sideload updater and the default-browser plugin).
 *
 * This is a factory rather than two copied configs because the alias table is
 * the platform seam — every new seam added to the shared core has to land in
 * both targets, and a duplicated table silently drifts the first time one is
 * missed. See AGENTS.md §"Architecture in one paragraph".
 */
export function makeCapacitorConfig(opts: CapacitorTargetOptions): UserConfig {
  const { root, outDir, extraAliases = [] } = opts

  return defineConfig({
    root: r('src', root),

    plugins: [
      nodePolyfills({
        globals: { Buffer: true, process: true, global: true },
        protocolImports: true
      }),
      // ledger-v9 (Midnight) ships ESM-integrated WASM, loaded as a lazy chunk
      // (top-level await in it is fine with target esnext).
      wasm(),
      react(),
      {
        name: 'generate-wallet-icon',
        async buildStart() { await generateWalletIcon() },
      },
      {
        // Midnight proving keys (~3.7 MB) ride along in the app bundle so the
        // WebView can fetch them from its own origin and prove a NIGHT send
        // locally (never from the SDK's dev S3 bucket).
        name: 'copy-midnight-keys',
        closeBundle() {
          const src = r('resources/midnight-keys')
          if (!existsSync(src)) return
          const dest = r(outDir, 'midnight-keys')
          mkdirSync(dest, { recursive: true })
          for (const f of readdirSync(src)) copyFileSync(path.join(src, f), path.join(dest, f))
        },
      },
    ],

    resolve: {
      alias: [
        ...extraAliases,
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
        // NOTE: no supabase-sync stub here (unlike the extension build) — the
        // real module is Worker-proxied + EIP-191 signature-gated with no client
        // keys, and its store reads are await-normalized, so ChainLens profile
        // sync works on both native targets.
        // Privacy-chain WASM backends: the WebView runs them in-page (monero-ts
        // in a Web Worker; ledger-v9 as a lazy WASM chunk).
        {
          find: /^\.\/monero(\.ts)?$/,
          replacement: r('src/capacitor/monero-browser.ts')
        },
        {
          find: /^\.\/midnight-ledger(\.ts)?$/,
          replacement: r('src/capacitor/midnight-ledger.ts')
        },
        // wallet-handlers imports './midnight-send-manager', which resolves to the
        // extension's OFFSCREEN PROXY by default. Neither native target has an
        // offscreen document — the WebView hosts the WASM itself — so point it at
        // the real manager (the same module the extension's offscreen doc loads).
        {
          find: /^\.\/midnight-send-manager(\.ts)?$/,
          replacement: r('src/capacitor/midnight-send-manager.ts')
        },
      ]
    },

    base: './',

    build: {
      outDir: r(outDir),
      // Modern-WebView-only target: required for native top-level await in the
      // wasm-init chunks (ledger-v9) — those chunks only load in page contexts
      // (offscreen document / WebView), never in the service worker.
      target: 'esnext',
      emptyOutDir: true,
      // No store-review readability constraint (the extension ships un-minified
      // for CWS review); minify to keep the app binary size down.
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
}
