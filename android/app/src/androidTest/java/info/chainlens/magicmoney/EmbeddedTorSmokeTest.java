package info.chainlens.magicmoney;

import static org.junit.Assert.assertTrue;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;
import android.util.Log;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.torproject.jni.TorService;

import java.io.BufferedReader;
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
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import javax.net.ssl.HttpsURLConnection;

/** Real-device smoke test for the bundled Tor runtime. */
@RunWith(AndroidJUnit4.class)
public class EmbeddedTorSmokeTest {
    private static final String TAG = "EmbeddedTorSmokeTest";

    @Test(timeout = 180_000)
    public void embeddedTorReachesExitAndOnionService() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        CountDownLatch serviceConnected = new CountDownLatch(1);
        AtomicReference<TorService> serviceRef = new AtomicReference<>();
        ServiceConnection connection = new ServiceConnection() {
            @Override
            public void onServiceConnected(ComponentName name, IBinder binder) {
                serviceRef.set(((TorService.LocalBinder) binder).getService());
                serviceConnected.countDown();
            }

            @Override
            public void onServiceDisconnected(ComponentName name) {
                serviceRef.set(null);
            }
        };

        Intent serviceIntent = new Intent(context, TorService.class);
        assertTrue("Embedded Tor service could not be bound",
                context.bindService(serviceIntent, connection, Context.BIND_AUTO_CREATE));

        try {
            assertTrue("Embedded Tor service did not connect",
                    serviceConnected.await(15, TimeUnit.SECONDS));

            int port = -1;
            long deadline = System.currentTimeMillis() + 120_000;
            while (System.currentTimeMillis() < deadline) {
                TorService service = serviceRef.get();
                port = service == null ? -1 : service.getSocksPort();
                if (port > 0 && verifyTorExit(port)) break;
                TimeUnit.SECONDS.sleep(2);
            }

            assertTrue("Embedded Tor did not expose a SOCKS port", port > 0);
            assertTrue("Tor Project did not verify the embedded Tor exit",
                    verifyTorExit(port));
            assertTrue("Embedded Tor could not open a v3 onion service",
                    verifyOnionService(port));
        } finally {
            try { context.unbindService(connection); } catch (Throwable ignored) { }
            try { context.stopService(serviceIntent); } catch (Throwable ignored) { }
        }
    }

    private boolean verifyOnionService(int port) {
        String host = "xao2lxsmia2edq2n5zxg6uahx6xox2t7bfjw6b5vdzsxi7ezmqob6qid.onion";
        // Perform the SOCKS5 handshake explicitly. Android's URLConnection can leave
        // a proxy handshake blocked past its configured connect timeout.
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress("127.0.0.1", port), 10_000);
            socket.setSoTimeout(60_000);
            InputStream input = socket.getInputStream();
            OutputStream output = socket.getOutputStream();

            output.write(new byte[]{0x05, 0x01, 0x00});
            output.flush();
            if (readRequired(input) != 0x05 || readRequired(input) != 0x00) {
                throw new IOException("SOCKS5 authentication negotiation failed");
            }

            byte[] hostname = host.getBytes(StandardCharsets.US_ASCII);
            ByteArrayOutputStream request = new ByteArrayOutputStream();
            request.write(new byte[]{0x05, 0x01, 0x00, 0x03, (byte) hostname.length});
            request.write(hostname);
            request.write(new byte[]{0x00, 0x50}); // port 80; onions are encrypted by Tor itself
            output.write(request.toByteArray());
            output.flush();

            if (readRequired(input) != 0x05) throw new IOException("Invalid SOCKS5 reply");
            int reply = readRequired(input);
            readRequired(input); // reserved
            int addressType = readRequired(input);
            if (reply != 0x00) throw new IOException("SOCKS5 onion connect failed: " + reply);
            int addressLength;
            if (addressType == 0x01) addressLength = 4;
            else if (addressType == 0x04) addressLength = 16;
            else if (addressType == 0x03) addressLength = readRequired(input);
            else throw new IOException("Unknown SOCKS5 address type: " + addressType);
            for (int i = 0; i < addressLength + 2; i++) readRequired(input);

            output.write(("GET / HTTP/1.1\r\nHost: " + host
                    + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            output.flush();
            BufferedReader reader = new BufferedReader(new InputStreamReader(
                    input, StandardCharsets.US_ASCII));
            String statusLine = reader.readLine();
            String location = null;
            String header;
            while ((header = reader.readLine()) != null && !header.isEmpty()) {
                if (header.regionMatches(true, 0, "Location:", 0, 9)) {
                    location = header.substring(9).trim();
                }
            }
            Log.i(TAG, "Tor Project onion response: " + statusLine
                    + (location == null ? "" : "; Location: " + location));
            return statusLine != null && statusLine.startsWith("HTTP/");
        } catch (Exception error) {
            Log.e(TAG, "Tor Project onion request failed", error);
            return false;
        }
    }

    private int readRequired(InputStream input) throws IOException {
        int value = input.read();
        if (value < 0) throw new IOException("Unexpected end of SOCKS5 response");
        return value;
    }

    private boolean verifyTorExit(int port) {
        HttpsURLConnection connection = null;
        try {
            Proxy proxy = new Proxy(Proxy.Type.SOCKS,
                    InetSocketAddress.createUnresolved("127.0.0.1", port));
            connection = (HttpsURLConnection) new URL("https://check.torproject.org/api/ip")
                    .openConnection(proxy);
            connection.setConnectTimeout(30_000);
            connection.setReadTimeout(30_000);
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
}
