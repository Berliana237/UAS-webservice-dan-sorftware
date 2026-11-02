package id.rangkai.booking.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import id.rangkai.booking.domain.DomainException;
import id.rangkai.booking.domain.SegmentRange;
import id.rangkai.booking.service.SeatStore.LockRecord;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

@DisplayName("SeatLockService: seat locking per segmen")
class SeatLockServiceTest {
    private static final String TRIP = "ARN-1";
    private static final String SEAT = "EKS1-1A";

    private InMemorySeatStore store;
    private AtomicLong clock;
    private List<String> published;
    private SeatLockService service;

    /** Transaksi palsu: cukup menjalankan pekerjaan dalam satu kunci, menggantikan BEGIN IMMEDIATE. */
    private static final Tx SERIAL_TX = new Tx() {
        @Override
        public synchronized <T> T run(Supplier<T> work) {
            return work.get();
        }
    };

    @BeforeEach
    void setUp() {
        store = new InMemorySeatStore();
        clock = new AtomicLong(1_000_000);
        published = new ArrayList<>();
        SeatEvents events = new SeatEvents() {
            @Override
            public void seatsChanged(String tripId, List<String> seats, SegmentRange range, String status) {
                published.add("seat:" + status);
            }

            @Override
            public void publish(String topic, String key, Map<String, Object> payload) {
                published.add(topic);
            }
        };
        service = new SeatLockService(store, SERIAL_TX, events, clock::get, 600);
    }

    private LockRecord lockAs(String user, int from, int to) {
        return service.lock(user, TRIP, List.of(SEAT), new SegmentRange(from, to), null);
    }

    @Test
    @DisplayName("Lock pada kursi kosong berhasil dan membuat klaim per segmen")
    void lockCreatesClaimPerSegment() {
        LockRecord lock = lockAs("u1", 0, 3);
        assertEquals(SeatLockService.ACTIVE, lock.status());
        assertEquals(3, store.claimCount());
        assertTrue(published.contains("seat:LOCKED"));
    }

    @Test
    @DisplayName("Surabaya-Madiun dan Madiun-Yogyakarta boleh memakai kursi yang sama")
    void adjacentSegmentsShareSeat() {
        lockAs("u1", 0, 5);
        LockRecord second = lockAs("u2", 5, 8);
        assertEquals(SeatLockService.ACTIVE, second.status());
        assertEquals(8, store.claimCount());
    }

    @ParameterizedTest(name = "lock pertama [0,5), lock kedua [{0},{1}) harus {2}")
    @CsvSource({
        "0, 5, CONFLICT",   // sama persis
        "4, 5, CONFLICT",   // satu segmen terakhir
        "4, 6, CONFLICT",   // melewati batas kanan
        "0, 1, CONFLICT",   // satu segmen pertama
        "5, 6, OK",         // tepat setelah batas (BVA)
        "6, 8, OK",         // jauh setelah batas
    })
    @DisplayName("Tumpang tindih segmen menentukan konflik (BVA)")
    void overlapDecidesConflict(int from, int to, String expected) {
        lockAs("u1", 0, 5);
        if ("OK".equals(expected)) {
            assertEquals(SeatLockService.ACTIVE, lockAs("u2", from, to).status());
        } else {
            DomainException e = assertThrows(DomainException.class, () -> lockAs("u2", from, to));
            assertEquals("SEAT_CONFLICT", e.code());
            assertEquals(409, e.status());
        }
    }

    @Test
    @DisplayName("Klaim banyak kursi bersifat atomik: satu konflik membatalkan semuanya")
    void multiSeatLockIsAtomic() {
        lockAs("u1", 0, 2);
        List<String> seats = List.of("EKS1-1B", SEAT);
        SegmentRange range = new SegmentRange(0, 2);
        assertThrows(DomainException.class, () -> service.lock("u2", TRIP, seats, range, null));
        assertEquals(2, store.claimCount(), "kursi EKS1-1B tidak boleh ikut terklaim");
    }

    @Test
    @DisplayName("Setelah TTL habis kursi bisa diambil orang lain")
    void expiredClaimCanBeTaken() {
        service.lock("u1", TRIP, List.of(SEAT), new SegmentRange(0, 2), 10);
        clock.addAndGet(10_000);
        assertEquals(SeatLockService.ACTIVE, lockAs("u2", 0, 2).status());
    }

