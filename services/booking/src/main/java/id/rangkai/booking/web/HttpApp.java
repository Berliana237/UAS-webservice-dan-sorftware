package id.rangkai.booking.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpsExchange;
import id.rangkai.booking.domain.DomainException;
import id.rangkai.booking.infra.JwtVerifier;
import id.rangkai.booking.infra.Log;
import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.naming.ldap.LdapName;
import javax.naming.ldap.Rdn;
import javax.net.ssl.SSLPeerUnverifiedException;

/** Router kecil di atas HttpsServer bawaan JDK: pencocokan rute, format error, verifikasi JWT, dan identitas mTLS. */
public final class HttpApp {
    static final ObjectMapper JSON = new ObjectMapper();
    private static final int MAX_BODY = 64 * 1024;

    @FunctionalInterface
    public interface Handler {
        void handle(Ctx ctx) throws Exception;
    }

    private record Route(String method, Pattern pattern, Handler handler) {}

    private final List<Route> routes = new ArrayList<>();
    private final JwtVerifier jwt;
    private final String instanceId;

    public HttpApp(JwtVerifier jwt, String instanceId) {
        this.jwt = jwt;
        this.instanceId = instanceId;
    }

    public void route(String method, String path, Handler handler) {
        String regex = path.replaceAll("\\{([a-zA-Z]+)\\}", "(?<$1>[^/]+)");
        routes.add(new Route(method, Pattern.compile("^" + regex + "$"), handler));
    }

    public void dispatch(HttpExchange ex) {
        long t0 = System.currentTimeMillis();
        String requestId = ex.getRequestHeaders().getFirst("X-Request-Id");
        if (requestId == null) requestId = UUID.randomUUID().toString();
        String path = ex.getRequestURI().getPath();
        Ctx ctx = new Ctx(ex, this, requestId);
        try {
            boolean pathSeen = false;
            for (Route r : routes) {
                Matcher m = r.pattern().matcher(path);
                if (!m.matches()) continue;
                pathSeen = true;
                if (!r.method().equals(ex.getRequestMethod())) continue;
                ctx.params = m;
                r.handler().handle(ctx);
                return;
            }
            if (pathSeen) throw new DomainException(405, "METHOD_NOT_ALLOWED", "Metode HTTP tidak didukung untuk rute ini.");
            throw new DomainException(404, "NOT_FOUND", "Rute tidak ditemukan.");
        } catch (DomainException e) {
            ctx.error(e.status(), e.code(), e.getMessage(), e.details());
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            ctx.error(400, "INVALID_JSON", "Body bukan JSON yang valid.", null);
        } catch (IOException e) {
            Log.info("koneksi klien terputus", "path", path);
        } catch (Exception e) {
            Log.error("kesalahan tak terduga", "path", path, "err", String.valueOf(e), "id", requestId);
            ctx.error(500, "INTERNAL_ERROR", "Terjadi kesalahan pada server.", null);
        } finally {
            if (!path.equals("/health")) Log.info("req", "id", requestId, "m", ex.getRequestMethod(), "p", path, "s", ctx.sent, "ms", System.currentTimeMillis() - t0);
            ex.close();
        }
    }

    /** Konteks satu request. */
    public static final class Ctx {
        final HttpExchange ex;
        private final HttpApp app;
        final String requestId;
        Matcher params;
        int sent;
        private byte[] rawBody;

        Ctx(HttpExchange ex, HttpApp app, String requestId) {
            this.ex = ex;
            this.app = app;
            this.requestId = requestId;
        }

        public String param(String name) {
            return URLDecoder.decode(params.group(name), StandardCharsets.UTF_8);
        }

        public Map<String, String> query() {
            Map<String, String> out = new HashMap<>();
            String q = ex.getRequestURI().getRawQuery();
            if (q == null) return out;
            for (String pair : q.split("&")) {
                int i = pair.indexOf('=');
                if (i > 0) out.put(URLDecoder.decode(pair.substring(0, i), StandardCharsets.UTF_8), URLDecoder.decode(pair.substring(i + 1), StandardCharsets.UTF_8));
            }
            return out;
        }

