package info.chainlens.magicmoney;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Environment;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.ProxyConfig;
import androidx.webkit.ProxyController;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;
import org.torproject.jni.TorService;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import javax.net.ssl.HttpsURLConnection;

/**
 * DappBrowser — native WebViews for untrusted dApp content.
 *
 * The wallet UI (trusted, holds keys while unlocked) stays in the Capacitor
 * WebView; every dApp page runs in a SEPARATE android.webkit.WebView hosted by
 * this plugin, mirroring the extension's realm boundary. The two sides only
 * meet through this plugin's message pipe:
 *
 *   dApp page (dapp-inject.js providers)
 *     → __mmBridge (WebViewCompat.addWebMessageListener, main frame only,
 *        origin authenticated by chromium via sourceOrigin)
 *     → notifyListeners('pageRequest') → wallet WebView (dapp-glue.ts validates
 *        against PAGE_RPC_TYPES, routes into the shared wallet handler, shows
 *        approval overlays)
 *     → respond() / emitEvent() → JavaScriptReplyProxy.postMessage
 *
 * Provider injection happens at document_start via addDocumentStartJavaScript
 * (the exact analog of the extension's content_scripts run_at=document_start),
 * with an onPageStarted evaluateJavascript fallback for old WebViews — the
 * EIP-6963 re-announce listener keeps the wallet discoverable if that races.
 */
@CapacitorPlugin(name = "DappBrowser")
public class DappBrowserPlugin extends Plugin {

    private static class Tab {
        int id;
        WebView webView;
        JavaScriptReplyProxy replyProxy;
        String origin = "";
        // volatile: written on the UI thread (onPageStarted), read from WebView
        // IO threads inside shouldInterceptRequest (Magic Guard source URL).
        volatile String url = "";
        String title = "";
        boolean loading = false;
        // Magic Guard counters — mutated on IO threads, read on the UI thread.
        final AtomicInteger blockedPage = new AtomicInteger();
        final AtomicInteger blockedTab = new AtomicInteger();
    }

    private FrameLayout container;
    private final Map<Integer, Tab> tabs = new LinkedHashMap<>();
    private final Map<String, Integer> pendingRequests = new ConcurrentHashMap<>();
    private int nextTabId = 1;
    private int activeTabId = -1;
    private String injectJs = null;
    private boolean docStartSupported = false;
    // The embedded Tor service starts asynchronously; bootstrap/verification
    // continue on separate executor workers while WebView remains fail-closed.
    private final ExecutorService torExecutor = Executors.newCachedThreadPool();
    private volatile boolean torEnabled = false;
    private volatile String torStatus = "off";
    private volatile String torMessage = "Tor Mode is off";
    private volatile int torPort = 19050;
    private volatile TorService torService;
    private volatile ServiceConnection torServiceConnection;
    private final AtomicInteger torGeneration = new AtomicInteger();
    private boolean browserShown = false;
    // Last bounds in CSS px, reapplied on setBounds
    private int bx = 0, by = 0, bw = 0, bh = 0;

    // ── Magic Guard state ────────────────────────────────────────────────────
    // Enabled flag + exact-hostname site exceptions live in this plugin's own
    // SharedPreferences (Android's analog of the desktop's userData/magic-guard
    // store) — the WalletConfig.magicGuardEnabled field in capacitor-store stays
    // a shape-parity field, as documented there. Reads happen on WebView IO
    // threads inside shouldInterceptRequest, so both are lock-free/concurrent.
    private static final String GUARD_PREFS = "magicguard";
    private volatile boolean guardEnabled = true;
    private final Set<String> guardExceptions = ConcurrentHashMap.newKeySet();
    private final Handler guardHandler = new Handler(Looper.getMainLooper());
    private final AtomicBoolean guardPushPending = new AtomicBoolean(false);

