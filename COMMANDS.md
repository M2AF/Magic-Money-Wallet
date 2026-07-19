# MagicMoney Wallet — Command Reference

All commands run from the project root (`Magic Money Wallet/`) via `npm run <script>`.
Android release/debug builds additionally need `JAVA_HOME` set — see [Android extras](#android-extras) at the bottom.

## Everyday dev

| Command | What it does |
|---|---|
| `npm run dev` | Builds the dApp-browser preload bundle, then launches the **Electron app** in dev mode (hot reload). Your main daily driver. |
| `npm run android:dev` | Runs the Capacitor web bundle as a plain Vite dev server on port 5183 for fast iteration in a **regular browser tab** (no native shell, no Capacitor plugins — layout/UI only). |
| `npm run preview` | Serves the last production `electron-vite build` output without rebuilding — quick sanity check of a built bundle. |

## Building each target

| Command | What it does |
|---|---|
| `npm run build` | Production build of the **Electron** app (`electron-vite build`) + rebuilds the preload inject bundle. Output: `out/`. Required before `npm run package` or `test:e2e:app`. |
| `npm run build:extension` | Production build of the **browser extension** (Vite, `vite.extension.config.ts`). Output: `dist-extension/` — load this unpacked in `chrome://extensions`. |
| `npm run build:capacitor` | Production build of the **Android web bundle**: Vite build + esbuild for the dApp-injection script + `npx cap sync android` (copies web assets into the native Android project). Output: `dist-capacitor/`. Run this before any Android native build. |
| `npm run build:inject` | Builds just the dApp-browser preload scripts (`web3-inject`, `popup-chrome`, `popup-connect`, `approval-preload`) into `out/inject/`. Runs automatically as part of `dev` and `build`; rarely needed standalone. |

## Packaging / releasing

| Command | What it does |
|---|---|
| `npm run package` | Builds the Electron app and packages installers via `electron-builder` (unsigned/local — doesn't publish anywhere). |
| `npm run package:publish` | Same as above, but publishes the release (`--publish always`) — **pushes to GitHub Releases**. Use with care. |
| `npm run android:apk` | Builds the Capacitor bundle, then runs Gradle's `assembleRelease` to produce a **release APK** (`android/app/build/outputs/apk/release/app-release.apk`). Needs a valid `keystore.properties` for signing. |
| `npm run android:aab` | Same, but produces a **release AAB** (`bundleRelease`) — the format Google Play requires for Play Store submission. |
| `npm run android` | Builds the Capacitor bundle and runs `npx cap run android` — builds + installs + launches on a connected device/emulator in one step (uses Capacitor's own run flow, debug build). |
| `npm run release:patch` | Runs `scripts/release.js patch` — bumps the patch version (0.2.0 → 0.2.1), likely tags/commits per the script's logic. |
| `npm run release:minor` | Same, but bumps the minor version (0.2.0 → 0.3.0). |
| `npm run release:major` | Same, but bumps the major version (0.2.0 → 1.0.0). |

## Testing & validation

| Command | What it does |
|---|---|
| `npm run typecheck` | Runs `tsc --noEmit` across **all four** tsconfigs (node/main, web/renderer, extension, capacitor) — the full-repo type-safety check. Always run before considering work done. |
| `npm test` | Runs the full **Vitest** unit test suite once (derivation vectors, address validation, etc.). |
| `npm run test:watch` | Same as `test`, but in watch mode — reruns on file changes. |
| `npm run test:e2e` | Builds the extension, then runs the full **Playwright** e2e suite (real unpacked-extension tests — headed Chromium). |
| `npm run test:e2e:app` | Builds the Electron app, then runs just the Electron smoke spec (`e2e/electron-smoke.spec.ts`). |
| `npm run test:tor` | Bundles `tor-manager.ts` standalone and runs `scripts/tor-smoke.cjs` under Electron — a smoke test for the Tor integration in isolation. |

> **Note:** the two Electron Playwright specs (`electron-smoke.spec.ts`, `electron-privacy-mode.spec.ts`) fail if run in the *same* `playwright test` invocation (Electron single-instance lock). Run them as separate `npx playwright test <file>` calls if you need both.

## Assets / codegen

| Command | What it does |
|---|---|
| `npm run apphub` | Regenerates `src/renderer/data/app-hub.ts` from `ChainLens_Files/app-hub-data.js`. Runs automatically before every dev/build via the `predev`/`prebuild*` hooks — you should never need to run it by hand. |
| `npm run icons` | Regenerates desktop app icons (`scripts/generate-icons.js`) from the source logo. |
| `npm run icons:android` | Regenerates Android launcher icons (`scripts/generate-android-icons.js`) at all required densities. |

## Android extras (not npm scripts, but part of the workflow)

These aren't in `package.json` — they're the Gradle/adb steps used alongside `npm run build:capacitor` when `npm run android:apk`/`android:aab` isn't enough (e.g. installing directly to a plugged-in phone):

```powershell
# One-time per shell session (adjust path/version to your installed JDK):
$env:JAVA_HOME = "C:\Users\balla\AppData\Local\Java\jdk-21.0.11+10"

# From android/ — build a release APK directly via Gradle:
cd android
.\gradlew.bat assembleRelease

# Install it on a connected device (USB debugging enabled):
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r app\build\outputs\apk\release\app-release.apk

# Launch it:
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell monkey -p info.chainlens.magicmoney -c android.intent.category.LAUNCHER 1
```

`adb devices` confirms your phone is connected and authorized before any of the above.

## Typical workflows

- **"I want to poke at the desktop app"** → `npm run dev`
- **"I changed something and want to make sure nothing broke"** → `npm run typecheck && npm test`
- **"I want to test the extension for real"** → `npm run build:extension`, then load `dist-extension/` unpacked in `chrome://extensions` (Developer mode → Load unpacked)
- **"I want the latest build on my phone"** → `npm run build:capacitor`, then the Gradle/adb steps above (or `npm run android:apk` + manual `adb install`)
- **"I'm about to ship"** → `npm run typecheck && npm test && npm run build && npm run build:extension && npm run build:capacitor`, then `npm run test:e2e:app`
