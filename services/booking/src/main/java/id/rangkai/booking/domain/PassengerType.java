package id.rangkai.booking.domain;

/**
 * Golongan penumpang menurut usia saat memesan.
 * Bayi (0-3), anak (4-16), dan dewasa (17-59) membayar tarif normal. Lansia (60 ke atas) mendapat potongan yang diatur admin.
 */
public enum PassengerType {
    INFANT("Bayi"), CHILD("Anak"), ADULT("Dewasa"), SENIOR("Lansia");

    public static final int MAX_AGE = 120;
    private final String label;

    PassengerType(String label) { this.label = label; }

    public String label() { return label; }

    public static PassengerType fromAge(int age) {
        if (age < 0 || age > MAX_AGE) throw new IllegalArgumentException("Usia harus 0 sampai " + MAX_AGE);
        if (age <= 3) return INFANT;
        if (age <= 16) return CHILD;
        if (age <= 59) return ADULT;
        return SENIOR;
    }
}
