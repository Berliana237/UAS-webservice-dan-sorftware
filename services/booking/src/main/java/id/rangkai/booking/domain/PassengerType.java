package id.rangkai.booking.domain;

/** Golongan penumpang berdasarkan usia saat berangkat, beserta persentase tarifnya. */
public enum PassengerType {
    INFANT(0), CHILD(75), ADULT(100), SENIOR(80);

    private final int farePercent;

    PassengerType(int farePercent) { this.farePercent = farePercent; }

    public int farePercent() { return farePercent; }

    public static PassengerType fromAge(int age) {
        if (age < 0 || age > 120) throw new IllegalArgumentException("Usia harus 0 sampai 120");
        if (age < 3) return INFANT;
        if (age <= 11) return CHILD;
        if (age <= 59) return ADULT;
        return SENIOR;
    }
}
