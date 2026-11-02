package id.rangkai.booking.infra;

import java.util.regex.Pattern;

/** Masking log: NIK, email, dan token tidak boleh tertulis utuh. */
public final class Masking {
    private static final Pattern BEARER = Pattern.compile("Bearer\\s+[A-Za-z0-9._~+/=-]+", Pattern.CASE_INSENSITIVE);
    private static final Pattern DIGITS = Pattern.compile("\\b(\\d{4})\\d{4,11}(\\d{2})\\b");
    private static final Pattern EMAIL = Pattern.compile("([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\\.[A-Za-z]{2,})");

    private Masking() {}

    public static String mask(String s) {
        if (s == null) return null;
        String out = BEARER.matcher(s).replaceAll("Bearer ***");
        out = DIGITS.matcher(out).replaceAll("$1********$2");
        return EMAIL.matcher(out).replaceAll("$1***@$2");
    }
}
