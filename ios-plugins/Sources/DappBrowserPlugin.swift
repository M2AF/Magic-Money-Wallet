import Foundation
import UIKit
import WebKit
import Capacitor

/**
 * DappBrowser — iOS counterpart of DappBrowserPlugin.java.
 *
 * A multi-tab dApp browser built from real WKWebViews layered ABOVE the wallet's
 * own Capacitor WebView. The wallet UI (BrowserOverlay.tsx) draws the chrome and
 * positions this container via setBounds; because native web views sit on top of
 * the wallet's, every menu in that overlay is an inline panel rather than a
 * dropdown — the same constraint the Android build works under, so the React
 * side ports unchanged.
 *
 * ── The bridge, and why it is hand-built here ────────────────────────────────
 * Android gets `window.__mmBridge` for free from
 * WebViewCompat.addWebMessageListener, which also hands over a chromium-
 * authenticated `sourceOrigin`. WKWebView has no equivalent, so this plugin
 * synthesises the same shape:
 *
 *   1. `bridgeBootstrapJS` (WKUserScript, .atDocumentStart) defines
 *      window.__mmBridge with postMessage/addEventListener/__recv on top of
 *      webkit.messageHandlers.
 *   2. dapp-inject.js is injected immediately after, also at document start,
 *      and finds the bridge already present.
 *   3. Replies and pushed events come back via evaluateJavaScript calling
 *      window.__mmBridge.__recv(...).
 *
 * Both scripts run in `.page` world ON PURPOSE: dapp-inject calls
 * installProviders(), which must define window.ethereum / window.solana on the
 * page's own window object. An isolated content world would hide them from the
 * dApp.
 *
 * ── Origin authentication (security-critical) ────────────────────────────────
 * The Java version trusts chromium's sourceOrigin. Here the equivalent is
 * WKScriptMessage.frameInfo.securityOrigin, and BOTH that and
 * frameInfo.isMainFrame are checked before a request is forwarded. The origin is
 * NEVER read from the message payload — a page can put anything there, and
 * trusting it would let any iframe impersonate a dApp to the wallet and get
 * approvals attributed to the wrong site.
 */
