package id.rangkai.booking.domain;

/**
 * Nama penumpang: spasi di awal/akhir dibuang dan spasi ganda dirapikan, lalu panjangnya harus 2 sampai 80 karakter.
 * Nama yang hanya berisi spasi ditolak, agar tiket tidak pernah terbit tanpa nama.
 */
public final class PassengerName {
    public static final int MIN = 2;
    public static final int MAX = 80;

    private PassengerName() {}

    public static String normalize(String raw) {
        String name = raw == null ? "" : raw.strip().replaceAll("\\s+", " ");
        if (name.length() < MIN || name.length() > MAX) {
            throw new DomainException(422, "INVALID_NAME", "Nama penumpang wajib diisi, " + MIN + " sampai " + MAX + " karakter selain spasi.");
        }
        return name;
    }
}
