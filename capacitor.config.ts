import type { CapacitorConfig } from '@capacitor/cli'

// Live-reload loop: run `npm run android:dev` in one terminal, then set
// CAP_DEV_SERVER (e.g. http://10.0.2.2:5183 — the emulator's host-loopback
// alias; a physical device uses your LAN IP) and `npx cap run android`.
const devUrl = process.env.CAP_DEV_SERVER

const config: CapacitorConfig = {
  // Matches the EIP-6963 rdns already shipped in inject.ts / web3-inject.ts.
  appId: 'info.chainlens.magicmoney',
  appName: 'MagicMoney Wallet',
  webDir: 'dist-capacitor',
  server: {
    // Secure context (WebCrypto guaranteed); WebView origin = https://localhost.
    // The vault lives in Preferences, not web storage, so origin isn't custody-critical.
    androidScheme: 'https',
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
  }
}

export default config
