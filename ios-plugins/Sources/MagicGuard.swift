import Foundation
import WebKit
import Compression

/**
 * MagicGuard — content blocking for the iOS dApp browser.
 *
 * The Rust matching engine used on Android and desktop CANNOT run here:
 * WKWebView has no `shouldInterceptRequest`, so nothing native ever sees an
 * outgoing subresource request. WebKit's supported mechanism is
 * `WKContentRuleList` — a declarative ruleset compiled once and evaluated
 * inside the engine, which is both faster than a callback and the only option.
 *
 * The rules are produced at development time by `native/magic-guard-cb`
 * (`npm run magic-guard:ios`) using adblock-rust's own ABP→content-blocking
 * converter — the same code Brave iOS ships — and committed under
 * resources/magic-guard/ios/. From EasyList + EasyPrivacy that yields roughly:
 *
 *     109k  block                 (network blocking)
 *      24k  css-display-none      (cosmetic hiding)
 *     1.4k  ignore-previous-rules (exceptions / unbreak)
 *
 * Rules ship raw-DEFLATE'd (~14.4 MB → ~1.3 MB) and are inflated here with
 * Apple's own `compression` framework, so there is no third-party unzip.
 *
 * ── One honest limitation ───────────────────────────────────────────────────
 * WKContentRuleList fires no callback when a rule matches. Per-page and
 * per-tab block COUNTS are therefore not obtainable on iOS at any effort —
 * they are reported as 0 rather than fabricated. Blocking itself is real; only
 * the telemetry is missing.
 */
final class MagicGuard {

    struct ChunkInfo {
        let file: String
        let rawBytes: Int
    }

    private static let enabledKey = "mm.magicGuard.enabled"
    private static let exceptionsKey = "mm.magicGuard.exceptions"

    private var chunks: [ChunkInfo] = []
    private var version = "0"
    private var totalRules = 0

    private(set) var compiledLists: [WKContentRuleList] = []
    private var exceptionList: WKContentRuleList?
    private(set) var ready = false
    private(set) var lastError: String?

    /// Global toggle. Defaults ON — a privacy feature the user never enabled is
    /// a privacy feature that does nothing.
    var enabled: Bool {
        get {
            if UserDefaults.standard.object(forKey: Self.enabledKey) == nil { return true }
            return UserDefaults.standard.bool(forKey: Self.enabledKey)
        }
        set { UserDefaults.standard.set(newValue, forKey: Self.enabledKey) }
    }

