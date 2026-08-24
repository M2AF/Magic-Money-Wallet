package info.chainlens.magicmoney;

import android.app.DownloadManager;
import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.text.TextUtils;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * DownloadsStore — the Android half of the browser's downloads tray.
 *
 * The desktop equivalent is src/main/downloads-manager.ts, and the JSON it hands
 * to the WebView is the SAME contract (src/shared/downloads-wire.ts), because one
 * React panel renders both. Anything added to a record here has to be added
 * there too.
 *
 * Why a store of our own rather than just querying DownloadManager:
 *   • DownloadManager forgets a download once the user clears the system
 *     notification tray, and it never knew about the files this app writes
 *     itself (NFT artwork through MediaStore). A tray that loses half its rows
 *     is not a tray.
 *   • DownloadManager cannot be asked "what did this app download", only "what
 *     is in my queue right now".
 * So DownloadManager stays the transport for browser downloads and this file is
 * the memory; live byte counts are refreshed from it on every read.
 *
 * Static and synchronized because two plugins write to it — DappBrowserPlugin
 * (links in a dApp tab) and DownloaderPlugin (NFT media) — and Capacitor gives
 * each its own instance.
 */
public final class DownloadsStore {

    /** Matches downloads-wire.ts. Extra native-only fields never reach the WebView. */
    public static final class Record {
        public String id;
        public String url = "";
        public String fileName = "download";
        /** Display location ("Downloads/photo.png") or an absolute path. */
        public String path;
        public String mimeType = "";
        public String state = "progressing";
        public long receivedBytes;
        public long totalBytes;
        public long startedAt;
        public long finishedAt = -1;
        public String host = "";
        public String error;

        // ── Native only ──────────────────────────────────────────────────────
        /** DownloadManager row id for browser downloads; -1 for our own writes. */
        public long dmId = -1;
        /** content:// (MediaStore or DownloadManager) or file:// for API 26-28. */
        public String uri;
    }

    private static final int MAX_RECORDS = 300;
    private static final int MAX_URL_CHARS = 2048;
    private static final Object LOCK = new Object();
    private static List<Record> cache;

    /** Set by DownloaderPlugin so tray changes can be pushed to the WebView. */
    public interface ChangeListener { void onDownloadsChanged(); }
    private static volatile ChangeListener listener;

    private DownloadsStore() { }

    public static void setChangeListener(ChangeListener l) { listener = l; }

    public static void notifyChanged() {
        ChangeListener l = listener;
        if (l != null) {
            try { l.onDownloadsChanged(); } catch (Exception ignored) { }
        }
    }

    // ── Persistence ─────────────────────────────────────────────────────────

