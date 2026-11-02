package id.rangkai.booking.service;

import id.rangkai.booking.domain.SegmentRange;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Pengganti database untuk unit test (prinsip FIRST: cepat dan tanpa I/O). Perilakunya mengikuti kontrak SeatStore. */
final class InMemorySeatStore implements SeatStore {
    private record Claim(String ownerId, long expiresAt) {}

    private final Map<String, Claim> claims = new HashMap<>();
    private final Map<String, LockRecord> locks = new HashMap<>();

    private static String key(String trip, String seat, int segment) {
        return trip + "|" + seat + "|" + segment;
    }

    @Override
    public synchronized List<SeatConflict> tryClaim(String tripId, List<String> seats, SegmentRange range, String ownerId, long expiresAt, long now) {
        List<SeatConflict> conflicts = new ArrayList<>();
        for (String seat : seats) {
            for (int s : range.segments()) {
                Claim c = claims.get(key(tripId, seat, s));
                if (c != null && c.expiresAt() > now) conflicts.add(new SeatConflict(seat, s, "LOCKED"));
            }
        }
        if (!conflicts.isEmpty()) return conflicts;
        for (String seat : seats) {
            for (int s : range.segments()) claims.put(key(tripId, seat, s), new Claim(ownerId, expiresAt));
        }
        return conflicts;
    }

    @Override
    public synchronized int releaseClaims(String ownerId) {
        int before = claims.size();
        claims.values().removeIf(c -> c.ownerId().equals(ownerId));
        return before - claims.size();
    }

    @Override
    public synchronized int countActiveLocks(String userId, String tripId, long now) {
        return (int) locks.values().stream().filter(l -> l.userId().equals(userId) && l.tripId().equals(tripId) && "ACTIVE".equals(l.status()) && l.expiresAt() > now).count();
    }

    @Override
    public synchronized void saveLock(LockRecord lock) {
        locks.put(lock.id(), lock);
    }

    @Override
    public synchronized Optional<LockRecord> findLock(String id) {
        return Optional.ofNullable(locks.get(id));
    }

    @Override
    public synchronized void setLockStatus(String id, String status) {
        LockRecord l = locks.get(id);
        locks.put(id, new LockRecord(l.id(), l.userId(), l.tripId(), l.seats(), l.range(), status, l.expiresAt(), l.createdAt()));
    }

    @Override
    public synchronized List<LockRecord> findExpiredLocks(long now, int limit) {
        return locks.values().stream().filter(l -> "ACTIVE".equals(l.status()) && l.expiresAt() <= now).limit(limit).toList();
    }

    synchronized int claimCount() {
        return claims.size();
    }
}
