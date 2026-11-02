package id.rangkai.booking.infra;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Duration;
import java.util.Base64;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;

/** Konteks TLS dua arah dari sertifikat service, dipakai untuk server maupun klien internal. */
public final class Mtls {
    private static final ObjectMapper JSON = new ObjectMapper();
    private final SSLContext context;
    private final HttpClient client;

    public Mtls(Path certDir, String name) {
        try {
            char[] pass = "x".toCharArray();
            CertificateFactory cf = CertificateFactory.getInstance("X.509");
            Certificate cert = cf.generateCertificate(new ByteArrayInputStream(Files.readAllBytes(certDir.resolve(name + ".crt"))));
            Certificate ca = cf.generateCertificate(new ByteArrayInputStream(Files.readAllBytes(certDir.resolve("ca.crt"))));
            String pem = Files.readString(certDir.resolve(name + ".key")).replaceAll("-----[A-Z ]+-----", "").replaceAll("\\s", "");
            PrivateKey key = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(pem)));

            KeyStore ks = KeyStore.getInstance(KeyStore.getDefaultType());
            ks.load(null, null);
            ks.setKeyEntry(name, key, pass, new Certificate[] {cert, ca});
            KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
            kmf.init(ks, pass);

            KeyStore ts = KeyStore.getInstance(KeyStore.getDefaultType());
            ts.load(null, null);
            ts.setCertificateEntry("ca", ca);
            TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
            tmf.init(ts);

            context = SSLContext.getInstance("TLS");
            context.init(kmf.getKeyManagers(), tmf.getTrustManagers(), null);
            client = HttpClient.newBuilder().sslContext(context).version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(3)).build();
        } catch (IOException | GeneralSecurityException e) {
            throw new IllegalStateException("Gagal memuat sertifikat mTLS: " + e.getMessage(), e);
        }
    }

    public SSLContext context() {
        return context;
    }

    public record Response(int status, JsonNode json) {}

    public Response get(String url, Duration timeout) throws IOException, InterruptedException {
        return send(HttpRequest.newBuilder(URI.create(url)).timeout(timeout).GET().build());
    }

    public Response post(String url, Object body, Duration timeout) throws IOException, InterruptedException {
        String payload = JSON.writeValueAsString(body);
        return send(HttpRequest.newBuilder(URI.create(url)).timeout(timeout).header("content-type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(payload)).build());
    }

    private Response send(HttpRequest req) throws IOException, InterruptedException {
        HttpResponse<String> res = client.send(req, HttpResponse.BodyHandlers.ofString());
        JsonNode node = null;
        try {
            node = res.body() == null || res.body().isBlank() ? null : JSON.readTree(res.body());
        } catch (IOException ignored) {
            /* respons bukan JSON */
        }
        return new Response(res.statusCode(), node);
    }
}