    /// Hostnames the user has switched blocking OFF for.
    private var exceptions: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: Self.exceptionsKey) ?? []) }
        set { UserDefaults.standard.set(Array(newValue).sorted(), forKey: Self.exceptionsKey) }
    }

    func isEnabled(forHost host: String?) -> Bool {
        guard enabled else { return false }
        guard let host = host, !host.isEmpty else { return true }
        return !exceptions.contains(Self.normalizeHost(host))
    }

    func setEnabled(forHost host: String?, enabled value: Bool) {
        guard let host = host, !host.isEmpty else { return }
        var set = exceptions
        let key = Self.normalizeHost(host)
        if value { set.remove(key) } else { set.insert(key) }
        exceptions = set
    }

    static func normalizeHost(_ host: String) -> String {
        var h = host.lowercased()
        if h.hasPrefix("www.") { h.removeFirst(4) }
        return h
    }

    // MARK: - Loading

    /// Compiles (or reuses) every ruleset. WebKit persists compiled lists in its
    /// own store keyed by identifier, so the expensive compile happens once per
    /// ruleset VERSION, not once per launch — hence the version in the id.
    func load(completion: @escaping () -> Void) {
        guard !ready else { completion(); return }
        guard loadManifest() else {
            lastError = "Filter lists are missing from the app bundle"
            completion()
            return
        }

        let store = WKContentRuleListStore.default()
        let group = DispatchGroup()
        var compiled: [Int: WKContentRuleList] = [:]
        let lock = NSLock()

        for (index, chunk) in chunks.enumerated() {
            group.enter()
            let identifier = "magicguard-\(version)-\(index)"

            store?.lookUpContentRuleList(forIdentifier: identifier) { [weak self] list, _ in
                if let list = list {
                    lock.lock(); compiled[index] = list; lock.unlock()
                    group.leave()
                    return
                }
                // Not cached — inflate the shipped ruleset and compile it.
                guard let self = self, let json = self.decodeChunk(chunk) else {
                    self?.lastError = "Could not read \(chunk.file)"
                    group.leave()
                    return
                }
                store?.compileContentRuleList(forIdentifier: identifier, encodedContentRuleList: json) { list, error in
                    if let list = list {
                        lock.lock(); compiled[index] = list; lock.unlock()
                    } else {
                        self.lastError = error?.localizedDescription ?? "Rule compilation failed"
                    }
                    group.leave()
                }
            }
        }

        group.notify(queue: .main) { [weak self] in
            guard let self = self else { completion(); return }
            // Keep chunk order: ignore-previous-rules semantics depend on later
            // rules being evaluated after the ones they countermand.
            self.compiledLists = compiled.keys.sorted().compactMap { compiled[$0] }
            self.ready = !self.compiledLists.isEmpty
            self.rebuildExceptionList { completion() }
        }
    }

    private func loadManifest() -> Bool {
        guard let url = Self.bundledURL("manifest.json"),
              let data = try? Data(contentsOf: url),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let list = obj["chunks"] as? [[String: Any]] else { return false }

        version = (obj["version"] as? String) ?? "0"
        totalRules = (obj["totalRules"] as? Int) ?? 0
        chunks = list.compactMap { entry in
            guard let file = entry["file"] as? String,
                  let raw = entry["rawBytes"] as? Int else { return nil }
            return ChunkInfo(file: file, rawBytes: raw)
        }
        return !chunks.isEmpty
    }

    private static func bundledURL(_ name: String) -> URL? {
        Bundle.main.url(forResource: name, withExtension: nil, subdirectory: "public/magic-guard")
            ?? Bundle.main.url(forResource: name, withExtension: nil, subdirectory: "magic-guard")
    }

    /// Raw DEFLATE → JSON string. COMPRESSION_ZLIB is Apple's name for the raw
    /// DEFLATE stream flate2 produces (no zlib/gzip container), which is why the
    /// generator writes `deflate` rather than `gzip`.
    private func decodeChunk(_ chunk: ChunkInfo) -> String? {
        guard let url = Self.bundledURL(chunk.file),
              let data = try? Data(contentsOf: url) else { return nil }

        // +1 KB of slack: compression_decode_buffer needs the destination sized
        // up front and returns 0 if it would overflow.
        let capacity = chunk.rawBytes + 1024
        var out: Data?
        data.withUnsafeBytes { (src: UnsafeRawBufferPointer) in
            guard let base = src.bindMemory(to: UInt8.self).baseAddress else { return }
            let dst = UnsafeMutablePointer<UInt8>.allocate(capacity: capacity)
            defer { dst.deallocate() }
            let written = compression_decode_buffer(dst, capacity, base, data.count, nil, COMPRESSION_ZLIB)
            if written > 0 { out = Data(bytes: dst, count: written) }
        }
        guard let inflated = out else { return nil }
        return String(data: inflated, encoding: .utf8)
    }

    // MARK: - Per-site exceptions

    /**
     * Per-site "off" is expressed as a SEPARATE compiled list of
     * `ignore-previous-rules` entries, attached after the block lists.
     * That is how WebKit models whitelisting — there is no way to selectively
     * disable an already-compiled list for one host.
     */
    private func rebuildExceptionList(completion: @escaping () -> Void) {
        let hosts = exceptions.sorted()
        guard !hosts.isEmpty else {
            exceptionList = nil
            completion()
            return
        }

        let rules: [[String: Any]] = [[
            "trigger": [
                "url-filter": ".*",
                // The leading * matches subdomains, matching how the shared UI
                // presents a per-site toggle ("this site", not "this exact host").
                "if-domain": hosts.map { "*\($0)" },
            ],
            "action": ["type": "ignore-previous-rules"],
        ]]

        guard let data = try? JSONSerialization.data(withJSONObject: rules),
              let json = String(data: data, encoding: .utf8) else {
            completion()
            return
        }

        // Identifier includes a hash of the host set so a changed exception list
        // never reuses a stale compiled version.
        let identifier = "magicguard-exceptions-\(abs(hosts.joined(separator: ",").hashValue))"
        WKContentRuleListStore.default()?.compileContentRuleList(
            forIdentifier: identifier, encodedContentRuleList: json
        ) { [weak self] list, _ in
            self?.exceptionList = list
            DispatchQueue.main.async { completion() }
        }
    }

    // MARK: - Applying

    /// Attach or detach every list on a web view. Content rule lists only take
    /// effect on the NEXT load, so callers reload after toggling.
    func apply(to webView: WKWebView, host: String?) {
        let controller = webView.configuration.userContentController
        controller.removeAllContentRuleLists()
        guard ready, isEnabled(forHost: host) else { return }
        for list in compiledLists { controller.add(list) }
        if let exceptionList = exceptionList { controller.add(exceptionList) }
    }

    func refreshExceptions(completion: @escaping () -> Void) {
        rebuildExceptionList(completion: completion)
    }

    // MARK: - State for the shared UI

    func statePayload(host: String?) -> [String: Any] {
        let siteEnabled = host.map { !exceptions.contains(Self.normalizeHost($0)) } ?? true
        let effective = ready && enabled && siteEnabled

        var status = "ready"
        if !ready { status = lastError == nil ? "loading" : "degraded" }
        else if !enabled { status = "disabled" }

        var payload: [String: Any] = [
            "enabled": enabled,
            "siteEnabled": siteEnabled,
            "effectiveEnabled": effective,
            "status": status,
            "hostname": host as Any,
            // NOT obtainable on iOS: WKContentRuleList never reports a match.
            // Reported as 0 rather than invented.
            "blockedThisPage": 0,
            "blockedThisTab": 0,
            "listVersion": version,
        ]
        if let error = lastError { payload["error"] = error }
        return payload
    }
}
