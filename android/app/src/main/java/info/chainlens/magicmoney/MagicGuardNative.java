package info.chainlens.magicmoney;

import android.content.Context;
import android.util.Log;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/**
 * MagicGuardNative — thin, safe wrapper around the magic-guard-core Rust JNI
 * library (native/magic-guard-core, Brave's adblock crate pinned to the same
 * 0.13.2 the desktop uses).
 *
 * Threading: shouldInterceptRequest runs off the UI thread and concurrently
 * across WebViews. The Rust Engine is Send+Sync (single-thread feature
 * disabled), so concurrent check() calls on one handle are the supported
 * contract. The handle is written once by the init thread and never destroyed
 * while the app lives — v1 has no list hot-reload, so there is no
 * destroy-while-in-flight window (nativeDestroy exists for a future updater).
 *
 * Failure policy: everything here fails OPEN. If the .so is missing, an asset
 * fails to read, or engine creation fails, isReady() stays false and callers
 * allow all requests — an adblock failure must never break browsing (or Tor).
 */
final class MagicGuardNative {

    private static final String TAG = "MagicGuard";
    private static final String[] LIST_ASSETS = {
            "magic-guard/easylist.txt",
            "magic-guard/easyprivacy.txt",
            "magic-guard/magicmoney-unbreak.txt",
    };

    private static volatile boolean libraryLoaded = false;
    private static volatile long handle = 0;
    private static volatile boolean initStarted = false;
    private static volatile boolean initFailed = false;

    static {
        try {
            System.loadLibrary("magic_guard_core");
            libraryLoaded = true;
        } catch (Throwable error) {
            Log.e(TAG, "native library failed to load — Magic Guard inactive (fail-open)", error);
        }
    }

    private MagicGuardNative() { }

    private static native long nativeCreate(String[] listTexts);
    private static native boolean nativeCheck(long handle, String url, String sourceUrl, String requestType);
    @SuppressWarnings("unused") // reserved for a future runtime list updater
    private static native void nativeDestroy(long handle);

    /** Kick off engine construction on the caller-supplied background thread. Idempotent. */
    static synchronized void init(Context context) {
        if (initStarted || !libraryLoaded) return;
        initStarted = true;
        try {
            String[] texts = new String[LIST_ASSETS.length];
            for (int i = 0; i < LIST_ASSETS.length; i++) {
                texts[i] = readAsset(context, LIST_ASSETS[i]);
            }
            long created = nativeCreate(texts);
            if (created == 0) {
                initFailed = true;
                Log.e(TAG, "engine creation failed — Magic Guard inactive (fail-open)");
                return;
            }
            handle = created;
            Log.i(TAG, "engine ready (EasyList + EasyPrivacy, network rules only)");
        } catch (Throwable error) {
            initFailed = true;
            Log.e(TAG, "engine init failed — Magic Guard inactive (fail-open)", error);
        }
    }

    /** True once the engine is loaded and filtering can actually happen. */
    static boolean isReady() {
        return handle != 0;
    }

    /** 'loading' | 'ready' | 'degraded' — mirrors the desktop MagicGuardStatus values. */
    static String status() {
        if (handle != 0) return "ready";
        if (!libraryLoaded || initFailed) return "degraded";
        return "loading";
    }

    /**
     * True only for a definite block decision. Any failure (engine not ready,
     * native error, malformed URL) returns false — fail open.
     */
    static boolean check(String url, String sourceUrl, String requestType) {
        long h = handle;
        if (h == 0) return false;
        try {
            return nativeCheck(h, url, sourceUrl, requestType);
        } catch (Throwable error) {
            return false;
        }
    }

    private static String readAsset(Context context, String path) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                context.getAssets().open(path), StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            char[] buf = new char[16384];
            int n;
            while ((n = reader.read(buf)) > 0) sb.append(buf, 0, n);
            return sb.toString();
        } catch (Exception e) {
            // magicmoney-unbreak.txt is optional; the two main lists are not, but
            // a missing list degrades to fewer rules rather than a hard failure.
            Log.w(TAG, "could not read asset " + path);
            return "";
        }
    }
}
