package id.rangkai.booking;

import java.nio.file.Path;
import java.util.Map;

/** Konfigurasi dari environment. Nilai default mengikuti skema port di services/shared/config.js. */
public record Config(String instanceId, int port, int lockTtlSeconds, Path dataDir, Path certDir, String registryUrl, String brokerUrl, String authUrl, String piiKey, String advertiseHost, String bindHost) {

    public static Config fromEnv(Map<String, String> env) {
        int offset = Integer.parseInt(env.getOrDefault("PORT_OFFSET", "0"));
        return new Config(
            env.getOrDefault("INSTANCE_ID", "booking-a"),
            Integer.parseInt(env.getOrDefault("BOOKING_PORT", String.valueOf(8781 + offset))),
            Integer.parseInt(env.getOrDefault("LOCK_TTL_SECONDS", "600")),
            Path.of(env.getOrDefault("DATA_DIR", "data")),
            Path.of(env.getOrDefault("CERT_DIR", "certs")),
            // 127.0.0.1, bukan localhost: lihat catatan hostOf di services/shared/config.js.
            "https://" + env.getOrDefault("REGISTRY_HOST", "127.0.0.1") + ":" + (8761 + offset),
            "https://" + env.getOrDefault("BROKER_HOST", "127.0.0.1") + ":" + (8770 + offset),
            "https://" + env.getOrDefault("AUTH_HOST", "127.0.0.1") + ":" + (8771 + offset),
            env.get("PII_KEY_BASE64"),
            env.getOrDefault("BOOKING_HOST", "127.0.0.1"),
            env.getOrDefault("BIND_HOST", "127.0.0.1"));
    }
}