@objc(DappBrowserPlugin)
public class DappBrowserPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DappBrowserPlugin"
    public let jsName = "DappBrowser"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "newTab", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "selectTab", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closeTab", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "navigate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "goBack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "goForward", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "canGoBack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBounds", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hide", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getTorState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTorMode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getMagicGuardState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMagicGuardEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMagicGuardForSite", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fillCredentials", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hasLoginForm", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sharePage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "installShortcut", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "respond", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "emitEvent", returnType: CAPPluginReturnPromise),
        // Downloads-tray retry. The rest of the tray is on the Downloader
        // plugin; this one needs a browser tab to re-request through.
        CAPPluginMethod(name: "retryDownload", returnType: CAPPluginReturnPromise),
    ]

    /// Matches Android's MAX_TABS. WKWebViews are memory-hungry and iOS jetsams
    /// aggressively; more tabs would trade a background tab for the whole app.
    private static let maxTabs = 5
    private static let messageHandlerName = "mmBridge"

    private var container: UIView?
    private var tabs: [BrowserTab] = []
    private var activeTabId: Int = -1
    private var nextTabId: Int = 1
    private var pendingRequests: [String: Int] = [:]   // requestId → tabId
    private var injectionScript: String?
    let magicGuard = MagicGuard()

    // MARK: - Lifecycle

    private func ensureContainer() -> UIView {
        if let container = container { return container }
        let view = UIView()
        view.backgroundColor = UIColor(red: 0.043, green: 0.043, blue: 0.059, alpha: 1.0)
        view.clipsToBounds = true
        bridge?.viewController?.view.addSubview(view)
        container = view
        return view
    }

    /// dapp-inject.js is bundled into the web assets by build:ios (esbuild), so
    /// it lives next to index.html inside App.app/public.
    private func loadInjectionScript() -> String? {
        if let cached = injectionScript { return cached }
        guard let url = Bundle.main.url(forResource: "dapp-inject", withExtension: "js", subdirectory: "public")
                ?? Bundle.main.url(forResource: "dapp-inject", withExtension: "js"),
              let source = try? String(contentsOf: url, encoding: .utf8) else {
            CAPLog.print("[DappBrowser] dapp-inject.js NOT FOUND — dApp provider will be missing")
            return nil
        }
        injectionScript = source
        return source
    }

    /// Synthesises the `__mmBridge` object dapp-inject.ts expects. Kept in sync
    /// with the MmBridge interface in src/capacitor/dapp-inject.ts.
    private var bridgeBootstrapJS: String {
        """
        (function () {
          if (window.__mmBridge) return;
          var listeners = [];
          window.__mmBridge = {
            postMessage: function (data) {
              try {
                window.webkit.messageHandlers.\(Self.messageHandlerName).postMessage(String(data));
              } catch (e) {}
            },
            addEventListener: function (type, cb) {
              if (type === 'message' && typeof cb === 'function') listeners.push(cb);
            },
            __recv: function (data) {
              for (var i = 0; i < listeners.length; i++) {
                try { listeners[i]({ data: String(data) }); } catch (e) {}
              }
            }
          };
        })();
        """
    }

    private func makeWebView(frame: CGRect) -> WKWebView {
        let controller = WKUserContentController()
        controller.add(self, contentWorld: .page, name: Self.messageHandlerName)
        controller.addUserScript(WKUserScript(source: bridgeBootstrapJS,
                                              injectionTime: .atDocumentStart,
                                              forMainFrameOnly: false,
                                              in: .page))
        if let inject = loadInjectionScript() {
            controller.addUserScript(WKUserScript(source: inject,
                                                  injectionTime: .atDocumentStart,
                                                  forMainFrameOnly: false,
                                                  in: .page))
        }

        let config = WKWebViewConfiguration()
        config.userContentController = controller
        config.allowsInlineMediaPlayback = true
        // Mirrors the Android settings: no app-initiated extra windows.
        config.preferences.javaScriptCanOpenWindowsAutomatically = false

        let webView = WKWebView(frame: frame, configuration: config)
        webView.allowsBackForwardNavigationGestures = true   // iOS edge-swipe back

        // Since iOS 16.4 a WKWebView is only reachable by the remote debugger
        // (and therefore by Appium's webview contexts) when isInspectable is
        // set. Inherit the wallet WebView's own setting rather than a compile
        // flag, so dApp pages are inspectable exactly when the app is — i.e.
        // in the e2e run, and never in a shipped build.
        if #available(iOS 16.4, *) {
            webView.isInspectable = bridge?.config.isWebDebuggable ?? false
        }
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        return webView
    }

    // MARK: - Tabs

    private func tab(withId id: Int) -> BrowserTab? { tabs.first { $0.id == id } }
    private var activeTab: BrowserTab? { tab(withId: activeTabId) }

    private func createTab(url: String, bounds: CGRect?) -> BrowserTab? {
        guard tabs.count < Self.maxTabs else { return nil }
        let container = ensureContainer()
        if let bounds = bounds { container.frame = bounds }

        let webView = makeWebView(frame: container.bounds)
        let tab = BrowserTab(id: nextTabId, webView: webView)
        nextTabId += 1
        tabs.append(tab)
        container.addSubview(webView)

        tab.observe { [weak self] in self?.emitStateForActiveTab() }

        let target = Self.normalizedURL(url)

        // Content rule lists must be attached BEFORE the first load or the
        // opening page goes unfiltered. If the lists are still compiling
        // (first launch after an update), load once they are ready.
        magicGuard.load { [weak self] in
            guard let self = self else { return }
            self.magicGuard.apply(to: webView, host: target?.host)
            if let target = target { webView.load(URLRequest(url: target)) }
        }

        selectTabInternal(tab.id)
        return tab
    }

    private func selectTabInternal(_ id: Int) {
        activeTabId = id
        for t in tabs { t.webView.isHidden = (t.id != id) }
        if let active = activeTab { container?.bringSubviewToFront(active.webView) }
        emitTabs()
        emitStateForActiveTab()
    }

    private func closeTabInternal(_ id: Int) {
        guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
        let tab = tabs.remove(at: index)
        tab.teardown()
        tab.webView.removeFromSuperview()

        if activeTabId == id {
            if let next = tabs.last {
                selectTabInternal(next.id)
            } else {
                activeTabId = -1
                closeInternal()
                return
            }
        }
        emitTabs()
    }

    private func closeInternal() {
        for tab in tabs {
            tab.teardown()
            tab.webView.removeFromSuperview()
        }
        tabs.removeAll()
        activeTabId = -1
        pendingRequests.removeAll()
        container?.removeFromSuperview()
        container = nil
        notifyListeners("closed", data: [:])
    }

    /// Bare hostnames typed into the URL bar become https:// like on Android.
    private static func normalizedURL(_ raw: String) -> URL? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") || trimmed.hasPrefix("about:") {
            return URL(string: trimmed)
        }
        return URL(string: "https://" + trimmed)
    }

    // MARK: - Events

    private func tabsPayload() -> [[String: Any]] {
        tabs.map { [
            "id": $0.id,
            "title": $0.webView.title ?? "",
            "url": $0.webView.url?.absoluteString ?? "",
            "loading": $0.webView.isLoading,
        ] }
    }

    private func emitTabs() {
        notifyListeners("tabsChanged", data: ["activeTabId": activeTabId, "tabs": tabsPayload()])
    }

    private func emitStateForActiveTab() {
        guard let tab = activeTab else { return }
        let wv = tab.webView
        notifyListeners("urlChanged", data: ["url": wv.url?.absoluteString ?? ""])
        notifyListeners("titleChanged", data: ["title": wv.title ?? ""])
        notifyListeners("loadingChanged", data: ["loading": wv.isLoading])
        notifyListeners("navState", data: ["canBack": wv.canGoBack, "canForward": wv.canGoForward])
    }

    private func statePayload() -> [String: Any] {
        let wv = activeTab?.webView
        return [
            "url": wv?.url?.absoluteString ?? "",
            "canBack": wv?.canGoBack ?? false,
            "canForward": wv?.canGoForward ?? false,
            "loading": wv?.isLoading ?? false,
            "activeTabId": activeTabId,
            "tabs": tabsPayload(),
        ]
    }

    // MARK: - Plugin methods

    @objc func open(_ call: CAPPluginCall) {
        let url = call.getString("url") ?? ""
        let bounds = Self.rect(from: call.getObject("bounds"))
        DispatchQueue.main.async {
            if let existing = self.activeTab {
                if let b = bounds { self.container?.frame = b }
                self.container?.isHidden = false
                call.resolve(["tabId": existing.id])
                return
            }
            guard let tab = self.createTab(url: url, bounds: bounds) else {
                call.reject("Could not open the browser")
                return
            }
            call.resolve(["tabId": tab.id])
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.closeInternal(); call.resolve() }
    }

    @objc func newTab(_ call: CAPPluginCall) {
        let url = call.getString("url") ?? ""
        DispatchQueue.main.async {
            guard let tab = self.createTab(url: url, bounds: nil) else {
                call.reject("Maximum of \(Self.maxTabs) tabs reached")
                return
            }
            call.resolve(["tabId": tab.id])
        }
    }

    @objc func selectTab(_ call: CAPPluginCall) {
        guard let id = call.getInt("tabId") else { call.reject("tabId is required"); return }
        DispatchQueue.main.async { self.selectTabInternal(id); call.resolve() }
    }

    @objc func closeTab(_ call: CAPPluginCall) {
        guard let id = call.getInt("tabId") else { call.reject("tabId is required"); return }
        DispatchQueue.main.async { self.closeTabInternal(id); call.resolve() }
    }

    @objc func navigate(_ call: CAPPluginCall) {
        let url = call.getString("url") ?? ""
        DispatchQueue.main.async {
            guard let target = Self.normalizedURL(url) else { call.reject("That address is not valid"); return }
            self.activeTab?.webView.load(URLRequest(url: target))
            call.resolve()
        }
    }

    @objc func goBack(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.activeTab?.webView.goBack(); call.resolve() }
    }

    @objc func goForward(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.activeTab?.webView.goForward(); call.resolve() }
    }

    @objc func reload(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.activeTab?.webView.reload(); call.resolve() }
    }

    @objc func canGoBack(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(["canBack": self.activeTab?.webView.canGoBack ?? false]) }
    }

    /**
     * CSS pixels map 1:1 to UIKit points here — unlike Android, which has to
     * scale by display density. The wallet WebView is not zoomed, so its CSS
     * pixel grid and the containing view's point grid are the same.
     */
    @objc func setBounds(_ call: CAPPluginCall) {
        let rect = Self.rect(from: call.jsObjectRepresentation)
        DispatchQueue.main.async {
            if let rect = rect { self.ensureContainer().frame = rect }
            call.resolve()
        }
    }

    @objc func hide(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.container?.isHidden = true; call.resolve() }
    }

    @objc func show(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.container?.isHidden = false
            if let active = self.activeTab { self.container?.bringSubviewToFront(active.webView) }
            call.resolve()
        }
    }

    @objc func getState(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(self.statePayload()) }
    }

    // MARK: - Bridge replies

    @objc func respond(_ call: CAPPluginCall) {
        guard let requestId = call.getString("requestId"),
              let json = call.getString("json") else {
            call.reject("respond requires requestId and json")
            return
        }
        DispatchQueue.main.async {
            let tabId = self.pendingRequests.removeValue(forKey: requestId)
            let target = tabId.flatMap { self.tab(withId: $0) } ?? self.activeTab
            target?.deliver(json)
            call.resolve()
        }
    }

    /**
     * Push a wallet event (chainChanged / accountsChanged) into pages.
     *
     * When `origin` is supplied the event goes ONLY to tabs currently on that
     * origin — an account change must not leak to an unrelated dApp that never
     * connected.
     */
    @objc func emitEvent(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else { call.reject("emitEvent requires json"); return }
        let origin = call.getString("origin")
        DispatchQueue.main.async {
            for tab in self.tabs {
                if let origin = origin, !origin.isEmpty {
                    guard let url = tab.webView.url, Self.origin(of: url) == origin else { continue }
                }
                tab.deliver(json)
            }
            call.resolve()
        }
    }

    // MARK: - Password autofill

    @objc func fillCredentials(_ call: CAPPluginCall) {
        guard let script = call.getString("script") else { call.reject("script is required"); return }
        DispatchQueue.main.async {
            // Active tab only, by design — there is no tabId parameter, so a
            // fill can never be aimed at a background tab.
            guard let webView = self.activeTab?.webView else {
                call.resolve(["ok": false, "result": "no active tab"])
                return
            }
            webView.evaluateJavaScript(script) { result, error in
                if let error = error {
                    call.resolve(["ok": false, "result": error.localizedDescription])
                } else {
                    call.resolve(["ok": true, "result": String(describing: result ?? "")])
                }
            }
        }
    }

    @objc func hasLoginForm(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let webView = self.activeTab?.webView else {
                call.resolve(["hasForm": false, "url": ""])
                return
            }
            let url = webView.url?.absoluteString ?? ""
            let js = """
            (function () {
              var els = document.querySelectorAll('input[type="password"]');
              for (var i = 0; i < els.length; i++) {
                var r = els[i].getBoundingClientRect();
                if (r.width > 0 && r.height > 0) return true;
              }
              return false;
            })();
            """
            webView.evaluateJavaScript(js) { result, _ in
                call.resolve(["hasForm": (result as? Bool) ?? false, "url": url])
            }
        }
    }

    // MARK: - Share

    @objc func sharePage(_ call: CAPPluginCall) {
        guard let url = call.getString("url"), let target = URL(string: url) else {
            call.reject("A page URL is required")
            return
        }
        let title = call.getString("title")
        DispatchQueue.main.async {
            var items: [Any] = [target]
            if let title = title, !title.isEmpty { items.insert(title, at: 0) }
            let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
            // iPad requires an anchor or this crashes.
            if let pop = sheet.popoverPresentationController, let host = self.bridge?.viewController?.view {
                pop.sourceView = host
                pop.sourceRect = CGRect(x: host.bounds.midX, y: host.bounds.maxY - 40, width: 1, height: 1)
            }
            self.bridge?.viewController?.present(sheet, animated: true)
            call.resolve()
        }
    }

    /// No iOS equivalent: pinning a site to the home screen is a Safari-only
    /// privilege with no third-party API. Reported honestly so the wallet UI can
    /// hide the action rather than appear to succeed.
    @objc func installShortcut(_ call: CAPPluginCall) {
        call.reject("Adding a site to the Home Screen isn't available on iOS")
    }

    // MARK: - Tor (deliberately not implemented on iOS)

    /**
     * Tor is NOT part of the iOS build — a product decision, not a TODO.
     *
     * Reporting `status: 'unsupported'` makes BrowserOverlay hide the toggle
     * entirely. The one thing this must never do is report anything that reads
     * as working: a Tor switch that appears on but isn't proxying tells the
     * user their traffic is anonymised when it is in clear — strictly worse
     * than having no feature.
     */
    private func torStatePayload() -> [String: Any] {
        [
            "enabled": false,
            "status": "unsupported",
            "host": "",
            "port": 0,
            "isTor": false,
            "message": "Tor Mode isn't available on iOS",
        ]
    }

    @objc func getTorState(_ call: CAPPluginCall) { call.resolve(torStatePayload()) }
    @objc func setTorMode(_ call: CAPPluginCall) { call.resolve(torStatePayload()) }

    // MARK: - Magic Guard

    private func magicGuardHost() -> String? { activeTab?.webView.url?.host }

    /// Re-attach rule lists to every tab and reload — content rule lists only
    /// take effect on the next navigation, so a toggle without the reload looks
    /// like it silently did nothing.
    private func reapplyMagicGuard() {
        for tab in tabs {
            magicGuard.apply(to: tab.webView, host: tab.webView.url?.host)
            tab.webView.reload()
        }
        notifyListeners("magicGuardStateChanged", data: magicGuard.statePayload(host: magicGuardHost()))
    }

    @objc func getMagicGuardState(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.magicGuard.load {
                call.resolve(self.magicGuard.statePayload(host: self.magicGuardHost()))
            }
        }
    }

    @objc func setMagicGuardEnabled(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? true
        DispatchQueue.main.async {
            self.magicGuard.enabled = enabled
            self.magicGuard.load {
                self.reapplyMagicGuard()
                call.resolve(self.magicGuard.statePayload(host: self.magicGuardHost()))
            }
        }
    }

    /// The hostname is derived from the ACTIVE TAB here, never passed in from
    /// JS — same invariant as the desktop IPC contract, so a compromised page
    /// cannot switch protection off for an unrelated site.
    @objc func setMagicGuardForSite(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? true
        DispatchQueue.main.async {
            let host = self.magicGuardHost()
            self.magicGuard.setEnabled(forHost: host, enabled: enabled)
            self.magicGuard.refreshExceptions {
                self.reapplyMagicGuard()
                call.resolve(self.magicGuard.statePayload(host: host))
            }
        }
    }

    // MARK: - Helpers

    private static func rect(from object: [String: Any]?) -> CGRect? {
        guard let o = object,
              let x = (o["x"] as? NSNumber)?.doubleValue,
              let y = (o["y"] as? NSNumber)?.doubleValue,
              let w = (o["width"] as? NSNumber)?.doubleValue,
              let h = (o["height"] as? NSNumber)?.doubleValue else { return nil }
        return CGRect(x: x, y: y, width: w, height: h)
    }

    /// scheme://host[:port] — the same shape chromium's sourceOrigin produces,
    /// so approvals recorded on Android and iOS key identically.
    static func origin(of url: URL) -> String {
        guard let scheme = url.scheme, let host = url.host else { return "" }
        if let port = url.port,
           !((scheme == "https" && port == 443) || (scheme == "http" && port == 80)) {
            return "\(scheme)://\(host):\(port)"
        }
        return "\(scheme)://\(host)"
    }
}

