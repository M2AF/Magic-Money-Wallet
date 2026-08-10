import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone: this harness is never an input to an app build. It exists only so
// the onboarding copy can be reviewed in every state (see
// scripts/passkey-onboarding-shots.mjs for why the app itself cannot be stubbed).
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: { port: 5199, strictPort: true },
})
