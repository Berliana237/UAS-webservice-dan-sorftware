package id.rangkai.booking.domain;

/** Tarif dihitung di server: base + perKm x km, dibulatkan ke atas per Rp1.000, lalu dikali persentase golongan. */
public final class FareCalculator {
    private static final long ROUND = 1000;

    private FareCalculator() {}

    public static long adultFare(long base, long perKm, int km) {
        if (km <= 0) throw new IllegalArgumentException("Jarak harus lebih dari 0 km");
        if (base < 0 || perKm < 0) throw new IllegalArgumentException("Tarif tidak boleh negatif");
        return roundUp(base + perKm * km);
    }

    public static long fare(long base, long perKm, int km, PassengerType type) {
        if (type == PassengerType.INFANT) {
            throw new DomainException(422, "INFANT_NO_SEAT", "Bayi di bawah 3 tahun tidak memerlukan kursi sendiri, jadi tidak perlu didaftarkan pada kursi.");
        }
        return roundUp(adultFare(base, perKm, km) * type.farePercent() / 100);
    }

    private static long roundUp(long amount) {
        return ((amount + ROUND - 1) / ROUND) * ROUND;
    }
}
