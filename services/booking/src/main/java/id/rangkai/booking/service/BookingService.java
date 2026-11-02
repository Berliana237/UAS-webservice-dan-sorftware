package id.rangkai.booking.service;

import id.rangkai.booking.domain.BookingStatus;
import id.rangkai.booking.domain.DomainException;
import id.rangkai.booking.domain.FareCalculator;
import id.rangkai.booking.domain.NikValidator;
import id.rangkai.booking.domain.PassengerType;
import id.rangkai.booking.domain.RefundPolicy;
import id.rangkai.booking.domain.SegmentRange;
import id.rangkai.booking.infra.Db;
import id.rangkai.booking.infra.FieldCrypto;
import id.rangkai.booking.infra.TripCatalog;
import id.rangkai.booking.infra.TripCatalog.Trip;
import id.rangkai.booking.service.SeatStore.LockRecord;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Siklus hidup pesanan: lock menjadi pesanan, pembayaran mengonfirmasi, pembatalan dan kedaluwarsa melepas kursi. */
public class BookingService {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String PNR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    public record PassengerInput(String seatId, String name, int age, String nik, String phone) {}

    private final Db db;
    private final SeatStore store;
    private final SeatLockService locks;
    private final SeatEvents events;
    private final TripCatalog catalog;
    private final FieldCrypto crypto;

    public BookingService(Db db, SeatStore store, SeatLockService locks, SeatEvents events, TripCatalog catalog, FieldCrypto crypto) {
        this.db = db;
        this.store = store;
        this.locks = locks;
        this.events = events;
        this.catalog = catalog;
        this.crypto = crypto;
    }

