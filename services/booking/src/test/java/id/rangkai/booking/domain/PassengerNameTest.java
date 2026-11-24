package id.rangkai.booking.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;

@DisplayName("PassengerName: nama penumpang wajib berisi minimal 2 karakter selain spasi")
class PassengerNameTest {

    @ParameterizedTest(name = "\"{0}\" ditolak")
    @NullSource
    @ValueSource(strings = {"", " ", "  ", "\t\n", "A", " B "})
    void namaKosongAtauTerlaluPendekDitolak(String raw) {
        DomainException e = assertThrows(DomainException.class, () -> PassengerName.normalize(raw));
        assertEquals("INVALID_NAME", e.code());
        assertEquals(422, e.status());
    }

    @Test
    @DisplayName("Batas atas: 80 karakter diterima, 81 ditolak (BVA)")
    void batasAtas() {
        assertEquals(80, PassengerName.normalize("a".repeat(80)).length());
        assertThrows(DomainException.class, () -> PassengerName.normalize("a".repeat(81)));
    }

    @Test
    @DisplayName("Spasi di tepi dibuang dan spasi ganda dirapikan")
    void dirapikan() {
        assertEquals("Sinta Maharani", PassengerName.normalize("  Sinta   Maharani "));
        assertEquals("Bo", PassengerName.normalize(" Bo "));
    }
}
