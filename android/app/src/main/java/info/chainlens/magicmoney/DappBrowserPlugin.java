package info.chainlens.magicmoney;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

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
                    container.setVisibility(View.GONE);
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
            if (container != null) container.setVisibility(View.GONE);
            call.resolve();
        });
    }

    @PluginMethod
    public void show(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (container != null && activeTabId != -1) container.setVisibility(View.VISIBLE);
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

    private void ensureContainer() {
        if (container != null) return;
        container = new FrameLayout(getContext());
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(0, 0);
        getActivity().addContentView(container, lp);
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
        container.setVisibility(View.VISIBLE);
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