// MARK: - Script messages (origin-authenticated)

extension DappBrowserPlugin: WKScriptMessageHandler {
    public func userContentController(_ userContentController: WKUserContentController,
                                      didReceive message: WKScriptMessage) {
        guard let body = message.body as? String else { return }
        guard let tab = tabs.first(where: { $0.webView === message.webView }) else { return }

        // SECURITY: the origin comes from WebKit's frameInfo, never from the
        // payload, and subframes are refused outright. Without the isMainFrame
        // check any embedded iframe could speak for the top-level dApp.
        let frame = message.frameInfo
        guard frame.isMainFrame else { return }
        let securityOrigin = frame.securityOrigin
        var origin = "\(securityOrigin.protocol)://\(securityOrigin.host)"
        if securityOrigin.port != 0,
           !((securityOrigin.protocol == "https" && securityOrigin.port == 443) ||
             (securityOrigin.protocol == "http" && securityOrigin.port == 80)) {
            origin += ":\(securityOrigin.port)"
        }
        guard origin.hasPrefix("http://") || origin.hasPrefix("https://") else { return }

        guard let data = body.data(using: .utf8),
              let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }

        switch parsed["type"] as? String {
        case "hello":
            // Android captures a JavaScriptReplyProxy here; on iOS the webview
            // reference is enough, so this only marks the frame as ready.
            tab.bridgeReady = true

        case "autofillFormFound":
            // Payload-free by design, and only honoured for the ACTIVE tab so a
            // background page cannot trigger an autofill prompt.
            guard tab.id == activeTabId else { return }
            notifyListeners("autofillFormFound", data: ["tabId": tab.id, "origin": origin])

        default:
            let requestId = UUID().uuidString
            pendingRequests[requestId] = tab.id
            notifyListeners("pageRequest", data: [
                "requestId": requestId,
                "origin": origin,
                "tabId": tab.id,
                "payloadJson": body,
            ])
        }
    }
}

