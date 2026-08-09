package info.chainlens.magicmoney.passkey;

import android.app.Activity;
import android.content.Intent;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.RequiresApi;
import androidx.credentials.CreatePublicKeyCredentialRequest;
import androidx.credentials.CreatePublicKeyCredentialResponse;
import androidx.credentials.CredentialOption;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.GetPublicKeyCredentialOption;
import androidx.credentials.PublicKeyCredential;
import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.CreateCredentialUnknownException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.GetCredentialUnknownException;
import androidx.credentials.provider.CallingAppInfo;
import androidx.credentials.provider.PendingIntentHandler;
import androidx.credentials.provider.ProviderCreateCredentialRequest;
import androidx.credentials.provider.ProviderGetCredentialRequest;

import org.json.JSONArray;
import org.json.JSONObject;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.List;

import javax.crypto.Cipher;

/**
 * The activity a CredentialEntry's PendingIntent launches: biometric, then
 * ceremony, then hand the response back through PendingIntentHandler.
 *
 * This is the ONLY place the webauthnRoot ever exists in plaintext, and only
 * after BiometricPrompt has authorised the exact Cipher that unwraps it. The
 * service itself (MagicMoneyCredentialProviderService) runs with no UI and can
 * therefore never touch key material.
 *
 * ⚠ PRIVILEGED CALLS. `CallingAppInfo.getOrigin(allowlist)` returning non-null
 * means the caller is a browser on our allowlist speaking for a website. In that
 * case Chrome has ALREADY built the real clientDataJSON and hashed it, so we
 * must sign the hash IT supplied and return a placeholder clientDataJSON —
 * building our own would hash different bytes than the relying party verifies
 * against, and every signature would be rejected for no visible reason.
 * For a non-privileged native caller there is no browser, so we build the client
 * data ourselves around the caller's `android:apk-key-hash:` origin.
 */
