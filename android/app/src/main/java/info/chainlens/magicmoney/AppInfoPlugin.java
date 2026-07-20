package info.chainlens.magicmoney;

import android.os.Build;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * AppInfo — install-source probe.
 *
 * Google Play's Device & Network Abuse policy forbids apps self-updating
 * outside Play, so the Settings "Software Update" feature (GitHub Releases
 * download) must disappear when this exact same artifact was installed from
 * Play. One binary serves both channels (Play App Signing uses the imported
 * upload key, so signatures match), which makes this a RUNTIME check:
 * installer 'com.android.vending' = Play; null / package-installer = sideload.
 */
@CapacitorPlugin(name = "AppInfo")
public class AppInfoPlugin extends Plugin {

    @PluginMethod
    public void getInstallSource(PluginCall call) {
        String installer = null;
        try {
            String pkg = getContext().getPackageName();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                installer = getContext().getPackageManager().getInstallSourceInfo(pkg).getInstallingPackageName();
            } else {
                @SuppressWarnings("deprecation")
                String legacy = getContext().getPackageManager().getInstallerPackageName(pkg);
                installer = legacy;
            }
        } catch (Exception ignored) { }
        JSObject ret = new JSObject();
        ret.put("installer", installer);
        call.resolve(ret);
    }

    /**
     * FLAG_SECURE toggle for seed-phrase screens: while on, Android blocks
     * screenshots/screen recording and blanks the app preview in Recents.
     * Scoped to seed display only — users still screenshot receive QRs etc.
     */
    @PluginMethod
    public void setSecureScreen(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) {
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            } else {
                getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            }
            call.resolve();
        });
    }
}
