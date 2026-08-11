import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone: this harness is never an input to an app build. It exists so the
// AGW panel can be reviewed in every state without a funded Abstract smart
// wallet (see scripts/agw-panel-shots.mjs for why the app itself is a dead end).
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: { port: 5198, strictPort: true },
})