    /* ---------- Membuat pesanan dari lock ---------- */
    public Map<String, Object> create(String userId, String lockId, List<PassengerInput> passengers) {
        LockRecord peek = locks.get(lockId, userId);
        Trip trip = catalog.get(peek.tripId());
        return db.run(() -> {
            long now = System.currentTimeMillis();
            LockRecord lock = locks.get(lockId, userId);
            if (!SeatLockService.ACTIVE.equals(lock.status())) {
                throw new DomainException(409, "LOCK_NOT_ACTIVE", "Penahanan kursi sudah tidak aktif.", Map.of("status", lock.status()));
            }
            if (lock.expiresAt() <= now) throw new DomainException(409, "LOCK_EXPIRED", "Waktu menahan kursi sudah habis. Silakan pilih kursi lagi.");
            if (db.one("SELECT id FROM bookings WHERE lock_id=? AND status='PENDING_PAYMENT'", lockId).isPresent()) {
                throw new DomainException(409, "LOCK_ALREADY_USED", "Penahanan ini sudah menjadi pesanan.");
            }
            trip.assertBookable(lock.range(), now);
            Set<String> given = new HashSet<>();
            passengers.forEach(p -> given.add(p.seatId()));
            if (given.size() != passengers.size() || !given.equals(new HashSet<>(lock.seats()))) {
                throw new DomainException(422, "PASSENGER_SEAT_MISMATCH", "Setiap kursi yang ditahan harus punya tepat satu penumpang.");
            }
            Set<String> niks = new HashSet<>();
            int km = trip.km(lock.range());
            String id = "bkg_" + UUID.randomUUID().toString().replace("-", "").substring(0, 20);
            long amount = 0;
            List<Object[]> rows = new ArrayList<>();
            for (PassengerInput p : passengers) {
                PassengerType type = typeOf(p.age());
                NikValidator.check(p.nik(), p.age());
                if (p.nik() != null && !p.nik().isBlank() && !niks.add(p.nik())) {
                    throw new DomainException(422, "DUPLICATE_PASSENGER", "NIK yang sama dipakai dua kali dalam satu pesanan.");
                }
                String seatClass = trip.seatClass().get(p.seatId());
                TripCatalog.Fare rule = trip.fares().get(seatClass);
                long fare = FareCalculator.fare(rule.base(), rule.perKm(), km, type);
                amount += fare;
                rows.add(new Object[] {"pax_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16), id, p.seatId(), seatClass,
                    crypto.encrypt(p.name().trim()), blank(p.nik()) ? null : crypto.encrypt(p.nik()), blank(p.phone()) ? null : crypto.encrypt(p.phone()), p.age(), type.name(), fare});
            }
            var from = trip.stops().get(lock.range().from());
            var to = trip.stops().get(lock.range().to());
            db.update("""
                INSERT INTO bookings(id,code,user_id,trip_id,train_name,from_code,from_name,to_code,to_name,from_idx,to_idx,departure_at,status,amount,lock_id,expires_at,created_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                id, pnr(), userId, trip.id(), trip.trainName(), from.code(), from.name(), to.code(), to.name(), lock.range().from(), lock.range().to(),
                from.departAt(), BookingStatus.PENDING_PAYMENT.name(), amount, lockId, lock.expiresAt(), now);
            for (Object[] r : rows) {
                db.update("INSERT INTO passengers(id,booking_id,seat_id,seat_class,name_enc,nik_enc,phone_enc,age,passenger_type,fare) VALUES(?,?,?,?,?,?,?,?,?,?)", r);
            }
            events.publish("booking.created", id, Map.of("bookingId", id, "userId", userId, "amount", amount, "tripId", trip.id()));
            audit("booking.created", userId, id);
            return view(id, true);
        });
    }

    private static PassengerType typeOf(int age) {
        try {
            return PassengerType.fromAge(age);
        } catch (IllegalArgumentException e) {
            throw new DomainException(422, "INVALID_AGE", e.getMessage());
        }
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    private static String pnr() {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < 6; i++) b.append(PNR_ALPHABET.charAt(RANDOM.nextInt(PNR_ALPHABET.length())));
        return b.toString();
    }

    /* ---------- Konfirmasi dari event pembayaran ---------- */
    public void onPaymentSucceeded(String bookingId, String paymentId, long amount) {
        db.run(() -> {
            long now = System.currentTimeMillis();
            var b = db.one("SELECT * FROM bookings WHERE id=?", bookingId).orElse(null);
            if (b == null) throw new DomainException(404, "BOOKING_NOT_FOUND", "Pesanan tidak ditemukan.");
            String userId = Db.str(b, "user_id");
            BookingStatus status = BookingStatus.valueOf(Db.str(b, "status"));
            if (status == BookingStatus.CONFIRMED || status == BookingStatus.CHECKED_IN) return null;
            String lockId = Db.str(b, "lock_id");
            long held = Db.num(db.one("SELECT COUNT(*) c FROM seat_claims WHERE owner_id=?", lockId).orElseThrow(), "c");
            boolean stillHeld = status == BookingStatus.PENDING_PAYMENT && Db.num(b, "expires_at") > now && held > 0;
            if (!stillHeld || amount != Db.num(b, "amount")) {
                // Pembayaran datang terlambat atau nominal tidak cocok: kursi tidak diterbitkan, dana dikembalikan.
                if (status == BookingStatus.PENDING_PAYMENT) expireBooking(b, now);
                events.publish("payment.refund_required", bookingId, Map.of("bookingId", bookingId, "userId", userId, "paymentId", paymentId, "amount", amount, "reason", stillHeld ? "amount_mismatch" : "lock_expired"));
                return null;
            }
            status.moveTo(BookingStatus.CONFIRMED);
            db.update("UPDATE seat_claims SET owner_type='BOOKING', owner_id=?, expires_at=NULL WHERE owner_id=?", bookingId, lockId);
            store.setLockStatus(lockId, SeatLockService.CONVERTED);
            db.update("UPDATE bookings SET status=?, payment_id=?, paid_at=? WHERE id=?", BookingStatus.CONFIRMED.name(), paymentId, now, bookingId);
            for (var p : db.list("SELECT id FROM passengers WHERE booking_id=?", bookingId)) {
                db.update("UPDATE passengers SET ticket_code=? WHERE id=?", "TKT-" + UUID.randomUUID().toString().replace("-", "").toUpperCase(), Db.str(p, "id"));
            }
            events.seatsChanged(Db.str(b, "trip_id"), seatsOf(bookingId), rangeOf(b), "BOOKED");
            events.publish("booking.confirmed", bookingId, Map.of("bookingId", bookingId, "userId", userId, "code", Db.str(b, "code")));
            audit("booking.confirmed", userId, bookingId);
            return null;
        });
    }

    private List<String> seatsOf(String bookingId) {
        return db.list("SELECT seat_id FROM passengers WHERE booking_id=?", bookingId).stream().map(r -> Db.str(r, "seat_id")).toList();
    }

    private static SegmentRange rangeOf(Map<String, Object> b) {
        return new SegmentRange((int) Db.num(b, "from_idx"), (int) Db.num(b, "to_idx"));
    }

    private void expireBooking(Map<String, Object> b, long now) {
        String id = Db.str(b, "id");
        String lockId = Db.str(b, "lock_id");
        if (store.releaseClaims(lockId) > 0) events.seatsChanged(Db.str(b, "trip_id"), seatsOf(id), rangeOf(b), "AVAILABLE");
        store.setLockStatus(lockId, SeatLockService.EXPIRED);
        db.update("UPDATE bookings SET status=?, cancelled_at=? WHERE id=?", BookingStatus.EXPIRED.name(), now, id);
        events.publish("booking.expired", id, Map.of("bookingId", id, "userId", Db.str(b, "user_id")));
    }

    /* ---------- Sweeper TTL ---------- */
    public int sweep() {
        return db.run(() -> {
            long now = System.currentTimeMillis();
            for (var b : db.list("SELECT * FROM bookings WHERE status='PENDING_PAYMENT' AND expires_at<=? LIMIT 100", now)) expireBooking(b, now);
            return locks.expireDue().size();
        });
    }

    /* ---------- Pembatalan ---------- */
    public Map<String, Object> refundPreview(String userId, String bookingId) {
        var b = owned(userId, bookingId);
        BookingStatus status = BookingStatus.valueOf(Db.str(b, "status"));
        if (!status.canMoveTo(BookingStatus.CANCELLED)) return Map.of("cancellable", false, "reason", "Pesanan berstatus " + status + " tidak bisa dibatalkan.");
        if (status == BookingStatus.PENDING_PAYMENT) return Map.of("cancellable", true, "percent", 0, "refundAmount", 0, "paid", false);
        int pct = RefundPolicy.percent(Db.num(b, "departure_at"), System.currentTimeMillis());
        return Map.of("cancellable", true, "percent", pct, "refundAmount", RefundPolicy.refund(Db.num(b, "amount"), pct), "paid", true);
    }

    public Map<String, Object> cancel(String userId, String bookingId) {
        return db.run(() -> {
            var b = owned(userId, bookingId);
            long now = System.currentTimeMillis();
            BookingStatus status = BookingStatus.valueOf(Db.str(b, "status"));
            status.moveTo(BookingStatus.CANCELLED);
            long refund = status == BookingStatus.CONFIRMED ? RefundPolicy.refund(Db.num(b, "amount"), RefundPolicy.percent(Db.num(b, "departure_at"), now)) : 0;
            doCancel(b, now, refund);
            audit("booking.cancelled", userId, bookingId);
            return view(bookingId, true);
        });
    }

    private void doCancel(Map<String, Object> b, long now, long refund) {
        String id = Db.str(b, "id");
        store.releaseClaims(id);
        store.releaseClaims(Db.str(b, "lock_id"));
        if (SeatLockService.ACTIVE.equals(store.findLock(Db.str(b, "lock_id")).map(LockRecord::status).orElse(""))) store.setLockStatus(Db.str(b, "lock_id"), SeatLockService.RELEASED);
        db.update("UPDATE bookings SET status=?, cancelled_at=?, refund_amount=? WHERE id=?", BookingStatus.CANCELLED.name(), now, refund, id);
        events.seatsChanged(Db.str(b, "trip_id"), seatsOf(id), rangeOf(b), "AVAILABLE");
        events.publish("booking.cancelled", id, Map.of("bookingId", id, "userId", Db.str(b, "user_id"), "refundAmount", refund));
    }

    /** Perjalanan dibatalkan operator: semua pesanan batal, dana kembali penuh. */
    public int onTripCancelled(String tripId) {
        return db.run(() -> {
            long now = System.currentTimeMillis();
            int n = 0;
            for (var b : db.list("SELECT * FROM bookings WHERE trip_id=? AND status IN ('PENDING_PAYMENT','CONFIRMED')", tripId)) {
                doCancel(b, now, "CONFIRMED".equals(Db.str(b, "status")) ? Db.num(b, "amount") : 0);
                n++;
            }
            return n;
        });
    }

    /* ---------- Check-in ---------- */
    public Map<String, Object> checkIn(String ticketCode, String operatorId) {
        return db.run(() -> {
            var p = db.one("SELECT * FROM passengers WHERE ticket_code=?", ticketCode)
                .orElseThrow(() -> new DomainException(404, "TICKET_NOT_FOUND", "Tiket tidak ditemukan."));
            if (p.get("checked_in_at") != null) throw new DomainException(409, "ALREADY_CHECKED_IN", "Tiket ini sudah dipakai check-in.");
            String bookingId = Db.str(p, "booking_id");
            var b = db.one("SELECT * FROM bookings WHERE id=?", bookingId).orElseThrow();
            BookingStatus status = BookingStatus.valueOf(Db.str(b, "status"));
            if (status != BookingStatus.CONFIRMED && status != BookingStatus.CHECKED_IN) {
                throw new DomainException(409, "TICKET_NOT_VALID", "Tiket tidak berlaku karena pesanan berstatus " + status + ".");
            }
            long now = System.currentTimeMillis();
            db.update("UPDATE passengers SET checked_in_at=? WHERE id=?", now, Db.str(p, "id"));
            long left = Db.num(db.one("SELECT COUNT(*) c FROM passengers WHERE booking_id=? AND checked_in_at IS NULL", bookingId).orElseThrow(), "c");
            if (left == 0) db.update("UPDATE bookings SET status=? WHERE id=?", BookingStatus.CHECKED_IN.name(), bookingId);
            audit("ticket.checkin", operatorId, bookingId);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("checkedIn", true);
            out.put("seatId", Db.str(p, "seat_id"));
            out.put("passenger", crypto.decrypt(Db.str(p, "name_enc")));
            out.put("bookingCode", Db.str(b, "code"));
            out.put("trainName", Db.str(b, "train_name"));
            return out;
        });
    }

    /* ---------- Baca ---------- */
    private Map<String, Object> owned(String userId, String bookingId) {
        // Pesanan milik orang lain dijawab 404, bukan 403, agar keberadaannya tidak bocor (IDOR).
        return db.one("SELECT * FROM bookings WHERE id=? AND user_id=?", bookingId, userId)
            .orElseThrow(() -> new DomainException(404, "BOOKING_NOT_FOUND", "Pesanan tidak ditemukan."));
    }

    public Map<String, Object> getOwned(String userId, String bookingId) {
        owned(userId, bookingId);
        return view(bookingId, true);
    }

    public List<Map<String, Object>> listOwned(String userId) {
        return db.list("SELECT id FROM bookings WHERE user_id=? ORDER BY created_at DESC LIMIT 50", userId).stream().map(r -> view(Db.str(r, "id"), true)).toList();
    }

    public Map<String, Object> internalView(String bookingId) {
        var b = db.one("SELECT * FROM bookings WHERE id=?", bookingId).orElseThrow(() -> new DomainException(404, "BOOKING_NOT_FOUND", "Pesanan tidak ditemukan."));
        return Map.of("id", bookingId, "userId", Db.str(b, "user_id"), "status", Db.str(b, "status"), "amount", Db.num(b, "amount"), "expiresAt", Db.num(b, "expires_at"));
    }

    public Map<String, Object> view(String id, boolean includeTickets) {
        var b = db.one("SELECT * FROM bookings WHERE id=?", id).orElseThrow();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", id);
        out.put("code", Db.str(b, "code"));
        out.put("status", Db.str(b, "status"));
        out.put("tripId", Db.str(b, "trip_id"));
        out.put("trainName", Db.str(b, "train_name"));
        out.put("from", Map.of("code", Db.str(b, "from_code"), "name", Db.str(b, "from_name")));
        out.put("to", Map.of("code", Db.str(b, "to_code"), "name", Db.str(b, "to_name")));
        out.put("departureAt", Db.num(b, "departure_at"));
        out.put("amount", Db.num(b, "amount"));
        out.put("expiresAt", Db.num(b, "expires_at"));
        out.put("createdAt", Db.num(b, "created_at"));
        out.put("paidAt", b.get("paid_at"));
        out.put("cancelledAt", b.get("cancelled_at"));
        out.put("refundAmount", Db.num(b, "refund_amount"));
        List<Map<String, Object>> pax = new ArrayList<>();
        for (var p : db.list("SELECT * FROM passengers WHERE booking_id=? ORDER BY seat_id", id)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("seatId", Db.str(p, "seat_id"));
            m.put("seatClass", Db.str(p, "seat_class"));
            m.put("name", crypto.decrypt(Db.str(p, "name_enc")));
            m.put("age", Db.num(p, "age"));
            m.put("passengerType", Db.str(p, "passenger_type"));
            m.put("fare", Db.num(p, "fare"));
            m.put("nikMasked", NikValidator.mask(crypto.decrypt(Db.str(p, "nik_enc"))));
            m.put("checkedIn", p.get("checked_in_at") != null);
            if (includeTickets) m.put("ticketCode", Db.str(p, "ticket_code"));
            pax.add(m);
        }
        out.put("passengers", pax);
        return out;
    }

    public List<Map<String, Object>> manifest(String tripId) {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (var r : db.list("""
            SELECT p.seat_id, p.seat_class, p.name_enc, p.nik_enc, p.passenger_type, p.checked_in_at, p.ticket_code, b.code, b.from_name, b.to_name, b.status
            FROM passengers p JOIN bookings b ON b.id=p.booking_id
            WHERE b.trip_id=? AND b.status IN ('CONFIRMED','CHECKED_IN') ORDER BY b.from_idx, p.seat_id""", tripId)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("seatId", Db.str(r, "seat_id"));
            m.put("seatClass", Db.str(r, "seat_class"));
            m.put("name", crypto.decrypt(Db.str(r, "name_enc")));
            m.put("nikMasked", NikValidator.mask(crypto.decrypt(Db.str(r, "nik_enc"))));
            m.put("passengerType", Db.str(r, "passenger_type"));
            m.put("bookingCode", Db.str(r, "code"));
            m.put("from", Db.str(r, "from_name"));
            m.put("to", Db.str(r, "to_name"));
            m.put("ticketCode", Db.str(r, "ticket_code"));
            m.put("checkedIn", r.get("checked_in_at") != null);
            rows.add(m);
        }
        return rows;
    }

    public List<Map<String, Object>> claims(String tripId) {
        long now = System.currentTimeMillis();
        List<Map<String, Object>> out = new ArrayList<>();
        for (var r : db.list("SELECT seat_id, segment_idx, owner_type FROM seat_claims WHERE trip_id=? AND (expires_at IS NULL OR expires_at>?)", tripId, now)) {
            Map<String, Object> m = new HashMap<>();
            m.put("seatId", Db.str(r, "seat_id"));
            m.put("segmentIdx", Db.num(r, "segment_idx"));
            m.put("ownerType", Db.str(r, "owner_type"));
            out.add(m);
        }
        return out;
    }

    public Map<String, Object> stats() {
        Map<String, Object> out = new LinkedHashMap<>();
        Map<String, Long> byStatus = new HashMap<>();
        for (var r : db.list("SELECT status, COUNT(*) c FROM bookings GROUP BY status")) byStatus.put(Db.str(r, "status"), Db.num(r, "c"));
        out.put("bookings", byStatus);
        out.put("activeLocks", Db.num(db.one("SELECT COUNT(*) c FROM seat_locks WHERE status='ACTIVE'").orElseThrow(), "c"));
        out.put("claims", Db.num(db.one("SELECT COUNT(*) c FROM seat_claims").orElseThrow(), "c"));
        out.put("outboxPending", Db.num(db.one("SELECT COUNT(*) c FROM outbox WHERE published_at IS NULL").orElseThrow(), "c"));
        return out;
    }

    private void audit(String action, String actor, String target) {
        events.publish("audit." + action, target, Map.of("action", action, "service", "booking", "actor", actor == null ? "" : actor, "target", target, "at", System.currentTimeMillis()));
    }
}
