package id.rangkai.booking.service;

import id.rangkai.booking.domain.SegmentRange;
import java.util.List;
import java.util.Optional;

/** Port penyimpanan kursi. Implementasi SQLite dipakai saat berjalan, implementasi memori dipakai unit test. */
public interface SeatStore {

    record SeatConflict(String seatId, int segment, String status) {}

    record LockRecord(String id, String userId, String tripId, List<String> seats, SegmentRange range, String status, long expiresAt, long createdAt) {}

    /**
     * Mengklaim semua segmen untuk semua kursi secara atomik: seluruhnya berhasil, atau tidak sama sekali.
     * Klaim milik lock yang sudah kedaluwarsa dianggap kosong dan diambil alih.
     * @return daftar konflik. Kosong berarti klaim berhasil.
     */
    List<SeatConflict> tryClaim(String tripId, List<String> seats, SegmentRange range, String ownerId, long expiresAt, long now);

    int releaseClaims(String ownerId);

    /** Melepas klaim sebagian kursi milik satu pemilik (dipakai saat pengguna membatalkan pilihan satu kursi). */
    int releaseSeatClaims(String ownerId, List<String> seats);

    /** Mengganti daftar kursi pada catatan lock. */
    void updateLockSeats(String id, List<String> seats);

    int countActiveLocks(String userId, String tripId, long now);

    void saveLock(LockRecord lock);

    Optional<LockRecord> findLock(String id);

    void setLockStatus(String id, String status);

    List<LockRecord> findExpiredLocks(long now, int limit);
}
