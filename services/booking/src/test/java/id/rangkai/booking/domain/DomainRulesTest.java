package id.rangkai.booking.domain;

import static org.junit.jupiter.api.Assertions.assertAll;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

@DisplayName("Aturan bisnis domain")
class DomainRulesTest {

    @Nested
    @DisplayName("SegmentRange")
    class SegmentRangeRules {
        @Test
        @DisplayName("Rentang terbalik atau kosong ditolak")
        void invalidRangesThrow() {
            assertAll(
                () -> assertThrows(IllegalArgumentException.class, () -> new SegmentRange(3, 3)),
                () -> assertThrows(IllegalArgumentException.class, () -> new SegmentRange(4, 2)),
                () -> assertThrows(IllegalArgumentException.class, () -> new SegmentRange(-1, 2)));
        }

        @ParameterizedTest(name = "[{0},{1}) vs [{2},{3}) tumpang tindih = {4}")
        @CsvSource({"0,5,5,8,false", "0,5,4,8,true", "2,4,0,8,true", "0,1,1,2,false", "3,6,0,4,true", "3,6,6,7,false"})
        @DisplayName("overlaps memperlakukan batas sebagai terbuka di kanan")
        void overlapBoundaries(int a, int b, int c, int d, boolean expected) {
            assertEquals(expected, new SegmentRange(a, b).overlaps(new SegmentRange(c, d)));
            assertEquals(expected, new SegmentRange(c, d).overlaps(new SegmentRange(a, b)), "overlaps harus simetris");
        }

        @Test
        @DisplayName("segments menghasilkan semua indeks ruas")
        void segmentsAreListed() {
            assertEquals(List.of(2, 3, 4), java.util.Arrays.stream(new SegmentRange(2, 5).segments()).boxed().toList());
            assertEquals(3, new SegmentRange(2, 5).length());
            assertTrue(new SegmentRange(2, 5).containsSegment(4));
            assertFalse(new SegmentRange(2, 5).containsSegment(5));
        }
    }

    @Nested
    @DisplayName("PassengerType (BVA usia)")
    class PassengerTypes {
        @ParameterizedTest(name = "usia {0} adalah {1}")
        @CsvSource({"0,INFANT", "2,INFANT", "3,CHILD", "11,CHILD", "12,ADULT", "59,ADULT", "60,SENIOR", "120,SENIOR"})
        void ageBoundaries(int age, PassengerType expected) {
            assertEquals(expected, PassengerType.fromAge(age));
        }

        @ParameterizedTest(name = "usia {0} ditolak")
        @ValueSource(ints = {-1, 121})
        void outOfRangeAgeThrows(int age) {
            IllegalArgumentException e = assertThrows(IllegalArgumentException.class, () -> PassengerType.fromAge(age));
            assertEquals("Usia harus 0 sampai 120", e.getMessage());
        }
    }

    @Nested
    @DisplayName("FareCalculator")
    class Fares {
        @ParameterizedTest(name = "base {0} + {1}/km x {2} km, {3} = Rp{4}")
        @CsvSource({
            "45000,900,155,ADULT,185000",
            "45000,900,155,CHILD,139000",
            "45000,900,155,SENIOR,148000",
            "30000,520,1,ADULT,31000",
            "1000,0,1,ADULT,1000",
        })
        void computesFare(long base, long perKm, int km, PassengerType type, long expected) {
            assertEquals(expected, FareCalculator.fare(base, perKm, km, type));
        }

        @Test
        @DisplayName("Bayi tidak mendapat kursi sendiri")
        void infantRejected() {
            DomainException e = assertThrows(DomainException.class, () -> FareCalculator.fare(45000, 900, 10, PassengerType.INFANT));
            assertEquals("INFANT_NO_SEAT", e.code());
        }

        @Test
        @DisplayName("Jarak nol atau tarif negatif ditolak")
        void invalidInputThrows() {
            assertAll(
                () -> assertThrows(IllegalArgumentException.class, () -> FareCalculator.adultFare(100, 10, 0)),
                () -> assertThrows(IllegalArgumentException.class, () -> FareCalculator.adultFare(-1, 10, 5)));
        }
    }

    @Nested
    @DisplayName("NikValidator")
    class Nik {
        @ParameterizedTest(name = "NIK sah: {0}")
        @ValueSource(strings = {"3578015203990001", "1101011201000001", "9601017112000001", "3578010101990001"})
        void validNik(String nik) {
            assertTrue(NikValidator.isValid(nik));
        }

        @ParameterizedTest(name = "NIK salah: \"{0}\"")
        @NullAndEmptySource
        @ValueSource(strings = {
            "357801520399000",   // 15 digit
            "35780152039900012", // 17 digit
            "1001015203990001",  // provinsi 10
            "9701015203990001",  // provinsi 97
            "3578013203990001",  // tanggal 32
            "3578014003990001",  // tanggal 40
            "3578017203990001",  // tanggal 72
            "3578015200990001",  // bulan 00
            "3578015213990001",  // bulan 13
            "35780152039900AB",  // bukan angka
        })
        void invalidNik(String nik) {
            assertFalse(NikValidator.isValid(nik));
        }

        @ParameterizedTest(name = "usia {0} tanpa NIK boleh = {1}")
        @CsvSource({"16,true", "17,false", "18,false"})
        @DisplayName("Batas wajib NIK ada di usia 17")
        void nikRequiredFromSeventeen(int age, boolean allowed) {
            if (allowed) assertDoesNotThrow(() -> NikValidator.check(null, age));
            else assertEquals("NIK_REQUIRED", assertThrows(DomainException.class, () -> NikValidator.check(" ", age)).code());
        }

