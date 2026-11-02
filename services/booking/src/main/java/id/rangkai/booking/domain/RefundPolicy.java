package id.rangkai.booking.domain;

/** Pengembalian dana menurut sisa waktu sebelum berangkat. */
public final class RefundPolicy {
    private static final long HOUR = 3_600_000L;

    private RefundPolicy() {}

    public static int percent(long departureAt, long now) {
        long left = departureAt - now;
        if (left <= 0) throw new DomainException(409, "TRIP_DEPARTED", "Kereta sudah berangkat, pesanan tidak bisa dibatalkan.");
        if (left >= 72 * HOUR) return 90;
        if (left >= 24 * HOUR) return 75;
        if (left >= 3 * HOUR) return 50;
        return 0;
    }

    public static long refund(long amount, int percent) {
        if (amount < 0) throw new IllegalArgumentException("Nominal tidak boleh negatif");
        if (percent < 0 || percent > 100) throw new IllegalArgumentException("Persentase harus 0 sampai 100");
        return amount * percent / 100;
    }
}
