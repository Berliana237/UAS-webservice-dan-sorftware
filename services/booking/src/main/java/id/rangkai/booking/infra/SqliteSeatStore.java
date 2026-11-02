package id.rangkai.booking.infra;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import id.rangkai.booking.domain.SegmentRange;
import id.rangkai.booking.service.SeatStore;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Implementasi SeatStore di atas SQLite. Dipanggil di dalam transaksi tulis (BEGIN IMMEDIATE) dari SeatLockService. */
public final class SqliteSeatStore implements SeatStore {
    private static final ObjectMapper JSON = new ObjectMapper();
    private final Db db;

    public SqliteSeatStore(Db db) {
        this.db = db;
    }

    @Override
    public List<SeatConflict> tryClaim(String tripId, List<String> seats, SegmentRange range, String ownerId, long expiresAt, long now) {
        return db.run(() -> {
            List<SeatConflict> conflicts = new ArrayList<>();
            for (String seat : seats) {
                // Klaim lock yang sudah lewat TTL dianggap kosong, walau sweeper belum sempat membersihkan.
                db.update("DELETE FROM seat_claims WHERE trip_id=? AND seat_id=? AND owner_type='LOCK' AND expires_at<=?", tripId, seat, now);
                for (var row : db.list("SELECT segment_idx, owner_type FROM seat_claims WHERE trip_id=? AND seat_id=? AND segment_idx>=? AND segment_idx<?",
                        tripId, seat, range.from(), range.to())) {
                    conflicts.add(new SeatConflict(seat, (int) Db.num(row, "segment_idx"), "BOOKING".equals(row.get("owner_type")) ? "BOOKED" : "LOCKED"));
                }
            }
            if (!conflicts.isEmpty()) return conflicts;
            for (String seat : seats) {
                for (int segment : range.segments()) {
                    db.update("INSERT INTO seat_claims(trip_id,seat_id,segment_idx,owner_type,owner_id,expires_at) VALUES(?,?,?,'LOCK',?,?)", tripId, seat, segment, ownerId, expiresAt);
                }
            }
            return conflicts;
        });
    }

    @Override
    public int releaseClaims(String ownerId) {
        return db.update("DELETE FROM seat_claims WHERE owner_id=?", ownerId);
    }

    @Override
    public int countActiveLocks(String userId, String tripId, long now) {
        return (int) Db.num(db.one("SELECT COUNT(*) c FROM seat_locks WHERE user_id=? AND trip_id=? AND status='ACTIVE' AND expires_at>?", userId, tripId, now).orElseThrow(), "c");
    }

    @Override
    public void saveLock(LockRecord l) {
        db.update("INSERT INTO seat_locks(id,user_id,trip_id,seats,from_idx,to_idx,status,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
            l.id(), l.userId(), l.tripId(), toJson(l.seats()), l.range().from(), l.range().to(), l.status(), l.expiresAt(), l.createdAt());
    }

    @Override
    public Optional<LockRecord> findLock(String id) {
        return db.one("SELECT * FROM seat_locks WHERE id=?", id).map(SqliteSeatStore::toLock);
    }

    @Override
    public void setLockStatus(String id, String status) {
        db.update("UPDATE seat_locks SET status=? WHERE id=?", status, id);
    }

    /** Lock milik pesanan yang menunggu bayar dilepas oleh BookingService agar status pesanan ikut berubah. */
    @Override
    public List<LockRecord> findExpiredLocks(long now, int limit) {
        return db.list("""
            SELECT l.* FROM seat_locks l WHERE l.status='ACTIVE' AND l.expires_at<=? LIMIT ?""", now, limit)
            .stream().map(SqliteSeatStore::toLock).toList();
    }

    private static LockRecord toLock(Map<String, Object> r) {
        return new LockRecord(Db.str(r, "id"), Db.str(r, "user_id"), Db.str(r, "trip_id"), fromJson(Db.str(r, "seats")),
            new SegmentRange((int) Db.num(r, "from_idx"), (int) Db.num(r, "to_idx")), Db.str(r, "status"), Db.num(r, "expires_at"), Db.num(r, "created_at"));
    }

    private static String toJson(List<String> seats) {
        try {
            return JSON.writeValueAsString(seats);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private static List<String> fromJson(String json) {
        try {
            return JSON.readValue(json, new TypeReference<>() {});
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }
}
