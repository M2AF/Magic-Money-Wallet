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
     * ⚠ Best-effort by design. The wallet's own passkey-index.enc remains the
     * source of truth and is reconciled on next launch; losing a row here costs
     * username-less discovery, never the credential.
     */
    public static void appendDiscovery(Context ctx, String rpId, String credentialIdB64u,
                                       String userName, String userHandleB64u, int accountIndex) {
        try {
            JSONArray next = new JSONArray();
            List<PasskeyVault.Discoverable> existing = PasskeyVault.discovery(ctx);
            for (PasskeyVault.Discoverable d : existing) {
                boolean superseded = d.rpId.equals(rpId)
                        && (d.credentialId.equals(credentialIdB64u)
                            || (!userHandleB64u.isEmpty() && userHandleB64u.equals(d.userHandle)));
                if (superseded) continue;
                next.put(toJson(d.rpId, d.credentialId, d.userName, d.userHandle, d.accountIndex));
            }
            next.put(toJson(rpId, credentialIdB64u, userName, userHandleB64u, accountIndex));
            PasskeyVault.putDiscovery(ctx, next);
        } catch (Exception e) {
            Log.w(TAG, "could not record the new passkey for discovery", e);
        }
    }

    private static JSONObject toJson(String rpId, String credentialId, String userName,
                                     String userHandle, int accountIndex) throws Exception {
        JSONObject o = new JSONObject();
        o.put("rpId", rpId);
        o.put("credentialId", credentialId);
        o.put("userName", userName == null ? "" : userName);
        o.put("userHandle", userHandle == null ? "" : userHandle);
        o.put("accountIndex", accountIndex);
        return o;
    }
}
