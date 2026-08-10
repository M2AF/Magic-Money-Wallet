package info.chainlens.magicmoney.passkey;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.RequiresApi;

import org.json.JSONArray;
import org.json.JSONObject;

import java.security.KeyFactory;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.spec.MGF1ParameterSpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;

/**
 * What the system passkey provider is allowed to hold, and how.
 *
 * ⚠ THE PROVIDER NEVER SEES THE SEED. It is a background service that ANY app's
 * sign-in prompt can cause the system to bind. Handing it the mnemonic would put
 * fund-spending authority behind a binder reachable by a hostile app's
 * `getCredential()` call. It gets `webauthnRoot` only: a full compromise of this
 * service costs the user their logins, not their money.
 *
 * TWO KEYSTORE KEYS, DELIBERATELY DIFFERENT — this is the load-bearing decision
 * in this file:
 *
 *   ROOT_ALIAS   requires user authentication on EVERY use
 *                (setUserAuthenticationRequired(true), timeout 0). It wraps the
 *                per-account webauthnRoot, and is unwrapped only inside
 *                PasskeyActivity behind a BiometricPrompt holding the very
 *                Cipher that will do the unwrapping. Nothing can mint a
 *                signature without a fresh biometric.
 *
 *   INDEX_ALIAS  requires NO authentication. It wraps only DISCOVERY metadata —
 *                which sites you hold a passkey for and under what username.
 *
 * Why the second key exists at all: `onBeginGetCredentialRequest` runs in the
 * service with no UI and no opportunity to prompt, yet it must already list the
 * matching accounts for the system sheet. Auth-binding that data would make
 * username-less sign-in impossible. The split is honest about the trade — the
 * site list is privacy-sensitive and stays hardware-wrapped and off-device
 * unreadable, but it is not key material and losing it costs discovery, not
 * control. Signing stays behind the biometric where it belongs.
 *
 * Both keys live in the Android Keystore, so the ciphertext below is useless on
 * any other device even with a full filesystem dump. They differ in kind for a
 * reason that is not cosmetic — see ROOT_TRANSFORM.
 */
