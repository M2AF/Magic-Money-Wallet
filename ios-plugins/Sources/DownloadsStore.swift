import Foundation

/**
 * DownloadsStore — the iOS half of the browser's downloads tray.
 *
 * Counterpart of DownloadsStore.java and src/main/downloads-manager.ts, speaking
 * the same wire contract (src/shared/downloads-wire.ts), because one React panel
 * — DownloadsPanel.tsx — renders all three.
 *
 * Two writers share it, as on Android: DappBrowserPlugin (WKDownload, i.e. a
 * link or non-displayable navigation in a dApp tab) and DownloaderPlugin (NFT
 * media). DownloaderPlugin owns the read/manage half and is the only one that
 * pushes changes into the WebView.
 *
 * ── What "where is it" means on iOS ──────────────────────────────────────────
 * There is no shared Downloads folder. Files land in one of two places, and the
 * record has to remember which, because they behave differently:
 *
 *   • the app's Documents directory — visible in Files under "On My iPhone →
 *     MagicMoney" (Info.plist sets UIFileSharingEnabled and
 *     LSSupportsOpeningDocumentsInPlace). Fully manageable: openable in a share
 *     sheet, deletable.
 *   • the Photos library — where DownloaderPlugin puts images and video. Access
 *     is ADD-ONLY on purpose, so the app cannot read the asset back and cannot
 *     delete it. Those rows report canDelete: false and Open hands off to the
 *     Photos app instead.
 */
final class DownloadsStore {

    /// Matches downloads-wire.ts. `location` is native-only.
    struct Record: Codable {
        var id: String
        var url: String
        var fileName: String
        /// Display location; also the real path when location == .documents.
        var path: String?
        var mimeType: String
        var state: String
        var receivedBytes: Int64
        var totalBytes: Int64
        var startedAt: Double
        var finishedAt: Double?
        var host: String
        var error: String?
        /// "documents" (a real file we control) or "photos" (add-only, opaque).
        var location: String
    }

    static let documents = "documents"
    static let photos = "photos"

    private static let maxRecords = 300
    private static let maxUrlChars = 2048

    static let shared = DownloadsStore()

    /// Set by DownloaderPlugin so tray changes can be pushed to the WebView.
    var onChanged: (() -> Void)?

    private let queue = DispatchQueue(label: "info.chainlens.magicmoney.downloads")
    private var cache: [Record]?

    private init() {}

    // ── Persistence ─────────────────────────────────────────────────────────

    /// Application Support, not Documents: this is app bookkeeping, and Documents
    /// is user-visible in the Files app (a stray downloads.json there is noise).
    private var storeUrl: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("browser", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir.appendingPathComponent("downloads.json")
    }

    /// Caller must already hold `queue`.
    private func loadLocked() -> [Record] {
        if let cache { return cache }
        guard let data = try? Data(contentsOf: storeUrl),
              let parsed = try? JSONDecoder().decode([Record].self, from: data) else {
            // Corrupt or absent store: start empty rather than wedging the tray.
            cache = []
            return []
        }
        cache = Array(parsed.prefix(Self.maxRecords))
        return cache ?? []
    }

    private func persistLocked() {
        guard let cache else { return }
        guard let data = try? JSONEncoder().encode(cache) else { return }
        try? data.write(to: storeUrl, options: .atomic)
    }

    private func notify() {
        onChanged?()
    }

    // ── Mutations ───────────────────────────────────────────────────────────

    @discardableResult
    func add(_ record: Record) -> Record {
        var stored = record
        // Fully on-chain NFT art arrives as a multi-megabyte data: URL. Keeping
        // it would put the whole image in this JSON on every save, and nothing
        // needs it (Retry is http(s)-only).
        if stored.url.count > Self.maxUrlChars {
            stored.url = stored.url.hasPrefix("data:") ? "data:" : String(stored.url.prefix(Self.maxUrlChars))
        }
        queue.sync {
            var list = loadLocked()
            list.insert(stored, at: 0)
            // Trim finished rows only — dropping a running one would orphan a
            // download nothing is watching.
            while list.count > Self.maxRecords {
                guard let victim = list.lastIndex(where: { !Self.isRunning($0) }) else { break }
                list.remove(at: victim)
            }
            cache = list
            persistLocked()
        }
        notify()
        return stored
    }

    func find(_ id: String) -> Record? {
        queue.sync { loadLocked().first { $0.id == id } }
    }

    func update(_ id: String, _ mutate: (inout Record) -> Void) {
        queue.sync {
            var list = loadLocked()
            guard let i = list.firstIndex(where: { $0.id == id }) else { return }
            mutate(&list[i])
            cache = list
            persistLocked()
        }
        notify()
    }

    func remove(_ id: String) {
        queue.sync {
            cache = loadLocked().filter { $0.id != id }
            persistLocked()
        }
        notify()
    }

    /// Clear the finished rows; anything still downloading keeps its place.
    func clearFinished() {
        queue.sync {
            cache = loadLocked().filter { Self.isRunning($0) }
            persistLocked()
        }
        notify()
    }

    var anyRunning: Bool {
        queue.sync { loadLocked().contains(where: { Self.isRunning($0) }) }
    }

    static func isRunning(_ r: Record) -> Bool {
        r.state == "progressing" || r.state == "paused"
    }

    // ── Serialization ───────────────────────────────────────────────────────

    /**
     * The wire snapshot. `exists` is computed here rather than stored, so a file
     * the user deleted in the Files app greys out its Open button on the next
     * read instead of failing on click.
     */
    func wireItems() -> [[String: Any]] {
        queue.sync { loadLocked() }.map { r in
            var o: [String: Any] = [
                "id": r.id,
                "url": r.url,
                "fileName": r.fileName,
                "path": r.path ?? NSNull(),
                "mimeType": r.mimeType,
                "state": r.state,
                "receivedBytes": r.receivedBytes,
                "totalBytes": r.totalBytes,
                "startedAt": r.startedAt,
                "finishedAt": r.finishedAt ?? NSNull(),
                "exists": Self.fileExists(r),
                // WKDownload can resume from resumeData, but only for the
                // process that started it and only across a failure, not a
                // user-driven pause — so there is no pause control to offer.
                "canResume": false,
                // Add-only Photos access cannot delete; Documents files can.
                "canDelete": r.location == Self.documents,
                "host": r.host,
            ]
            if let error = r.error { o["error"] = error }
            return o
        }
    }

    /**
     * A Photos row is reported as present because it is: the asset is in the
     * user's library. The app simply cannot see it — add-only authorization
     * grants no read access — so there is nothing to stat.
     */
    static func fileExists(_ r: Record) -> Bool {
        // Only a finished download has a file worth offering. An interrupted one
        // leaves a partial on disk that must not present an Open button.
        guard r.state == "completed" else { return false }
        if r.location == photos { return true }
        guard let path = r.path, path.hasPrefix("/") else { return false }
        return FileManager.default.fileExists(atPath: path)
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    static func hostOf(_ url: String) -> String {
        if url.hasPrefix("data:") { return "data:" }
        guard let host = URL(string: url)?.host else { return "" }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    static func newRecord(url: String, fileName: String, location: String) -> Record {
        Record(
            id: UUID().uuidString,
            url: url,
            fileName: fileName,
            path: nil,
            mimeType: "",
            state: "progressing",
            receivedBytes: 0,
            totalBytes: 0,
            startedAt: Date().timeIntervalSince1970 * 1000,
            finishedAt: nil,
            host: hostOf(url),
            error: nil,
            location: location
        )
    }
}
