package info.chainlens.magicmoney.passkey;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.OutcomeReceiver;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.provider.BeginCreateCredentialRequest;
import androidx.credentials.provider.BeginCreatePublicKeyCredentialRequest;
import androidx.credentials.provider.BeginCreateCredentialResponse;
import androidx.credentials.provider.BeginGetCredentialOption;
import androidx.credentials.provider.BeginGetCredentialRequest;
import androidx.credentials.provider.BeginGetCredentialResponse;
import androidx.credentials.provider.BeginGetPublicKeyCredentialOption;
import androidx.credentials.provider.CreateEntry;
import androidx.credentials.provider.CredentialProviderService;
import androidx.credentials.provider.ProviderClearCredentialStateRequest;
import androidx.credentials.provider.PublicKeyCredentialEntry;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import info.chainlens.magicmoney.R;

/**
 * Magic Money as a system passkey provider.
 *
 * This is the door Samsung Pass shut. Password managers only release site
 * passkeys to browsers on THEIR allowlist and there is no API to join one — so
 * the wallet stops asking and answers instead. Enabled under
 * Settings → Passwords, passkeys & accounts, it serves the same seed-derived
 * credentials the in-app browser uses, in Chrome, Brave and Samsung Internet.
 *
 * ⚠ NO CRYPTO HAPPENS HERE. This service runs with no UI and cannot prompt, so
 * it only ever reads the unencrypted-metadata discovery projection to decide
 * WHICH entries to show. Every signature is produced in PasskeyActivity, behind
 * a BiometricPrompt bound to the Cipher that unwraps the root. See PasskeyVault
 * for why the two are split.
 *
 * Android 14 (API 34) is the floor for CredentialProviderService; below that the
 * system never binds this and the wallet is unaffected.
 */