// MARK: - Navigation

extension DappBrowserPlugin: WKNavigationDelegate {
    public func webView(_ webView: WKWebView,
                        decidePolicyFor navigationAction: WKNavigationAction,
                        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.allow); return }
        let scheme = url.scheme?.lowercased() ?? ""

        // Non-web schemes (mailto:, tel:, wc:, wallet deep links) are handed to
        // the system rather than loaded — same behaviour as the Android
        // shouldOverrideUrlLoading branch.
        if scheme != "http" && scheme != "https" && scheme != "about" {
            decisionHandler(.cancel)
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
            return
        }

        // A per-site exception is keyed on host, so a top-level navigation to a
        // different host has to re-evaluate which lists apply. Rule lists take
        // effect on the NEXT load, so this is done before allowing it.
        if navigationAction.targetFrame?.isMainFrame == true,
           let host = url.host,
           host != webView.url?.host {
            magicGuard.apply(to: webView, host: host)
        }

        decisionHandler(.allow)
    }

    /**
     * Anything WebKit can't display becomes a download instead of a blank page.
     *
     * Android needs an explicit `setDownloadListener` for this; WKWebView has
     * `.download` as a navigation-response policy, which is both simpler and
     * covers Content-Disposition: attachment automatically.
     */
    public func webView(_ webView: WKWebView,
                        decidePolicyFor navigationResponse: WKNavigationResponse,
                        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    public func webView(_ webView: WKWebView,
                        navigationResponse: WKNavigationResponse,
                        didBecome download: WKDownload) {
        download.delegate = self
    }

    public func webView(_ webView: WKWebView,
                        navigationAction: WKNavigationAction,
                        didBecome download: WKDownload) {
        download.delegate = self
    }

    public func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        emitStateForActiveTab(); emitTabs()
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        emitStateForActiveTab(); emitTabs()
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        emitStateForActiveTab(); emitTabs()
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        emitStateForActiveTab(); emitTabs()
    }
}

