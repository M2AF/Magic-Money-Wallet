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
    // Native passthrough for fetch/XHR — bypasses WebView CORS exactly like the
    // Electron main-process fetch and the extension's host_permissions do.
    // AbortSignal semantics are restored by src/capacitor/fetch-guard.ts.
    CapacitorHttp: { enabled: true }
  }
}

export default config
