package info.chainlens.magicmoney;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must register before the bridge initializes.
        registerPlugin(DappBrowserPlugin.class);
        registerPlugin(AppInfoPlugin.class);
        registerPlugin(DefaultBrowserPlugin.class);
        registerPlugin(DownloaderPlugin.class);
        // OEM settings deep-links (the credential-provider picker). Separate from
        // the passkey package on purpose — see SystemSettingsPlugin.
        registerPlugin(SystemSettingsPlugin.class);
        // Android 14+ system passkey provider. The plugin itself gates on
        // Build.VERSION, so registering it unconditionally is safe — the wallet
        // asks status() and hides the control on anything older.
        registerPlugin(info.chainlens.magicmoney.passkey.PasskeyProviderPlugin.class);
        super.onCreate(savedInstanceState);
        enableWebAuthn();
        surviveRendererLoss();
    }

    /**
     * The WebView renderer is shared by every WebView in the app, and Android
     * reclaims it under memory pressure — typically while we sit in the
     * background. Capacitor's default answer (false) crashes the whole process.
     *
     * The wallet WebView cannot be revived in place (a WebView whose renderer
     * died is unusable), so relaunch the activity cleanly instead: the wallet
     * comes back locked — exactly as after a crash, minus the crash — and the
     * browser's saved tab list (BrowserOverlay) restores the tabs after unlock.
     * dApp tab WebViews recover themselves in DappBrowserPlugin.
     */
    private void surviveRendererLoss() {
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                Intent relaunch = getPackageManager().getLaunchIntentForPackage(getPackageName());
                if (relaunch != null) {
                    relaunch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                    startActivity(relaunch);
                }
                finish();
                return true;
            }
        });
    }

    /**
     * android.webkit.WebView does NOT expose WebAuthn by default — measured on
     * device, `typeof PublicKeyCredential === "undefined"` inside our WebView even
     * though Chrome on the same phone does the full PRF round trip. Without this
     * call the passkey option simply never appears (the JS feature-detects and
     * hides it), so the wallet still works, just without passkey generation.
     *
     * FOR_APP makes THIS APP the relying party, which is right here: the page in
     * this WebView is the wallet itself, not someone else's site. The dApp
     * browser is the opposite case and uses FOR_BROWSER — see
     * DappBrowserPlugin.enableBrowserWebAuthn.
     *
     * ⚠ FOR_APP does NOT let us pick an arbitrary rpId. An earlier version of
     * this comment claimed assetlinks.json made 'www.chainlensnft.info' usable;
     * measured on device, that fails with "The relying party ID is not a
     * registrable domain suffix of, nor equal to, the current domain". Chromium
     * still enforces the web origin rule, so the rpId in capacitor/passkey.ts is
     * 'localhost' — matching the origin Capacitor serves.
     *
     * Guarded by isFeatureSupported: the API needs a recent WebView (and
     * androidx.webkit 1.12+), and on older devices we must degrade quietly rather
     * than crash at startup.
     */
    private void enableWebAuthn() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) return;
        try {
            WebSettings settings = getBridge().getWebView().getSettings();
            WebSettingsCompat.setWebAuthenticationSupport(
                    settings, WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP);
        } catch (Exception e) {
            // Never block startup over an optional capability.
        }
    }
}
