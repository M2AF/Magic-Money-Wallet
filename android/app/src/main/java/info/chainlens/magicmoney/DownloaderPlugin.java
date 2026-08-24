package info.chainlens.magicmoney;

import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.Base64;
import android.webkit.MimeTypeMap;

import androidx.core.content.FileProvider;

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
 * Downloader — saves NFT media into the phone's public Downloads folder, and
 * owns the browser's downloads tray (list / open / delete / clear / cancel).
 *
 * The tray half is the Android counterpart of src/main/downloads-manager.ts and
 * speaks the same wire contract (src/shared/downloads-wire.ts), because one
 * React panel — DownloadsPanel.tsx — renders both. Records live in
 * DownloadsStore, which this plugin and DappBrowserPlugin both write to.
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

    /** Poller cadence while a browser download is in flight. */
    private static final long POLL_MS = 700;
    private final Handler poller = new Handler(Looper.getMainLooper());
    // Written from the UI thread and from the io executor (a record added by a
    // finished NFT save fires the change listener on that thread).
    private volatile boolean polling = false;

    @Override
    public void load() {
        // This plugin owns the tray's read/manage API, so it is also the one
        // that can push changes into the WebView. DappBrowserPlugin and this one
        // both WRITE records; only this one broadcasts them.
        DownloadsStore.setChangeListener(this::emitDownloads);
        ensurePolling();
    }

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

    // ── Downloads tray ──────────────────────────────────────────────────────
    //
    // The read/manage half of the browser's downloads manager. Records come from
    // two writers — DappBrowserPlugin (links in a dApp tab, via DownloadManager)
    // and this plugin (NFT media, via MediaStore) — and DownloadsStore is the
    // single memory both share. Retry is the one action that lives in
    // DappBrowserPlugin instead: it re-requests over the network, so it has to
    // clear the same Tor gate.
    //
    // Only ids cross the bridge; paths and content URIs stay on this side, so
    // the WebView cannot ask for a file outside the tray to be opened or deleted.

    @PluginMethod
    public void listDownloads(PluginCall call) {
        DownloadsStore.refreshFromDownloadManager(getContext());
        call.resolve(snapshotObject(getContext()));
    }

    @PluginMethod
    public void openDownload(PluginCall call) {
        DownloadsStore.Record record = DownloadsStore.find(getContext(), call.getString("id", ""));
        if (record == null) { call.resolve(trayResult(getContext(), false, "That download is no longer listed.")); return; }
        if (!DownloadsStore.fileExists(getContext(), record)) {
            call.resolve(trayResult(getContext(), false, "That file has been moved or deleted."));
            return;
        }
        Uri viewUri = viewableUri(record);
        if (viewUri == null) { call.resolve(trayResult(getContext(), false, "That file cannot be opened.")); return; }
        try {
            Intent view = new Intent(Intent.ACTION_VIEW);
            String mime = TextUtils.isEmpty(record.mimeType)
                    ? guessMime(record.fileName)
                    : record.mimeType.split(";")[0].trim();
            view.setDataAndType(viewUri, TextUtils.isEmpty(mime) ? "*/*" : mime);
            view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(view);
            call.resolve(trayResult(getContext(), true, null));
        } catch (ActivityNotFoundException e) {
            call.resolve(trayResult(getContext(), false, "No app on this phone can open that file."));
        } catch (Exception e) {
            call.resolve(trayResult(getContext(), false, "That file could not be opened."));
        }
    }

    /** Delete the file AND its row — what "Delete" does in every browser. */
    @PluginMethod
    public void deleteDownload(PluginCall call) {
        String id = call.getString("id", "");
        DownloadsStore.Record record = DownloadsStore.find(getContext(), id);
        if (record == null) { call.resolve(trayResult(getContext(), false, "That download is no longer listed.")); return; }
        try {
            if (record.dmId >= 0) {
                // DownloadManager.remove deletes the file it wrote and forgets
                // the row — which is also how a running download is cancelled.
                DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
                if (dm != null) dm.remove(record.dmId);
            } else if (!TextUtils.isEmpty(record.uri)) {
                Uri uri = Uri.parse(record.uri);
                if ("file".equalsIgnoreCase(uri.getScheme())) {
                    String path = uri.getPath();
                    if (path != null) new File(path).delete();
                } else {
                    getContext().getContentResolver().delete(uri, null, null);
                }
            } else if (!TextUtils.isEmpty(record.path) && record.path.startsWith("/")) {
                // API 26-28 writes land in the app's own external files dir with
                // no URI of any kind — a plain path is the only handle there is.
                new File(record.path).delete();
            }
        } catch (Exception e) {
            call.resolve(trayResult(getContext(), false, "That file could not be deleted."));
            return;
        }
        DownloadsStore.remove(getContext(), id);
        call.resolve(trayResult(getContext(), true, null));
    }

    /** Forget the row, leave the file where it is. */
    @PluginMethod
    public void removeDownload(PluginCall call) {
        DownloadsStore.remove(getContext(), call.getString("id", ""));
        call.resolve(trayResult(getContext(), true, null));
    }

    @PluginMethod
    public void clearDownloads(PluginCall call) {
        DownloadsStore.clearFinished(getContext());
        call.resolve(trayResult(getContext(), true, null));
    }

    /**
     * Cancel a running download. DownloadManager.remove is the only stop
     * control it offers — there is no pause/resume, which is why the snapshot
     * reports canPause: false and the panel hides those buttons.
     */
    @PluginMethod
    public void cancelDownload(PluginCall call) {
        String id = call.getString("id", "");
        DownloadsStore.Record record = DownloadsStore.find(getContext(), id);
        if (record == null) { call.resolve(trayResult(getContext(), false, "That download is no longer listed.")); return; }
        if (record.dmId >= 0) {
            DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm != null) dm.remove(record.dmId);
        }
        record.state = "cancelled";
        record.error = "Cancelled";
        record.finishedAt = System.currentTimeMillis();
        DownloadsStore.save(getContext());
        call.resolve(trayResult(getContext(), true, null));
    }

    /** Android's own Downloads screen — the closest thing to "show in folder". */
    @PluginMethod
    public void openDownloadsFolder(PluginCall call) {
        try {
            Intent intent = new Intent(DownloadManager.ACTION_VIEW_DOWNLOADS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(trayResult(getContext(), true, null));
        } catch (Exception e) {
            call.resolve(trayResult(getContext(), false, "This phone has no Downloads app."));
        }
    }

    // ── App update download + install ────────────────────────────────────
    //
    // The sideload updater used to hand the APK URL to Browser.open(), i.e. a
    // Custom Tab. That downloads through whatever browser handles the tab,
    // which on many phones stalls part-way -- and when it does finish, the user
    // is left to find the file in a file manager and tap it themselves. Doing
    // it here instead means one progress bar inside the app and one button at
    // the end that opens the system installer directly.
    //
    // NOT gated on Tor Mode, unlike browser downloads (see
    // DownloadsStore.enqueueBrowserDownload). Tor Mode anonymises BROWSING; the
    // update check itself already reaches api.github.com directly from the
    // WebView, so refusing only the download would cost the user their update
    // without hiding anything that was not already exposed.

    private static final String UPDATE_PREFIX = "magicmoney-update-";
    private long updateDownloadId = -1;
    private final Handler updatePoller = new Handler(Looper.getMainLooper());
    private volatile boolean pollingUpdate = false;

    /** Where update APKs live: app-private, no permission, cleared on uninstall. */
    private File updateDir() {
        return getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
    }

    /**
     * True when the user has granted "install unknown apps" to MagicMoney. The
     * install intent silently bounces without it, so the UI asks first rather
     * than looking broken.
     */
    @PluginMethod
    public void canInstallUpdates(PluginCall call) {
        JSObject out = new JSObject();
        out.put("granted", hasInstallPermission());
        call.resolve(out);
    }

    private boolean hasInstallPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        try {
            return getContext().getPackageManager().canRequestPackageInstalls();
        } catch (Exception e) {
            return false;
        }
    }

    /** Send the user to the one Settings screen that can grant it. */
    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the install-permission screen");
        }
    }

    /**
     * Download an update APK through DownloadManager. Progress rides the
     * `updateProgress` event, which also carries the terminal state, so the JS
     * side never has to poll.
     */
    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        String url = call.getString("url", "");
        String version = call.getString("version", "");
        if (url == null || url.isEmpty()) { call.reject("No update URL"); return; }

        DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null) { call.reject("Downloads are unavailable on this device"); return; }

        // A part-downloaded or superseded APK from a previous attempt is dead
        // weight, and would confuse installUpdate's newest-file pick.
        purgeUpdateApks();

        String name = UPDATE_PREFIX + (version.isEmpty() ? "latest" : version) + ".apk";
        try {
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            req.setTitle("MagicMoney " + version);
            req.setDescription("Downloading update");
            req.setMimeType("application/vnd.android.package-archive");
            req.setDestinationInExternalFilesDir(getContext(), Environment.DIRECTORY_DOWNLOADS, name);
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            updateDownloadId = dm.enqueue(req);
        } catch (Exception e) {
            call.reject("Could not start the update download");
            return;
        }
        emitUpdate("downloading", 0, null);
        startUpdatePolling();
        call.resolve();
    }

    /** Hand the downloaded APK to the system package installer. */
    @PluginMethod
    public void installUpdate(PluginCall call) {
        File apk = newestUpdateApk();
        if (apk == null) { call.reject("No downloaded update to install"); return; }
        if (!hasInstallPermission()) { call.reject("PERMISSION_REQUIRED"); return; }
        try {
            Uri uri = FileProvider.getUriForFile(
                    getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open the installer");
        }
    }

    /** Newest downloaded update APK, or null when there is none. */
    private File newestUpdateApk() {
        File dir = updateDir();
        if (dir == null) return null;
        File[] files = dir.listFiles((d, n) -> n.startsWith(UPDATE_PREFIX) && n.endsWith(".apk"));
        if (files == null || files.length == 0) return null;
        File newest = files[0];
        for (File f : files) if (f.lastModified() > newest.lastModified()) newest = f;
        return newest.length() > 0 ? newest : null;
    }

    private void purgeUpdateApks() {
        File dir = updateDir();
        if (dir == null) return;
        File[] files = dir.listFiles((d, n) -> n.startsWith(UPDATE_PREFIX) && n.endsWith(".apk"));
        if (files == null) return;
        for (File f : files) { try { f.delete(); } catch (Exception ignored) { } }
    }

    /**
     * DownloadManager reports progress by polling only. This runs while the
     * update download is in flight and stops the moment it settles.
     */
    private void startUpdatePolling() {
        if (pollingUpdate) return;
        pollingUpdate = true;
        updatePoller.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (!tickUpdate()) {
                    pollingUpdate = false;
                    return;
                }
                updatePoller.postDelayed(this, POLL_MS);
            }
        }, POLL_MS);
    }

    /** One poll. Returns false once the download has reached a terminal state. */
    private boolean tickUpdate() {
        DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null || updateDownloadId < 0) return false;
        Cursor c = null;
        try {
            c = dm.query(new DownloadManager.Query().setFilterById(updateDownloadId));
            if (c == null || !c.moveToFirst()) {
                emitUpdate("error", 0, "The update download was cancelled");
                return false;
            }
            int status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            long soFar = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            long total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                emitUpdate("downloaded", 100, null);
                return false;
            }
            if (status == DownloadManager.STATUS_FAILED) {
                int reason = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                emitUpdate("error", 0, "The update download failed (" + reason + ")");
                return false;
            }
            int percent = total > 0 ? (int) Math.min(99, (soFar * 100L) / total) : 0;
            emitUpdate("downloading", percent, null);
            return true;
        } catch (Exception e) {
            emitUpdate("error", 0, "The update download failed");
            return false;
        } finally {
            if (c != null) c.close();
        }
    }

    private void emitUpdate(String state, int percent, String error) {
        JSObject event = new JSObject();
        event.put("state", state);
        event.put("percent", percent);
        if (error != null) event.put("error", error);
        notifyListeners("updateProgress", event);
    }

    // ── Tray helpers ────────────────────────────────────────────────────────

    /**
     * The DownloadsSnapshot shape from src/shared/downloads-wire.ts. Package
     * -visible because DappBrowserPlugin's retryDownload returns the same shape.
     */
    static JSObject snapshotObject(Context context) {
        JSObject out = new JSObject();
        out.put("items", DownloadsStore.toWireArray(context));
        // Android has neither: DownloadManager exposes no pause/resume, and the
        // system Downloads app is offered as its own action rather than per row.
        out.put("canShowInFolder", false);
        out.put("canPause", false);
        return out;
    }

    /** The DownloadActionResult shape — ok/error plus the fresh snapshot. */
    static JSObject trayResult(Context context, boolean ok, String error) {
        JSObject out = new JSObject();
        out.put("ok", ok);
        if (error != null) out.put("error", error);
        out.put("snapshot", snapshotObject(context));
        return out;
    }

    /**
     * A URI another app can actually open. A raw file:// path would throw
     * FileUriExposedException on API 24+, so app-written files go through the
     * FileProvider already declared in AndroidManifest.
     */
    private Uri viewableUri(DownloadsStore.Record record) {
        if (record.dmId >= 0) {
            DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm != null) {
                try {
                    Uri fromDm = dm.getUriForDownloadedFile(record.dmId);
                    if (fromDm != null) return fromDm;
                } catch (Exception ignored) { }
            }
        }
        if (!TextUtils.isEmpty(record.uri)) {
            Uri uri = Uri.parse(record.uri);
            if (!"file".equalsIgnoreCase(uri.getScheme())) return uri;
            String path = uri.getPath();
            if (path != null) return fileProviderUri(new File(path));
        }
        if (!TextUtils.isEmpty(record.path) && record.path.startsWith("/")) {
            return fileProviderUri(new File(record.path));
        }
        return null;
    }

    private Uri fileProviderUri(File file) {
        try {
            return FileProvider.getUriForFile(
                    getContext(), getContext().getPackageName() + ".fileprovider", file);
        } catch (Exception e) {
            return null;
        }
    }

    private static String guessMime(String fileName) {
        int dot = fileName.lastIndexOf('.');
        if (dot < 0 || dot == fileName.length() - 1) return "";
        String mime = MimeTypeMap.getSingleton()
                .getMimeTypeFromExtension(fileName.substring(dot + 1).toLowerCase(Locale.US));
        return mime == null ? "" : mime;
    }

    private void emitDownloads() {
        notifyListeners("downloadsChanged", snapshotObject(getContext()));
        ensurePolling();
    }

    /**
     * DownloadManager reports progress by polling only — it has no per-download
     * callback — so the tray runs its own tick, and ONLY while something is
     * actually in flight. An idle tray costs nothing.
     */
    private void ensurePolling() {
        if (polling || !DownloadsStore.anyRunning(getContext())) return;
        polling = true;
        poller.postDelayed(new Runnable() {
            @Override
            public void run() {
                boolean changed = DownloadsStore.refreshFromDownloadManager(getContext());
                if (changed) notifyListeners("downloadsChanged", snapshotObject(getContext()));
                if (DownloadsStore.anyRunning(getContext())) {
                    poller.postDelayed(this, POLL_MS);
                } else {
                    polling = false;
                    // One last push so the row settles on its real end state.
                    notifyListeners("downloadsChanged", snapshotObject(getContext()));
                }
            }
        }, POLL_MS);
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
                ? writeToMediaStore(url, fileName, mime, bytes)
                : writeToAppExternalDir(url, fileName, mime, bytes);
    }

    /**
     * Put a file this plugin wrote itself into the browser's downloads tray.
     *
     * These never touch DownloadManager, so without this they would be invisible
     * there — and a user who saves an NFT and then a PDF expects to find both in
     * one place, since both land in the same Downloads folder.
     */
    private void recordSaved(String url, String fileName, String mime, Uri uri, String displayPath, int bytes) {
        DownloadsStore.Record record = new DownloadsStore.Record();
        record.url = url;
        record.fileName = fileName;
        record.mimeType = mime == null ? "" : mime;
        record.path = displayPath;
        record.uri = uri == null ? null : uri.toString();
        record.state = "completed";
        record.receivedBytes = bytes;
        record.totalBytes = bytes;
        record.finishedAt = System.currentTimeMillis();
        record.host = DownloadsStore.hostOf(url);
        DownloadsStore.add(getContext(), record);
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
    private JSObject writeToMediaStore(String sourceUrl, String fileName, String mime, byte[] bytes) throws IOException {
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
        recordSaved(sourceUrl, fileName, mime, item, "Downloads/" + fileName, bytes.length);
        return ok(fileName, "Downloads/" + fileName);
    }

    /** API 26–28: app-scoped external storage, the only permission-free option. */
    private JSObject writeToAppExternalDir(String sourceUrl, String fileName, String mime, byte[] bytes) throws IOException {
        File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) throw new IOException("No storage available.");
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("No storage available.");
        File target = uniqueFile(dir, fileName);
        try (FileOutputStream out = new FileOutputStream(target)) {
            out.write(bytes);
        }
        recordSaved(sourceUrl, target.getName(), mime, null, target.getAbsolutePath(), bytes.length);
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
