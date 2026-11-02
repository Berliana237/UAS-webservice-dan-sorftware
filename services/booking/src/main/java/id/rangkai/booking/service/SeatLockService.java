package id.rangkai.booking.service;

import id.rangkai.booking.domain.DomainException;
import id.rangkai.booking.domain.LockPolicy;
import id.rangkai.booking.domain.SegmentRange;
import id.rangkai.booking.service.SeatStore.LockRecord;
import id.rangkai.booking.service.SeatStore.SeatConflict;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.LongSupplier;

/**
 * Inti seat locking per segmen. Dua lock atas kursi yang sama hanya berkonflik bila ruasnya tumpang tindih.
 * Atomisitas dijamin transaksi tulis dan PRIMARY KEY (trip, kursi, segmen), bukan oleh lock di memori,
 * sehingga tetap benar walau booking-service berjalan di beberapa instance.
 */
public class SeatLockService {
    public static final String ACTIVE = "ACTIVE";
    public static final String RELEASED = "RELEASED";
    public static final String EXPIRED = "EXPIRED";
    public static final String CONVERTED = "CONVERTED";

    private final SeatStore store;
    private final Tx tx;
    private final SeatEvents events;
    private final LongSupplier clock;
    private final int maxTtlSeconds;

    public SeatLockService(SeatStore store, Tx tx, SeatEvents events, LongSupplier clock, int maxTtlSeconds) {
        this.store = store;
        this.tx = tx;
        this.events = events;
        this.clock = clock;
        this.maxTtlSeconds = maxTtlSeconds;
    }

    public LockRecord lock(String userId, String tripId, List<String> seats, SegmentRange range, Integer ttlSeconds) {
        LockPolicy.checkSeats(seats);
        int ttl = LockPolicy.resolveTtl(ttlSeconds, maxTtlSeconds);
        return tx.run(() -> {
            long now = clock.getAsLong();
            LockPolicy.checkActiveLocks(store.countActiveLocks(userId, tripId, now));
            String id = "lck_" + UUID.randomUUID().toString().replace("-", "").substring(0, 20);
            long expiresAt = now + ttl * 1000L;
            List<SeatConflict> conflicts = store.tryClaim(tripId, seats, range, id, expiresAt, now);
            if (!conflicts.isEmpty()) {
                throw new DomainException(409, "SEAT_CONFLICT", "Kursi sudah diambil penumpang lain pada ruas ini.", Map.of("conflicts", conflicts));
            }
            LockRecord lock = new LockRecord(id, userId, tripId, List.copyOf(seats), range, ACTIVE, expiresAt, now);
            store.saveLock(lock);
            events.seatsChanged(tripId, seats, range, "LOCKED");
            return lock;
        });
    }

    public LockRecord get(String lockId, String userId) {
        return store.findLock(lockId)
            .filter(l -> l.userId().equals(userId))
            .orElseThrow(() -> new DomainException(404, "LOCK_NOT_FOUND", "Penahanan kursi tidak ditemukan."));
    }

    public void release(String lockId, String userId) {
        tx.run(() -> {
            LockRecord lock = get(lockId, userId);
            if (!ACTIVE.equals(lock.status())) {
                throw new DomainException(409, "LOCK_NOT_ACTIVE", "Penahanan ini sudah tidak aktif.", Map.of("status", lock.status()));
            }
            store.releaseClaims(lockId);
            store.setLockStatus(lockId, RELEASED);
            events.seatsChanged(lock.tripId(), lock.seats(), lock.range(), "AVAILABLE");
            return null;
        });
    }

    /** Melepas lock yang melewati TTL. Aman dijalankan bersamaan oleh banyak instance. */
    public List<LockRecord> expireDue() {
        return tx.run(() -> {
            long now = clock.getAsLong();
            List<LockRecord> done = new ArrayList<>();
            for (LockRecord lock : store.findExpiredLocks(now, 100)) {
                store.releaseClaims(lock.id());
                store.setLockStatus(lock.id(), EXPIRED);
                events.seatsChanged(lock.tripId(), lock.seats(), lock.range(), "AVAILABLE");
                events.publish("seat.lock.expired", lock.id(), Map.of("lockId", lock.id(), "userId", lock.userId(), "tripId", lock.tripId(), "seats", lock.seats()));
                done.add(lock);
            }
            return done;
        });
    }
}