@RequiresApi(api = Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
public final class PasskeyVault {

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORM = "AES/GCM/NoPadding";
    private static final int GCM_TAG_BITS = 128;

    /**
     * The root is wrapped with RSA-OAEP, not AES-GCM, for one measured reason: an
     * auth-bound SYMMETRIC key demands a fresh biometric to ENCRYPT as well as to
     * decrypt, so enabling the provider threw
     * `KeyStoreException: Key user not authenticated (KEY_USER_NOT_AUTHENTICATED)`
     * before it could store anything (Galaxy S21+, Android 15). With a key PAIR
     * the public half wraps freely — enabling stays a quiet, promptless hand-off
     * — while the private half stays auth-bound, which is the half that matters.
     */
    private static final String ROOT_TRANSFORM = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding";

    /**
     * ⚠ MGF1 pinned to SHA-1, on BOTH sides. The transform string names SHA-256,
     * but Android's Keystore uses SHA-1 for MGF1 regardless while the software
     * provider follows the string — so relying on defaults yields a key that
     * encrypts happily and can never decrypt.
     */
    private static OAEPParameterSpec oaep() {
        return new OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT);
    }

    /** Auth-bound. Wraps webauthnRoot. */
    private static final String ROOT_ALIAS = "MagicMoneyPasskeyRoot";
    /** Not auth-bound. Wraps discovery metadata only. */
    private static final String INDEX_ALIAS = "MagicMoneyPasskeyIndex";

    private static final String PREFS = "magicmoney.passkey";
    private static final String KEY_ROOTS = "roots.json";       // {"<account>":{"ct":..}} — RSA-OAEP, no IV
    private static final String KEY_INDEX = "discovery.blob";   // "iv:ct"

    private PasskeyVault() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String b64(byte[] b) {
        return Base64.encodeToString(b, Base64.NO_WRAP);
    }

    private static byte[] unb64(String s) {
        return Base64.decode(s, Base64.NO_WRAP);
    }

    /**
     * A non-secret 8-byte tag naming WHICH root this is.
     *
     * The provider service runs with no UI and cannot prompt, so it can never
     * unwrap a root at offer time — which is why it cannot simply call
     * `isOwnCredentialId` to check that a projection row is signable. This is the
     * prompt-free stand-in: both the wrapped root and every row it minted carry
     * this tag, so a row left behind by a DIFFERENT root (a different wallet, or
     * a different account — the frozen spec puts accountIndex in the HKDF info,
     * so each account has its own root) is recognisable without any key material.
     *
     * Truncated SHA-256 of a 256-bit secret: not an oracle, and hex so the
     * TypeScript side can produce byte-identical values.
     */
    public static String rootFingerprint(byte[] root) throws Exception {
        byte[] h = java.security.MessageDigest.getInstance("SHA-256").digest(root);
        StringBuilder sb = new StringBuilder(16);
        for (int i = 0; i < 8; i++) sb.append(String.format("%02x", h[i]));
        return sb.toString();
    }

    /** The fingerprint of the root enrolled for this account, or null. */
    @Nullable
    public static String enrolledFingerprint(Context ctx, int accountIndex) {
        JSONObject entry = readRoots(ctx).optJSONObject(String.valueOf(accountIndex));
        if (entry == null) return null;
        String fp = entry.optString("fp", "");
        return fp.isEmpty() ? null : fp;
    }

    // ── Keystore keys ────────────────────────────────────────────────────────

    private static KeyStore keystore() throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE);
        ks.load(null);
        return ks;
    }

    /** The no-auth AES key that wraps discovery metadata. */
    private static SecretKey indexKey() throws Exception {
        KeyStore ks = keystore();
        SecretKey existing = (SecretKey) ks.getKey(INDEX_ALIAS, null);
        if (existing != null) return existing;

        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        gen.init(new KeyGenParameterSpec.Builder(
                INDEX_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return gen.generateKey();
    }

    /**
     * Create the auth-bound RSA key pair if it does not exist yet.
     *
     * ⚠ An alias left by an older build can be the wrong KIND of key — this
     * wrapped with AES until the auth-on-encrypt problem forced a key pair, and
     * a symmetric entry has no certificate, so the public-key lookup would fail
     * with a null dereference three calls later. Detect and replace instead.
     * Any roots wrapped under the old key are unreadable by definition, so they
     * go with it and the wallet re-enrols from the seed.
     */
    private static void ensureRootKeyPair(Context ctx) throws Exception {
        KeyStore ks = keystore();
        if (ks.containsAlias(ROOT_ALIAS)) {
            if (ks.getCertificate(ROOT_ALIAS) != null) return;
            ks.deleteEntry(ROOT_ALIAS);
            prefs(ctx).edit().remove(KEY_ROOTS).apply();
        }
        KeyPairGenerator gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, KEYSTORE);
        gen.initialize(new KeyGenParameterSpec.Builder(
                ROOT_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
                .setKeySize(2048)
                .setUserAuthenticationRequired(true)
                // Timeout 0 = authenticate for EVERY use, via a CryptoObject. A
                // non-zero window would let anything in the process mint
                // signatures for that many seconds after an unrelated unlock.
                .setUserAuthenticationParameters(0,
                        KeyProperties.AUTH_BIOMETRIC_STRONG | KeyProperties.AUTH_DEVICE_CREDENTIAL)
                // Enrolling a new fingerprint invalidates the key, so a coerced or
                // added biometric cannot inherit the old one's authority.
                // Recoverable: the wallet still has the seed (see clearRoots).
                .setInvalidatedByBiometricEnrollment(true)
                .build());
        gen.generateKeyPair();
    }

    // ── webauthnRoot, per account, behind the biometric ──────────────────────

    /**
     * Wrap and store one account's root. Called from the wallet (JS) while it is
     * unlocked; the plaintext root never touches disk.
     */
    public static void putRoot(Context ctx, int accountIndex, byte[] root) throws Exception {
        if (root == null || root.length != 32) throw new IllegalArgumentException("root must be 32 bytes");
        ensureRootKeyPair(ctx);

        // ⚠ Rebuild the public key OUTSIDE Keystore. The PublicKey that Keystore
        // hands back routes the operation back through Keystore, where it
        // inherits the private key's auth requirement — the same
        // KEY_USER_NOT_AUTHENTICATED failure by a subtler route.
        PublicKey fromStore = keystore().getCertificate(ROOT_ALIAS).getPublicKey();
        PublicKey unrestricted = KeyFactory.getInstance(fromStore.getAlgorithm())
                .generatePublic(new X509EncodedKeySpec(fromStore.getEncoded()));

        Cipher cipher = Cipher.getInstance(ROOT_TRANSFORM);
        cipher.init(Cipher.ENCRYPT_MODE, unrestricted, oaep());
        byte[] ct = cipher.doFinal(root);

        JSONObject all = readRoots(ctx);
        JSONObject entry = new JSONObject();
        entry.put("ct", b64(ct));
        // Recorded so the service can tell, without a prompt, whether a discovery
        // row was minted by THIS root. See rootFingerprint().
        entry.put("fp", rootFingerprint(root));
        all.put(String.valueOf(accountIndex), entry);
        prefs(ctx).edit().putString(KEY_ROOTS, all.toString()).apply();
    }

    private static JSONObject readRoots(Context ctx) {
        String raw = prefs(ctx).getString(KEY_ROOTS, null);
        if (raw == null) return new JSONObject();
        try {
            return new JSONObject(raw);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    public static boolean hasRoot(Context ctx, int accountIndex) {
        return readRoots(ctx).has(String.valueOf(accountIndex));
    }

    public static boolean hasAnyRoot(Context ctx) {
        return readRoots(ctx).length() > 0;
    }

    /**
     * A Cipher primed to decrypt one account's root, for handing to
     * BiometricPrompt as a CryptoObject. Returns null when that account was never
     * enrolled — the caller must then fail the ceremony, never guess.
     */
    @Nullable
    public static Cipher rootDecryptCipher(Context ctx, int accountIndex) throws Exception {
        JSONObject entry = readRoots(ctx).optJSONObject(String.valueOf(accountIndex));
        if (entry == null) return null;
        PrivateKey key = (PrivateKey) keystore().getKey(ROOT_ALIAS, null);
        if (key == null) return null;
        Cipher cipher = Cipher.getInstance(ROOT_TRANSFORM);
        cipher.init(Cipher.DECRYPT_MODE, key, oaep());
        return cipher;
    }

    /**
     * Finish the unwrap with the Cipher BiometricPrompt just authorised.
     *
     * Must be the same Cipher instance that went into the CryptoObject — that is
     * the whole point of the CryptoObject dance, and passing a fresh one would
     * throw rather than silently skip the biometric.
     */
    public static byte[] unwrapRoot(Context ctx, int accountIndex, Cipher authorised) throws Exception {
        JSONObject entry = readRoots(ctx).optJSONObject(String.valueOf(accountIndex));
        if (entry == null) throw new IllegalStateException("no enrolled root for account " + accountIndex);
        return authorised.doFinal(unb64(entry.getString("ct")));
    }

    /**
     * Forget every wrapped root and the Keystore key itself.
     *
     * Called when the user turns the provider off, and as self-healing when the
     * key has been invalidated by a biometric enrolment — a permanently
     * undecryptable blob is worse than none, because it makes the failure look
     * intermittent.
     */
    public static void clearRoots(Context ctx) {
        prefs(ctx).edit().remove(KEY_ROOTS).apply();
        try {
            keystore().deleteEntry(ROOT_ALIAS);
        } catch (Exception ignored) {
            // Best effort: the pref is gone, so nothing can be unwrapped anyway.
        }
    }

    // ── Discovery metadata, readable without a prompt ────────────────────────

    /** One row the system sheet can show before any authentication happens. */
    public static final class Discoverable {
        public final String rpId;
        public final String credentialId;   // base64url
        public final String userName;
        public final String userHandle;     // base64url, may be ""
        public final int accountIndex;
        /** Fingerprint of the root that minted it; "" on rows written before this existed. */
        public final String rootFp;
        /**
         * True for rows this app wrote itself in PasskeyActivity. The wallet's
         * passkey-index.enc has never heard of them, so a wholesale replace from
         * the wallet must not take them with it.
         */
        public final boolean providerMinted;

        Discoverable(String rpId, String credentialId, String userName, String userHandle,
                     int accountIndex, String rootFp, boolean providerMinted) {
            this.rpId = rpId;
            this.credentialId = credentialId;
            this.userName = userName;
            this.userHandle = userHandle;
            this.accountIndex = accountIndex;
            this.rootFp = rootFp == null ? "" : rootFp;
            this.providerMinted = providerMinted;
        }

        JSONObject toJson() throws Exception {
            JSONObject o = new JSONObject();
            o.put("rpId", rpId);
            o.put("credentialId", credentialId);
            o.put("userName", userName);
            o.put("userHandle", userHandle);
            o.put("accountIndex", accountIndex);
            if (!rootFp.isEmpty()) o.put("rootFp", rootFp);
            if (providerMinted) o.put("providerMinted", true);
            return o;
        }
    }

    /**
     * Update the discovery projection from the wallet's own index.
     *
     * ⚠ THIS MERGES, IT DOES NOT REPLACE. `passkey-index.enc` is the source of
     * truth for everything created in the wallet, but a passkey created through
     * the SYSTEM SHEET is written here by PasskeyActivity and the wallet's index
     * has never heard of it. A wholesale replace therefore silently deleted every
     * Chrome-created passkey the moment the wallet next synced — one-directional
     * data loss with no error anywhere, and the reason a credential this device
     * minted itself could vanish from its own discovery list.
     *
     * So: incoming rows win, and provider-minted rows survive unless an incoming
     * row supersedes them by credentialId.
     */
    public static void putDiscovery(Context ctx, JSONArray records) throws Exception {
        JSONArray merged = new JSONArray();
        Set<String> incoming = new HashSet<>();
        for (int i = 0; i < records.length(); i++) {
            JSONObject o = records.optJSONObject(i);
            if (o == null) continue;
            String id = o.optString("credentialId", "");
            if (!id.isEmpty()) incoming.add(id);
            merged.put(o);
        }
        for (Discoverable d : discovery(ctx)) {
            if (!d.providerMinted) continue;              // the wallet owns this row
            if (incoming.contains(d.credentialId)) continue;  // superseded
            merged.put(d.toJson());
        }
        putDiscoveryRaw(ctx, merged);
    }

    /** Write the projection verbatim. The merge above is the only caller that matters. */
    private static void putDiscoveryRaw(Context ctx, JSONArray records) throws Exception {
        Cipher cipher = Cipher.getInstance(TRANSFORM);
        cipher.init(Cipher.ENCRYPT_MODE, indexKey());
        byte[] ct = cipher.doFinal(WebAuthnCore.utf8(records.toString()));
        prefs(ctx).edit().putString(KEY_INDEX, b64(cipher.getIV()) + ":" + b64(ct)).apply();
    }

    /**
     * Append one row this app minted itself, preserving everything already there.
     * Kept here rather than in PasskeyPrefs so the merge rule and the row schema
     * live in one file.
     */
    public static void appendDiscovery(Context ctx, Discoverable row) throws Exception {
        JSONArray next = new JSONArray();
        for (Discoverable d : discovery(ctx)) {
            boolean superseded = d.rpId.equals(row.rpId)
                    && (d.credentialId.equals(row.credentialId)
                        || (!row.userHandle.isEmpty() && row.userHandle.equals(d.userHandle)));
            if (superseded) continue;
            next.put(d.toJson());
        }
        next.put(row.toJson());
        putDiscoveryRaw(ctx, next);
    }

    /** Everything this device can offer, or an empty list. Never throws upward. */
    @NonNull
    public static List<Discoverable> discovery(Context ctx) {
        List<Discoverable> out = new ArrayList<>();
        String raw = prefs(ctx).getString(KEY_INDEX, null);
        if (raw == null) return out;
        try {
            int split = raw.indexOf(':');
            if (split < 0) return out;
            Cipher cipher = Cipher.getInstance(TRANSFORM);
            cipher.init(Cipher.DECRYPT_MODE, indexKey(),
                    new GCMParameterSpec(GCM_TAG_BITS, unb64(raw.substring(0, split))));
            String json = new String(cipher.doFinal(unb64(raw.substring(split + 1))), "UTF-8");
            JSONArray arr = new JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                String rpId = o.optString("rpId", "");
                String credentialId = o.optString("credentialId", "");
                if (rpId.isEmpty() || credentialId.isEmpty()) continue;
                out.add(new Discoverable(rpId, credentialId,
                        o.optString("userName", ""), o.optString("userHandle", ""),
                        o.optInt("accountIndex", 0),
                        o.optString("rootFp", ""), o.optBoolean("providerMinted", false)));
            }
        } catch (Exception e) {
            // A damaged or key-rotated projection means "nothing to offer", which
            // degrades username-less sign-in. It must NEVER be read as licence to
            // invent a credential — the MAC in WebAuthnCore is the only authority.
            return new ArrayList<>();
        }
        return out;
    }

    public static void clearDiscovery(Context ctx) {
        prefs(ctx).edit().remove(KEY_INDEX).apply();
        try {
            keystore().deleteEntry(INDEX_ALIAS);
        } catch (Exception ignored) { /* best effort */ }
    }

    public static void clearAll(Context ctx) {
        clearRoots(ctx);
        clearDiscovery(ctx);
    }
}
