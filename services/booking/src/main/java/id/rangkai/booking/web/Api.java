package id.rangkai.booking.web;

import com.fasterxml.jackson.databind.JsonNode;
import id.rangkai.booking.domain.DomainException;
import id.rangkai.booking.domain.SegmentRange;
import id.rangkai.booking.infra.Db;
import id.rangkai.booking.infra.TripCatalog;
import id.rangkai.booking.service.BookingService;
import id.rangkai.booking.service.SeatLockService;
import id.rangkai.booking.service.SeatStore.LockRecord;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/** Definisi endpoint REST booking-service. */
public final class Api {
    private static final long SSE_MAX_MS = 15 * 60 * 1000L;

    private final Db db;
    private final SeatLockService locks;
    private final BookingService bookings;
    private final TripCatalog catalog;
    private final SeatEventHub hub;
    private final String instanceId;

    public Api(Db db, SeatLockService locks, BookingService bookings, TripCatalog catalog, SeatEventHub hub, String instanceId) {
        this.db = db;
        this.locks = locks;
        this.bookings = bookings;
        this.catalog = catalog;
        this.hub = hub;
        this.instanceId = instanceId;
    }

    public void register(HttpApp app) {
        app.route("GET", "/health", ctx -> ctx.json(200, Map.of("status", "UP", "service", "booking", "instance", instanceId)));
        app.route("GET", "/api/bookings/instance", ctx -> ctx.json(200, Map.of("service", "booking", "instance", instanceId)));

        app.route("GET", "/api/trips/{id}/availability", this::availability);
        app.route("GET", "/api/trips/{id}/seats/stream", this::stream);
        app.route("GET", "/api/trips/{id}/manifest", ctx -> {
            ctx.user("manifest:read");
            ctx.json(200, Map.of("tripId", ctx.param("id"), "passengers", bookings.manifest(ctx.param("id"))));
        });

        app.route("POST", "/api/locks", this::createLock);
        app.route("GET", "/api/locks/{id}", ctx -> {
            var u = ctx.user("booking:read");
            ctx.json(200, lockView(locks.get(ctx.param("id"), u.sub())));
        });
        app.route("DELETE", "/api/locks/{id}", ctx -> {
            var u = ctx.user("booking:write");
            locks.release(ctx.param("id"), u.sub());
            ctx.json(200, Map.of("released", true));
        });

        app.route("POST", "/api/bookings", this::createBooking);
        app.route("GET", "/api/bookings", ctx -> {
            var u = ctx.user("booking:read");
            ctx.json(200, Map.of("bookings", bookings.listOwned(u.sub())));
        });
        app.route("GET", "/api/bookings/{id}", ctx -> {
            var u = ctx.user("booking:read");
            ctx.json(200, bookings.getOwned(u.sub(), ctx.param("id")));
        });
        app.route("GET", "/api/bookings/{id}/refund-preview", ctx -> {
            var u = ctx.user("booking:read");
            ctx.json(200, bookings.refundPreview(u.sub(), ctx.param("id")));
        });
        app.route("POST", "/api/bookings/{id}/cancel", ctx -> {
            var u = ctx.user("booking:write");
            ctx.json(200, bookings.cancel(u.sub(), ctx.param("id")));
        });
        app.route("POST", "/api/tickets/checkin", ctx -> {
            var u = ctx.user("checkin:write");
            String code = ctx.body().path("ticketCode").asText("");
            if (code.isBlank()) throw new DomainException(422, "VALIDATION_FAILED", "ticketCode wajib diisi.");
            ctx.json(200, bookings.checkIn(code, u.sub()));
        });
        app.route("GET", "/api/admin/booking-stats", ctx -> {
            ctx.user("system:read");
            Map<String, Object> out = new LinkedHashMap<>(bookings.stats());
            out.put("instance", instanceId);
            ctx.json(200, out);
        });

        // Internal: hanya service tertentu, dibuktikan oleh sertifikat mTLS.
        app.route("GET", "/internal/trips/{id}/claims", ctx -> {
            ctx.requireService("catalog", "gateway");
            ctx.json(200, Map.of("tripId", ctx.param("id"), "claims", bookings.claims(ctx.param("id"))));
        });
        app.route("GET", "/internal/bookings/{id}", ctx -> {
            ctx.requireService("payment");
            ctx.user("internal:booking.read");
            ctx.json(200, bookings.internalView(ctx.param("id")));
        });
    }

