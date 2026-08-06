package info.chainlens.magicmoney.passkey;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.os.Build;

import java.security.MessageDigest;

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
 * As our own provider we write the list, so we can trust our own browser.
 *
 * The entry is built at RUNTIME from this app's real signing certificate rather
 * than a pasted fingerprint: debug and release are signed by different keys, and
 * a stale constant would fail in exactly the confusing, silent way this whole
 * feature is meant to avoid.
 */
public final class PrivilegedAllowlist {

    private PrivilegedAllowlist() {}

    /**
     * JSON in the exact shape CallingAppInfo.getOrigin expects.
     *
     * ⚠ The fingerprint key is `cert_fingerprint_sha256`, NOT the
     * `cert_fingerprint` that several published examples use — the wrong key
     * makes getOrigin throw `IllegalArgumentException: privilegedAllowlist must
     * be formatted properly` rather than simply not matching. Verified against
     * androidx.credentials 1.5.0's PrivilegedApp parser, which also compares
     * fingerprints as uppercase `%02X` bytes joined by ':' — the format
     * ownSigningFingerprint produces.
     */
    public static String selfAllowlist(Context context) {
        String fingerprint = ownSigningFingerprint(context);
        if (fingerprint == null) return "{\"apps\":[]}";
        // The wallet's own package, whichever variant is running (…​.debug too).
        return "{\"apps\":[{\"type\":\"android\",\"info\":{\"package_name\":\""
                + context.getPackageName()
                + "\",\"signatures\":[{\"build\":\"release\",\"cert_fingerprint_sha256\":\""
                + fingerprint + "\"}]}}]}";
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