        public String header(String name) {
            return ex.getRequestHeaders().getFirst(name);
        }

        public byte[] rawBody() throws IOException {
            if (rawBody == null) {
                rawBody = ex.getRequestBody().readNBytes(MAX_BODY + 1);
                if (rawBody.length > MAX_BODY) throw new DomainException(413, "PAYLOAD_TOO_LARGE", "Body terlalu besar.");
            }
            return rawBody;
        }

        public JsonNode body() throws IOException {
            byte[] raw = rawBody();
            if (raw.length == 0) throw new DomainException(400, "INVALID_JSON", "Body wajib diisi.");
            return JSON.readTree(raw);
        }

        /** Verifikasi lapis kedua: gateway sudah memeriksa, service tetap memeriksa lagi. */
        public JwtVerifier.Claims user(String... scopes) {
            String h = header("Authorization");
            if (h == null || !h.startsWith("Bearer ")) throw new DomainException(401, "UNAUTHENTICATED", "Token akses diperlukan.");
            JwtVerifier.Claims c;
            try {
                c = app.jwt.verify(h.substring(7));
            } catch (JwtVerifier.InvalidToken e) {
                throw new DomainException(401, "INVALID_TOKEN", "Token tidak valid atau sudah kedaluwarsa.");
            }
            for (String s : scopes) {
                if (!c.has(s)) throw new DomainException(403, "INSUFFICIENT_SCOPE", "Hak akses tidak mencukupi.", Map.of("required", List.of(scopes)));
            }
            return c;
        }

        /** Nama service pemanggil dari sertifikat mTLS. */
        public String peerService() {
            try {
                var certs = ((HttpsExchange) ex).getSSLSession().getPeerCertificates();
                String dn = ((X509Certificate) certs[0]).getSubjectX500Principal().getName();
                for (Rdn rdn : new LdapName(dn).getRdns()) if ("CN".equalsIgnoreCase(rdn.getType())) return rdn.getValue().toString();
            } catch (SSLPeerUnverifiedException | javax.naming.InvalidNameException | ClassCastException e) {
                return null;
            }
            return null;
        }

        public void requireService(String... allowed) {
            String peer = peerService();
            for (String a : allowed) if (a.equals(peer)) return;
            throw new DomainException(403, "SERVICE_NOT_ALLOWED", "Service \"" + peer + "\" tidak diizinkan memanggil endpoint ini.");
        }

        public void json(int status, Object body) throws IOException {
            byte[] bytes = JSON.writeValueAsBytes(body);
            ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
            ex.getResponseHeaders().set("X-Request-Id", requestId);
            ex.getResponseHeaders().set("X-Instance-Id", app.instanceId);
            ex.getResponseHeaders().set("Cache-Control", "no-store");
            ex.sendResponseHeaders(status, bytes.length == 0 ? -1 : bytes.length);
            sent = status;
            if (bytes.length > 0) ex.getResponseBody().write(bytes);
        }

        public void raw(int status, String json, boolean replay) throws IOException {
            if (replay) ex.getResponseHeaders().set("Idempotent-Replay", "true");
            byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
            ex.getResponseHeaders().set("X-Request-Id", requestId);
            ex.getResponseHeaders().set("X-Instance-Id", app.instanceId);
            ex.sendResponseHeaders(status, bytes.length);
            sent = status;
            ex.getResponseBody().write(bytes);
        }

        void error(int status, String code, String message, Object details) {
            Map<String, Object> err = new LinkedHashMap<>();
            err.put("code", code);
            err.put("message", message);
            if (details != null) err.put("details", details);
            try {
                json(status, Map.of("error", err, "requestId", requestId));
            } catch (IOException e) {
                Log.info("gagal mengirim error", "code", code);
            }
        }
    }
}