        @Test
        @DisplayName("NIK anak boleh kosong, tetapi bila diisi harus benar")
        void childNikMustBeValidWhenPresent() {
            assertEquals("INVALID_NIK", assertThrows(DomainException.class, () -> NikValidator.check("123", 10)).code());
        }

        @Test
        @DisplayName("Masking hanya menyisakan 4 digit terakhir")
        void masks() {
            assertEquals("************0001", NikValidator.mask("3578015203990001"));
            assertNull(NikValidator.mask(null));
        }
    }

    @Nested
    @DisplayName("BookingStatus (uji transisi status)")
    class Status {
        @ParameterizedTest(name = "{0} ke {1} = {2}")
        @CsvSource({
            "PENDING_PAYMENT,CONFIRMED,true", "PENDING_PAYMENT,CANCELLED,true", "PENDING_PAYMENT,EXPIRED,true", "PENDING_PAYMENT,CHECKED_IN,false",
            "CONFIRMED,CHECKED_IN,true", "CONFIRMED,CANCELLED,true", "CONFIRMED,EXPIRED,false", "CONFIRMED,PENDING_PAYMENT,false",
            "CHECKED_IN,CANCELLED,false", "CANCELLED,CONFIRMED,false", "EXPIRED,CONFIRMED,false",
        })
        void transitions(BookingStatus from, BookingStatus to, boolean allowed) {
            assertEquals(allowed, from.canMoveTo(to));
        }

        @Test
        @DisplayName("Transisi terlarang melempar exception")
        void invalidTransitionThrows() {
            DomainException e = assertThrows(DomainException.class, () -> BookingStatus.CANCELLED.moveTo(BookingStatus.CONFIRMED));
            assertEquals("INVALID_STATE_TRANSITION", e.code());
            assertEquals(409, e.status());
        }

        @Test
        @DisplayName("Status akhir tidak punya kelanjutan")
        void terminalStates() {
            assertAll(
                () -> assertTrue(BookingStatus.CANCELLED.isTerminal()),
                () -> assertTrue(BookingStatus.EXPIRED.isTerminal()),
                () -> assertTrue(BookingStatus.CHECKED_IN.isTerminal()),
                () -> assertFalse(BookingStatus.CONFIRMED.isTerminal()));
        }
    }

    @Nested
    @DisplayName("RefundPolicy (BVA waktu)")
    class Refund {
        @ParameterizedTest(name = "sisa {0} ms = {1}%")
        @CsvSource({
            "259200000,90",  // tepat 72 jam
            "259199999,75",
            "86400000,75",   // tepat 24 jam
            "86399999,50",
            "10800000,50",   // tepat 3 jam
            "10799999,0",
            "1,0",
        })
        void percentByTimeLeft(long left, int expected) {
            assertEquals(expected, RefundPolicy.percent(1_000_000_000L + left, 1_000_000_000L));
        }

        @Test
        @DisplayName("Setelah berangkat tidak bisa dibatalkan")
        void departedThrows() {
            DomainException e = assertThrows(DomainException.class, () -> RefundPolicy.percent(1000, 1000));
            assertEquals("TRIP_DEPARTED", e.code());
        }

        @Test
        @DisplayName("Perhitungan nominal dan validasi masukan")
        void refundAmount() {
            assertEquals(75000, RefundPolicy.refund(100000, 75));
            assertThrows(IllegalArgumentException.class, () -> RefundPolicy.refund(-1, 50));
            assertThrows(IllegalArgumentException.class, () -> RefundPolicy.refund(100, 101));
        }
    }

    @Nested
    @DisplayName("LockPolicy")
    class Locks {
        @ParameterizedTest(name = "{0} kursi diterima")
        @ValueSource(ints = {1, 4})
        void seatCountWithinLimit(int count) {
            List<String> seats = java.util.stream.IntStream.range(0, count).mapToObj(i -> "S" + i).toList();
            assertDoesNotThrow(() -> LockPolicy.checkSeats(seats));
        }

        @Test
        @DisplayName("0 kursi, 5 kursi, dan kursi kembar ditolak")
        void invalidSeatLists() {
            assertAll(
                () -> assertEquals("NO_SEATS", assertThrows(DomainException.class, () -> LockPolicy.checkSeats(List.of())).code()),
                () -> assertEquals("TOO_MANY_SEATS", assertThrows(DomainException.class, () -> LockPolicy.checkSeats(List.of("1", "2", "3", "4", "5"))).code()),
                () -> assertEquals("DUPLICATE_SEAT", assertThrows(DomainException.class, () -> LockPolicy.checkSeats(List.of("1", "1"))).code()));
        }

        @ParameterizedTest(name = "minta {0} detik, batas 600, hasil {1}")
        @CsvSource({"3,3", "599,599", "600,600", "601,600", "99999,600"})
        @DisplayName("Klien hanya bisa memperpendek durasi")
        void ttlIsClamped(int requested, int expected) {
            assertEquals(expected, LockPolicy.resolveTtl(requested, 600));
        }

        @Test
        @DisplayName("Durasi di bawah minimum ditolak, kosong memakai batas server")
        void ttlEdges() {
            assertEquals("INVALID_TTL", assertThrows(DomainException.class, () -> LockPolicy.resolveTtl(2, 600)).code());
            assertEquals(600, LockPolicy.resolveTtl(null, 600));
        }
    }
}
