package info.chainlens.magicmoney;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.MimeTypeMap;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Downloader — saves NFT media into the phone's public Downloads folder.
 *
 * Android's WebView has no download support at all unless the host app supplies
 * a DownloadListener, so the wallet's "Download Image" anchor was a no-op here
 * (and on desktop it escaped to the system browser — see main/downloads.ts).
 *
 * Deliberately does NOT use DownloadManager: writing to the public Downloads
 * directory through it requires WRITE_EXTERNAL_STORAGE below API 29, and adding
 * a storage permission to a wallet app is a poor trade for one button. Instead:
 *
 *   • API 29+ (Q): MediaStore.Downloads — public Downloads folder, NO permission.
 *   • API 26–28:   the app's own external files dir, which also needs no
 *                  permission. Less discoverable, but those releases are a
 *                  vanishing slice of devices and nothing silently fails.
 *
 * `data:` URLs (fully on-chain SVG art) are decoded locally rather than fetched.
 */
@CapacitorPlugin(name = "Downloader")
public class DownloaderPlugin extends Plugin {

    private static final int MAX_BYTES = 64 * 1024 * 1024;
    private static final int TIMEOUT_MS = 30_000;
    private static final int MAX_REDIRECTS = 5;

    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void downloadFile(PluginCall call) {
        final String url = call.getString("url", "");
        final String suggestedName = call.getString("filename", "download");
        if (url == null || url.isEmpty()) {
            call.resolve(fail("That media link is not valid."));
            return;
        }
        io.execute(() -> {
            emitProgress(true, -1);
            try {
                call.resolve(save(url, sanitize(suggestedName)));
            } catch (Exception e) {
                String message = e.getMessage();
                call.resolve(fail(message == null ? "Download failed." : message));
            } finally {
                emitProgress(false, 100);
            }
        });
    }

    /**
     * Drives the wallet's top-edge neon bar (DownloadProgressBar.tsx). A percent
     * of -1 travels as null, meaning "size unknown" — the bar sweeps instead of
     * showing a fabricated number.
     */
    private void emitProgress(boolean active, int percent) {
        JSObject event = new JSObject();
        event.put("active", active);
        if (percent < 0) event.put("percent", JSONObject.NULL);
        else event.put("percent", percent);
        notifyListeners("progress", event);
    }

    // ── Core ────────────────────────────────────────────────────────────────

    private JSObject save(String rawUrl, String baseName) throws IOException {
        String url = normalize(rawUrl);

        byte[] bytes;
        String mime;
        if (url.startsWith("data:")) {
            int comma = url.indexOf(',');
            if (comma < 0) return fail("That media link could not be decoded.");
            String header = url.substring(5, comma);
            String payload = url.substring(comma + 1);
            boolean base64 = header.toLowerCase(Locale.US).endsWith(";base64");
            mime = header.replaceAll("(?i);base64$", "");
            bytes = base64
                    ? Base64.decode(payload, Base64.DEFAULT)
                    : URLDecoder.decode(payload, "UTF-8").getBytes(StandardCharsets.UTF_8);
        } else if (url.startsWith("http://") || url.startsWith("https://")) {
            Fetched fetched = fetch(url);
            bytes = fetched.bytes;
            mime = fetched.mime;
        } else {
            return fail("Only http(s) media can be saved.");
        }

        if (bytes == null || bytes.length == 0) return fail("Download failed.");
        if (bytes.length > MAX_BYTES) return fail("That file is too large to save.");

        String fileName = baseName + extensionFor(url, mime);
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? writeToMediaStore(fileName, mime, bytes)
                : writeToAppExternalDir(fileName, bytes);
    }

    private static final class Fetched {
        byte[] bytes;
        String mime;
    }

