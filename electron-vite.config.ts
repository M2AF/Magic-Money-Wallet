import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // Prevent electron-vite from wiping out/main on every startup.
      // web3-inject.js is built by the separate build:inject script and must
      // survive into the directory alongside index.js.
      emptyOutDir: false,
      rollupOptions: {
        input: { index: 'src/main/index.ts' }
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