// MARK: - Downloads

/**
 * Page downloads land in the app's Documents directory, which Info.plist
 * exposes to the Files app (UIFileSharingEnabled +
 * LSSupportsOpeningDocumentsInPlace, set by scripts/patch-ios-plist.js).
 *
 * iOS has no shared Downloads folder and no DownloadManager equivalent, so
 * unlike Android there is no system notification or download tray — the file
 * simply appears under "On My iPhone → MagicMoney". Android's Tor guard
 * (refusing downloads while proxied, because DownloadManager is a separate
 * process that would bypass the proxy) has no counterpart here: WKDownload runs
 * in-process, and iOS has no Tor mode at all.
 */
extension DappBrowserPlugin: WKDownloadDelegate {
    public func download(_ download: WKDownload,
                         decideDestinationUsing response: URLResponse,
                         suggestedFilename: String,
                         completionHandler: @escaping (URL?) -> Void) {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let safe = suggestedFilename.isEmpty ? "download" : suggestedFilename
        // WKDownload REQUIRES a destination that does not already exist — it
        // fails the download rather than overwriting.
        let target = DownloaderPlugin.uniqueUrl(in: docs, fileName: safe)

        // The tray record is created HERE rather than when the download starts,
        // because this is the first callback that knows the real file name.
        var record = DownloadsStore.newRecord(
            url: download.originalRequest?.url?.absoluteString ?? "",
            fileName: target.lastPathComponent,
            location: DownloadsStore.documents)
        record.path = target.path
        record.mimeType = response.mimeType ?? ""
        record.totalBytes = response.expectedContentLength > 0 ? response.expectedContentLength : 0
        let stored = DownloadsStore.shared.add(record)
        Self.activeDownloads[ObjectIdentifier(download)] = (download, stored.id)
        Self.startDownloadPolling()

        completionHandler(target)
    }

