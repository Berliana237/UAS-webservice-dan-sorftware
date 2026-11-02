package id.rangkai.booking.infra;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import id.rangkai.booking.Config;
import id.rangkai.booking.service.BookingService;
import java.time.Duration;
import java.util.Map;

/** Pekerjaan latar: relay outbox ke broker, konsumen event, dan sweeper TTL. Semuanya aman berjalan di banyak instance. */
public final class Workers {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String QUEUE = "booking.events";

    private final Db db;
    private final Mtls mtls;
    private final Config cfg;
    private final BookingService bookings;

    public Workers(Db db, Mtls mtls, Config cfg, BookingService bookings) {
        this.db = db;
        this.mtls = mtls;
        this.cfg = cfg;
        this.bookings = bookings;
    }

    public void start() {
        loop("outbox-relay", 150, this::relayOutbox);
        loop("ttl-sweeper", 1000, bookings::sweep);
        loop("consumer", 50, this::consumeOnce);
    }

    private void loop(String name, long pauseMs, Runnable work) {
        Thread.ofPlatform().daemon().name(name).start(() -> {
            while (!Thread.currentThread().isInterrupted()) {
                try {
                    work.run();
                } catch (RuntimeException e) {
                    Log.warn(name + " gagal, dicoba lagi", "err", String.valueOf(e.getMessage()));
                    sleep(800);
                }
                sleep(pauseMs);
            }
        });
    }

    private void relayOutbox() {
        var pending = db.list("SELECT * FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 50");
        for (var row : pending) {
            try {
                Map<String, Object> msg = Map.of("id", Db.str(row, "id"), "topic", Db.str(row, "topic"),
                    "key", row.get("msg_key") == null ? "" : row.get("msg_key"), "payload", JSON.readTree(Db.str(row, "payload")));
                Mtls.Response r = mtls.post(cfg.brokerUrl() + "/publish", msg, Duration.ofSeconds(4));
                if (r.status() >= 300) throw new IllegalStateException("broker status " + r.status());
                db.update("UPDATE outbox SET published_at=? WHERE id=?", System.currentTimeMillis(), Db.str(row, "id"));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            } catch (Exception e) {
                // Broker mati: event tetap aman di outbox dan dikirim lagi nanti.
                throw new IllegalStateException(e.getMessage(), e);
            }
        }
    }

    private void consumeOnce() {
        try {
            Mtls.Response r = mtls.post(cfg.brokerUrl() + "/consume",
                Map.of("queue", QUEUE, "consumer", cfg.instanceId(), "max", 10, "waitMs", 4000), Duration.ofSeconds(9));
            if (r.status() != 200 || r.json() == null) return;
            for (JsonNode m : r.json().path("messages")) handle(m);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (java.io.IOException e) {
            throw new IllegalStateException(e.getMessage(), e);
        }
    }

    private void handle(JsonNode m) throws java.io.IOException, InterruptedException {
        String lease = m.path("leaseToken").asText();
        try {
            String id = m.path("id").asText();
            db.run(() -> {
                // Konsumen idempotent: pesan yang sama tidak diproses dua kali.
                if (db.update("INSERT OR IGNORE INTO processed_messages(msg_id,at) VALUES(?,?)", id, System.currentTimeMillis()) == 0) return null;
                dispatch(m.path("topic").asText(), m.path("payload"));
                return null;
            });
            mtls.post(cfg.brokerUrl() + "/ack", Map.of("queue", QUEUE, "leaseToken", lease), Duration.ofSeconds(4));
        } catch (RuntimeException e) {
            Log.warn("event gagal diproses", "topic", m.path("topic").asText(), "err", String.valueOf(e.getMessage()));
            mtls.post(cfg.brokerUrl() + "/nack", Map.of("queue", QUEUE, "leaseToken", lease, "error", String.valueOf(e.getMessage())), Duration.ofSeconds(4));
        }
    }

    private void dispatch(String topic, JsonNode p) {
        switch (topic) {
            case "payment.succeeded" -> bookings.onPaymentSucceeded(p.path("bookingId").asText(), p.path("paymentId").asText(), p.path("amount").asLong());
            case "trip.cancelled" -> bookings.onTripCancelled(p.path("tripId").asText());
            default -> { /* payment.failed: pesanan tetap menunggu sampai TTL, pengguna boleh coba metode lain */ }
        }
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }
}
