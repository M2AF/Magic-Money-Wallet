package info.chainlens.magicmoney.passkey;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import info.chainlens.magicmoney.R;

/**
 * The privileged-app allowlist this provider trusts to speak for a website.
 *
 * When a browser asks Credential Manager for a passkey it passes the site's
 * origin, and a provider only honours that origin if the calling app appears in
 * the allowlist THE PROVIDER SUPPLIES (see CallingAppInfo.getOrigin). Google
 * Password Manager and Samsung Pass ship curated lists of known browsers, which
 * is exactly why the wallet's own browser is refused by them:
 *
 *   [PASS][SPAF] ... TYPE_INVALID_STATE_ERROR (Can't use passkeys with this browser.)
 *
 * As our own provider we write the list. It has TWO halves and needs both:
 *
 *   1. GOOGLE'S PUBLIC LIST (Chrome, Brave, Samsung Internet, Firefox, …).
 *      ⚠ Without it, a request from Chrome resolves NO origin — getOrigin
 *      returns null — and the whole point of Phase 4 (these passkeys working in
 *      a real browser) silently fails. Ours alone is not enough.
 *   2. OUR OWN PACKAGE, computed at runtime from this app's real signing
 *      certificate. Debug and release are signed by different keys, so a pasted
 *      constant would break in exactly the silent way this feature exists to
 *      avoid.
 *
 * ⚠ The fingerprint key is `cert_fingerprint_sha256`, NOT the `cert_fingerprint`
 * that several published examples use — the wrong key makes getOrigin throw
 * `IllegalArgumentException: privilegedAllowlist must be formatted properly`
 * rather than simply not matching. Verified against androidx.credentials 1.5.0's
 * PrivilegedApp parser, which also compares fingerprints as uppercase `%02X`
 * bytes joined by ':' — the format ownSigningFingerprint produces.
 */
public final class PrivilegedAllowlist {

    private static final String TAG = "MagicMoneyPasskey";

    /** Google's published list of browsers permitted to assert a web origin. */
    private static final String GOOGLE_LIST_URL =
            "https://www.gstatic.com/gpm-passkeys-privileged-apps/apps.json";

    private static final long REFRESH_INTERVAL_MS = 7L * 24 * 60 * 60 * 1000;   // weekly
    private static final String PREFS = "magicmoney.passkey";
    private static final String KEY_CACHED = "allowlist.google.json";
    private static final String KEY_FETCHED_AT = "allowlist.google.at";

    private PrivilegedAllowlist() {}

    /**
     * The allowlist to hand CallingAppInfo.getOrigin: Google's browsers plus us.
     *
     * Never network-blocking. The bundled copy in res/raw is the floor, a cached
     * download is preferred when present, and a refresh is kicked off in the
     * background — a provider that stalled on an HTTP request would hang the
     * system's credential sheet.
     */
    public static String merged(Context context) {
        JSONArray apps = new JSONArray();

        // 1. Google's browsers — cached download, else the bundled snapshot.
        String googleJson = cached(context);
        if (googleJson == null) googleJson = bundled(context);
        appendApps(apps, googleJson);

        // 2. Ourselves.
        JSONObject self = selfEntry(context);
        if (self != null) apps.put(self);

        JSONObject root = new JSONObject();
        try {
            root.put("apps", apps);
        } catch (Exception e) {
            return "{\"apps\":[]}";
        }
        return root.toString();
    }

    /** Just our own entry — what the Phase 0 spike measured with. */
    public static String selfAllowlist(Context context) {
        JSONArray apps = new JSONArray();
        JSONObject self = selfEntry(context);
        if (self != null) apps.put(self);
        JSONObject root = new JSONObject();
        try {
            root.put("apps", apps);
        } catch (Exception e) {
            return "{\"apps\":[]}";
        }
        return root.toString();
    }

