package info.chainlens.magicmoney;

import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * SystemSettings — opening OEM settings screens that have no reliable public
 * intent.
 *
 * Deliberately NOT part of the passkey package: this is an Android/OEM
 * navigation problem, not passkey logic, and the same fallback ladder will be
 * wanted for other screens. PasskeyProviderPlugin.openSettings() predates this
 * and should delegate here once both are in one branch — it uses only
 * ACTION_CREDENTIAL_PROVIDER, which is the case measured to fail below.
 *
 * ⚠ MEASURED ON A GALAXY S21+ (Android 15): `Settings.ACTION_CREDENTIAL_PROVIDER`
 * does NOT resolve. Samsung ships the credential picker as a concrete component
 * and never registered the AOSP action for it, so an app relying on the action
 * alone silently lands the user nowhere — the worst outcome for an onboarding
 * step whose entire job is "go here and flip this switch".
 *
 * Everything below therefore checks resolvability BEFORE starting anything, and
 * reports which rung of the ladder worked so the UI can tell the truth rather
 * than claim it opened a screen the user never saw.
 */
@CapacitorPlugin(name = "SystemSettings")
public class SystemSettingsPlugin extends Plugin {

    private static final String TAG = "MagicMoneySettings";

    /** The real picker on AOSP and Samsung. Not exported as an action anywhere. */
    private static final ComponentName CREDENTIAL_PICKER = new ComponentName(
            "com.android.settings",
            "com.android.settings.applications.credentials.CredentialsPickerActivity");

    /**
     * Open Settings → Passwords, passkeys & accounts.
     *
     * Resolves `{ opened: boolean, via: string }`. `opened:false` is a normal,
     * expected answer on an OEM build we have not seen — the caller must then
     * show written directions instead of pretending the tap worked.
     */
    @PluginMethod
    public void openCredentialProviderSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // No credential-provider picker exists before Android 14. Saying so
            // beats dumping the user in an unrelated settings screen.
            call.resolve(result(false, "unsupported"));
            return;
        }

        // 1. The concrete component. First because it is the only one measured
        //    to work on Samsung, and it lands directly on the provider list.
        Intent picker = new Intent(Intent.ACTION_MAIN)
                .setComponent(CREDENTIAL_PICKER)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (start(picker)) { call.resolve(result(true, "picker-component")); return; }

        // 2. The AOSP action, scoped to us. Works on stock Android; a no-op on
        //    the device this was written for.
        Intent action = new Intent(Settings.ACTION_CREDENTIAL_PROVIDER)
                .setData(Uri.parse("package:" + getContext().getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (start(action)) { call.resolve(result(true, "credential-provider-action")); return; }

        // 3. The same action without the package filter — some builds reject the
        //    data URI but honour the bare action.
        Intent bare = new Intent(Settings.ACTION_CREDENTIAL_PROVIDER)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (start(bare)) { call.resolve(result(true, "credential-provider-bare")); return; }

        // 4. Last resort: the top-level settings app. Not the right screen, but
        //    it is somewhere the written directions can start from.
        Intent settings = new Intent(Settings.ACTION_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (start(settings)) { call.resolve(result(true, "settings-root")); return; }

        call.resolve(result(false, "none"));
    }

    /** Which rung would work, without navigating anywhere. Lets the UI pre-check. */
    @PluginMethod
    public void canOpenCredentialProviderSettings(PluginCall call) {
        boolean ok = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
                && (resolves(new Intent(Intent.ACTION_MAIN).setComponent(CREDENTIAL_PICKER))
                    || resolves(new Intent(Settings.ACTION_CREDENTIAL_PROVIDER)));
        call.resolve(result(ok, ok ? "available" : "none"));
    }

    /**
     * Resolve first, then start. `startActivity` on an unresolvable intent throws
     * ActivityNotFoundException, and catching that per-rung would also swallow
     * the SecurityException from a component the OEM has locked down — which is
     * a different problem deserving a different rung.
     */
    private boolean start(Intent intent) {
        if (!resolves(intent)) return false;
        try {
            getContext().startActivity(intent);
            return true;
        } catch (Exception e) {
            Log.w(TAG, "settings intent resolved but would not start: " + intent, e);
            return false;
        }
    }

    private boolean resolves(Intent intent) {
        PackageManager pm = getContext().getPackageManager();
        return intent.resolveActivity(pm) != null;
    }

    private JSObject result(boolean opened, String via) {
        JSObject o = new JSObject();
        o.put("opened", opened);
        o.put("via", via);
        return o;
    }
}
