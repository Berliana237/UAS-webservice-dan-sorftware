package id.rangkai.booking.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import id.rangkai.booking.domain.DomainException;
import id.rangkai.booking.domain.FareCalculator;
import id.rangkai.booking.domain.PassengerType;
import id.rangkai.booking.domain.SegmentRange;
import id.rangkai.booking.infra.Db;
import id.rangkai.booking.infra.FieldCrypto;
import id.rangkai.booking.infra.OutboxEvents;
import id.rangkai.booking.infra.Schema;
import id.rangkai.booking.infra.SqliteSeatStore;
import id.rangkai.booking.infra.TripCatalog;
import id.rangkai.booking.service.BookingService.PassengerInput;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Uji integrasi BookingService di atas SQLite sungguhan (menutup gap coverage WB-TC-05):
 * pembuatan pesanan, validasi penumpang (termasuk BUG-03), pembayaran, check-in, pembatalan, dan refund.
 * Data perjalanan dimasukkan lewat TripCatalog.put sehingga tidak ada panggilan jaringan.
 */
@DisplayName("Integrasi: BookingService (pesanan, bayar, check-in, batal)")
class BookingServiceIntegrationTest {
    private static final long HOUR = 3_600_000L;
    private static final String TRIP = "GJY-UJI-01";
    private static final String NIK = "3578015203990001";

    @TempDir
    Path dir;

    private Db db;
    private SeatLockService locks;
    private BookingService bookings;
    private TripCatalog catalog;

    @BeforeEach
    void setUp() {
        db = new Db(dir.resolve("booking.db"));
        db.script(Schema.DDL);
        OutboxEvents events = new OutboxEvents(db);
        SqliteSeatStore store = new SqliteSeatStore(db);
        locks = new SeatLockService(store, db, events, System::currentTimeMillis, 600);
        catalog = new TripCatalog(null, null);
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        bookings = new BookingService(db, store, locks, events, catalog, new FieldCrypto(Base64.getEncoder().encodeToString(key)));
        putTrip(System.currentTimeMillis() + 100 * HOUR, "SCHEDULED");
    }

    @AfterEach
    void tearDown() {
        db.close();
    }

    private void putTrip(long departAt, String status) {
        List<TripCatalog.Stop> stops = List.of(
            new TripCatalog.Stop(0, "GMR", "Gambir", 0, departAt),
            new TripCatalog.Stop(1, "CN", "Cirebon", 213, departAt + 3 * HOUR),
            new TripCatalog.Stop(2, "YK", "Yogyakarta", 514, departAt + 7 * HOUR));
        Map<String, String> seatClass = new LinkedHashMap<>();
        for (String s : List.of("EKS1-1A", "EKS1-1B", "EKS1-1C")) seatClass.put(s, "EKSEKUTIF");
        catalog.put(new TripCatalog.Trip(TRIP, "GJY", "Gajayana", true, status, departAt, "usr_masinis_a", stops, seatClass,
            Map.of("EKSEKUTIF", new TripCatalog.Fare(100_000, 800)), 10));
    }

    private String lock(String user, String... seats) {
        return locks.lock(user, TRIP, List.of(seats), new SegmentRange(0, 2), null).id();
    }

    private Map<String, Object> book(String user, String lockId, PassengerInput... pax) {
        return bookings.create(user, "Sinta", "sinta@contoh.com", lockId, List.of(pax));
    }