@RequiresApi(api = Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
public class PasskeyActivity extends Activity {

    private static final String TAG = "MagicMoneyPasskey";

    public static final String EXTRA_CREDENTIAL_ID = "info.chainlens.magicmoney.passkey.CREDENTIAL_ID";
    public static final String EXTRA_ACCOUNT_INDEX = "info.chainlens.magicmoney.passkey.ACCOUNT_INDEX";

    /** Matches the in-app browser shim: cross-device reach is the seed, not a transport. */
    private static final String TRANSPORTS = "[\"internal\"]";

    private CancellationSignal cancellationSignal;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        ProviderGetCredentialRequest get =
                PendingIntentHandler.retrieveProviderGetCredentialRequest(getIntent());
        if (get != null) {
            handleGet(get);
            return;
        }
        ProviderCreateCredentialRequest create =
                PendingIntentHandler.retrieveProviderCreateCredentialRequest(getIntent());
        if (create != null) {
            handleCreate(create);
            return;
        }
        Log.w(TAG, "PasskeyActivity launched with neither a get nor a create request");
        finish();
    }

    // ── Sign in ──────────────────────────────────────────────────────────────

    private void handleGet(ProviderGetCredentialRequest request) {
        GetPublicKeyCredentialOption option = null;
        for (CredentialOption o : request.getCredentialOptions()) {
            if (o instanceof GetPublicKeyCredentialOption) {
                option = (GetPublicKeyCredentialOption) o;
                break;
            }
        }
        if (option == null) {
            failGet("No public-key option in the request");
            return;
        }

        final CallingAppInfo caller = request.getCallingAppInfo();
        final String origin = resolveOrigin(caller);
        final String requestJson = option.getRequestJson();

        final String rpId;
        final byte[] credentialId;
        final int accountIndex;
        try {
            JSONObject json = new JSONObject(requestJson);
            rpId = json.optString("rpId", originHost(origin));
            String entryCredId = getIntent().getStringExtra(EXTRA_CREDENTIAL_ID);
            if (entryCredId == null) { failGet("Entry carried no credential id"); return; }
            credentialId = WebAuthnCore.fromBase64Url(entryCredId);
            accountIndex = getIntent().getIntExtra(EXTRA_ACCOUNT_INDEX, 0);
        } catch (Exception e) {
            failGet("Malformed request: " + e.getMessage());
            return;
        }

        final ClientData clientData = clientDataFor("webauthn.get", requestJson, origin, caller,
                option.getClientDataHash());
        if (clientData == null) { failGet("Could not build client data"); return; }

        authenticate(accountIndex, "Sign in to " + displayName(rpId, origin), new RootConsumer() {
            @Override
            public void onRoot(byte[] root) {
                try {
                    // The MAC is the authority — an entry pointing at a credential
                    // this root did not mint is refused here, not signed with.
                    WebAuthnCore.Assertion assertion = WebAuthnCore.buildAssertion(
                            root, rpId, credentialId, clientData.hash, true);

                    JSONObject response = new JSONObject();
                    response.put("clientDataJSON", WebAuthnCore.base64Url(clientData.json));
                    response.put("authenticatorData", WebAuthnCore.base64Url(assertion.authenticatorData));
                    response.put("signature", WebAuthnCore.base64Url(assertion.signature));
                    String userHandle = getIntent().getStringExtra("userHandle");
                    if (userHandle != null && !userHandle.isEmpty()) {
                        response.put("userHandle", userHandle);
                    }

                    JSONObject out = new JSONObject();
                    String id = WebAuthnCore.base64Url(credentialId);
                    out.put("id", id);
                    out.put("rawId", id);
                    out.put("type", "public-key");
                    out.put("authenticatorAttachment", "platform");
                    out.put("clientExtensionResults", new JSONObject());
                    out.put("response", response);

                    Intent result = new Intent();
                    PendingIntentHandler.setGetCredentialResponse(result,
                            new GetCredentialResponse(new PublicKeyCredential(out.toString())));
                    setResult(RESULT_OK, result);
                    finish();
                } catch (Exception e) {
                    Log.w(TAG, "assertion failed", e);
                    failGet("Could not sign in with that passkey");
                }
            }

            @Override
            public void onFailure(String message) {
                failGet(message);
            }
        });
    }

    // ── Register ─────────────────────────────────────────────────────────────

    private void handleCreate(ProviderCreateCredentialRequest request) {
        if (!(request.getCallingRequest() instanceof CreatePublicKeyCredentialRequest)) {
            failCreate("Only passkeys are supported");
            return;
        }
        CreatePublicKeyCredentialRequest req = (CreatePublicKeyCredentialRequest) request.getCallingRequest();
        final CallingAppInfo caller = request.getCallingAppInfo();
        final String origin = resolveOrigin(caller);
        final String requestJson = req.getRequestJson();

        final String rpId;
        final String userName;
        final String userHandleB64;
        try {
            JSONObject json = new JSONObject(requestJson);
            JSONObject rp = json.optJSONObject("rp");
            rpId = rp != null && rp.has("id") ? rp.getString("id") : originHost(origin);
            JSONObject user = json.optJSONObject("user");
            userName = user != null ? user.optString("name", "") : "";
            userHandleB64 = user != null ? user.optString("id", "") : "";

            // ES256 only. Refusing here beats a biometric prompt for a ceremony
            // that cannot succeed.
            JSONArray params = json.optJSONArray("pubKeyCredParams");
            if (params != null && params.length() > 0) {
                boolean es256 = false;
                for (int i = 0; i < params.length(); i++) {
                    JSONObject p = params.optJSONObject(i);
                    if (p != null && p.optInt("alg", 0) == WebAuthnCore.COSE_ALG_ES256) es256 = true;
                }
                if (!es256) { failCreate("That site requires an algorithm Magic Money does not support"); return; }
            }
        } catch (Exception e) {
            failCreate("Malformed request: " + e.getMessage());
            return;
        }

        final ClientData clientData = clientDataFor("webauthn.create", requestJson, origin, caller,
                req.getClientDataHash());
        if (clientData == null) { failCreate("Could not build client data"); return; }

        // Registration always uses the wallet's current account — the same one
        // the in-app browser would use, so the two paths cannot disagree.
        final int accountIndex = PasskeyPrefs.currentAccount(this);

        authenticate(accountIndex, "Create a passkey for " + displayName(rpId, origin), new RootConsumer() {
            @Override
            public void onRoot(byte[] root) {
                try {
                    byte[] nonce = new byte[16];
                    new SecureRandom().nextBytes(nonce);
                    // Real AAGUID here, unlike the in-app shim: blanking it is the
                    // CLIENT's job and on this path Chrome is the client.
                    WebAuthnCore.Attestation att =
                            WebAuthnCore.buildAttestationObject(root, rpId, nonce, true, null);

                    JSONObject response = new JSONObject();
                    response.put("clientDataJSON", WebAuthnCore.base64Url(clientData.json));
                    response.put("attestationObject", WebAuthnCore.base64Url(att.attestationObject));
                    response.put("transports", new JSONArray(TRANSPORTS));

                    String id = WebAuthnCore.base64Url(att.credentialId);
                    JSONObject out = new JSONObject();
                    out.put("id", id);
                    out.put("rawId", id);
                    out.put("type", "public-key");
                    out.put("authenticatorAttachment", "platform");
                    out.put("clientExtensionResults", new JSONObject());
                    out.put("response", response);

                    // Record it so username-less sign-in can offer it later. A
                    // failure here costs discovery only — the credential itself is
                    // a function of the seed and still works when the site names it.
                    PasskeyPrefs.appendDiscovery(PasskeyActivity.this,
                            rpId, id, userName, userHandleB64, accountIndex);

                    Intent result = new Intent();
                    PendingIntentHandler.setCreateCredentialResponse(result,
                            new CreatePublicKeyCredentialResponse(out.toString()));
                    setResult(RESULT_OK, result);
                    finish();
                } catch (Exception e) {
                    Log.w(TAG, "registration failed", e);
                    failCreate("Could not create that passkey");
                }
            }

            @Override
            public void onFailure(String message) {
                failCreate(message);
            }
        });
    }

    // ── Origin + client data ─────────────────────────────────────────────────

    /**
     * The website this caller may speak for, or null for an ordinary app.
     *
     * getOrigin THROWS (rather than returning null) when a caller asserts an
     * origin while absent from the allowlist — a hostile app trying to harvest
     * another site's passkeys lands here, and the only safe reading is "no
     * origin", which forces the app-scoped path below.
     */
    @Nullable
    private String resolveOrigin(CallingAppInfo caller) {
        if (caller == null) return null;
        try {
            return caller.getOrigin(PrivilegedAllowlist.merged(this));
        } catch (Exception e) {
            Log.w(TAG, "caller " + caller.getPackageName()
                    + " asserted an origin but is not allowlisted: " + e.getMessage());
            return null;
        }
    }

    private static final class ClientData {
        final byte[] hash;
        final byte[] json;   // real, or a placeholder on the privileged path

        ClientData(byte[] hash, byte[] json) {
            this.hash = hash;
            this.json = json;
        }
    }

    /**
     * Privileged: sign the browser's own hash and return a placeholder JSON.
     * Otherwise: build the client data ourselves for the calling app's origin.
     */
    @Nullable
    private ClientData clientDataFor(String type, String requestJson, @Nullable String origin,
                                     CallingAppInfo caller, @Nullable byte[] suppliedHash) {
        try {
            String challenge = new JSONObject(requestJson).optString("challenge", "");
            if (origin != null && suppliedHash != null && suppliedHash.length == 32) {
                // Chrome hashed the real client data; anything we construct would
                // differ (key order, extra members) and every signature would fail
                // verification. The placeholder is what Android's own docs
                // prescribe for this case.
                JSONObject placeholder = new JSONObject();
                placeholder.put("type", type);
                placeholder.put("challenge", challenge);
                placeholder.put("origin", origin);
                placeholder.put("androidPackageName", caller.getPackageName());
                return new ClientData(suppliedHash, WebAuthnCore.utf8(placeholder.toString()));
            }

            String appOrigin = origin != null ? origin : apkKeyHashOrigin(caller);
            JSONObject json = new JSONObject();
            json.put("type", type);
            json.put("challenge", challenge);
            json.put("origin", appOrigin);
            json.put("androidPackageName", caller == null ? "" : caller.getPackageName());
            byte[] bytes = WebAuthnCore.utf8(json.toString());
            return new ClientData(WebAuthnCore.sha256(bytes), bytes);
        } catch (Exception e) {
            Log.w(TAG, "client data assembly failed", e);
            return null;
        }
    }

    /** The origin a native (non-browser) caller signs under. */
    private String apkKeyHashOrigin(CallingAppInfo caller) {
        try {
            android.content.pm.SigningInfo si = caller.getSigningInfo();
            android.content.pm.Signature[] sigs = si.hasMultipleSigners()
                    ? si.getApkContentsSigners() : si.getSigningCertificateHistory();
            byte[] cert = MessageDigest.getInstance("SHA-256").digest(sigs[0].toByteArray());
            return "android:apk-key-hash:" + WebAuthnCore.base64Url(cert);
        } catch (Exception e) {
            return "android:apk-key-hash:unknown";
        }
    }

    private static String originHost(@Nullable String origin) {
        if (origin == null) return "";
        try {
            String host = new java.net.URI(origin).getHost();
            return host == null ? "" : host;
        } catch (Exception e) {
            return "";
        }
    }

    private static String displayName(String rpId, @Nullable String origin) {
        if (rpId != null && !rpId.isEmpty()) return rpId;
        String host = originHost(origin);
        return host.isEmpty() ? "this app" : host;
    }

    // ── Biometric ────────────────────────────────────────────────────────────

    private interface RootConsumer {
        void onRoot(byte[] root);
        void onFailure(String message);
    }

    /**
     * BiometricPrompt bound to the very Cipher that unwraps the root. Passing the
     * Cipher as a CryptoObject is what makes the Keystore release the key — a
     * prompt whose result we merely trusted would be bypassable by anything that
     * could call this activity.
     */
    private void authenticate(int accountIndex, String subtitle, RootConsumer consumer) {
        final Cipher cipher;
        try {
            cipher = PasskeyVault.rootDecryptCipher(this, accountIndex);
        } catch (Exception e) {
            // KeyPermanentlyInvalidatedException lands here: a new fingerprint was
            // enrolled, so the wrapped roots can never be read again. Drop them so
            // the wallet shows "turn it back on" instead of failing forever.
            Log.w(TAG, "root cipher unavailable — clearing enrolment", e);
            PasskeyVault.clearRoots(this);
            consumer.onFailure("Magic Money needs to be re-enabled as a passkey provider");
            return;
        }
        if (cipher == null) {
            consumer.onFailure("This wallet account has no passkeys enabled on this device");
            return;
        }

        cancellationSignal = new CancellationSignal();
        BiometricPrompt prompt = new BiometricPrompt.Builder(this)
                .setTitle("Magic Money")
                .setSubtitle(subtitle)
                .setAllowedAuthenticators(
                        BiometricManager.Authenticators.BIOMETRIC_STRONG
                                | BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                .build();

        prompt.authenticate(new BiometricPrompt.CryptoObject(cipher), cancellationSignal,
                getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        byte[] root = null;
                        try {
                            Cipher authorised = result.getCryptoObject() != null
                                    ? result.getCryptoObject().getCipher() : cipher;
                            root = PasskeyVault.unwrapRoot(PasskeyActivity.this, accountIndex, authorised);
                            consumer.onRoot(root);
                        } catch (Exception e) {
                            Log.w(TAG, "root unwrap failed", e);
                            consumer.onFailure("Could not unlock your passkeys");
                        } finally {
                            if (root != null) java.util.Arrays.fill(root, (byte) 0);
                        }
                    }

                    @Override
                    public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                        consumer.onFailure(errString == null ? "Cancelled" : errString.toString());
                    }
                });
    }

    // ── Failure paths ────────────────────────────────────────────────────────

    private void failGet(String message) {
        Log.i(TAG, "get failed: " + message);
        Intent result = new Intent();
        PendingIntentHandler.setGetCredentialException(result,
                new GetCredentialUnknownException(message));
        setResult(RESULT_OK, result);
        finish();
    }

    private void failCreate(String message) {
        Log.i(TAG, "create failed: " + message);
        Intent result = new Intent();
        PendingIntentHandler.setCreateCredentialException(result,
                new CreateCredentialUnknownException(message));
        setResult(RESULT_OK, result);
        finish();
    }

    @Override
    protected void onDestroy() {
        if (cancellationSignal != null && !cancellationSignal.isCanceled()) cancellationSignal.cancel();
        super.onDestroy();
    }
}
