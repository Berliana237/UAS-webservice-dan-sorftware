package id.rangkai.booking.domain;

/**
 * Tarif dihitung di server: base + perKm x km, dibulatkan ke atas per Rp1.000.
 * Hanya lansia yang mendapat potongan, sebesar persentase yang diatur admin (0 sampai 100).
 */
public final class FareCalculator {
    private static final long ROUND = 1000;

    private FareCalculator() {}

    public static long adultFare(long base, long perKm, int km) {
        if (km <= 0) throw new IllegalArgumentException("Jarak harus lebih dari 0 km");
        if (base < 0 || perKm < 0) throw new IllegalArgumentException("Tarif tidak boleh negatif");
        return roundUp(base + perKm * km);
    }

    public static long fare(long base, long perKm, int km, PassengerType type, int seniorDiscountPercent) {
        if (seniorDiscountPercent < 0 || seniorDiscountPercent > 100) throw new IllegalArgumentException("Diskon lansia harus 0 sampai 100 persen");
        long adult = adultFare(base, perKm, km);
        if (type != PassengerType.SENIOR) return adult;
        return roundUp(adult * (100 - seniorDiscountPercent) / 100);
    }

    private static long roundUp(long amount) {
        return ((amount + ROUND - 1) / ROUND) * ROUND;
    }
}