    /** Plain HttpURLConnection so IPFS gateway redirects are followed explicitly. */
    private Fetched fetch(String url) throws IOException {
        String current = url;
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            HttpURLConnection conn = (HttpURLConnection) new URL(current).openConnection();
            conn.setConnectTimeout(TIMEOUT_MS);
            conn.setReadTimeout(TIMEOUT_MS);
            conn.setInstanceFollowRedirects(false);   // cross-protocol hops are not auto-followed
            conn.setRequestProperty("Accept", "*/*");
            try {
                int code = conn.getResponseCode();
                if (code == HttpURLConnection.HTTP_MOVED_PERM
                        || code == HttpURLConnection.HTTP_MOVED_TEMP
                        || code == HttpURLConnection.HTTP_SEE_OTHER
                        || code == 307 || code == 308) {
                    String location = conn.getHeaderField("Location");
                    if (location == null) throw new IOException("Download failed (redirect without target).");
                    current = new URL(new URL(current), location).toString();
                    continue;
                }
                if (code < 200 || code > 299) throw new IOException("Download failed (" + code + ").");

                int declared = conn.getContentLength();
                if (declared > MAX_BYTES) throw new IOException("That file is too large to save.");

                Fetched out = new Fetched();
                out.mime = conn.getContentType();
                try (InputStream in = conn.getInputStream()) {
                    out.bytes = readBounded(in, declared);
                }
                return out;
            } finally {
                conn.disconnect();
            }
        }
        throw new IOException("Download failed (too many redirects).");
    }

    /** `declared` is Content-Length, or <= 0 when the server didn't send one. */
    private byte[] readBounded(InputStream in, int declared) throws IOException {
        java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
        byte[] chunk = new byte[16 * 1024];
        int read;
        int total = 0;
        int lastPercent = -1;
        while ((read = in.read(chunk)) != -1) {
            total += read;
            if (total > MAX_BYTES) throw new IOException("That file is too large to save.");
            buffer.write(chunk, 0, read);
            if (declared > 0) {
                // Only emit on a whole-percent change — a 16 KB chunk loop would
                // otherwise flood the WebView bridge for a large image.
                int percent = Math.min(99, (int) ((total * 100L) / declared));
                if (percent != lastPercent) {
                    lastPercent = percent;
                    emitProgress(true, percent);
                }
            }
        }
        return buffer.toByteArray();
    }

    /** API 29+: public Downloads via MediaStore — no storage permission needed. */
    private JSObject writeToMediaStore(String fileName, String mime, byte[] bytes) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
        if (mime != null && !mime.isEmpty()) values.put(MediaStore.Downloads.MIME_TYPE, mime.split(";")[0].trim());
        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        values.put(MediaStore.Downloads.IS_PENDING, 1);

        Uri item = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (item == null) throw new IOException("Could not create the file.");
        try {
            try (OutputStream out = resolver.openOutputStream(item)) {
                if (out == null) throw new IOException("Could not write the file.");
                out.write(bytes);
            }
            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(item, values, null, null);
        } catch (IOException e) {
            resolver.delete(item, null, null);   // never leave a pending stub behind
            throw e;
        }
        return ok(fileName, "Downloads/" + fileName);
    }

    /** API 26–28: app-scoped external storage, the only permission-free option. */
    private JSObject writeToAppExternalDir(String fileName, byte[] bytes) throws IOException {
        File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) throw new IOException("No storage available.");
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("No storage available.");
        File target = uniqueFile(dir, fileName);
        try (FileOutputStream out = new FileOutputStream(target)) {
            out.write(bytes);
        }
        return ok(target.getName(), target.getAbsolutePath());
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private static File uniqueFile(File dir, String fileName) {
        int dot = fileName.lastIndexOf('.');
        String base = dot > 0 ? fileName.substring(0, dot) : fileName;
        String ext = dot > 0 ? fileName.substring(dot) : "";
        File candidate = new File(dir, fileName);
        for (int i = 1; candidate.exists() && i < 100; i++) {
            candidate = new File(dir, base + " (" + i + ")" + ext);
        }
        return candidate;
    }

    /** Same ipfs://, ar:// mapping the TypeScript fetchers apply. */
    private static String normalize(String url) {
        String trimmed = url.trim();
        if (trimmed.startsWith("ipfs://")) return "https://ipfs.io/ipfs/" + trimmed.substring(7);
        if (trimmed.startsWith("ar://")) return "https://arweave.net/" + trimmed.substring(5);
        return trimmed;
    }

    private static String sanitize(String name) {
        String cleaned = (name == null ? "" : name)
                .replaceAll("[\\\\/:*?\"<>|]", "_")
                .replaceAll("^\\.+", "")
                .trim();
        if (cleaned.length() > 80) cleaned = cleaned.substring(0, 80);
        return cleaned.isEmpty() ? "download" : cleaned;
    }

    /** URL extension first (when recognizable), then the server's Content-Type. */
    private static String extensionFor(String url, String mime) {
        try {
            String path = Uri.parse(url).getPath();
            if (path != null) {
                int dot = path.lastIndexOf('.');
                if (dot >= 0 && dot < path.length() - 1) {
                    String ext = path.substring(dot + 1).toLowerCase(Locale.US);
                    if (ext.matches("[a-z0-9]{2,5}")
                            && MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) != null) {
                        return "." + ext;
                    }
                }
            }
        } catch (Exception ignored) { }
        if (mime != null) {
            String fromMime = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime.split(";")[0].trim());
            if (fromMime != null) return "." + fromMime;
        }
        return ".bin";
    }

    private static JSObject ok(String fileName, String path) {
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("fileName", fileName);
        ret.put("path", path);
        return ret;
    }

    private static JSObject fail(String error) {
        JSObject ret = new JSObject();
        ret.put("ok", false);
        ret.put("error", error);
        return ret;
    }
}