    private void availability(HttpApp.Ctx ctx) throws IOException {
        String tripId = ctx.param("id");
        TripCatalog.Trip trip = catalog.get(tripId);
        var q = ctx.query();
        if (q.get("from") == null || q.get("to") == null) throw new DomainException(422, "VALIDATION_FAILED", "Parameter from dan to wajib diisi.");
        SegmentRange range = trip.range(q.get("from"), q.get("to"));
        Map<String, String> taken = new HashMap<>();
        for (var c : bookings.claims(tripId)) {
            int seg = ((Number) c.get("segmentIdx")).intValue();
            if (!range.containsSegment(seg)) continue;
            String seat = (String) c.get("seatId");
            String status = "BOOKING".equals(c.get("ownerType")) ? "BOOKED" : "LOCKED";
            taken.merge(seat, status, (a, b) -> "BOOKED".equals(a) || "BOOKED".equals(b) ? "BOOKED" : "LOCKED");
        }
        List<Map<String, String>> seats = new ArrayList<>();
        taken.forEach((k, v) -> seats.add(Map.of("seatId", k, "status", v)));
        int total = trip.seatClass().size();
        ctx.json(200, Map.of("tripId", tripId, "fromIndex", range.from(), "toIndex", range.to(), "total", total, "available", total - taken.size(), "taken", seats));
    }

