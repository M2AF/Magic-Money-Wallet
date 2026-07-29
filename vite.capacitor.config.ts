import { makeCapacitorConfig } from './vite.capacitor.shared'

/**
 * Android/Capacitor build — the shared native recipe with no extra aliases.
 * Single SPA entry rooted at src/capacitor, so dist-capacitor/ is a flat
 * webDir Capacitor can serve directly.
 *
 * The alias table and plugin set live in vite.capacitor.shared.ts, shared with
 * vite.ios.config.ts.
 */
export default makeCapacitorConfig({
  root: 'capacitor',
  outDir: 'dist-capacitor'
})
