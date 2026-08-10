package info.chainlens.magicmoney.passkey;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import androidx.annotation.RequiresApi;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

/**
 * Small shared state between the wallet (JS) and the provider service.
 *
 * Only two things live here: which wallet account is currently selected, and the
 * discovery projection. Neither is key material — see PasskeyVault for the split
 * between what is auth-bound and what is not, and why.
 */
@RequiresApi(api = Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
public final class PasskeyPrefs {

    private static final String TAG = "MagicMoneyPasskey";
    private static final String PREFS = "magicmoney.passkey";
    private static final String KEY_ACCOUNT = "current.account";

    private PasskeyPrefs() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * The account a provider-side registration will use. Pushed by the wallet
     * whenever the user switches accounts, so a passkey created from Chrome lands
     * under the same account the in-app browser would have used.
     */
    public static int currentAccount(Context ctx) {
        return prefs(ctx).getInt(KEY_ACCOUNT, 0);
    }

    public static void setCurrentAccount(Context ctx, int accountIndex) {
        prefs(ctx).edit().putInt(KEY_ACCOUNT, Math.max(0, accountIndex)).apply();
    }

    /**
     * Add one row to the discovery projection after a provider-side registration.
     *
     * Replaces any row for the same (rpId, userHandle), matching what the
     * TypeScript index does on re-registration: the relying party has just stored
     * a new public key, so the old credential is dead to it.
     *
     * The row is flagged `providerMinted` because the wallet's passkey-index.enc
     * has never heard of it — that flag is what stops the wallet's next sync from
     * deleting it. It also carries the fingerprint of the root that minted it, so
     * the service can later tell whether it is still signable without prompting.
     *
     * ⚠ Best-effort by design: losing a row here costs username-less discovery,
     * never the credential, which re-derives from the seed whenever a site names it.
     */
    public static void appendDiscovery(Context ctx, String rpId, String credentialIdB64u,
                                       String userName, String userHandleB64u, int accountIndex,
                                       byte[] root) {
        try {
            PasskeyVault.appendDiscovery(ctx, new PasskeyVault.Discoverable(
                    rpId, credentialIdB64u,
                    userName == null ? "" : userName,
                    userHandleB64u == null ? "" : userHandleB64u,
                    accountIndex,
                    PasskeyVault.rootFingerprint(root),
                    true));
        } catch (Exception e) {
            Log.w(TAG, "could not record the new passkey for discovery", e);
        }
    }
}