@RequiresApi(api = Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
public class MagicMoneyCredentialProviderService extends CredentialProviderService {

    private static final String TAG = "MagicMoneyPasskey";

    /**
     * PendingIntent request codes must differ per entry or the extras of the
     * first would be reused for all of them — the classic way an account chooser
     * ends up signing in as the wrong person.
     */
    private static int requestCode = 1000;

    @Override
    public void onBeginGetCredentialRequest(
            @NonNull BeginGetCredentialRequest request,
            @NonNull CancellationSignal cancellationSignal,
            @NonNull OutcomeReceiver<BeginGetCredentialResponse, GetCredentialException> callback) {

        // Browsers get added to Google's list over time; refresh in the
        // background so a newly-shipped browser eventually works. Never blocks.
        PrivilegedAllowlist.refreshIfStale(this);

        List<PublicKeyCredentialEntry> entries = new ArrayList<>();
        try {
            for (BeginGetCredentialOption option : request.getBeginGetCredentialOptions()) {
                if (!(option instanceof BeginGetPublicKeyCredentialOption)) continue;
                BeginGetPublicKeyCredentialOption pk = (BeginGetPublicKeyCredentialOption) option;
                entries.addAll(entriesFor(pk));
            }
        } catch (Exception e) {
            Log.w(TAG, "building credential entries failed", e);
        }

        BeginGetCredentialResponse.Builder response = new BeginGetCredentialResponse.Builder();
        for (PublicKeyCredentialEntry entry : entries) response.addCredentialEntry(entry);
        Log.i(TAG, "GET offered " + entries.size() + " passkey(s)");
        callback.onResult(response.build());
    }

    /**
     * Which of our credentials this request could use.
     *
     * `allowCredentials` present ⇒ the site named what it wants and we offer only
     * matches. Absent ⇒ username-less sign-in, so we offer everything we hold for
     * that rpId and let the user pick in the system sheet.
     */
    private List<PublicKeyCredentialEntry> entriesFor(BeginGetPublicKeyCredentialOption option)
            throws Exception {
        List<PublicKeyCredentialEntry> out = new ArrayList<>();
        JSONObject json = new JSONObject(option.getRequestJson());
        String rpId = json.optString("rpId", "");
        if (rpId.isEmpty()) return out;

        Set<String> allowed = new HashSet<>();
        JSONArray allow = json.optJSONArray("allowCredentials");
        if (allow != null) {
            for (int i = 0; i < allow.length(); i++) {
                JSONObject c = allow.optJSONObject(i);
                if (c != null) allowed.add(c.optString("id", ""));
            }
        }

        for (PasskeyVault.Discoverable d : PasskeyVault.discovery(this)) {
            if (!rpId.equals(d.rpId)) continue;
            if (!allowed.isEmpty() && !allowed.contains(d.credentialId)) continue;
            // A row whose account was never enrolled cannot be signed with, so
            // offering it would produce a prompt that always fails.
            if (!PasskeyVault.hasRoot(this, d.accountIndex)) continue;

            // ⚠ "A root exists for that account" is NOT the same as "that root
            // minted this credential". Each account has its own root (the frozen
            // spec puts accountIndex in the HKDF info), so a row left behind by a
            // different wallet — or one whose account was re-enrolled — passes
            // hasRoot and then dies in parseCredentialId's MAC check, AFTER the
            // user has already given a fingerprint. Measured on device as
            // "Unrecognised credential id: authentication tag mismatch".
            //
            // The MAC itself is unavailable here: this service has no UI, so it
            // can never unwrap a root to compute one. The root fingerprint is the
            // prompt-free equivalent and catches exactly that case. A row with no
            // fingerprint predates this check and is not offered — the wallet
            // rewrites its own rows, with fingerprints, on the next sync.
            String enrolled = PasskeyVault.enrolledFingerprint(this, d.accountIndex);
            if (enrolled == null || d.rootFp.isEmpty() || !enrolled.equals(d.rootFp)) {
                Log.i(TAG, "skipping a row this wallet cannot sign (stale or unverifiable)");
                continue;
            }

            Intent intent = new Intent(this, PasskeyActivity.class)
                    .setPackage(getPackageName())
                    .putExtra(PasskeyActivity.EXTRA_CREDENTIAL_ID, d.credentialId)
                    .putExtra(PasskeyActivity.EXTRA_ACCOUNT_INDEX, d.accountIndex)
                    .putExtra("userHandle", d.userHandle);

            PendingIntent pending = PendingIntent.getActivity(this, requestCode++, intent,
                    PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

            String label = d.userName == null || d.userName.isEmpty() ? rpId : d.userName;
            out.add(new PublicKeyCredentialEntry.Builder(this, label, pending, option)
                    .setDisplayName(getString(R.string.passkey_account_entry, d.accountIndex + 1))
                    .build());
        }
        return out;
    }

    @Override
    public void onBeginCreateCredentialRequest(
            @NonNull BeginCreateCredentialRequest request,
            @NonNull CancellationSignal cancellationSignal,
            @NonNull OutcomeReceiver<BeginCreateCredentialResponse, CreateCredentialException> callback) {

        BeginCreateCredentialResponse.Builder response = new BeginCreateCredentialResponse.Builder();

        // Passkeys only. Offering an entry for anything else would put the wallet
        // in prompts it cannot serve.
        if (request instanceof BeginCreatePublicKeyCredentialRequest && PasskeyVault.hasAnyRoot(this)) {
            Intent intent = new Intent(this, PasskeyActivity.class).setPackage(getPackageName());
            PendingIntent pending = PendingIntent.getActivity(this, requestCode++, intent,
                    PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            response.addCreateEntry(new CreateEntry.Builder(getString(R.string.passkey_create_entry), pending)
                    .setDescription("Saved to your seed phrase — restores on any device with your words")
                    .build());
            // Logged on the SUCCESS path too, not just the else. Without this,
            // "we were never asked" and "we offered and the user picked Google
            // Password Manager" are indistinguishable in logcat — which is
            // exactly the ambiguity that made a GPM-created passkey (aaguid
            // ea9b8d66-…) look like it might have been ours.
            Log.i(TAG, "CREATE offered an entry");
        } else {
            Log.i(TAG, "CREATE not offered (no enrolled root, or not a passkey request)");
        }
        callback.onResult(response.build());
    }

    /**
     * Nothing to clear. Credentials are a pure function of the seed; the only
     * local state is the discovery projection, which the wallet owns and which
     * the user removes by turning the provider off.
     */
    @Override
    public void onClearCredentialStateRequest(
            @NonNull ProviderClearCredentialStateRequest request,
            @NonNull CancellationSignal cancellationSignal,
            @NonNull OutcomeReceiver<Void, ClearCredentialException> callback) {
        callback.onResult(null);
    }
}
