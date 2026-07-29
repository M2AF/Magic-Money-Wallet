import type { CapacitorConfig } from '@capacitor/cli'

// Live-reload loop: run `npm run android:dev` in one terminal, then set
// CAP_DEV_SERVER (e.g. http://10.0.2.2:5183 — the emulator's host-loopback
// alias; a physical device uses your LAN IP) and `npx cap run android`.
const devUrl = process.env.CAP_DEV_SERVER

// The Capacitor CLI has no --config flag, so the two native targets share this
// one file and differ only by webDir. scripts/cap.js sets CAP_WEB_DIR before
// spawning the CLI for iOS; the Android path never sets it and keeps the
// default. Both bundles are built from the same src/capacitor sources with a
// different alias set (see vite.capacitor.shared.ts).
const config: CapacitorConfig = {
  // Matches the EIP-6963 rdns already shipped in inject.ts / web3-inject.ts.
  appId: 'info.chainlens.magicmoney',
  appName: 'MagicMoney Wallet',
  webDir: process.env.CAP_WEB_DIR || 'dist-capacitor',
  server: {
    // Secure context (WebCrypto guaranteed); WebView origin = https://localhost.
    // The vault lives in Preferences, not web storage, so origin isn't custody-critical.
    androidScheme: 'https',
    // iOS defaults to capacitor://localhost. That origin would invalidate every
    // entry in fetch-guard.ts's BROWSER_HOSTS allowlist, which was CORS-verified
    // against `Origin: https://localhost` — hosts that reflect the origin (the
    // Worker, Monad RPCs, Magic Eden) would start failing and silently fall back
    // to the native bridge, corrupting Monero/Zcash binary bodies. Pinning the
    // iOS scheme to https keeps one origin across both native targets.
    iosScheme: 'https',
    ...(devUrl ? { url: devUrl, cleartext: true } : {})
  },
  plugins: {
    // Global fetch patching is OFF: routing everything over the native bridge
    // made the portfolio's parallel fan-out visibly slow. fetch-guard.ts now
    // routes per-host — WebView fetch for the Worker + CORS-friendly APIs,
    // CapacitorHttp.request() only for CORS-hostile hosts.
    CapacitorHttp: { enabled: false }
  },
  android: {
    // Android 15 forces edge-to-edge with targetSdk 35, drawing the WebView
    // under the system nav bar (it overlapped the app's bottom nav). 'auto'
    // makes Capacitor inset the WebView on affected devices; older Androids
    // are untouched. (Capacitor 7 defaults to 'disable'; 8 flips to 'auto'.)
    adjustMarginsForEdgeToEdge: 'auto'
  },
  ios: {
    // The app paints its own background under the notch/home indicator; safe
    // areas are handled in CSS (ios.css uses env(safe-area-inset-*)) rather
    // than by insetting the WebView, so the browser overlay can run full-bleed.
    contentInset: 'never',
    // Match the dark chrome — this is the color behind the WebView during
    // rotation/rubber-band scroll, not a theme setting.
    backgroundColor: '#0b0b0f'
  }
}

export default config
