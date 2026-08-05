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
    // NOTE: there is deliberately no `iosScheme` here. iOS serves the bundle
    // from capacitor://localhost and CANNOT be moved to https: Capacitor
    // registers a WKURLSchemeHandler for the scheme, and WKWebView refuses to
    // hand over any scheme it already handles. Capacitor validates this in
    // CAPInstanceDescriptor.normalize() —
    //     if WKWebView.handlesURLScheme(scheme) == false { valid } else { reset }
    // — so `iosScheme: 'https'` is SILENTLY discarded and falls back to
    // 'capacitor'. It looks applied in capacitor.config.json and is not.
    //
    // The two origins therefore differ (https://localhost on Android,
    // capacitor://localhost on iOS). That is fine: the Worker reflects both
    // (APP_ORIGINS in cloudflare-worker/swap-proxy.js), and every other entry
    // in fetch-guard.ts's BROWSER_HOSTS sends `Access-Control-Allow-Origin: *`.
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
    adjustMarginsForEdgeToEdge: 'auto',
    // OPT-IN web inspection, same doctrine as the iOS block below: an
    // inspectable WebView in a shipped wallet lets anyone with the device read
    // the running page, so this is never unconditional. Set CAP_WEB_DEBUG=1 to
    // attach Chrome DevTools over adb (used to verify WebAuthn/PRF behaviour in
    // the real WebView origin rather than in a browser).
    ...(process.env.CAP_WEB_DEBUG === '1' ? { webContentsDebuggingEnabled: true } : {})
  },
  ios: {
    // The app paints its own background under the notch/home indicator; safe
    // areas are handled in CSS (ios.css uses env(safe-area-inset-*)) rather
    // than by insetting the WebView, so the browser overlay can run full-bleed.
    contentInset: 'never',
    // Match the dark chrome — this is the color behind the WebView during
    // rotation/rubber-band scroll, not a theme setting.
    backgroundColor: '#0b0b0f',
    // OPT-IN web inspection, for the Appium e2e run only.
    //
    // Since iOS 16.4 a WKWebView that is not `isInspectable` is invisible to
    // the remote debugger — which is exactly how Appium enumerates webview
    // contexts. Without this the harness only ever sees NATIVE_APP and cannot
    // drive the app at all. Capacitor decides this from `#if DEBUG` evaluated
    // when ITS pod compiles, which is not something to rely on.
    //
    // Deliberately NOT unconditional: an inspectable WebView in a shipped
    // wallet lets anyone with the device and a Mac read the running page. Only
    // .github/workflows/ios.yml sets CAP_WEB_DEBUG=1; release.yml never does,
    // so published builds keep Capacitor's default (off in Release).
    ...(process.env.CAP_WEB_DEBUG === '1' ? { webContentsDebuggingEnabled: true } : {})
  }
}

export default config
