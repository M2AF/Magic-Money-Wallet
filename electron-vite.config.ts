import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: 'src/main/index.ts' },
        external: ['@emurgo/cardano-serialization-lib-asmjs'],
        // Prevent Rollup from rewriting import() back to require() in the CJS bundle.
        // This is required because @emurgo/cardano-serialization-lib-asmjs is ESM-only
        // ("type": "module") and Node.js require() cannot load ES modules.
        output: {
          dynamicImportInCjs: false
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: 'src/preload/index.ts'
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: 'src/renderer/index.html'
        }
      }
    }
  }
})