    /** Server-Sent Events: perubahan kursi didorong ke klien begitu terjadi, termasuk dari instance lain. */
    private void stream(HttpApp.Ctx ctx) throws IOException {
        String tripId = ctx.param("id");
        catalog.get(tripId);
        ctx.ex.getResponseHeaders().set("Content-Type", "text/event-stream; charset=utf-8");
        ctx.ex.getResponseHeaders().set("Cache-Control", "no-store");
        ctx.ex.getResponseHeaders().set("X-Instance-Id", instanceId);
        ctx.ex.sendResponseHeaders(200, 0);
        ctx.sent = 200;
        var queue = hub.subscribe(tripId);
        long until = System.currentTimeMillis() + SSE_MAX_MS;
        try (OutputStream out = ctx.ex.getResponseBody()) {
            write(out, ": terhubung\nretry: 2000\n\n");
            long lastBeat = System.currentTimeMillis();
            while (System.currentTimeMillis() < until) {
                Map<String, Object> ev = queue.poll(1, TimeUnit.SECONDS);
                if (ev != null) {
                    Map<String, Object> data = new LinkedHashMap<>();
                    data.put("seq", Db.num(ev, "seq"));
                    data.put("seats", HttpApp.JSON.readTree(Db.str(ev, "seats")));
                    data.put("fromIndex", Db.num(ev, "from_idx"));
                    data.put("toIndex", Db.num(ev, "to_idx"));
                    data.put("status", Db.str(ev, "status"));
                    write(out, "id: " + Db.num(ev, "seq") + "\nevent: seat\ndata: " + HttpApp.JSON.writeValueAsString(data) + "\n\n");
                }
                if (System.currentTimeMillis() - lastBeat > 15000) {
                    write(out, ": detak\n\n");
                    lastBeat = System.currentTimeMillis();
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            hub.unsubscribe(tripId, queue);
        }
    }

    private static void write(OutputStream out, String text) throws IOException {
        out.write(text.getBytes(StandardCharsets.UTF_8));
        out.flush();
    }

    private void createLock(HttpApp.Ctx ctx) throws IOException {
        var u = ctx.user("booking:write");
        idempotent(ctx, u.sub(), "POST /api/locks", 201, () -> {
            JsonNode b = ctx.body();
            String tripId = required(b, "tripId");
            List<String> seats = new ArrayList<>();
            b.path("seats").forEach(s -> seats.add(s.asText()));
            TripCatalog.Trip trip = catalog.get(tripId);
            SegmentRange range = trip.range(required(b, "from"), required(b, "to"));
            trip.assertBookable(range, System.currentTimeMillis());
            trip.assertSeatsExist(seats);
            Integer ttl = b.hasNonNull("ttlSeconds") ? b.path("ttlSeconds").asInt() : null;
            return lockView(locks.lock(u.sub(), tripId, seats, range, ttl));
        });
    }

    private void createBooking(HttpApp.Ctx ctx) throws IOException {
        var u = ctx.user("booking:write");
        idempotent(ctx, u.sub(), "POST /api/bookings", 201, () -> {
            JsonNode b = ctx.body();
            List<BookingService.PassengerInput> pax = new ArrayList<>();
            for (JsonNode p : b.path("passengers")) {
                pax.add(new BookingService.PassengerInput(p.path("seatId").asText(""), p.path("name").asText(""), p.path("age").asInt(-1),
                    p.hasNonNull("nik") ? p.path("nik").asText() : null, p.hasNonNull("phone") ? p.path("phone").asText() : null));
            }
            if (pax.isEmpty()) throw new DomainException(422, "VALIDATION_FAILED", "Data penumpang wajib diisi.");
            return bookings.create(u.sub(), required(b, "lockId"), pax);
        });
    }

    private static String required(JsonNode b, String field) {
        String v = b.path(field).asText("");
        if (v.isBlank()) throw new DomainException(422, "VALIDATION_FAILED", "Field " + field + " wajib diisi.");
        return v;
    }

    private Map<String, Object> lockView(LockRecord l) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", l.id());
        m.put("tripId", l.tripId());
        m.put("seats", l.seats());
        m.put("fromIndex", l.range().from());
        m.put("toIndex", l.range().to());
        m.put("status", l.status());
        m.put("expiresAt", l.expiresAt());
        m.put("serverTime", System.currentTimeMillis());
        return m;
    }

    @FunctionalInterface
    private interface Work {
        Map<String, Object> run() throws IOException;
    }

    /** Idempotency-Key: pengiriman ulang akibat gangguan jaringan mengembalikan hasil pertama, tanpa efek ganda. */
    private void idempotent(HttpApp.Ctx ctx, String userId, String route, int successStatus, Work work) throws IOException {
        String key = ctx.header("Idempotency-Key");
        if (key == null || key.length() < 8 || key.length() > 128) {
            throw new DomainException(400, "IDEMPOTENCY_KEY_REQUIRED", "Header Idempotency-Key wajib diisi (8 sampai 128 karakter).");
        }
        String hash = sha256(ctx.rawBody());
        Object[] result = db.run(() -> {
            var prev = db.one("SELECT request_hash,status,body FROM idempotency WHERE user_id=? AND route=? AND idem_key=?", userId, route, key);
            if (prev.isPresent()) {
                if (!hash.equals(Db.str(prev.get(), "request_hash"))) {
                    throw new DomainException(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency-Key sudah dipakai untuk isi permintaan yang berbeda.");
                }
                return new Object[] {(int) Db.num(prev.get(), "status"), Db.str(prev.get(), "body"), true};
            }
            try {
                String body = HttpApp.JSON.writeValueAsString(work.run());
                db.update("INSERT INTO idempotency(user_id,route,idem_key,request_hash,status,body,created_at) VALUES(?,?,?,?,?,?,?)", userId, route, key, hash, successStatus, body, System.currentTimeMillis());
                return new Object[] {successStatus, body, false};
            } catch (IOException e) {
                throw new DomainException(400, "INVALID_JSON", "Body bukan JSON yang valid.");
            }
        });
        ctx.raw((int) result[0], (String) result[1], (boolean) result[2]);
    }

    private static String sha256(byte[] data) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
