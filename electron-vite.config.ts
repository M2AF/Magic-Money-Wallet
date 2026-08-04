import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // The Midnight SDK is ESM-only (every @midnightntwrk/* package is
    // "type": "module" with no "require" condition in its exports map).
    //
    // externalizeDepsPlugin only externalises DECLARED dependencies, so
    // transitive ones — @midnightntwrk/wallet-sdk-capabilities in particular —
    // were pulled into the bundle, and rollup rewrote their internal ESM
    // imports as CJS require(). Requiring an ESM-only subpath fails with
    // ERR_PACKAGE_PATH_NOT_EXPORTED ("./effect is not defined by exports"),
    // which broke every Midnight send in a BUILT app while still working under
    // `electron-vite dev`, where main is served as ESM.
    //
    // Externalising the whole scope keeps these packages out of the bundle so
    // Node loads them natively as ESM; dynamicImportInCjs below keeps the
    // `await import()` calls in midnight-send.ts as real dynamic imports rather
    // than require() shims, which is what lets a CJS bundle load ESM at all.
    plugins: [externalizeDepsPlugin()],
    define: {
      'process.env.WS_NO_BUFFER_UTIL': '"1"',
      'process.env.WS_NO_UTF_8_VALIDATE': '"1"',
    },
    build: {
      rollupOptions: {
        // web3-inject.ts is the dApp-browser preload. It is built separately by
        // the `build:inject` esbuild script into out/inject/ (a directory
        // electron-vite never manages, so it is never wiped on rebuild).
        input: { index: 'src/main/index.ts' },
        // Regex, because the offending package is TRANSITIVE — the plugin above
        // only knows about declared dependencies.
        external: [/^@midnight-?ntwrk\//],
        output: { dynamicImportInCjs: true }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: 'src/preload/index.ts' }
      }
    }
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: 'src/renderer/index.html' }
      }
    }
  }
})
