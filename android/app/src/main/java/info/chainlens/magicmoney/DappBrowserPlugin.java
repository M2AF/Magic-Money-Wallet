package info.chainlens.magicmoney;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.net.Uri;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.ProxyConfig;
import androidx.webkit.ProxyController;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;
import org.torproject.arti.ArtiProxy;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
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
        String url = "";
        String title = "";
        boolean loading = false;
    }

    private FrameLayout container;
    private final Map<Integer, Tab> tabs = new LinkedHashMap<>();
    private final Map<String, Integer> pendingRequests = new ConcurrentHashMap<>();
    private int nextTabId = 1;
    private int activeTabId = -1;
    private String injectJs = null;
    private boolean docStartSupported = false;
    // ArtiProxy.start() spawns its native runtime and returns immediately;
    // bootstrap/verification continue on separate executor workers.
    private final ExecutorService torExecutor = Executors.newCachedThreadPool();
    private volatile boolean torEnabled = false;
    private volatile String torStatus = "off";
    private volatile String torMessage = "Tor Mode is off";
    private volatile int torPort = 19050;
    private volatile ArtiProxy artiProxy;
    private volatile CountDownLatch artiBootstrapLatch;
    private final AtomicInteger torGeneration = new AtomicInteger();
    private boolean browserShown = false;
    // Last bounds in CSS px, reapplied on setBounds
    private int bx = 0, by = 0, bw = 0, bh = 0;

    private static final int MAX_TABS = 5;
    @Override
    public void load() {
        injectJs = readAsset("public/dapp-inject.js");
        docStartSupported = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);
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
            CountDownLatch pendingBootstrap = artiBootstrapLatch;
            if (pendingBootstrap != null) pendingBootstrap.countDown();
            torEnabled = false;
            torStatus = "connecting";
            torMessage = "Disconnecting from Tor…";
            pushTorState();
            ProxyController.getInstance().clearProxyOverride(
                    ContextCompat.getMainExecutor(getContext()),
                    () -> {
                        stopArtiRuntime();
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
        ProxyConfig torProxy = new ProxyConfig.Builder()
                .addProxyRule("socks://127.0.0.1:" + torPort)
                .build();
        ProxyController.getInstance().setProxyOverride(
                torProxy,
                ContextCompat.getMainExecutor(getContext()),
                () -> {
                    stopLoadingAllTabs();
                    startEmbeddedTor(generation, call);
                });
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

    private synchronized ArtiProxy ensureArtiProxy() {
        if (artiProxy == null) {
            artiProxy = ArtiProxy.Builder(getContext())
                    // App-specific ports avoid collisions with Orbot's standard
                    // 9050/9150 listeners while remaining loopback-only.
                    .setSocksPort(19050)
                    .setDnsPort(19051)
                    .setLogListener(this::handleArtiLog)
                    .build();
        }
        return artiProxy;
    }

    private void startEmbeddedTor(int generation, PluginCall call) {
        CountDownLatch bootstrap = new CountDownLatch(1);
        artiBootstrapLatch = bootstrap;
        AtomicBoolean settled = new AtomicBoolean(false);
        ArtiProxy proxy = ensureArtiProxy();

        torExecutor.execute(() -> {
            try {
                if (generation != torGeneration.get() || !torEnabled) return;
                // A live listener can survive an Activity/plugin recreation. In
                // that case, reuse it instead of asking Arti to start twice.
                if (!localPortOpen(torPort, 500)) proxy.start();
            } catch (Throwable ignored) {
                finishTorAttempt(generation, call, settled, false,
                        "Embedded Tor could not start. Traffic remains blocked.");
            }
        });

        torExecutor.execute(() -> {
            try {
                long deadline = System.currentTimeMillis() + 120_000;
                while (System.currentTimeMillis() < deadline) {
                    if (generation != torGeneration.get() || !torEnabled) {
                        finishTorAttempt(generation, call, settled, false, "");
                        return;
                    }
                    if (localPortOpen(torPort, 700) && verifyTorExit(torPort)) {
                        finishTorAttempt(generation, call, settled, true,
                                "Connected and verified through embedded Tor");
                        return;
                    }
                    bootstrap.await(2, TimeUnit.SECONDS);
                }
                if (generation == torGeneration.get() && torEnabled) stopArtiRuntime();
                finishTorAttempt(generation, call, settled, false,
                        "Tor could not connect within two minutes. Traffic remains blocked.");
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
                finishTorAttempt(generation, call, settled, false,
                        "Tor connection was interrupted. Traffic remains blocked.");
            }
        });
    }

    private void handleArtiLog(String line) {
        if (line == null) return;
        Log.i("MagicMoneyTor", line.trim());
        if (line.contains("Sufficiently bootstrapped")) {
            CountDownLatch latch = artiBootstrapLatch;
            if (latch != null) latch.countDown();
        }
        // Arti ignores stop() while it is still Starting. If the user switched
        // Tor off during bootstrap, stop it as soon as it reaches Running.
        if (!torEnabled && line.contains("state changed to Running")) stopArtiRuntime();
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

    private void stopArtiRuntime() {
        ArtiProxy proxy = artiProxy;
        if (proxy == null) return;
        try { proxy.stop(); } catch (Throwable ignored) { }
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
        boolean showPage = browserShown && activeTabId != -1 && torAllowsPage;
        container.setVisibility(showPage ? View.VISIBLE : View.GONE);
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
        stopArtiRuntime();
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
        }
        pushTabsChanged();
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

        // Origin-authenticated message bridge (main frame only — mirrors the
        // extension's content-script scope).
        WebViewCompat.addWebMessageListener(wv, "__mmBridge", Collections.singleton("*"),
                (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                    if (!isMainFrame) return;
                    String data = message.getData();
                    if (data == null) return;
                    try {
                        JSONObject o = new JSONObject(data);
                        if ("hello".equals(o.optString("type"))) {
                            tab.replyProxy = replyProxy;
                            tab.origin = sourceOrigin.toString();
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
                if (!docStartSupported && injectJs != null) view.evaluateJavascript(injectJs, null);
                if (tab.id == activeTabId) { pushUrl(tab); pushLoading(tab); pushNavState(tab); }
                pushTabsChanged();
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
        });

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
