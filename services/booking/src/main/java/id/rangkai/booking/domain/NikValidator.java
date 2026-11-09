package id.rangkai.booking.domain;

/**
 * Validasi NIK: cukup 16 digit angka. Sistem tidak mencocokkan dengan data kependudukan,
 * jadi format provinsi dan tanggal lahir tidak diperiksa.
 */
public final class NikValidator {
    public static final int MIN_AGE_REQUIRING_NIK = 17;

    private NikValidator() {}

    public static boolean isValid(String nik) {
        return nik != null && nik.matches("\\d{16}");
    }

    /** Penumpang 17 tahun ke atas wajib NIK. Di bawah itu boleh kosong, tetapi bila diisi harus 16 digit. */
    public static void check(String nik, int age) {
        boolean empty = nik == null || nik.isBlank();
        if (empty && age >= MIN_AGE_REQUIRING_NIK) {
            throw new DomainException(422, "NIK_REQUIRED", "Penumpang berusia 17 tahun ke atas wajib mengisi NIK.");
        }
        if (!empty && !isValid(nik)) {
            throw new DomainException(422, "INVALID_NIK", "NIK harus 16 digit angka.");
        }
    }

    public static String mask(String nik) {
        if (nik == null || nik.length() < 4) return null;
        return "************" + nik.substring(nik.length() - 4);
    }
}
