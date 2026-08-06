package info.chainlens.magicmoney.passkey;

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
import androidx.credentials.provider.BeginCreateCredentialResponse;
import androidx.credentials.provider.BeginGetCredentialRequest;
import androidx.credentials.provider.BeginGetCredentialResponse;
import androidx.credentials.provider.CallingAppInfo;
import androidx.credentials.provider.CredentialProviderService;
import androidx.credentials.provider.ProviderClearCredentialStateRequest;

/**
 * PHASE 0 SPIKE — measurement only. Returns NO credential entries and performs
 * no crypto, so enabling it cannot disturb real sign-ins.
 *
 * It exists to answer one question that decides whether the wallet can be a
 * passkey provider at all:
 *
 *   Does CallingAppInfo.getOrigin(ourAllowlist) return the site origin when the
 *   request comes from the WALLET'S OWN browser?
 *
 * Providers honour a browser-supplied origin only for apps in the allowlist they
 * pass in, and we allowlist ourselves (see PrivilegedAllowlist). If Android
 * nonetheless refuses — treating an app vouching for itself as self-dealing —
 * then the plan's Phase 4 cannot work as designed and we stop here rather than
 * discovering it three weeks in.
 *
 * Read the answer with:
 *   adb logcat -s MagicMoneyPasskey:*
 * after triggering a passkey prompt from Chrome and from the wallet's browser.
 *
 * Android 14 (API 34) is the floor for CredentialProviderService; on anything
 * older the system never binds this service and the wallet is unaffected.
 */
@RequiresApi(api = Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
public class MagicMoneyCredentialProviderService extends CredentialProviderService {

    private static final String TAG = "MagicMoneyPasskey";

    @Override
    public void onBeginGetCredentialRequest(
            @NonNull BeginGetCredentialRequest request,
            @NonNull CancellationSignal cancellationSignal,
            @NonNull OutcomeReceiver<BeginGetCredentialResponse, GetCredentialException> callback) {
        report("GET", request.getCallingAppInfo());
        // No entries: the wallet offers nothing yet. Deliberate for the spike.
        callback.onResult(new BeginGetCredentialResponse.Builder().build());
    }

    @Override
    public void onBeginCreateCredentialRequest(
            @NonNull BeginCreateCredentialRequest request,
            @NonNull CancellationSignal cancellationSignal,
            @NonNull OutcomeReceiver<BeginCreateCredentialResponse, CreateCredentialException> callback) {
        report("CREATE", request.getCallingAppInfo());
        callback.onResult(new BeginCreateCredentialResponse.Builder().build());
    }

    @Override
    public void onClearCredentialStateRequest(
            @NonNull ProviderClearCredentialStateRequest request,
            @NonNull CancellationSignal cancellationSignal,
            @NonNull OutcomeReceiver<Void, ClearCredentialException> callback) {
        callback.onResult(null);
    }

    /**
     * The measurement. `origin != null` means Android accepted our allowlist and
     * told us which website the caller speaks for — the green light for Phase 4.
     * `origin == null` for our own package is the kill criterion.
     */
    private void report(String phase, CallingAppInfo info) {
        if (info == null) { Log.w(TAG, phase + ": no CallingAppInfo"); return; }
        String caller = info.getPackageName();
        String origin;
        try {
            origin = info.getOrigin(PrivilegedAllowlist.selfAllowlist(this));
        } catch (Exception e) {
            // getOrigin throws when the caller claims an origin but is not
            // allowlisted — itself a meaningful answer, so record it as one.
            Log.i(TAG, phase + " caller=" + caller + " origin=THREW " + e.getClass().getSimpleName()
                    + ": " + e.getMessage());
            return;
        }
        boolean isSelf = getPackageName().equals(caller);
        Log.i(TAG, phase + " caller=" + caller + (isSelf ? " (OUR OWN BROWSER)" : "")
                + " origin=" + (origin == null ? "null" : origin));
    }
}
