package id.rangkai.booking.infra;

import com.fasterxml.jackson.databind.JsonNode;
import id.rangkai.booking.Config;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/** Klien service discovery: mendaftar dengan heartbeat, dan mencari alamat service lain secara round robin. */
public final class Discovery {
    private static final long CACHE_MS = 2000;

    private record Entry(List<String> urls, long at) {}

    private final Mtls mtls;
    private final Config cfg;
    private final Map<String, Entry> cache = new ConcurrentHashMap<>();
    private final AtomicInteger cursor = new AtomicInteger();

    public Discovery(Mtls mtls, Config cfg) {
        this.mtls = mtls;
        this.cfg = cfg;
    }

    public void startHeartbeat() {
        Thread.ofVirtual().name("heartbeat").start(() -> {
            Map<String, Object> body = Map.of("name", "booking", "instanceId", cfg.instanceId(), "url", "https://" + cfg.advertiseHost() + ":" + cfg.port(),
                "meta", Map.of("role", "seat-locking", "lang", "java"));
            while (!Thread.currentThread().isInterrupted()) {
                try {
                    mtls.post(cfg.registryUrl() + "/register", body, Duration.ofSeconds(3));
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } catch (Exception e) {
                    Log.warn("registry belum bisa dihubungi", "err", String.valueOf(e.getMessage()));
                }
                sleep(4000);
            }
        });
    }

    public String urlOf(String service) throws Exception {
        Entry hit = cache.get(service);
        if (hit == null || System.currentTimeMillis() - hit.at() > CACHE_MS) {
            Mtls.Response r = mtls.get(cfg.registryUrl() + "/services/" + service, Duration.ofSeconds(3));
            List<String> urls = new ArrayList<>();
            for (JsonNode i : r.json().path("instances")) urls.add(i.path("url").asText());
            hit = new Entry(urls, System.currentTimeMillis());
            cache.put(service, hit);
        }
        if (hit.urls().isEmpty()) throw new IllegalStateException("tidak ada instance " + service);
        return hit.urls().get(Math.floorMod(cursor.getAndIncrement(), hit.urls().size()));
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }
}