    private static File storeFile(Context context) {
        File dir = new File(context.getFilesDir(), "browser");
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, "downloads.json");
    }

    private static List<Record> load(Context context) {
        synchronized (LOCK) {
            if (cache != null) return cache;
            List<Record> out = new ArrayList<>();
            try {
                File file = storeFile(context);
                if (file.isFile()) {
                    JSONArray parsed = new JSONArray(readText(file));
                    for (int i = 0; i < parsed.length() && out.size() < MAX_RECORDS; i++) {
                        Record r = fromJson(parsed.optJSONObject(i));
                        if (r != null) out.add(r);
                    }
                }
            } catch (Exception e) {
                // Corrupt store: start empty rather than wedging the browser.
                out.clear();
            }
            cache = out;
            return cache;
        }
    }

    private static void persist(Context context) {
        synchronized (LOCK) {
            if (cache == null) return;
            JSONArray array = new JSONArray();
            for (Record r : cache) array.put(toJsonInternal(r));
            try (FileOutputStream out = new FileOutputStream(storeFile(context))) {
                out.write(array.toString().getBytes(StandardCharsets.UTF_8));
            } catch (IOException e) {
                // A tray that cannot write its history is still usable this session.
            }
        }
    }

    private static String readText(File file) throws IOException {
        try (InputStream in = new java.io.FileInputStream(file)) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = in.read(chunk)) != -1) buffer.write(chunk, 0, read);
            return buffer.toString("UTF-8");
        }
    }

    // ── Mutations ───────────────────────────────────────────────────────────

    /** Newest-first insert. Returns the record so the caller can keep its id. */
    public static Record add(Context context, Record record) {
        synchronized (LOCK) {
            List<Record> list = load(context);
            if (TextUtils.isEmpty(record.id)) record.id = UUID.randomUUID().toString();
            if (record.startedAt <= 0) record.startedAt = System.currentTimeMillis();
            if (TextUtils.isEmpty(record.host)) record.host = hostOf(record.url);
            // Fully on-chain NFT art arrives as a multi-megabyte data: URL.
            // Keeping it would put the whole image in this JSON file on every
            // save; nothing needs it (Retry is http(s)-only).
            if (record.url != null && record.url.length() > MAX_URL_CHARS) {
                record.url = record.url.startsWith("data:")
                        ? "data:"
                        : record.url.substring(0, MAX_URL_CHARS);
            }
            list.add(0, record);
            // Trim finished rows only — dropping a running one would orphan its
            // DownloadManager id and leave a download nothing is watching.
            while (list.size() > MAX_RECORDS) {
                int victim = -1;
                for (int i = list.size() - 1; i >= 0; i--) {
                    if (!isRunning(list.get(i))) { victim = i; break; }
                }
                if (victim < 0) break;
                list.remove(victim);
            }
            persist(context);
        }
        notifyChanged();
        return record;
    }

    public static Record find(Context context, String id) {
        synchronized (LOCK) {
            for (Record r : load(context)) if (r.id.equals(id)) return r;
            return null;
        }
    }

    public static void save(Context context) {
        persist(context);
        notifyChanged();
    }

    public static void remove(Context context, String id) {
        synchronized (LOCK) {
            Iterator<Record> it = load(context).iterator();
            while (it.hasNext()) if (it.next().id.equals(id)) it.remove();
            persist(context);
        }
        notifyChanged();
    }

    /** Clear the finished rows; anything still downloading keeps its place. */
    public static void clearFinished(Context context) {
        synchronized (LOCK) {
            Iterator<Record> it = load(context).iterator();
            while (it.hasNext()) if (!isRunning(it.next())) it.remove();
            persist(context);
        }
        notifyChanged();
    }

    public static boolean anyRunning(Context context) {
        synchronized (LOCK) {
            for (Record r : load(context)) if (isRunning(r)) return true;
            return false;
        }
    }

    private static boolean isRunning(Record r) {
        return "progressing".equals(r.state) || "paused".equals(r.state);
    }

    // ── Live refresh from DownloadManager ───────────────────────────────────

    /**
     * Pull byte counts and end states for every row still believed to be running.
     * Called before each read, so the panel never has to trust a stale snapshot,
     * and by the poller so pushes carry real numbers.
     *
     * Returns true when anything actually changed — the poller uses that to
     * avoid emitting identical snapshots at 1.4 Hz.
     */
    public static boolean refreshFromDownloadManager(Context context) {
        DownloadManager dm = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null) return false;

        List<Long> ids = new ArrayList<>();
        synchronized (LOCK) {
            for (Record r : load(context)) if (isRunning(r) && r.dmId >= 0) ids.add(r.dmId);
        }
        if (ids.isEmpty()) return false;

        long[] filter = new long[ids.size()];
        for (int i = 0; i < ids.size(); i++) filter[i] = ids.get(i);

        boolean changed = false;
        DownloadManager.Query query = new DownloadManager.Query().setFilterById(filter);
        Cursor cursor = null;
        List<Long> seen = new ArrayList<>();
        try {
            cursor = dm.query(query);
            while (cursor != null && cursor.moveToNext()) {
                long dmId = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_ID));
                seen.add(dmId);
                int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                long soFar = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                String localUri = cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI));
                int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));

                synchronized (LOCK) {
                    for (Record r : load(context)) {
                        if (r.dmId != dmId) continue;
                        changed = true;
                        r.receivedBytes = Math.max(0, soFar);
                        // A missing Content-Length arrives as -1; the panel reads
                        // 0 as "unknown size" and sweeps instead of faking a %.
                        r.totalBytes = total > 0 ? total : 0;
                        if (!TextUtils.isEmpty(localUri)) {
                            r.uri = localUri;
                            String name = fileNameFromUri(localUri);
                            if (!TextUtils.isEmpty(name)) r.fileName = name;
                            r.path = displayPathFor(localUri, r.fileName);
                        }
                        if (status == DownloadManager.STATUS_SUCCESSFUL) {
                            r.state = "completed";
                            r.finishedAt = System.currentTimeMillis();
                            if (r.totalBytes <= 0) r.totalBytes = r.receivedBytes;
                        } else if (status == DownloadManager.STATUS_FAILED) {
                            r.state = "interrupted";
                            r.finishedAt = System.currentTimeMillis();
                            r.error = "The download failed (" + reason + ")";
                        } else if (status == DownloadManager.STATUS_PAUSED) {
                            // DownloadManager pauses on its own (no network, waiting
                            // to retry). The panel shows it, but offers no Resume:
                            // there is no public API to drive it.
                            r.state = "paused";
                        } else {
                            r.state = "progressing";
                        }
                    }
                }
            }
        } catch (Exception e) {
            return changed;
        } finally {
            if (cursor != null) cursor.close();
        }

        // A row DownloadManager no longer knows about was cleared out from under
        // us (system tray cleared, or the user removed it there). Leaving it as
        // "progressing" would spin a bar forever.
        synchronized (LOCK) {
            for (Record r : load(context)) {
                if (isRunning(r) && r.dmId >= 0 && !seen.contains(r.dmId)) {
                    r.state = "interrupted";
                    r.error = "The download was cancelled outside the app";
                    r.finishedAt = System.currentTimeMillis();
                    changed = true;
                }
            }
        }
        if (changed) persist(context);
        return changed;
    }

    // ── Serialization ───────────────────────────────────────────────────────

    /**
     * The wire snapshot. `exists` is computed here rather than stored, so a file
     * the user deleted in the Files app greys out its Open button on the next
     * read instead of failing on click.
     */
    public static JSONArray toWireArray(Context context) {
        JSONArray array = new JSONArray();
        synchronized (LOCK) {
            for (Record r : load(context)) {
                try {
                    JSONObject o = new JSONObject();
                    o.put("id", r.id);
                    o.put("url", r.url == null ? "" : r.url);
                    o.put("fileName", r.fileName);
                    o.put("path", r.path == null ? JSONObject.NULL : r.path);
                    o.put("mimeType", r.mimeType == null ? "" : r.mimeType);
                    o.put("state", r.state);
                    o.put("receivedBytes", r.receivedBytes);
                    o.put("totalBytes", r.totalBytes);
                    o.put("startedAt", r.startedAt);
                    o.put("finishedAt", r.finishedAt > 0 ? r.finishedAt : JSONObject.NULL);
                    o.put("exists", fileExists(context, r));
                    // DownloadManager exposes no pause/resume control at all.
                    o.put("canResume", false);
                    o.put("host", r.host == null ? "" : r.host);
                    if (!TextUtils.isEmpty(r.error)) o.put("error", r.error);
                    array.put(o);
                } catch (JSONException ignored) { }
            }
        }
        return array;
    }

    private static JSONObject toJsonInternal(Record r) {
        JSONObject o = new JSONObject();
        try {
            o.put("id", r.id);
            o.put("url", r.url);
            o.put("fileName", r.fileName);
            o.put("path", r.path);
            o.put("mimeType", r.mimeType);
            o.put("state", r.state);
            o.put("receivedBytes", r.receivedBytes);
            o.put("totalBytes", r.totalBytes);
            o.put("startedAt", r.startedAt);
            o.put("finishedAt", r.finishedAt);
            o.put("host", r.host);
            o.put("error", r.error);
            o.put("dmId", r.dmId);
            o.put("uri", r.uri);
        } catch (JSONException ignored) { }
        return o;
    }

    private static Record fromJson(JSONObject o) {
        if (o == null) return null;
        String fileName = o.optString("fileName", "");
        if (TextUtils.isEmpty(fileName)) return null;
        Record r = new Record();
        r.id = o.optString("id", UUID.randomUUID().toString());
        r.url = o.optString("url", "");
        r.fileName = fileName;
        r.path = o.isNull("path") ? null : o.optString("path", null);
        r.mimeType = o.optString("mimeType", "");
        String state = o.optString("state", "interrupted");
        // A process restart ends any in-flight download that DownloadManager is
        // not still tracking; refreshFromDownloadManager revives the ones it is.
        r.state = state;
        r.receivedBytes = o.optLong("receivedBytes", 0);
        r.totalBytes = o.optLong("totalBytes", 0);
        r.startedAt = o.optLong("startedAt", System.currentTimeMillis());
        r.finishedAt = o.optLong("finishedAt", -1);
        r.host = o.optString("host", "");
        r.error = o.isNull("error") ? null : o.optString("error", null);
        r.dmId = o.optLong("dmId", -1);
        r.uri = o.isNull("uri") ? null : o.optString("uri", null);
        return r;
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    /**
     * Existence is checked through whichever handle the file was saved with:
     * a MediaStore/DownloadManager content URI, then the raw path. Scoped
     * storage (API 29+) makes the path check unreliable on its own, and the
     * content URI stops resolving once DownloadManager forgets the row, so
     * neither alone is enough.
     */
    public static boolean fileExists(Context context, Record r) {
        // Only a finished download can have a file to find, and this runs for
        // every row on every read — opening a content stream per in-flight or
        // failed row would be pure waste on a phone.
        if (!"completed".equals(r.state)) return false;
        if (!TextUtils.isEmpty(r.uri)) {
            Uri uri = Uri.parse(r.uri);
            if ("file".equalsIgnoreCase(uri.getScheme())) {
                String p = uri.getPath();
                if (p != null && new File(p).isFile()) return true;
            } else {
                ContentResolver resolver = context.getContentResolver();
                try (java.io.InputStream probe = resolver.openInputStream(uri)) {
                    if (probe != null) return true;
                } catch (Exception ignored) { }
            }
        }
        if (!TextUtils.isEmpty(r.path) && r.path.startsWith("/")) {
            return new File(r.path).isFile();
        }
        return false;
    }

    public static String hostOf(String url) {
        try {
            if (TextUtils.isEmpty(url)) return "";
            if (url.startsWith("data:")) return "data:";
            String host = Uri.parse(url).getHost();
            if (host == null) return "";
            return host.startsWith("www.") ? host.substring(4) : host;
        } catch (Exception e) {
            return "";
        }
    }

    public static String fileNameFromUri(String uri) {
        try {
            String path = Uri.parse(uri).getPath();
            if (path == null) return null;
            int slash = path.lastIndexOf('/');
            return slash >= 0 ? path.substring(slash + 1) : path;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * What the row shows under the file name. A raw
     * "/storage/emulated/0/Download/x.pdf" means nothing to a phone user, so
     * anything inside the public Downloads folder is shown as "Downloads/x.pdf"
     * — the same wording the system Files app uses.
     */
    public static String displayPathFor(String uri, String fileName) {
        try {
            String path = Uri.parse(uri).getPath();
            if (path != null && path.toLowerCase(Locale.US).contains("/download")) {
                return "Downloads/" + fileName;
            }
            return path != null ? path : fileName;
        } catch (Exception e) {
            return fileName;
        }
    }

    // ── Starting a browser download ─────────────────────────────────────────

    /** Outcome of enqueueBrowserDownload — exactly one of the two fields is set. */
    public static final class EnqueueResult {
        public Record record;
        public String error;
        static EnqueueResult failed(String message) {
            EnqueueResult r = new EnqueueResult();
            r.error = message;
            return r;
        }
    }

    /**
     * Hand a URL to Android's DownloadManager and record it, so a browser
     * download and a retry of one can never take different code paths.
     *
     * REFUSED WHILE TOR MODE IS ON. DownloadManager is a separate system process
     * that does NOT use this app's WebView proxy, so letting it run would send a
     * direct, de-anonymized request — exactly the leak Tor Mode's fail-closed
     * design exists to prevent. The check lives HERE rather than at each call
     * site so a future caller cannot forget it.
     */
    public static EnqueueResult enqueueBrowserDownload(Context context, String url,
                                                       String fileName, String referer) {
        if (DappBrowserPlugin.isTorModeActive()) {
            return EnqueueResult.failed("Downloads are blocked while Tor Mode is on - they would bypass Tor");
        }
        if (TextUtils.isEmpty(url)) return EnqueueResult.failed("This item cannot be downloaded");
        String lower = url.toLowerCase(Locale.US);
        if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
            return EnqueueResult.failed("This item cannot be downloaded");
        }

        DownloadManager dm = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null) return EnqueueResult.failed("Downloads are unavailable on this device");

        String name = TextUtils.isEmpty(fileName) ? "download" : fileName;
        try {
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            req.setTitle(name);
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            // Carry the page's cookies so login-gated media saves correctly.
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) req.addRequestHeader("Cookie", cookie);
            if (!TextUtils.isEmpty(referer)) req.addRequestHeader("Referer", referer);

            long dmId = dm.enqueue(req);

            Record record = new Record();
            record.url = url;
            record.fileName = name;
            record.path = "Downloads/" + name;
            record.state = "progressing";
            record.dmId = dmId;
            record.host = hostOf(url);
            EnqueueResult ok = new EnqueueResult();
            ok.record = add(context, record);
            return ok;
        } catch (Exception e) {
            return EnqueueResult.failed("Could not start the download");
        }
    }
}
