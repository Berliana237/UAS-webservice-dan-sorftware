package id.rangkai.booking.domain;

import java.util.HashSet;
import java.util.List;

/** Aturan penahanan kursi: jumlah kursi, durasi, dan batas lock aktif agar kursi tidak ditimbun bot. */
public final class LockPolicy {
    public static final int MAX_SEATS = 4;
    public static final int MAX_ACTIVE_LOCKS = 2;
    public static final int MIN_TTL_SECONDS = 3;

    private LockPolicy() {}

    public static void checkSeats(List<String> seats) {
        if (seats == null || seats.isEmpty()) throw new DomainException(422, "NO_SEATS", "Pilih minimal satu kursi.");
        if (seats.size() > MAX_SEATS) throw new DomainException(422, "TOO_MANY_SEATS", "Maksimal " + MAX_SEATS + " kursi dalam satu pesanan.");
        if (new HashSet<>(seats).size() != seats.size()) throw new DomainException(422, "DUPLICATE_SEAT", "Ada kursi yang dipilih dua kali.");
    }

    /** Klien hanya boleh memperpendek durasi tahan, tidak pernah memperpanjang melewati batas server. */
    public static int resolveTtl(Integer requested, int serverMax) {
        if (serverMax < MIN_TTL_SECONDS) throw new IllegalArgumentException("Batas TTL server terlalu kecil");
        if (requested == null) return serverMax;
        if (requested < MIN_TTL_SECONDS) throw new DomainException(422, "INVALID_TTL", "Durasi tahan minimal " + MIN_TTL_SECONDS + " detik.");
        return Math.min(requested, serverMax);
    }

    public static void checkActiveLocks(int active) {
        if (active >= MAX_ACTIVE_LOCKS) {
            throw new DomainException(409, "TOO_MANY_ACTIVE_LOCKS", "Anda sudah menahan kursi di perjalanan ini. Selesaikan atau lepas dulu.");
        }
    }
}
