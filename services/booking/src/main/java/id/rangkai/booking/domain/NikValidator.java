package id.rangkai.booking.domain;

/** Validasi struktur NIK: 16 digit, kode provinsi, tanggal lahir (perempuan +40), dan bulan lahir. */
public final class NikValidator {
    public static final int MIN_AGE_REQUIRING_NIK = 17;

    private NikValidator() {}

    public static boolean isValid(String nik) {
        if (nik == null || !nik.matches("\\d{16}")) return false;
        int province = Integer.parseInt(nik.substring(0, 2));
        if (province < 11 || province > 96) return false;
        int day = Integer.parseInt(nik.substring(6, 8));
        boolean validDay = (day >= 1 && day <= 31) || (day >= 41 && day <= 71);
        if (!validDay) return false;
        int month = Integer.parseInt(nik.substring(8, 10));
        return month >= 1 && month <= 12;
    }

    /** Penumpang 17 tahun ke atas wajib NIK. Di bawah itu boleh kosong, tetapi bila diisi harus valid. */
    public static void check(String nik, int age) {
        boolean empty = nik == null || nik.isBlank();
        if (empty && age >= MIN_AGE_REQUIRING_NIK) {
            throw new DomainException(422, "NIK_REQUIRED", "Penumpang berusia 17 tahun ke atas wajib mengisi NIK.");
        }
        if (!empty && !isValid(nik)) {
            throw new DomainException(422, "INVALID_NIK", "NIK harus 16 digit dan formatnya benar.");
        }
    }

    public static String mask(String nik) {
        if (nik == null || nik.length() < 4) return null;
        return "************" + nik.substring(nik.length() - 4);
    }
}
