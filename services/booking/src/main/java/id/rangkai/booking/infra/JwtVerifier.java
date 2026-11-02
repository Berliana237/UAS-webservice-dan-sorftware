package id.rangkai.booking.infra;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.RSAPublicKeySpec;
import java.time.Duration;
import java.util.Arrays;
import java.util.Base64;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/** Verifikasi JWT lapis kedua di dalam service. Hanya RS256 yang diterima; "alg: none" dan HS256 otomatis ditolak. */
public final class JwtVerifier {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final long JWKS_TTL_MS = 300_000;

    public record Claims(String sub, String role, Set<String> scopes, String clientId) {
        public boolean has(String scope) { return scopes.contains(scope); }
    }

    public static final class InvalidToken extends Exception {
        public InvalidToken(String m) { super(m); }
    }

    private final Mtls mtls;
    private final String jwksUrl;
    private final String issuer;
    private final String audience;
    private final Map<String, PublicKey> keys = new ConcurrentHashMap<>();
    private volatile long loadedAt;

    public JwtVerifier(Mtls mtls, String jwksUrl, String issuer, String audience) {
        this.mtls = mtls;
        this.jwksUrl = jwksUrl;
        this.issuer = issuer;
        this.audience = audience;
    }

    public Claims verify(String token) throws InvalidToken {
        String[] parts = token.split("\\.");
        if (parts.length != 3) throw new InvalidToken("format");
        try {
            JsonNode header = JSON.readTree(Base64.getUrlDecoder().decode(parts[0]));
            if (!"RS256".equals(header.path("alg").asText())) throw new InvalidToken("alg");
            PublicKey key = keyFor(header.path("kid").asText());
            if (key == null) throw new InvalidToken("kid");
            Signature s = Signature.getInstance("SHA256withRSA");
            s.initVerify(key);
            s.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
            if (!s.verify(Base64.getUrlDecoder().decode(parts[2]))) throw new InvalidToken("signature");

            JsonNode c = JSON.readTree(Base64.getUrlDecoder().decode(parts[1]));
            if (!issuer.equals(c.path("iss").asText())) throw new InvalidToken("iss");
            JsonNode aud = c.path("aud");
            boolean audOk = aud.isArray() ? aud.toString().contains("\"" + audience + "\"") : audience.equals(aud.asText());
            if (!audOk) throw new InvalidToken("aud");
            if (c.path("exp").asLong(0) * 1000 <= System.currentTimeMillis()) throw new InvalidToken("exp");
            Set<String> scopes = Arrays.stream(c.path("scope").asText("").split(" ")).filter(x -> !x.isBlank()).collect(Collectors.toSet());
            return new Claims(c.path("sub").asText(), c.path("role").asText(), scopes, c.path("client_id").asText());
        } catch (InvalidToken e) {
            throw e;
        } catch (Exception e) {
            throw new InvalidToken("malformed");
        }
    }

    private PublicKey keyFor(String kid) throws Exception {
        PublicKey key = keys.get(kid);
        if (key != null && System.currentTimeMillis() - loadedAt < JWKS_TTL_MS) return key;
        Mtls.Response r = mtls.get(jwksUrl, Duration.ofSeconds(4));
        if (r.status() == 200 && r.json() != null) {
            for (JsonNode k : r.json().path("keys")) keys.put(k.path("kid").asText(), rsa(k));
            loadedAt = System.currentTimeMillis();
        }
        return keys.get(kid);
    }

    private static PublicKey rsa(JsonNode jwk) throws GeneralSecurityException {
        BigInteger n = new BigInteger(1, Base64.getUrlDecoder().decode(jwk.path("n").asText()));
        BigInteger e = new BigInteger(1, Base64.getUrlDecoder().decode(jwk.path("e").asText()));
        return KeyFactory.getInstance("RSA").generatePublic(new RSAPublicKeySpec(n, e));
    }
}