    public func downloadDidFinish(_ download: WKDownload) {
        guard let entry = Self.activeDownloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
        DownloadsStore.shared.update(entry.recordId) { r in
            r.state = "completed"
            r.finishedAt = Date().timeIntervalSince1970 * 1000
            let written = download.progress.completedUnitCount
            r.receivedBytes = written
            if r.totalBytes <= 0 { r.totalBytes = written }
        }
    }

    public func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        CAPLog.print("[DappBrowser] download failed: \(error.localizedDescription)")
        guard let entry = Self.activeDownloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
        // A user-driven cancel arrives here too; the record already says
        // "cancelled" in that case and must not be relabelled as a failure.
        DownloadsStore.shared.update(entry.recordId) { r in
            if r.state != "cancelled" {
                r.state = "interrupted"
                r.error = error.localizedDescription
            }
            r.finishedAt = Date().timeIntervalSince1970 * 1000
        }
    }
}

// MARK: - Downloads tray (the parts that need a browser)

extension DappBrowserPlugin {
    /// WKDownloads still running, keyed by identity so the delegate callbacks
    /// can find their tray record. Static because the tray plugin needs to
    /// reach them to cancel, and it is a different plugin instance.
    static var activeDownloads: [ObjectIdentifier: (download: WKDownload, recordId: String)] = [:]
    private static var downloadPollTimer: Timer?