    private static final int MAX_TABS = 5;
    @Override
    public void load() {
        injectJs = readAsset("public/dapp-inject.js");
        docStartSupported = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);
        loadGuardPrefs();
        // Engine construction parses ~3.6MB of bundled filter lists — never on
        // the UI thread. Until it finishes, isReady() is false and every request
        // is allowed through (fail-open), status reports 'loading'.
        Context appContext = getContext().getApplicationContext();
        new Thread(() -> MagicGuardNative.init(appContext), "magic-guard-init").start();
    }

    private String readAsset(String path) {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(
                getContext().getAssets().open(path), StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line).append('\n');
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    @PluginMethod
    public void open(PluginCall call) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            call.reject("Update Android System WebView to use the dApp browser");
            return;
        }
        String url = call.getString("url", "https://www.chainlensnft.info/");
        JSObject bounds = call.getObject("bounds", new JSObject());
        getActivity().runOnUiThread(() -> {
            ensureContainer();
            browserShown = true;
            applyBounds(bounds);
            Tab tab = createTab(url);
            selectTabInternal(tab.id);
            JSObject ret = new JSObject();
            ret.put("tabId", tab.id);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            exitFullscreen();
            for (Tab t : tabs.values()) {
                container.removeView(t.webView);
                t.webView.destroy();
            }
            tabs.clear();
            activeTabId = -1;
            browserShown = false;
            if (container != null) container.setVisibility(View.GONE);
            notifyListeners("closed", new JSObject());
            call.resolve();
        });
    }

    @PluginMethod
    public void newTab(PluginCall call) {
        String url = call.getString("url", "https://www.chainlensnft.info/");
        getActivity().runOnUiThread(() -> {
            if (tabs.size() >= MAX_TABS) {
                call.reject("Tab limit reached (" + MAX_TABS + ")");
                return;
            }
            ensureContainer();
            Tab tab = createTab(url);
            selectTabInternal(tab.id);
            JSObject ret = new JSObject();
            ret.put("tabId", tab.id);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void selectTab(PluginCall call) {
        int id = call.getInt("tabId", -1);
        getActivity().runOnUiThread(() -> {
            if (!tabs.containsKey(id)) { call.reject("No such tab"); return; }
            selectTabInternal(id);
            call.resolve();
        });
    }

    @PluginMethod
    public void closeTab(PluginCall call) {
        int id = call.getInt("tabId", -1);
        getActivity().runOnUiThread(() -> {
            Tab t = tabs.remove(id);
            if (t != null) {
                container.removeView(t.webView);
                t.webView.destroy();
            }
            if (activeTabId == id) {
                Integer next = tabs.isEmpty() ? null : tabs.keySet().iterator().next();
                if (next != null) selectTabInternal(next);
                else {
                    activeTabId = -1;
                    browserShown = false;
                    syncContainerVisibility();
                    notifyListeners("closed", new JSObject());
                }
            }
            pushTabsChanged();
            call.resolve();
        });
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    @PluginMethod
    public void navigate(PluginCall call) {
        String url = call.getString("url", "");
        getActivity().runOnUiThread(() -> {
            Tab t = active();
            if (t != null && url != null && !url.isEmpty()) t.webView.loadUrl(url);
            call.resolve();
        });
    }

    @PluginMethod
    public void goBack(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Tab t = active();
            if (t != null && t.webView.canGoBack()) t.webView.goBack();
            call.resolve();
        });
    }

    @PluginMethod
    public void goForward(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Tab t = active();
            if (t != null && t.webView.canGoForward()) t.webView.goForward();
            call.resolve();
        });
    }

    @PluginMethod
    public void reload(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Tab t = active();
            if (t != null) t.webView.reload();
            call.resolve();
        });
    }

    @PluginMethod
    public void canGoBack(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Tab t = active();
            JSObject ret = new JSObject();
            ret.put("canBack", t != null && t.webView.canGoBack());
            call.resolve(ret);
        });
    }

    // ── Layout / visibility ───────────────────────────────────────────────────

    @PluginMethod
    public void setBounds(PluginCall call) {
        JSObject bounds = call.getData();
        getActivity().runOnUiThread(() -> {
            applyBounds(bounds);
            call.resolve();
        });
    }

    @PluginMethod
    public void hide(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            // Leaving the browser must drop fullscreen too, or the video would
            // stay pinned over the wallet UI with no way back.
            exitFullscreen();
            browserShown = false;
            syncContainerVisibility();
            call.resolve();
        });
    }

    @PluginMethod
    public void show(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            browserShown = true;
            syncContainerVisibility();
            call.resolve();
        });
    }

    // ── Password autofill / manual fill ──────────────────────────────────────
    //
    // JS is evaluated in the ACTIVE tab's WebView only, and the caller (the
    // wallet WebView's password vault) has already matched the credential
    // against that tab's host. `evalInActiveTab` is deliberately NOT a general
    // "run this on any tab" primitive: there is no tabId parameter, so the
    // wallet can never aim a fill at a background tab it isn't looking at.
    @PluginMethod
    public void fillCredentials(PluginCall call) {
        String script = call.getString("script", "");
        if (script == null || script.isEmpty()) {
            call.reject("No fill script supplied");
            return;
        }
        getActivity().runOnUiThread(() -> {
            Tab t = active();
            if (t == null) {
                call.reject("There is no page to fill");
                return;
            }
            t.webView.evaluateJavascript(script, value -> {
                JSObject ret = new JSObject();
                // evaluateJavascript hands back a JSON literal, so a returned
                // string arrives quoted — compare against the quoted form.
                ret.put("ok", !"\"no-form\"".equals(value));
                ret.put("result", value == null ? "" : value);
                call.resolve(ret);
            });
        });
    }

    /** True when the active tab currently shows a visible password field. */
    @PluginMethod
    public void hasLoginForm(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Tab t = active();
            if (t == null) {
                JSObject ret = new JSObject();
                ret.put("hasForm", false);
                call.resolve(ret);
                return;
            }
            t.webView.evaluateJavascript(HAS_LOGIN_FORM_JS, value -> {
                JSObject ret = new JSObject();
                ret.put("hasForm", "true".equals(value));
                ret.put("url", t.url == null ? "" : t.url);
                call.resolve(ret);
            });
        });
    }

    private static final String HAS_LOGIN_FORM_JS =
            "(function(){var l=document.querySelectorAll('input[type=\"password\"]');" +
            "for(var i=0;i<l.length;i++){var r=l[i].getBoundingClientRect();" +
            "if(r.width>0&&r.height>0)return true;}return false;})()";

    // ── Share sheet ──────────────────────────────────────────────────────────
    // Android's system share sheet — the platform-correct analog of the
    // desktop's "copy link / share by email" pair, and what a phone user
    // actually expects from a share button.
    @PluginMethod
    public void sharePage(PluginCall call) {
        String url = call.getString("url", "");
        String title = call.getString("title", "");
        if (url == null || url.isEmpty()) {
            call.reject("There is no page to share");
            return;
        }
        final String shareTitle = title == null ? "" : title;
        getActivity().runOnUiThread(() -> {
            try {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_TEXT, url);
                if (!shareTitle.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, shareTitle);
                Intent chooser = Intent.createChooser(send, "Share page");
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(chooser);
                call.resolve();
            } catch (Exception e) {
                call.reject("No app is available to share with");
            }
        });
    }

    // ── Install page as an app (home-screen shortcut) ────────────────────────
    // The Android analog of the desktop's .lnk/.desktop shortcut. The shortcut
    // fires a VIEW intent at MagicMoney itself, which the manifest's http/https
    // filter already routes into this dApp browser — the same path used when
    // MagicMoney holds the default-browser role. Launchers that don't support
    // pinning report unsupported rather than silently doing nothing.
    @PluginMethod
    public void installShortcut(PluginCall call) {
        String url = call.getString("url", "");
        String name = call.getString("name", "");
        if (url == null || url.isEmpty()) {
            call.reject("There is no page to install");
            return;
        }
        final String label = (name == null || name.trim().isEmpty())
                ? Uri.parse(url).getHost() : name.trim();
        getActivity().runOnUiThread(() -> {
            try {
                if (!ShortcutManagerCompat.isRequestPinShortcutSupported(getContext())) {
                    call.reject("This launcher does not support adding shortcuts");
                    return;
                }
                Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                open.setPackage(getContext().getPackageName());
                open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

                ShortcutInfoCompat shortcut = new ShortcutInfoCompat.Builder(
                            getContext(), "mm-webapp-" + Integer.toHexString(url.hashCode()))
                        .setShortLabel(label == null || label.isEmpty() ? "Web App" : label)
                        .setLongLabel(label == null || label.isEmpty() ? "Web App" : label)
                        .setIcon(IconCompat.createWithResource(getContext(), R.mipmap.ic_launcher))
                        .setIntent(open)
                        .build();

                ShortcutManagerCompat.requestPinShortcut(getContext(), shortcut, null);
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not add the shortcut");
            }
        });
    }

    @PluginMethod
    public void getState(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Tab t = active();
            JSObject ret = new JSObject();
            ret.put("url", t == null ? "" : t.url);
            ret.put("canBack", t != null && t.webView.canGoBack());
            ret.put("canForward", t != null && t.webView.canGoForward());
            ret.put("loading", t != null && t.loading);
            ret.put("activeTabId", activeTabId);
            ret.put("tabs", tabsArray());
            call.resolve(ret);
        });
    }

    // ── Tor browser proxy ────────────────────────────────────────────────────

    @PluginMethod
    public void getTorState(PluginCall call) {
        call.resolve(torStateJson());
    }

    @PluginMethod
    public void setTorMode(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
            torEnabled = false;
            torStatus = "unsupported";
            torMessage = "Update Android System WebView to use Tor Mode";
            pushTorState();
            call.resolve(torStateJson());
            return;
        }

        if (!enabled) {
            torGeneration.incrementAndGet();
            torEnabled = false;
            torStatus = "connecting";
            torMessage = "Disconnecting from Tor…";
            pushTorState();
            ProxyController.getInstance().clearProxyOverride(
                    ContextCompat.getMainExecutor(getContext()),
                    () -> {
                        stopEmbeddedTorRuntime();
                        torStatus = "off";
                        torMessage = "Tor Mode is off";
                        reloadAllTabs();
                        pushTorState();
                        call.resolve(torStateJson());
                    });
            return;
        }

        final int generation = torGeneration.incrementAndGet();
        torEnabled = true;
        torStatus = "connecting";
        torMessage = "Starting embedded Tor… first connection can take up to a minute";
        torPort = 19050;
        pushTorState();

        // Fail closed before starting Tor: WebView is hidden and every subsequent
        // request is pinned to the embedded SOCKS endpoint, even during bootstrap.
        applyTorProxy(torPort, () -> {
            stopLoadingAllTabs();
            startEmbeddedTor(generation, call);
        });
    }

    // ── Magic Guard (privacy filtering for dApp WebViews) ────────────────────
    // The hostname a toggle applies to is always derived from the ACTIVE tab's
    // own top-level URL on the Java side — never from a value the JS layer
    // passes in — mirroring the desktop's browser-manager.ts invariant.

    @PluginMethod
    public void getMagicGuardState(PluginCall call) {
        getActivity().runOnUiThread(() -> call.resolve(guardStateJson()));
    }

    @PluginMethod
    public void setMagicGuardEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        getActivity().runOnUiThread(() -> {
            guardEnabled = enabled;
            persistGuardPrefs();
            JSObject state = guardStateJson();
            notifyListeners("magicGuardStateChanged", state);
            call.resolve(state);
        });
    }

    /** enabled=false excepts the active tab's site (guard off there); true un-excepts. */
    @PluginMethod
    public void setMagicGuardForSite(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        getActivity().runOnUiThread(() -> {
            Tab t = active();
            String host = t == null ? null : hostOf(t.url);
            if (host != null) {
                if (enabled) guardExceptions.remove(host);
                else guardExceptions.add(host);
                persistGuardPrefs();
            }
            JSObject state = guardStateJson();
            notifyListeners("magicGuardStateChanged", state);
            call.resolve(state);
        });
    }

    private void loadGuardPrefs() {
        SharedPreferences prefs = getContext().getSharedPreferences(GUARD_PREFS, Context.MODE_PRIVATE);
        guardEnabled = prefs.getBoolean("enabled", true);
        try {
            JSONArray arr = new JSONArray(prefs.getString("exceptions", "[]"));
            for (int i = 0; i < arr.length(); i++) guardExceptions.add(arr.getString(i));
        } catch (Exception ignored) {
            // Corrupt store → ignore it and default to protection ON everywhere.
        }
    }

    private void persistGuardPrefs() {
        getContext().getSharedPreferences(GUARD_PREFS, Context.MODE_PRIVATE).edit()
                .putBoolean("enabled", guardEnabled)
                .putString("exceptions", new JSONArray(guardExceptions).toString())
                .apply();
    }

    private static String hostOf(String url) {
        if (url == null || url.isEmpty()) return null;
        try {
            String host = Uri.parse(url).getHost();
            return host == null || host.isEmpty() ? null : host.toLowerCase(Locale.ROOT);
        } catch (Exception e) {
            return null;
        }
    }

    /** Must run on the UI thread (reads the tab registry). */
    private JSObject guardStateJson() {
        Tab t = active();
        String host = t == null ? null : hostOf(t.url);
        boolean siteEnabled = host == null || !guardExceptions.contains(host);
        JSObject state = new JSObject();
        state.put("enabled", guardEnabled);
        state.put("siteEnabled", siteEnabled);
        state.put("effectiveEnabled", guardEnabled && siteEnabled && MagicGuardNative.isReady());
        state.put("status", !guardEnabled ? "disabled" : MagicGuardNative.status());
        if (host == null) state.put("hostname", JSONObject.NULL);
        else state.put("hostname", host);
        state.put("blockedThisPage", t == null ? 0 : t.blockedPage.get());
        state.put("blockedThisTab", t == null ? 0 : t.blockedTab.get());
        return state;
    }

    /**
     * Coalesced per-block state push: blocked requests can arrive many times a
     * second on an ad-heavy page, so batch to one event per 150ms (trailing
     * edge, so the final counts always land). Nav/tab-switch pushes stay
     * immediate on their own paths.
     */
    private void scheduleGuardPush() {
        if (!guardPushPending.compareAndSet(false, true)) return;
        guardHandler.postDelayed(() -> {
            guardPushPending.set(false);
            notifyListeners("magicGuardStateChanged", guardStateJson());
        }, 150);
    }

    private static WebResourceResponse blockedResponse() {
        WebResourceResponse response = new WebResourceResponse(
                "text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
        try {
            response.setStatusCodeAndReasonPhrase(204, "No Content");
        } catch (Exception ignored) { /* keep default 200 with an empty body */ }
        return response;
    }

    /**
     * Classify an Android WebResourceRequest into an adblock-rust request-type
     * alias. Android exposes no Chromium resource type here, so this is the
     * plan's tested best-effort ladder: Sec-Fetch-Dest → Accept header →
     * conservative URL-extension hints → 'other'. Cannot match Electron's
     * precision — documented Android limitation.
     */
    private static String classifyResource(WebResourceRequest request) {
        String dest = null;
        String accept = null;
        Map<String, String> headers = request.getRequestHeaders();
        if (headers != null) {
            for (Map.Entry<String, String> e : headers.entrySet()) {
                if ("sec-fetch-dest".equalsIgnoreCase(e.getKey())) dest = e.getValue();
                else if ("accept".equalsIgnoreCase(e.getKey())) accept = e.getValue();
            }
        }
        if (dest != null) {
            switch (dest.toLowerCase(Locale.ROOT)) {
                case "iframe":
                case "frame": return "subdocument";
                case "script":
                case "worker":
                case "sharedworker":
                case "serviceworker": return "script";
                case "style": return "stylesheet";
                case "image": return "image";
                case "font": return "font";
                case "audio":
                case "video":
                case "track": return "media";
                case "object":
                case "embed": return "object";
                case "empty": return "xmlhttprequest"; // fetch()/XHR
                default: break;
            }
        }
        if (accept != null) {
            String a = accept.toLowerCase(Locale.ROOT);
            if (a.startsWith("text/css")) return "stylesheet";
            if (a.startsWith("image/")) return "image";
            if (a.startsWith("video/") || a.startsWith("audio/")) return "media";
        }
        String path = request.getUrl().getPath();
        if (path != null) {
            String p = path.toLowerCase(Locale.ROOT);
            if (p.endsWith(".js") || p.endsWith(".mjs")) return "script";
            if (p.endsWith(".css")) return "stylesheet";
            if (p.endsWith(".png") || p.endsWith(".jpg") || p.endsWith(".jpeg") || p.endsWith(".gif")
                    || p.endsWith(".webp") || p.endsWith(".svg") || p.endsWith(".ico") || p.endsWith(".avif")) return "image";
            if (p.endsWith(".woff") || p.endsWith(".woff2") || p.endsWith(".ttf") || p.endsWith(".otf")) return "font";
            if (p.endsWith(".mp4") || p.endsWith(".webm") || p.endsWith(".mp3") || p.endsWith(".m3u8") || p.endsWith(".ogg")) return "media";
        }
        return "other";
    }

    // ── Wallet-side pipe ─────────────────────────────────────────────────────

    /** Post a reply JSON (built by dapp-glue.ts) to the requesting tab's page. */
    @PluginMethod
    public void respond(PluginCall call) {
        String requestId = call.getString("requestId", "");
        String json = call.getString("json", "");
        Integer tabId = pendingRequests.remove(requestId);
        getActivity().runOnUiThread(() -> {
            Tab t = tabId == null ? null : tabs.get(tabId);
            if (t != null && t.replyProxy != null && json != null) {
                t.replyProxy.postMessage(json);
            }
            call.resolve();
        });
    }

    /** Push an event JSON to every tab, or only tabs on `origin` when given. */
    @PluginMethod
    public void emitEvent(PluginCall call) {
        String origin = call.getString("origin", null);
        String json = call.getString("json", "");
        getActivity().runOnUiThread(() -> {
            for (Tab t : tabs.values()) {
                if (t.replyProxy == null || json == null) continue;
                if (origin != null && !origin.equals(t.origin)) continue;
                t.replyProxy.postMessage(json);
            }
            call.resolve();
        });
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    private Tab active() {
        return tabs.get(activeTabId);
    }

    private void applyTorProxy(int port, Runnable applied) {
        ProxyConfig torProxy = new ProxyConfig.Builder()
                .addProxyRule("socks://127.0.0.1:" + port)
                .build();
        ProxyController.getInstance().setProxyOverride(
                torProxy,
                ContextCompat.getMainExecutor(getContext()),
                applied);
    }

    private boolean applyTorProxyAndWait(int port) throws InterruptedException {
        CountDownLatch applied = new CountDownLatch(1);
        applyTorProxy(port, applied::countDown);
        return applied.await(8, TimeUnit.SECONDS);
    }

    private synchronized boolean bindEmbeddedTor() {
        if (torService != null || torServiceConnection != null) return true;

        ServiceConnection connection = new ServiceConnection() {
            @Override
            public void onServiceConnected(ComponentName name, IBinder binder) {
                synchronized (DappBrowserPlugin.this) {
                    if (torServiceConnection != this || !torEnabled) return;
                    torService = ((TorService.LocalBinder) binder).getService();
                }
                Log.i("MagicMoneyTor", "Embedded Tor service connected");
            }

            @Override
            public void onServiceDisconnected(ComponentName name) {
                synchronized (DappBrowserPlugin.this) {
                    if (torServiceConnection == this) torService = null;
                }
                Log.w("MagicMoneyTor", "Embedded Tor service disconnected");
            }
        };
        torServiceConnection = connection;
        try {
            boolean bound = getContext().getApplicationContext().bindService(
                    new Intent(getContext(), TorService.class),
                    connection,
                    Context.BIND_AUTO_CREATE);
            if (!bound) torServiceConnection = null;
            return bound;
        } catch (Throwable error) {
            torServiceConnection = null;
            Log.e("MagicMoneyTor", "Could not bind embedded Tor service", error);
            return false;
        }
    }

    private void startEmbeddedTor(int generation, PluginCall call) {
        AtomicBoolean settled = new AtomicBoolean(false);
        if (!bindEmbeddedTor()) {
            finishTorAttempt(generation, call, settled, false,
                    "Embedded Tor could not start. Traffic remains blocked.");
            return;
        }

        torExecutor.execute(() -> {
            try {
                long deadline = System.currentTimeMillis() + 120_000;
                int appliedPort = torPort;
                boolean exitVerified = false;
                while (System.currentTimeMillis() < deadline) {
                    if (generation != torGeneration.get() || !torEnabled) {
                        finishTorAttempt(generation, call, settled, false, "");
                        return;
                    }

                    TorService service = torService;
                    int servicePort = service == null ? -1 : service.getSocksPort();
                    if (servicePort > 0 && servicePort != appliedPort) {
                        if (!applyTorProxyAndWait(servicePort)) {
                            throw new IllegalStateException("WebView did not apply the Tor proxy");
                        }
                        torPort = servicePort;
                        appliedPort = servicePort;
                        exitVerified = false;
                    }

                    if (servicePort > 0 && localPortOpen(servicePort, 700)) {
                        if (!exitVerified) exitVerified = verifyTorExit(servicePort);
                        if (exitVerified && verifyOnionAccess(servicePort)) {
                            finishTorAttempt(generation, call, settled, true,
                                    "Connected; Tor exit and onion service verified");
                            return;
                        }
                    }
                    TimeUnit.SECONDS.sleep(2);
                }
                if (generation == torGeneration.get() && torEnabled) stopEmbeddedTorRuntime();
                finishTorAttempt(generation, call, settled, false,
                        "Tor could not connect within two minutes. Traffic remains blocked.");
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                finishTorAttempt(generation, call, settled, false,
                        "Tor connection was interrupted. Traffic remains blocked.");
            } catch (Throwable error) {
                Log.e("MagicMoneyTor", "Embedded Tor startup failed", error);
                stopEmbeddedTorRuntime();
                finishTorAttempt(generation, call, settled, false,
                        "Embedded Tor could not start. Traffic remains blocked.");
            }
        });
    }

    private boolean localPortOpen(int port, int timeoutMs) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress("127.0.0.1", port), timeoutMs);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private void finishTorAttempt(int generation, PluginCall call, AtomicBoolean settled,
                                  boolean connected, String message) {
        if (generation != torGeneration.get() || !torEnabled) {
            if (settled.compareAndSet(false, true)) call.resolve(torStateJson());
            return;
        }
        if (!settled.compareAndSet(false, true)) return;
        getActivity().runOnUiThread(() -> {
            if (generation != torGeneration.get() || !torEnabled) {
                call.resolve(torStateJson());
                return;
            }
            torStatus = connected ? "connected" : "error";
            torMessage = message;
            if (connected) reloadAllTabs();
            pushTorState();
            call.resolve(torStateJson());
        });
    }

    private synchronized void stopEmbeddedTorRuntime() {
        Context context = getContext().getApplicationContext();
        ServiceConnection connection = torServiceConnection;
        torServiceConnection = null;
        torService = null;
        if (connection != null) {
            try { context.unbindService(connection); } catch (Throwable ignored) { }
        }
        try { context.stopService(new Intent(context, TorService.class)); } catch (Throwable ignored) { }
    }

    private boolean verifyTorExit(int port) {
        HttpsURLConnection connection = null;
        try {
            Proxy proxy = new Proxy(Proxy.Type.SOCKS,
                    InetSocketAddress.createUnresolved("127.0.0.1", port));
            connection = (HttpsURLConnection) new URL("https://check.torproject.org/api/ip")
                    .openConnection(proxy);
            connection.setConnectTimeout(12000);
            connection.setReadTimeout(12000);
            connection.setRequestProperty("Cache-Control", "no-store");
            try (InputStream stream = connection.getInputStream();
                 BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                StringBuilder body = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) body.append(line);
                return new JSONObject(body.toString()).optBoolean("IsTor", false);
            }
        } catch (Exception ignored) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private boolean verifyOnionAccess(int port) {
        // Use an onion service operated by the Tor Project for the readiness
        // check. Third-party onions (including search providers) can be
        // temporarily unavailable even when this client is working correctly.
        String host = "xao2lxsmia2edq2n5zxg6uahx6xox2t7bfjw6b5vdzsxi7ezmqob6qid.onion";
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress("127.0.0.1", port), 2_000);
            socket.setSoTimeout(45_000);
            InputStream input = socket.getInputStream();
            OutputStream output = socket.getOutputStream();

            output.write(new byte[]{0x05, 0x01, 0x00});
            output.flush();
            if (readSocksByte(input) != 0x05 || readSocksByte(input) != 0x00) return false;

            byte[] hostname = host.getBytes(StandardCharsets.US_ASCII);
            ByteArrayOutputStream request = new ByteArrayOutputStream();
            request.write(new byte[]{0x05, 0x01, 0x00, 0x03, (byte) hostname.length});
            request.write(hostname);
            request.write(new byte[]{0x00, 0x50}); // port 80; onions are encrypted by Tor itself
            output.write(request.toByteArray());
            output.flush();

            return readSocksByte(input) == 0x05 && readSocksByte(input) == 0x00;
        } catch (Exception ignored) {
            return false;
        }
    }

    private int readSocksByte(InputStream input) throws IOException {
        int value = input.read();
        if (value < 0) throw new IOException("Unexpected end of SOCKS5 response");
        return value;
    }

    private JSObject torStateJson() {
        JSObject state = new JSObject();
        state.put("enabled", torEnabled);
        state.put("status", torStatus);
        state.put("host", "127.0.0.1");
        state.put("port", torPort);
        state.put("isTor", torEnabled && "connected".equals(torStatus));
        state.put("message", torMessage);
        return state;
    }

    private void pushTorState() {
        Runnable push = () -> {
            syncContainerVisibility();
            notifyListeners("torStateChanged", torStateJson());
        };
        if (Looper.myLooper() == Looper.getMainLooper()) push.run();
        else getActivity().runOnUiThread(push);
    }

    private void syncContainerVisibility() {
        if (container == null) return;
        boolean torAllowsPage = (!torEnabled && !"connecting".equals(torStatus))
                || "connected".equals(torStatus);
        // While a video is fullscreen the page container stays hidden behind the
        // fullscreen view — otherwise the tab would paint over the video.
        boolean showPage = browserShown && activeTabId != -1 && torAllowsPage && customView == null;
        container.setVisibility(showPage ? View.VISIBLE : View.GONE);
    }

    // ── HTML5 fullscreen video ───────────────────────────────────────────────
    //
    // The site hands us a view; we host it edge-to-edge above everything else
    // (including the wallet WebView, which is a sibling in the activity's content
    // frame) and hide the system bars. Back exits fullscreen rather than the page.
    //
    // ⚠ This used to be an OnKeyListener on the focused container watching for
    // KEYCODE_BACK. Under targetSdk 36 predictive back is on by default and the
    // system stops dispatching KEYCODE_BACK entirely, so that listener would
    // never fire and back would tear down the whole browser mid-video instead of
    // just leaving fullscreen. OnBackPressedDispatcher is the supported path and
    // works on every API level we ship to (legacy back routes through
    // ComponentActivity.onBackPressed, predictive back through
    // OnBackInvokedDispatcher).
    //
    // Registration is lazy — on first fullscreen, therefore always AFTER
    // @capacitor/app's own callback, which is added in its load(). The
    // dispatcher walks callbacks in reverse registration order, so ours is
    // offered the event first whenever it is enabled, and the wallet's normal
    // back handling resumes the moment fullscreen exits.

    private FrameLayout fullscreenContainer;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private OnBackPressedCallback fullscreenBackCallback;

    private void ensureFullscreenContainer() {
        if (fullscreenContainer != null) return;
        fullscreenContainer = new FrameLayout(getContext());
        fullscreenContainer.setBackgroundColor(0xFF000000);
        fullscreenContainer.setVisibility(View.GONE);
        // Focus still matters: it keeps the hidden page WebView from taking key
        // input while a video is up.
        fullscreenContainer.setFocusable(true);
        fullscreenContainer.setFocusableInTouchMode(true);
        fullscreenBackCallback = new OnBackPressedCallback(false) {
            @Override
            public void handleOnBackPressed() {
                exitFullscreen();
            }
        };
        getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), fullscreenBackCallback);
        getActivity().addContentView(fullscreenContainer, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void enterFullscreen(View view, WebChromeClient.CustomViewCallback callback) {
        if (customView != null) {
            // Already fullscreen — the contract is to reject the second request.
            callback.onCustomViewHidden();
            return;
        }
        customView = view;
        customViewCallback = callback;
        ensureFullscreenContainer();
        fullscreenContainer.addView(view, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        fullscreenContainer.setVisibility(View.VISIBLE);
        fullscreenContainer.bringToFront();
        fullscreenContainer.requestFocus();
        if (fullscreenBackCallback != null) fullscreenBackCallback.setEnabled(true);
        bridge.getWebView().setVisibility(View.GONE);
        syncContainerVisibility();
        setSystemBarsVisible(false);
    }

    private void exitFullscreen() {
        if (customView == null) return;
        if (fullscreenBackCallback != null) fullscreenBackCallback.setEnabled(false);
        if (fullscreenContainer != null) {
            fullscreenContainer.removeAllViews();
            fullscreenContainer.setVisibility(View.GONE);
        }
        customView = null;
        if (customViewCallback != null) {
            try { customViewCallback.onCustomViewHidden(); } catch (Exception ignored) { }
            customViewCallback = null;
        }
        bridge.getWebView().setVisibility(View.VISIBLE);
        syncContainerVisibility();
        setSystemBarsVisible(true);
    }

    private void setSystemBarsVisible(boolean visible) {
        try {
            Window window = getActivity().getWindow();
            WindowInsetsControllerCompat controller =
                    WindowCompat.getInsetsController(window, window.getDecorView());
            if (visible) {
                controller.show(WindowInsetsCompat.Type.systemBars());
            } else {
                controller.setSystemBarsBehavior(
                        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsetsCompat.Type.systemBars());
            }
        } catch (Exception ignored) { /* never let chrome tweaks break playback */ }
    }

    // ── Long-press context menu (links + images) ─────────────────────────────

    /** Show the action sheet for whatever was long-pressed. False = not ours. */
    private boolean showHitTestMenu(WebView wv) {
        WebView.HitTestResult result = wv.getHitTestResult();
        if (result == null) return false;
        int type = result.getType();
        String extra = result.getExtra();

        if (type == WebView.HitTestResult.SRC_ANCHOR_TYPE) {
            presentLinkMenu(extra, null);
            return true;
        }
        if (type == WebView.HitTestResult.IMAGE_TYPE) {
            presentLinkMenu(null, extra);
            return true;
        }
        if (type == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE) {
            // An image wrapped in a link: the anchor href isn't in the hit test,
            // it has to be requested asynchronously from the DOM node.
            final String imageUrl = extra;
            Message msg = new Handler(Looper.getMainLooper()) {
                @Override
                public void handleMessage(@NonNull Message m) {
                    String linkUrl = m.getData() == null ? null : m.getData().getString("url");
                    presentLinkMenu(linkUrl, imageUrl);
                }
            }.obtainMessage();
            wv.requestFocusNodeHref(msg);
            return true;
        }
        return false;   // plain text — leave selection alone
    }

    private void presentLinkMenu(String linkUrl, String imageUrl) {
        final boolean hasLink = isDownloadableUrl(linkUrl);
        final boolean hasImage = isDownloadableUrl(imageUrl);
        if (!hasLink && !hasImage) return;

        final java.util.List<String> labels = new java.util.ArrayList<>();
        final java.util.List<Runnable> actions = new java.util.ArrayList<>();

        if (hasLink) {
            labels.add("Open in new tab");
            actions.add(() -> openInNewTab(linkUrl));
            labels.add("Copy link address");
            actions.add(() -> copyToClipboard("Link", linkUrl, "Link copied"));
            labels.add("Download link");
            actions.add(() -> startDownload(linkUrl, URLUtil.guessFileName(linkUrl, null, null)));
            labels.add("Share link");
            actions.add(() -> shareText(linkUrl));
        }
        if (hasImage) {
            labels.add("Open image in new tab");
            actions.add(() -> openInNewTab(imageUrl));
            labels.add("Copy image address");
            actions.add(() -> copyToClipboard("Image", imageUrl, "Image address copied"));
            labels.add("Download image");
            actions.add(() -> startDownload(imageUrl, URLUtil.guessFileName(imageUrl, null, null)));
            labels.add("Share image");
            actions.add(() -> shareText(imageUrl));
        }

        String header = hasLink ? linkUrl : imageUrl;
        if (header != null && header.length() > 80) header = header.substring(0, 77) + "…";

        new AlertDialog.Builder(getActivity())
                .setTitle(header)
                .setItems(labels.toArray(new String[0]), (d, which) -> {
                    if (which >= 0 && which < actions.size()) actions.get(which).run();
                })
                .show();
    }

    /** Only real web URLs are actionable — data:/blob:/javascript: are not. */
    private boolean isDownloadableUrl(String url) {
        if (url == null || url.isEmpty()) return false;
        String lower = url.toLowerCase(Locale.US);
        return lower.startsWith("http://") || lower.startsWith("https://");
    }

    private void openInNewTab(String url) {
        getActivity().runOnUiThread(() -> {
            if (tabs.size() >= MAX_TABS) {
                toast("Close a tab first — " + MAX_TABS + " is the limit");
                return;
            }
            ensureContainer();
            browserShown = true;
            Tab t = createTab(url);
            selectTabInternal(t.id);
            pushTabsChanged();
        });
    }

    private void copyToClipboard(String label, String value, String confirmation) {
        try {
            ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null) return;
            cm.setPrimaryClip(ClipData.newPlainText(label, value));
            toast(confirmation);
        } catch (Exception e) {
            toast("Could not copy");
        }
    }

    private void shareText(String value) {
        try {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, value);
            Intent chooser = Intent.createChooser(send, "Share");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
        } catch (Exception e) {
            toast("No app is available to share with");
        }
    }

    /**
     * Save a URL through Android's DownloadManager (notification + Downloads
     * folder, like any other browser).
     *
     * REFUSED WHILE TOR MODE IS ON: DownloadManager is a separate system process
     * that does NOT use this app's WebView proxy, so letting it run would send a
     * direct, de-anonymized request — exactly the leak Tor Mode's fail-closed
     * design exists to prevent.
     */
    private void startDownload(String url, String fileName) {
        if (torEnabled) {
            toast("Downloads are blocked while Tor Mode is on — they would bypass Tor");
            return;
        }
        if (!isDownloadableUrl(url)) {
            toast("This item can't be downloaded");
            return;
        }
        try {
            DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) { toast("Downloads are unavailable on this device"); return; }

            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            String name = (fileName == null || fileName.isEmpty()) ? "download" : fileName;
            req.setTitle(name);
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            // Carry the page's cookies/UA so login-gated media saves correctly.
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) req.addRequestHeader("Cookie", cookie);
            Tab active = active();
            if (active != null && active.url != null) req.addRequestHeader("Referer", active.url);

            dm.enqueue(req);
            toast("Saving " + name + "…");
        } catch (Exception e) {
            toast("Could not start the download");
        }
    }

    private void toast(String message) {
        getActivity().runOnUiThread(() ->
                Toast.makeText(getContext(), message, Toast.LENGTH_SHORT).show());
    }

    private void stopLoadingAllTabs() {
        for (Tab tab : tabs.values()) {
            try { tab.webView.stopLoading(); } catch (Exception ignored) { }
        }
    }

    private void reloadAllTabs() {
        for (Tab tab : tabs.values()) {
            try { tab.webView.reload(); } catch (Exception ignored) { }
        }
    }

    private void ensureContainer() {
        if (container != null) return;
        container = new FrameLayout(getContext());
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(0, 0);
        getActivity().addContentView(container, lp);
    }

    @Override
    protected void handleOnDestroy() {
        torGeneration.incrementAndGet();
        torEnabled = false;
        stopEmbeddedTorRuntime();
        torExecutor.shutdownNow();
        super.handleOnDestroy();
    }

    private void applyBounds(JSObject bounds) {
        if (container == null) return;
        bx = bounds.getInteger("x", bx);
        by = bounds.getInteger("y", by);
        bw = bounds.getInteger("width", bw);
        bh = bounds.getInteger("height", bh);
        float density = getContext().getResources().getDisplayMetrics().density;
        // CSS px (wallet WebView viewport) → window px, offset by the WebView's
        // position so notch/status-bar insets are accounted for.
        int[] loc = new int[2];
        bridge.getWebView().getLocationInWindow(loc);
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) container.getLayoutParams();
        lp.leftMargin = loc[0] + Math.round(bx * density);
        lp.topMargin = loc[1] + Math.round(by * density);
        lp.width = Math.round(bw * density);
        lp.height = Math.round(bh * density);
        container.setLayoutParams(lp);
    }

    private void selectTabInternal(int id) {
        activeTabId = id;
        for (Tab t : tabs.values()) {
            t.webView.setVisibility(t.id == id ? View.VISIBLE : View.GONE);
        }
        syncContainerVisibility();
        Tab t = tabs.get(id);
        if (t != null) {
            pushUrl(t);
            pushNavState(t);
            pushLoading(t);
            notifyListeners("magicGuardStateChanged", guardStateJson());
        }
        pushTabsChanged();
    }

    /**
     * Let sites in the dApp browser use passkeys (WebAuthn).
     *
     * Without this a plain WebView has no window.PublicKeyCredential at all, so
     * passkey prompts silently never appear — measured on a real device against
     * chainlensnft.info, where the whole passkey UI simply refused to show.
     *
     * FOR_BROWSER, deliberately NOT the FOR_APP used in MainActivity. The two
     * mean opposite things about who the relying party is:
     *   FOR_APP     — THIS APP is the RP. Right for the wallet's own WebView,
     *                 where the page we serve IS us.
     *   FOR_BROWSER — the VISITED SITE is the RP, exactly like Chrome. Right
     *                 here, where we render other people's origins.
     * Using FOR_APP here would bind every credential to MagicMoney instead of to
     * the site the user thinks they're registering with — credentials that would
     * not work in any other browser and could not be undone afterwards.
     *
     * Guarded and swallowed: on a device whose WebView predates the API the
     * browser keeps working without passkeys, which sites can feature-detect.
     */
    private void enableBrowserWebAuthn(WebSettings s) {
        boolean supported = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION);
        Log.i("MagicMoneyWebAuthn", "WEB_AUTHENTICATION feature supported=" + supported);
        if (!supported) return;
        try {
            WebSettingsCompat.setWebAuthenticationSupport(
                    s, WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_BROWSER);
            Log.i("MagicMoneyWebAuthn", "FOR_BROWSER applied");
        } catch (Throwable e) {
            Log.e("MagicMoneyWebAuthn", "FOR_BROWSER failed", e);
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private Tab createTab(String url) {
        Tab tab = new Tab();
        tab.id = nextTabId++;
        tab.url = url;

        WebView wv = new WebView(getContext());
        tab.webView = wv;
        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setSupportMultipleWindows(false);
        // dApp pages get a normal mobile browsing identity; no file/content access.
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        enableBrowserWebAuthn(s);

        // Origin-authenticated message bridge (main frame only — mirrors the
        // extension's content-script scope).
        WebViewCompat.addWebMessageListener(wv, "__mmBridge", Collections.singleton("*"),
                (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                    if (!isMainFrame) return;
                    String data = message.getData();
                    if (data == null) return;
                    try {
                        JSONObject o = new JSONObject(data);
                        String type = o.optString("type");
                        if ("hello".equals(type)) {
                            tab.replyProxy = replyProxy;
                            tab.origin = sourceOrigin.toString();
                            return;
                        }
                        // A visible password field appeared in this page. The
                        // message carries NO data — the wallet re-derives the
                        // host from the tab it is actually showing, so a page
                        // cannot ask to be filled with another site's login.
                        // Only the ACTIVE tab is announced: a background tab
                        // must never trigger a fill the user isn't looking at.
                        if ("autofillFormFound".equals(type)) {
                            tab.replyProxy = replyProxy;
                            tab.origin = sourceOrigin.toString();
                            if (tab.id == activeTabId) {
                                JSObject af = new JSObject();
                                af.put("tabId", tab.id);
                                af.put("origin", sourceOrigin.toString());
                                notifyListeners("autofillFormFound", af);
                            }
                            return;
                        }
                    } catch (Exception ignored) {
                        return;
                    }
                    tab.replyProxy = replyProxy;
                    tab.origin = sourceOrigin.toString();
                    String requestId = UUID.randomUUID().toString();
                    pendingRequests.put(requestId, tab.id);
                    JSObject ev = new JSObject();
                    ev.put("requestId", requestId);
                    ev.put("origin", sourceOrigin.toString());
                    ev.put("tabId", tab.id);
                    ev.put("payloadJson", data);
                    notifyListeners("pageRequest", ev);
                });

        // document_start provider injection (feature-checked; see class doc).
        if (docStartSupported && injectJs != null) {
            WebViewCompat.addDocumentStartJavaScript(wv, injectJs, Collections.singleton("*"));
        }

        wv.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String u, android.graphics.Bitmap favicon) {
                tab.url = u;
                tab.loading = true;
                tab.replyProxy = null;  // stale after navigation until the new page says hello
                // Magic Guard: onPageStarted only fires for top-level navigations —
                // blockedThisPage resets here, before subresources begin loading;
                // blockedThisTab persists until the tab closes.
                tab.blockedPage.set(0);
                if (!docStartSupported && injectJs != null) view.evaluateJavascript(injectJs, null);
                if (tab.id == activeTabId) {
                    pushUrl(tab); pushLoading(tab); pushNavState(tab);
                    notifyListeners("magicGuardStateChanged", guardStateJson());
                }
                pushTabsChanged();
            }

            // ── Magic Guard subresource filtering ────────────────────────────
            // Runs OFF the UI thread, possibly concurrently across WebViews.
            // Policy per plan section 11: non-http(s) → bypass; main frame →
            // bypass (top-level phishing/navigation guard is separate); guard
            // disabled / engine not ready / site excepted → bypass; otherwise a
            // synchronous JNI check. Blocked → empty 204; allowed → null (let
            // the WebView continue normally — through the Tor proxy when it is
            // on; a guard failure never touches Tor's fail-closed state). No
            // disk I/O, list parsing, network, or Capacitor callbacks in here.
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if (!"http".equals(scheme) && !"https".equals(scheme)) return null;
                if (request.isForMainFrame()) return null;
                if (!guardEnabled || !MagicGuardNative.isReady()) return null;
                String topUrl = tab.url;
                String topHost = hostOf(topUrl);
                if (topHost != null && guardExceptions.contains(topHost)) return null;
                boolean blocked = MagicGuardNative.check(
                        uri.toString(),
                        topUrl == null ? "" : topUrl,
                        classifyResource(request));
                if (!blocked) return null;
                tab.blockedPage.incrementAndGet();
                tab.blockedTab.incrementAndGet();
                scheduleGuardPush();
                return blockedResponse();
            }

            @Override
            public void onPageFinished(WebView view, String u) {
                tab.url = u;
                tab.loading = false;
                if (tab.id == activeTabId) { pushUrl(tab); pushLoading(tab); pushNavState(tab); }
                pushTabsChanged();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) return false;
                // intent:, market:, wc:, mailto:, … → hand to the OS
                try {
                    getActivity().startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) { }
                return true;
            }
        });

        wv.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onReceivedTitle(WebView view, String title) {
                tab.title = title == null ? "" : title;
                if (tab.id == activeTabId) {
                    JSObject ev = new JSObject();
                    ev.put("title", tab.title);
                    notifyListeners("titleChanged", ev);
                }
                pushTabsChanged();
            }

            // HTML5 fullscreen (YouTube/Twitter/etc). Without these two overrides
            // the WebView reports no fullscreen support and the site's fullscreen
            // button does nothing at all.
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                enterFullscreen(view, callback);
            }

            @Override
            public void onHideCustomView() {
                exitFullscreen();
            }
        });

        // Long-press on a link or image → the same action sheet other Android
        // browsers offer. Returning false for anything else leaves normal text
        // selection untouched.
        wv.setOnLongClickListener(v -> showHitTestMenu(wv));

        // Ordinary download links (a file the page navigates to rather than
        // renders). Same DownloadManager path the context menu uses, including
        // the Tor guard — see startDownload.
        wv.setDownloadListener((downloadUrl, userAgent, contentDisposition, mimeType, contentLength) ->
                startDownload(downloadUrl, URLUtil.guessFileName(downloadUrl, contentDisposition, mimeType)));

        container.addView(wv, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        tabs.put(tab.id, tab);
        wv.loadUrl(url);
        return tab;
    }

    private JSArray tabsArray() {
        JSArray arr = new JSArray();
        for (Tab t : tabs.values()) {
            JSObject o = new JSObject();
            o.put("id", t.id);
            o.put("title", t.title);
            o.put("url", t.url);
            o.put("loading", t.loading);
            arr.put(o);
        }
        return arr;
    }

    private void pushUrl(Tab t) {
        JSObject ev = new JSObject();
        ev.put("url", t.url);
        notifyListeners("urlChanged", ev);
    }

    private void pushLoading(Tab t) {
        JSObject ev = new JSObject();
        ev.put("loading", t.loading);
        notifyListeners("loadingChanged", ev);
    }

    private void pushNavState(Tab t) {
        JSObject ev = new JSObject();
        ev.put("canBack", t.webView.canGoBack());
        ev.put("canForward", t.webView.canGoForward());
        notifyListeners("navState", ev);
    }

    private void pushTabsChanged() {
        JSObject ev = new JSObject();
        ev.put("activeTabId", activeTabId);
        ev.put("tabs", tabsArray());
        notifyListeners("tabsChanged", ev);
    }
}
