package info.chainlens.magicmoney;

import android.app.Activity;
import android.app.role.RoleManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * DefaultBrowser — lets the user make MagicMoney the phone's default browser, so
 * links tapped in any other app open in the in-app dApp browser instead of Chrome.
 *
 * Android never lets an app grant itself the browser role; it can only ASK. Two
 * paths exist, picked at runtime:
 *
 *   • API 29+ (Q): RoleManager.ROLE_BROWSER. createRequestRoleIntent() shows the
 *     system's one-tap "Make MagicMoney your default browser?" dialog, and
 *     isRoleHeld() is an authoritative answer to "are we default?".
 *   • API 26–28: no RoleManager. Fall back to opening the default-apps settings
 *     screen and resolve the current holder with PackageManager.
 *
 * Eligibility comes from the manifest, not from here: MainActivity declares a
 * VIEW/BROWSABLE/DEFAULT filter with bare http + https schemes (no host), which
 * is exactly the shape Android's browser-role check looks for.
 */
@CapacitorPlugin(name = "DefaultBrowser")
public class DefaultBrowserPlugin extends Plugin {

    private JSObject status() {
        JSObject ret = new JSObject();
        ret.put("supported", true);
        ret.put("registered", true);   // the manifest filter IS the registration
        ret.put("isDefault", isDefaultBrowser());
        return ret;
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void requestDefault(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            RoleManager roleManager = (RoleManager) getContext().getSystemService(Context.ROLE_SERVICE);
            if (roleManager != null && roleManager.isRoleAvailable(RoleManager.ROLE_BROWSER)) {
                if (roleManager.isRoleHeld(RoleManager.ROLE_BROWSER)) {
                    call.resolve(status());
                    return;
                }
                Intent intent = roleManager.createRequestRoleIntent(RoleManager.ROLE_BROWSER);
                startActivityForResult(call, intent, "roleRequestResult");
                return;
            }
        }
        openDefaultAppsSettings();
        call.resolve(status());
    }

    /** The role dialog is dismissed — report the (possibly changed) holder back. */
    @ActivityCallback
    private void roleRequestResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        call.resolve(status());
    }

    private boolean isDefaultBrowser() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            RoleManager roleManager = (RoleManager) getContext().getSystemService(Context.ROLE_SERVICE);
            if (roleManager != null && roleManager.isRoleAvailable(RoleManager.ROLE_BROWSER)) {
                return roleManager.isRoleHeld(RoleManager.ROLE_BROWSER);
            }
        }
        // Pre-Q: ask the package manager who currently wins a plain web link.
        try {
            Intent probe = new Intent(Intent.ACTION_VIEW, Uri.parse("http://example.com"));
            probe.addCategory(Intent.CATEGORY_BROWSABLE);
            ResolveInfo info = getContext().getPackageManager()
                    .resolveActivity(probe, PackageManager.MATCH_DEFAULT_ONLY);
            return info != null
                    && info.activityInfo != null
                    && getContext().getPackageName().equals(info.activityInfo.packageName);
        } catch (Exception ignored) {
            return false;
        }
    }

    /** Best-effort jump to Settings; falls back to the app's own details page. */
    private void openDefaultAppsSettings() {
        Activity activity = getActivity();
        if (activity == null) return;
        try {
            activity.startActivity(new Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS));
        } catch (Exception ignored) {
            try {
                Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                fallback.setData(Uri.parse("package:" + getContext().getPackageName()));
                activity.startActivity(fallback);
            } catch (Exception ignored2) { }
        }
    }
}