    /**
     * WKDownload reports progress through a Foundation Progress object with no
     * delegate callback, so the tray ticks it — and ONLY while something is
     * actually in flight, matching the Android poller.
     */
    static func startDownloadPolling() {
        DispatchQueue.main.async {
            guard downloadPollTimer == nil else { return }
            downloadPollTimer = Timer.scheduledTimer(withTimeInterval: 0.7, repeats: true) { timer in
                guard !activeDownloads.isEmpty else {
                    timer.invalidate()
                    downloadPollTimer = nil
                    return
                }
                for (_, entry) in activeDownloads {
                    let progress = entry.download.progress
                    DownloadsStore.shared.update(entry.recordId) { r in
                        r.receivedBytes = progress.completedUnitCount
                        if progress.totalUnitCount > 0 { r.totalBytes = progress.totalUnitCount }
                    }
                }
            }
        }
    }

    /// Called by DownloaderPlugin's cancelDownload — the tray owns the button,
    /// this plugin owns the WKDownload.
    ///
    /// Hopped to main because every other reader and writer of activeDownloads
    /// is a WKDownload delegate callback or the poll timer, both of which are
    /// main-thread; a Capacitor plugin call is not.
    static func cancelActiveDownload(recordId: String) {
        DispatchQueue.main.async {
            guard let key = activeDownloads.first(where: { $0.value.recordId == recordId })?.key else { return }
            let entry = activeDownloads.removeValue(forKey: key)
            entry?.download.cancel { _ in }
        }
    }

