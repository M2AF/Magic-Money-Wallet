import Foundation
import Capacitor
import Photos
import UniformTypeIdentifiers

/**
 * Downloader — iOS counterpart of DownloaderPlugin.java.
 *
 * WKWebView ignores `<a download>` exactly as Android's WebView does, so NFT
 * media has to be saved natively. The fetch/decode/limit logic is a direct
 * port; only the destination differs, because **iOS has no shared Downloads
 * folder**:
 *
 *   • Images and video  → the Photos library (add-only authorization). This is
 *     where a user looks for saved media on iOS, and it's the closest analog
 *     to Android's MediaStore.Downloads.
 *   • Everything else   → the app's Documents directory, which is surfaced in
 *     the Files app because Info.plist sets UIFileSharingEnabled and
 *     LSSupportsOpeningDocumentsInPlace.
 *
 * Add-only Photos access (.addOnly) is deliberate: it lets the app write media
 * without ever gaining permission to READ the user's library, which a wallet
 * has no business doing and which reviewers scrutinize.
 */
@objc(DownloaderPlugin)
public class DownloaderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DownloaderPlugin"
    public let jsName = "Downloader"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "downloadFile", returnType: CAPPluginReturnPromise),
    ]

    private static let maxBytes = 64 * 1024 * 1024
    private static let timeout: TimeInterval = 30
    private static let maxRedirects = 5

    @objc func downloadFile(_ call: CAPPluginCall) {
        let rawUrl = call.getString("url") ?? ""
        let suggested = call.getString("filename") ?? "download"

        guard !rawUrl.isEmpty else {
            call.resolve(Self.fail("That media link is not valid."))
            return
        }

        emitProgress(active: true, percent: nil)

        Task {
            defer { self.emitProgress(active: false, percent: 100) }
            do {
                let result = try await self.save(rawUrl, baseName: Self.sanitize(suggested))
                call.resolve(result)
            } catch let e as DownloadError {
                call.resolve(Self.fail(e.message))
            } catch {
                call.resolve(Self.fail("Download failed."))
            }
        }
    }

    /**
     * Drives the wallet's top-edge neon bar (DownloadProgressBar.tsx). A nil
     * percent means "size unknown" — the bar sweeps instead of showing a
     * fabricated number. Same contract as the Android plugin.
     */
    private func emitProgress(active: Bool, percent: Int?) {
        var event: [String: Any] = ["active": active]
        event["percent"] = percent as Any? ?? NSNull()
        notifyListeners("progress", data: event)
    }

    // ── Core ────────────────────────────────────────────────────────────────

    private func save(_ rawUrl: String, baseName: String) async throws -> [String: Any] {
        let url = Self.normalize(rawUrl)

        let bytes: Data
        let mime: String?

        if url.hasPrefix("data:") {
            (bytes, mime) = try Self.decodeDataUrl(url)
        } else if url.hasPrefix("http://") || url.hasPrefix("https://") {
            (bytes, mime) = try await fetch(url)
        } else {
            throw DownloadError("Only http(s) media can be saved.")
        }

        guard !bytes.isEmpty else { throw DownloadError("Download failed.") }
        guard bytes.count <= Self.maxBytes else { throw DownloadError("That file is too large to save.") }

        let fileName = baseName + Self.extensionFor(url: url, mime: mime)

        if Self.isPhotoLibraryType(fileName: fileName, mime: mime) {
            return try await saveToPhotos(bytes, fileName: fileName)
        }
        return try saveToDocuments(bytes, fileName: fileName)
    }

    private static func decodeDataUrl(_ url: String) throws -> (Data, String?) {
        guard let comma = url.firstIndex(of: ",") else {
            throw DownloadError("That media link could not be decoded.")
        }
        let header = String(url[url.index(url.startIndex, offsetBy: 5)..<comma])
        let payload = String(url[url.index(after: comma)...])
        let isBase64 = header.lowercased().hasSuffix(";base64")
        let mime = isBase64 ? String(header.dropLast(7)) : header

        let data: Data?
        if isBase64 {
            data = Data(base64Encoded: payload)
        } else {
            data = payload.removingPercentEncoding?.data(using: .utf8)
        }
        guard let decoded = data else {
            throw DownloadError("That media link could not be decoded.")
        }
        return (decoded, mime.isEmpty ? nil : mime)
    }

    /// Streamed so progress events match Android's; redirects are counted
    /// explicitly because IPFS gateways chain several.
    private func fetch(_ url: String) async throws -> (Data, String?) {
        guard let parsed = URL(string: url) else {
            throw DownloadError("That media link is not valid.")
        }

        var request = URLRequest(url: parsed)
        request.timeoutInterval = Self.timeout
        request.setValue("*/*", forHTTPHeaderField: "Accept")

        let delegate = RedirectCounter(max: Self.maxRedirects)
        let session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }

        let (stream, response) = try await session.bytes(for: request)

        guard let http = response as? HTTPURLResponse else {
            throw DownloadError("Download failed.")
        }
        guard (200...299).contains(http.statusCode) else {
            throw DownloadError("Download failed (\(http.statusCode)).")
        }

        let declared = http.expectedContentLength
        if declared > Int64(Self.maxBytes) {
            throw DownloadError("That file is too large to save.")
        }

        var data = Data()
        if declared > 0 { data.reserveCapacity(Int(declared)) }
        var lastPercent = -1

        for try await byte in stream {
            data.append(byte)
            if data.count > Self.maxBytes {
                throw DownloadError("That file is too large to save.")
            }
            if declared > 0 {
                // Only emit on a whole-percent change — otherwise this floods
                // the WebView bridge, which is what the Android port guards
                // against with the same check.
                let percent = min(99, Int((Int64(data.count) * 100) / declared))
                if percent != lastPercent {
                    lastPercent = percent
                    emitProgress(active: true, percent: percent)
                }
            }
        }

        return (data, http.mimeType)
    }

    // ── Destinations ────────────────────────────────────────────────────────

    private static func isPhotoLibraryType(fileName: String, mime: String?) -> Bool {
        if let mime = mime?.split(separator: ";").first.map(String.init)?.lowercased() {
            if mime.hasPrefix("image/") || mime.hasPrefix("video/") { return true }
        }
        let ext = (fileName as NSString).pathExtension.lowercased()
        return ["png", "jpg", "jpeg", "gif", "heic", "webp", "mp4", "mov", "m4v"].contains(ext)
    }

    private func saveToPhotos(_ data: Data, fileName: String) async throws -> [String: Any] {
        let status = await withCheckedContinuation { (c: CheckedContinuation<PHAuthorizationStatus, Never>) in
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { c.resume(returning: $0) }
        }
        guard status == .authorized || status == .limited else {
            // Not an error state worth a crash — fall back to Files, which
            // needs no permission at all, so the download still succeeds.
            return try saveToDocuments(data, fileName: fileName)
        }

        // WebP and some IPFS payloads aren't valid Photos assets; a failed
        // insert would otherwise lose the download entirely.
        do {
            try await PHPhotoLibrary.shared().performChanges {
                let request = PHAssetCreationRequest.forAsset()
                request.addResource(with: Self.isVideo(fileName) ? .video : .photo, data: data, options: nil)
            }
        } catch {
            return try saveToDocuments(data, fileName: fileName)
        }

        return Self.ok(fileName: fileName, path: "Photos/\(fileName)")
    }

    private static func isVideo(_ fileName: String) -> Bool {
        ["mp4", "mov", "m4v"].contains((fileName as NSString).pathExtension.lowercased())
    }

    private func saveToDocuments(_ data: Data, fileName: String) throws -> [String: Any] {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let target = Self.uniqueUrl(in: dir, fileName: fileName)
        do {
            try data.write(to: target, options: .atomic)
        } catch {
            throw DownloadError("Could not write the file.")
        }
        return Self.ok(fileName: target.lastPathComponent, path: "Files/MagicMoney/\(target.lastPathComponent)")
    }

    // ── Helpers (ported 1:1 from the Java) ──────────────────────────────────

    private static func uniqueUrl(in dir: URL, fileName: String) -> URL {
        let base = (fileName as NSString).deletingPathExtension
        let ext = (fileName as NSString).pathExtension
        var candidate = dir.appendingPathComponent(fileName)
        var i = 1
        while FileManager.default.fileExists(atPath: candidate.path) && i < 100 {
            let name = ext.isEmpty ? "\(base) (\(i))" : "\(base) (\(i)).\(ext)"
            candidate = dir.appendingPathComponent(name)
            i += 1
        }
        return candidate
    }

    /// Same ipfs://, ar:// mapping the TypeScript fetchers apply.
    private static func normalize(_ url: String) -> String {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("ipfs://") {
            return "https://ipfs.io/ipfs/" + trimmed.dropFirst(7)
        }
        if trimmed.hasPrefix("ar://") {
            return "https://arweave.net/" + trimmed.dropFirst(5)
        }
        return trimmed
    }

    private static func sanitize(_ name: String) -> String {
        var cleaned = name
            .components(separatedBy: CharacterSet(charactersIn: "\\/:*?\"<>|"))
            .joined(separator: "_")
        while cleaned.hasPrefix(".") { cleaned.removeFirst() }
        cleaned = cleaned.trimmingCharacters(in: .whitespaces)
        if cleaned.count > 80 { cleaned = String(cleaned.prefix(80)) }
        return cleaned.isEmpty ? "download" : cleaned
    }

    /// URL extension first (when recognizable), then the server's Content-Type.
    private static func extensionFor(url: String, mime: String?) -> String {
        if let path = URL(string: url)?.path {
            let ext = (path as NSString).pathExtension.lowercased()
            if ext.count >= 2, ext.count <= 5,
               ext.allSatisfy({ $0.isLetter || $0.isNumber }),
               UTType(filenameExtension: ext) != nil {
                return "." + ext
            }
        }
        if let mime = mime?.split(separator: ";").first.map(String.init),
           let type = UTType(mimeType: mime.trimmingCharacters(in: .whitespaces)),
           let ext = type.preferredFilenameExtension {
            return "." + ext
        }
        return ".bin"
    }

    private static func ok(fileName: String, path: String) -> [String: Any] {
        ["ok": true, "fileName": fileName, "path": path]
    }

    private static func fail(_ error: String) -> [String: Any] {
        ["ok": false, "error": error]
    }
}

private struct DownloadError: Error {
    let message: String
    init(_ message: String) { self.message = message }
}

/// URLSession follows redirects itself; this only enforces the hop limit the
/// Android plugin implements by hand.
private final class RedirectCounter: NSObject, URLSessionTaskDelegate {
    private let max: Int
    private var count = 0

    init(max: Int) { self.max = max }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        count += 1
        completionHandler(count > max ? nil : request)
    }
}
