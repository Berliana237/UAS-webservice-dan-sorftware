package id.rangkai.booking.domain;

import java.util.stream.IntStream;

/**
 * Ruas perjalanan sebagai rentang indeks segmen [from, to).
 * Segmen ke-i adalah ruas antara stasiun urutan i dan i+1, sehingga Surabaya-Madiun dan Madiun-Yogyakarta
 * tidak saling tumpang tindih walau berbagi stasiun Madiun.
 */
public record SegmentRange(int from, int to) {

    public SegmentRange {
        if (from < 0) throw new IllegalArgumentException("Indeks awal tidak boleh negatif");
        if (to <= from) throw new IllegalArgumentException("Stasiun tujuan harus setelah stasiun asal");
    }

    public boolean overlaps(SegmentRange other) {
        return from < other.to && other.from < to;
    }

    public boolean containsSegment(int segment) {
        return segment >= from && segment < to;
    }

    public int length() {
        return to - from;
    }

    public int[] segments() {
        return IntStream.range(from, to).toArray();
    }
}