    /**
     * Retry from the downloads tray. It lives here rather than in
     * DownloaderPlugin because a retry is a fresh page-context request: it goes
     * through the active tab's web view, so it carries that tab's cookies and
     * whatever proxy configuration the browser is running under.
     */
    @objc func retryDownload(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        guard let record = DownloadsStore.shared.find(id),
              let url = URL(string: record.url),
              url.scheme == "http" || url.scheme == "https" else {
            call.resolve(DownloaderPlugin.trayResult(false, "This download cannot be retried."))
            return
        }
        DispatchQueue.main.async { [weak self] in
            // activeTab is private, but this extension is in the same file.
            guard let webView = self?.activeTab?.webView else {
                call.resolve(DownloaderPlugin.trayResult(false, "Open a browser tab before retrying a download."))
                return
            }
            webView.startDownload(using: URLRequest(url: url)) { download in
                download.delegate = self
            }
            // The old row is dropped in favour of the new attempt's, matching
            // every other browser.
            DownloadsStore.shared.remove(id)
            call.resolve(DownloaderPlugin.trayResult(true, nil))
        }
    }
}

// MARK: - UI delegate

/**
 * NOTE — the long-press context menu is deliberately NOT ported.
 *
 * DappBrowserPlugin.java builds one by hand (HitTestResult + a custom action
 * sheet) because Android's WebView has no built-in menu at all. WKWebView
 * already provides one: Open / Open in New Tab / Copy / Share for links, and
 * Save Image / Copy / Share for images, with correct system styling, haptics
 * and Live Text. Overriding `contextMenuConfigurationForElement` to rebuild
 * that would be strictly worse than what iOS gives for free.
 */
extension DappBrowserPlugin: WKUIDelegate {
    /// target="_blank" and window.open: load in the SAME tab rather than
    /// silently dropping it (Android sets setSupportMultipleWindows(false),
    /// which has the same effect).
    public func webView(_ webView: WKWebView,
                        createWebViewWith configuration: WKWebViewConfiguration,
                        for navigationAction: WKNavigationAction,
                        windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            webView.load(URLRequest(url: url))
        }
        return nil
    }
}

// MARK: - Tab

/// One dApp page: its web view plus the KVO wiring that keeps the wallet's
/// chrome (title, URL, spinner, back/forward) in step with it.
final class BrowserTab {
    let id: Int
    let webView: WKWebView
    var bridgeReady = false

    private var observations: [NSKeyValueObservation] = []

    init(id: Int, webView: WKWebView) {
        self.id = id
        self.webView = webView
    }

    func observe(_ onChange: @escaping () -> Void) {
        let fire: (Any, Any) -> Void = { _, _ in DispatchQueue.main.async { onChange() } }
        observations = [
            webView.observe(\.title, options: [.new]) { a, b in fire(a, b) },
            webView.observe(\.url, options: [.new]) { a, b in fire(a, b) },
            webView.observe(\.isLoading, options: [.new]) { a, b in fire(a, b) },
            webView.observe(\.canGoBack, options: [.new]) { a, b in fire(a, b) },
            webView.observe(\.canGoForward, options: [.new]) { a, b in fire(a, b) },
        ]
    }

    func teardown() {
        observations.forEach { $0.invalidate() }
        observations.removeAll()
        webView.configuration.userContentController
            .removeScriptMessageHandler(forName: "mmBridge", contentWorld: .page)
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
        webView.stopLoading()
    }

    /// Hand a JSON string back to the page's __mmBridge listeners.
    func deliver(_ json: String) {
        // Encode through JSONSerialization so quotes/newlines/unicode in the
        // payload can never break out of the JS string literal.
        guard let encoded = try? JSONSerialization.data(withJSONObject: [json], options: []),
              let array = String(data: encoded, encoding: .utf8) else { return }
        let literal = String(array.dropFirst().dropLast())   // strip [ ]
        let js = "window.__mmBridge && window.__mmBridge.__recv(\(literal));"
        webView.evaluateJavaScript(js, in: nil, in: .page) { _ in }
    }
}