    @Test
    @DisplayName("Tepat sebelum TTL habis kursi masih terkunci (BVA)")
    void claimStillHeldJustBeforeExpiry() {
        service.lock("u1", TRIP, List.of(SEAT), new SegmentRange(0, 2), 10);
        clock.addAndGet(9_999);
        assertThrows(DomainException.class, () -> lockAs("u2", 0, 2));
    }

    @Test
    @DisplayName("Sweeper melepas lock kedaluwarsa dan menerbitkan event")
    void sweeperReleasesExpired() {
        LockRecord lock = service.lock("u1", TRIP, List.of(SEAT), new SegmentRange(0, 2), 10);
        clock.addAndGet(10_000);
        List<LockRecord> expired = service.expireDue();
        assertEquals(1, expired.size());
        assertEquals(0, store.claimCount());
        assertEquals(SeatLockService.EXPIRED, store.findLock(lock.id()).orElseThrow().status());
        assertTrue(published.contains("seat.lock.expired"));
    }

    @Test
    @DisplayName("Pemilik bisa melepas lock, kursi kembali kosong")
    void ownerReleasesLock() {
        LockRecord lock = lockAs("u1", 0, 2);
        service.release(lock.id(), "u1");
        assertEquals(0, store.claimCount());
        assertEquals(SeatLockService.RELEASED, store.findLock(lock.id()).orElseThrow().status());
    }

    @Test
    @DisplayName("Lock milik orang lain tidak terlihat (mencegah IDOR)")
    void otherUserCannotTouchLock() {
        LockRecord lock = lockAs("u1", 0, 2);
        DomainException e = assertThrows(DomainException.class, () -> service.release(lock.id(), "penyusup"));
        assertEquals(404, e.status());
        assertEquals(2, store.claimCount());
    }

    @Test
    @DisplayName("Lock yang sudah dilepas tidak bisa dilepas lagi")
    void cannotReleaseTwice() {
        LockRecord lock = lockAs("u1", 0, 2);
        service.release(lock.id(), "u1");
        DomainException e = assertThrows(DomainException.class, () -> service.release(lock.id(), "u1"));
        assertEquals("LOCK_NOT_ACTIVE", e.code());
    }

    @Test
    @DisplayName("Lock aktif per pengguna dibatasi agar kursi tidak ditimbun")
    void activeLockLimit() {
        service.lock("u1", TRIP, List.of("EKS1-1A"), new SegmentRange(0, 1), null);
        service.lock("u1", TRIP, List.of("EKS1-2A"), new SegmentRange(0, 1), null);
        DomainException e = assertThrows(DomainException.class, () -> service.lock("u1", TRIP, List.of("EKS1-3A"), new SegmentRange(0, 1), null));
        assertEquals("TOO_MANY_ACTIVE_LOCKS", e.code());
    }

    @Test
    @DisplayName("Konkurensi: 64 pengguna merebut segmen yang sama, tepat satu menang")
    void onlyOneWinnerUnderContention() throws Exception {
        int threads = 64;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger winners = new AtomicInteger();
        AtomicInteger losers = new AtomicInteger();
        for (int i = 0; i < threads; i++) {
            String user = "u" + i;
            pool.submit(() -> {
                try {
                    start.await();
                    lockAs(user, 2, 6);
                    winners.incrementAndGet();
                } catch (DomainException e) {
                    losers.incrementAndGet();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
        }
        start.countDown();
        pool.shutdown();
        assertTrue(pool.awaitTermination(10, TimeUnit.SECONDS));
        assertEquals(1, winners.get());
        assertEquals(threads - 1, losers.get());
        assertEquals(4, store.claimCount());
    }

    @Test
    @DisplayName("Konkurensi: ruas yang tidak tumpang tindih semuanya berhasil")
    void disjointSegmentsAllWinUnderContention() throws Exception {
        int segments = 8;
        ExecutorService pool = Executors.newFixedThreadPool(segments);
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger winners = new AtomicInteger();
        for (int i = 0; i < segments; i++) {
            int seg = i;
            pool.submit(() -> {
                try {
                    start.await();
                    lockAs("u" + seg, seg, seg + 1);
                    winners.incrementAndGet();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
        }
        start.countDown();
        pool.shutdown();
        assertTrue(pool.awaitTermination(10, TimeUnit.SECONDS));
        assertEquals(segments, winners.get());
    }
}