    private static PassengerInput adult(String seat, String name) {
        return new PassengerInput(seat, name, 27, NIK, "081234567890");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> firstPassenger(Map<String, Object> view) {
        return ((List<Map<String, Object>>) view.get("passengers")).get(0);
    }

    @Test
    @DisplayName("Pesanan valid: PENDING_PAYMENT dengan harga dihitung server")
    void pesananValid() {
        Map<String, Object> b = book("u1", lock("u1", "EKS1-1A"), adult("EKS1-1A", "Sinta"));
        assertEquals("PENDING_PAYMENT", b.get("status"));
        assertEquals(FareCalculator.fare(100_000, 800, 514, PassengerType.ADULT, 10), ((Number) b.get("amount")).longValue());
        assertNull(firstPassenger(b).get("ticketCode"));
    }

    @Test
    @DisplayName("BUG-03: nama penumpang hanya spasi ditolak INVALID_NAME dan tidak ada pesanan terbentuk")
    void namaSpasiDitolak() {
        String lockId = lock("u1", "EKS1-1A");
        DomainException e = assertThrows(DomainException.class, () -> book("u1", lockId, new PassengerInput("EKS1-1A", "  ", 10, null, null)));
        assertEquals("INVALID_NAME", e.code());
        assertEquals(0L, Db.num(db.one("SELECT COUNT(*) c FROM bookings").orElseThrow(), "c"));
        assertEquals("Sinta Maharani", firstPassenger(book("u1", lockId, adult("EKS1-1A", "  Sinta   Maharani "))).get("name"));
    }

    @Test
    @DisplayName("Jumlah penumpang harus sama dengan kursi yang ditahan")
    void penumpangTidakSesuaiKursi() {
        String lockId = lock("u1", "EKS1-1A");
        DomainException e = assertThrows(DomainException.class, () -> book("u1", lockId, adult("EKS1-1A", "Sinta"), adult("EKS1-1A", "Bima")));
        assertEquals("PASSENGER_SEAT_MISMATCH", e.code());
    }

    @Test
    @DisplayName("Usia 17 tanpa NIK ditolak; usia di luar 0-120 ditolak")
    void aturanUsiaDanNik() {
        String lockId = lock("u1", "EKS1-1A");
        assertEquals("NIK_REQUIRED", assertThrows(DomainException.class, () -> book("u1", lockId, new PassengerInput("EKS1-1A", "Sinta", 17, null, null))).code());
        assertEquals("INVALID_AGE", assertThrows(DomainException.class, () -> book("u1", lockId, new PassengerInput("EKS1-1A", "Sinta", 121, NIK, null))).code());
    }

    @Test
    @DisplayName("Bayar sukses: CONFIRMED, tiket terbit, lock CONVERTED; check-in kedua ditolak")
    void bayarLaluCheckIn() {
        String lockId = lock("u1", "EKS1-1A");
        Map<String, Object> b = book("u1", lockId, adult("EKS1-1A", "Sinta"));
        String id = (String) b.get("id");
        bookings.onPaymentSucceeded(id, "pay_1", ((Number) b.get("amount")).longValue());
        Map<String, Object> v = bookings.getOwned("u1", id);
        assertEquals("CONFIRMED", v.get("status"));
        String ticket = (String) firstPassenger(v).get("ticketCode");
        assertTrue(ticket.startsWith("TKT-"));
        assertEquals("CONVERTED", locks.get(lockId, "u1").status());
        assertEquals(TRIP, bookings.tripOfTicket(ticket).orElseThrow());
        assertEquals(true, bookings.checkIn(ticket, "usr_masinis_a").get("checkedIn"));
        assertEquals("ALREADY_CHECKED_IN", assertThrows(DomainException.class, () -> bookings.checkIn(ticket, "usr_masinis_a")).code());
        assertEquals("CHECKED_IN", bookings.getOwned("u1", id).get("status"));
    }

    @Test
    @DisplayName("Nominal pembayaran berbeda: pesanan tidak dikonfirmasi dan tiket tidak terbit")
    void nominalBerbeda() {
        Map<String, Object> b = book("u1", lock("u1", "EKS1-1A"), adult("EKS1-1A", "Sinta"));
        String id = (String) b.get("id");
        bookings.onPaymentSucceeded(id, "pay_1", ((Number) b.get("amount")).longValue() + 1000);
        Map<String, Object> v = bookings.getOwned("u1", id);
        assertTrue(!"CONFIRMED".equals(v.get("status")));
        assertNull(firstPassenger(v).get("ticketCode"));
    }

    @Test
    @DisplayName("Batal lebih dari 72 jam sebelum berangkat: refund 90%")
    void batalRefund90() {
        Map<String, Object> b = book("u1", lock("u1", "EKS1-1A"), adult("EKS1-1A", "Sinta"));
        String id = (String) b.get("id");
        long amount = ((Number) b.get("amount")).longValue();
        bookings.onPaymentSucceeded(id, "pay_1", amount);
        Map<String, Object> c = bookings.cancel("u1", id);
        assertEquals("CANCELLED", c.get("status"));
        assertEquals(amount * 90 / 100, ((Number) c.get("refundAmount")).longValue());
    }

    @Test
    @DisplayName("Perjalanan dibatalkan operator: refund penuh untuk pesanan lunas")
    void perjalananDibatalkan() {
        Map<String, Object> b = book("u1", lock("u1", "EKS1-1A"), adult("EKS1-1A", "Sinta"));
        String id = (String) b.get("id");
        long amount = ((Number) b.get("amount")).longValue();
        bookings.onPaymentSucceeded(id, "pay_1", amount);
        assertEquals(1, bookings.onTripCancelled(TRIP));
        Map<String, Object> v = bookings.getOwned("u1", id);
        assertEquals("CANCELLED", v.get("status"));
        assertEquals(amount, ((Number) v.get("refundAmount")).longValue());
    }

    @Test
    @DisplayName("Pesanan milik orang lain tidak terlihat (404)")
    void isolasiPemilik() {
        String id = (String) book("u1", lock("u1", "EKS1-1A"), adult("EKS1-1A", "Sinta")).get("id");
        assertEquals("BOOKING_NOT_FOUND", assertThrows(DomainException.class, () -> bookings.getOwned("u2", id)).code());
        assertNotNull(bookings.getOwned("u1", id));
    }
}