    private static JSONObject selfEntry(Context context) {
        String fingerprint = ownSigningFingerprint(context);
        if (fingerprint == null) return null;
        try {
            JSONObject signature = new JSONObject();
            signature.put("build", "release");
            signature.put("cert_fingerprint_sha256", fingerprint);

            JSONObject info = new JSONObject();
            // Whichever variant is running — release or ….debug.
            info.put("package_name", context.getPackageName());
            info.put("signatures", new JSONArray().put(signature));

            JSONObject app = new JSONObject();
            app.put("type", "android");
            app.put("info", info);
            return app;
        } catch (Exception e) {
            return null;
        }
    }

    private static void appendApps(JSONArray target, String json) {
        if (json == null) return;
        try {
            JSONArray apps = new JSONObject(json).optJSONArray("apps");
            if (apps == null) return;
            for (int i = 0; i < apps.length(); i++) {
                JSONObject app = apps.optJSONObject(i);
                if (app != null) target.put(app);
            }
        } catch (Exception e) {
            Log.w(TAG, "privileged allowlist: unparseable source ignored", e);
        }
    }

    private static String bundled(Context context) {
        try (InputStream in = context.getResources().openRawResource(R.raw.privileged_allowlist)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            Log.w(TAG, "privileged allowlist: bundled copy unreadable", e);
            return null;
        }
    }

    private static String cached(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY_CACHED, null);
    }

    /**
     * Refresh Google's list in the background if it is stale. Browsers get added
     * to it over time, and a wallet that never refreshed would slowly stop
     * working in newly-shipped browsers. Failure is silent by design: the
     * bundled snapshot keeps Chrome working regardless.
     */
    public static void refreshIfStale(Context context) {
        final Context app = context.getApplicationContext();
        long last = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong(KEY_FETCHED_AT, 0);
        if (System.currentTimeMillis() - last < REFRESH_INTERVAL_MS) return;

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(GOOGLE_LIST_URL).openConnection();
                conn.setConnectTimeout(10_000);
                conn.setReadTimeout(10_000);
                if (conn.getResponseCode() != 200) return;
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                try (InputStream in = conn.getInputStream()) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                String json = new String(out.toByteArray(), StandardCharsets.UTF_8);
                // Only accept something that actually parses AND has entries —
                // caching an error page would disable every browser at once.
                JSONArray apps = new JSONObject(json).optJSONArray("apps");
                if (apps == null || apps.length() == 0) return;
                app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                        .putString(KEY_CACHED, json)
                        .putLong(KEY_FETCHED_AT, System.currentTimeMillis())
                        .apply();
                Log.i(TAG, "privileged allowlist refreshed: " + apps.length() + " apps");
            } catch (Exception e) {
                Log.i(TAG, "privileged allowlist refresh skipped: " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        }, "mm-allowlist-refresh").start();
    }

    /** Colon-separated uppercase SHA-256 of this app's signing certificate. */
    public static String ownSigningFingerprint(Context context) {
        try {
            PackageManager pm = context.getPackageManager();
            Signature[] signatures;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                PackageInfo info = pm.getPackageInfo(context.getPackageName(),
                        PackageManager.GET_SIGNING_CERTIFICATES);
                SigningInfo signingInfo = info.signingInfo;
                if (signingInfo == null) return null;
                signatures = signingInfo.hasMultipleSigners()
                        ? signingInfo.getApkContentsSigners()
                        : signingInfo.getSigningCertificateHistory();
            } else {
                @SuppressWarnings("deprecation")
                PackageInfo info = pm.getPackageInfo(context.getPackageName(),
                        PackageManager.GET_SIGNATURES);
                @SuppressWarnings("deprecation")
                Signature[] legacy = info.signatures;
                signatures = legacy;
            }
            if (signatures == null || signatures.length == 0) return null;
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(signatures[0].toByteArray());
            StringBuilder sb = new StringBuilder(digest.length * 3);
            for (int i = 0; i < digest.length; i++) {
                if (i > 0) sb.append(':');
                sb.append(String.format("%02X", digest[i]));
            }
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }
}
