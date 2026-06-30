import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
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
