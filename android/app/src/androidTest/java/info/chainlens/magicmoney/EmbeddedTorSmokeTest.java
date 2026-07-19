package info.chainlens.magicmoney;

import static org.junit.Assert.assertTrue;

import android.content.Context;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.torproject.arti.ArtiProxy;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.HttpsURLConnection;

/** Real-device smoke test for the bundled Tor runtime. */
@RunWith(AndroidJUnit4.class)
public class EmbeddedTorSmokeTest {

    @Test(timeout = 180_000)
    public void embeddedArtiReachesVerifiedTorExit() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        CountDownLatch bootstrapped = new CountDownLatch(1);
        ExecutorService worker = Executors.newSingleThreadExecutor();
        ArtiProxy proxy = ArtiProxy.Builder(context)
                .setSocksPort(19250)
                .setDnsPort(19251)
                .setLogListener(line -> {
                    if (line != null && line.contains("Sufficiently bootstrapped")) {
                        bootstrapped.countDown();
                    }
                })
                .build();

        try {
            worker.execute(proxy::start);
            assertTrue("Embedded Tor did not bootstrap within 120 seconds",
                    bootstrapped.await(120, TimeUnit.SECONDS));
            assertTrue("Tor Project did not verify the embedded Tor exit",
                    verifyTorExit(19250));
        } finally {
            try { proxy.stop(); } catch (Throwable ignored) { }
            worker.shutdownNow();
        }
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
