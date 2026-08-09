package info.chainlens.magicmoney.passkey;

import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

/**
 * The wallet's control surface over the system passkey provider.
 *
 * The wallet holds the seed; this service must not. So enabling the provider is
 * a deliberate hand-off: the wallet (unlocked) derives `webauthnRoot` for an
 * account and passes ONLY that here, where it is immediately wrapped by an
 * auth-bound Keystore key (PasskeyVault). The root never reaches disk unwrapped
 * and the seed never crosses this boundary at all.
 *
 * Everything is gated on Android 14 (API 34): below that the system never binds
 * a CredentialProviderService, so the wallet must hide the control rather than
 * offer one that silently cannot work.
 */
@CapacitorPlugin(name = "PasskeyProvider")
public class PasskeyProviderPlugin extends Plugin {

    private static final String TAG = "MagicMoneyPasskey";

    private static boolean supported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE;
    }

    /**
     * What the wallet needs to decide whether to show the control, and in which
     * state.
     *
     * `enabledInSettings` is best-effort: Android exposes no public API for "am I
     * the selected credential provider", so this reads the Settings.Secure key
     * the platform actually stores it in. A null result means "cannot tell" and
     * the UI must say so rather than assert either way.
     */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject out = new JSObject();
        out.put("supported", supported());
        out.put("androidVersion", Build.VERSION.SDK_INT);
        if (!supported()) {
            out.put("enrolled", false);
            out.put("enabledInSettings", JSObject.NULL);
            call.resolve(out);
            return;
        }
        out.put("enrolled", PasskeyVault.hasAnyRoot(getContext()));
        Boolean enabled = enabledInSettings();
        if (enabled == null) out.put("enabledInSettings", JSObject.NULL);
        else out.put("enabledInSettings", enabled.booleanValue());
        out.put("fingerprint", PrivilegedAllowlist.ownSigningFingerprint(getContext()));
        call.resolve(out);
    }

    /**
     * Is this app listed as an enabled credential provider?
     *
     * There is no public API, so we read the platform's own setting. The key
     * changed names across previews, hence the pair; returning null when neither
     * is readable is honest — the alternative (guessing false) would make the UI
     * nag a user who has already enabled it.
     *
     * ⚠ MEASURED: on a Galaxy S21+ running Android 15 this returns null even
     * when `credential_service_primary` is set to exactly this component (adb
     * can read it; the app cannot). So null is the NORMAL result on Samsung, not
     * an edge case — never build UI that treats null as "off".
     */
    private Boolean enabledInSettings() {
        String component = new ComponentName(getContext(),
                MagicMoneyCredentialProviderService.class).flattenToString();
        String shortForm = getContext().getPackageName() + "/"
                + MagicMoneyCredentialProviderService.class.getName();
        for (String key : new String[]{"credential_service", "credential_service_primary"}) {
            try {
                String value = Settings.Secure.getString(getContext().getContentResolver(), key);
                if (value == null) continue;
                if (value.contains(component) || value.contains(shortForm)) return Boolean.TRUE;
                // The key exists and we are not in it — a real "no".
                return Boolean.FALSE;
            } catch (Exception ignored) {
                // Fall through to the next key.
            }
        }
        return null;
    }

    /**
     * Hand over one account's webauthnRoot and the discovery projection.
     *
     * Call again for each account that should be reachable from Chrome: each has
     * its own root (the frozen spec puts accountIndex in the HKDF info), and the
     * provider can only sign for accounts it holds.
     */
    @PluginMethod
    public void enrol(PluginCall call) {
        if (!supported()) { call.reject("Android 14 or newer is required"); return; }
        String rootHex = call.getString("rootHex");
        if (rootHex == null || rootHex.length() != 64) {
            call.reject("rootHex must be the 32-byte webauthnRoot as hex");
            return;
        }
        int accountIndex = call.getInt("accountIndex", 0);
        byte[] root = null;
        try {
            root = WebAuthnCore.fromHex(rootHex);
            PasskeyVault.putRoot(getContext(), accountIndex, root);
            PasskeyPrefs.setCurrentAccount(getContext(), accountIndex);

            JSArray records = call.getArray("discovery");
            if (records != null) {
                PasskeyVault.putDiscovery(getContext(), new JSONArray(records.toString()));
            }
            call.resolve();
        } catch (Exception e) {
            Log.w(TAG, "enrol failed", e);
            call.reject("Could not enable the passkey provider: " + e.getMessage());
        } finally {
            // The plaintext root lives for microseconds and never leaves this frame.
            if (root != null) java.util.Arrays.fill(root, (byte) 0);
        }
    }

    /** Refresh the list of credentials the system sheet may offer. */
    @PluginMethod
    public void syncDiscovery(PluginCall call) {
        if (!supported()) { call.resolve(); return; }
        try {
            JSArray records = call.getArray("discovery");
            PasskeyVault.putDiscovery(getContext(),
                    records == null ? new JSONArray() : new JSONArray(records.toString()));
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not update the passkey list: " + e.getMessage());
        }
    }

    /** Keep provider-side registrations on the account the wallet is showing. */
    @PluginMethod
    public void setCurrentAccount(PluginCall call) {
        if (!supported()) { call.resolve(); return; }
        PasskeyPrefs.setCurrentAccount(getContext(), call.getInt("accountIndex", 0));
        call.resolve();
    }

    /**
     * Forget every wrapped root and the discovery list.
     *
     * The passkeys themselves are untouched — they are a function of the seed and
     * still work in the wallet's own browser, and on any device where the words
     * are restored. Only this device's system-wide access is withdrawn.
     */
    @PluginMethod
    public void disable(PluginCall call) {
        if (!supported()) { call.resolve(); return; }
        PasskeyVault.clearAll(getContext());
        call.resolve();
    }

    /**
     * Open Settings → Passwords, passkeys & accounts, focused on this app.
     *
     * There is no way to enable a provider programmatically, by design: the user
     * must choose it. Onboarding therefore has to send them here rather than
     * pretend the switch flipped.
     */
    @PluginMethod
    public void openSettings(PluginCall call) {
        if (!supported()) { call.reject("Android 14 or newer is required"); return; }
        try {
            Intent intent = new Intent(Settings.ACTION_CREDENTIAL_PROVIDER)
                    .setData(Uri.parse("package:" + getContext().getPackageName()))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            // Some OEM builds do not honour the deep link; the generic sync
            // settings screen still gets the user to the right place.
            try {
                getContext().startActivity(new Intent(Settings.ACTION_SYNC_SETTINGS)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                call.resolve();
            } catch (Exception inner) {
                call.reject("Could not open Settings — look for Passwords, passkeys & accounts");
            }
        }
    }
}
