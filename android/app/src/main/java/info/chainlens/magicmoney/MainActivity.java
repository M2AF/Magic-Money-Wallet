package info.chainlens.magicmoney;

import android.os.Bundle;
import android.webkit.WebSettings;

import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must register before the bridge initializes.
        registerPlugin(DappBrowserPlugin.class);
        registerPlugin(AppInfoPlugin.class);
        registerPlugin(DefaultBrowserPlugin.class);
        registerPlugin(DownloaderPlugin.class);
        super.onCreate(savedInstanceState);
        enableWebAuthn();
    }

    /**
     * android.webkit.WebView does NOT expose WebAuthn by default — measured on
     * device, `typeof PublicKeyCredential === "undefined"` inside our WebView even
     * though Chrome on the same phone does the full PRF round trip. Without this
     * call the passkey option simply never appears (the JS feature-detects and
     * hides it), so the wallet still works, just without passkey generation.
     *
     * FOR_APP makes THIS APP the relying party. Android verifies that by fetching
     * https://chainlensnft.info/.well-known/assetlinks.json and checking our
     * signing certificate is listed there, which is why the rpId in
     * capacitor/passkey.ts is that domain and not 'localhost'.
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
