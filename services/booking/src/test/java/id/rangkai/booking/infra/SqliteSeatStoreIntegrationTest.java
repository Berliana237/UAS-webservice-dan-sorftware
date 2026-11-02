package id.rangkai.booking.infra;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import id.rangkai.booking.domain.DomainException;
import id.rangkai.booking.domain.SegmentRange;
import id.rangkai.booking.service.SeatEvents;
import id.rangkai.booking.service.SeatLockService;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Uji integrasi di atas file SQLite sungguhan. Dua objek Db yang membuka file yang sama
 * meniru dua instance booking-service, sehingga atomisitas diuji lintas koneksi.
 */
@DisplayName("Integrasi: seat locking di SQLite lintas instance")
class SqliteSeatStoreIntegrationTest {
    @TempDir
    Path dir;

    private Db instanceA;
    private Db instanceB;
    private SeatLockService serviceA;
    private SeatLockService serviceB;

    private SeatLockService service(Db db) {
        SeatEvents events = new OutboxEvents(db);
        return new SeatLockService(new SqliteSeatStore(db), db, events, System::currentTimeMillis, 600);
    }

    @BeforeEach
    void setUp() {
        Path file = dir.resolve("booking.db");
        instanceA = new Db(file);
        instanceA.script(Schema.DDL);
        instanceB = new Db(file);
        serviceA = service(instanceA);
        serviceB = service(instanceB);
    }

    @AfterEach
    void tearDown() {
        instanceA.close();
        instanceB.close();
    }

    private long claims() {
        return Db.num(instanceA.one("SELECT COUNT(*) c FROM seat_claims").orElseThrow(), "c");
    }

    @Test
    @DisplayName("Dua instance berebut segmen yang sama: tepat satu pemenang, tanpa klaim ganda")
    void singleWinnerAcrossInstances() throws Exception {
        int threads = 40;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger winners = new AtomicInteger();
        AtomicInteger conflicts = new AtomicInteger();
        List<Throwable> unexpected = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            SeatLockService svc = i % 2 == 0 ? serviceA : serviceB;
            String user = "u" + i;
            pool.submit(() -> {
                try {
                    start.await();
                    svc.lock(user, "T1", List.of("EKS1-5A", "EKS1-5B"), new SegmentRange(1, 4), null);
                    winners.incrementAndGet();
                } catch (DomainException e) {
                    conflicts.incrementAndGet();
                } catch (Throwable t) {
                    synchronized (unexpected) { unexpected.add(t); }
                }
            });
        }
        start.countDown();
        pool.shutdown();
        assertTrue(pool.awaitTermination(30, TimeUnit.SECONDS));
        assertTrue(unexpected.isEmpty(), () -> "error tak terduga: " + unexpected);
        assertEquals(1, winners.get());
        assertEquals(threads - 1, conflicts.get());
        assertEquals(6, claims(), "2 kursi x 3 segmen");
    }

    @Test
    @DisplayName("Ruas bersebelahan lintas instance sama-sama berhasil pada kursi yang sama")
    void adjacentSegmentsAcrossInstances() {
        serviceA.lock("u1", "T1", List.of("EKS1-1A"), new SegmentRange(0, 5), null);
        serviceB.lock("u2", "T1", List.of("EKS1-1A"), new SegmentRange(5, 8), null);
        assertEquals(8, claims());
    }

    @Test
    @DisplayName("Lock kedaluwarsa bisa langsung diambil walau sweeper belum jalan")
    void expiredClaimIsReclaimedAtomically() throws Exception {
        serviceA.lock("u1", "T1", List.of("EKS1-1A"), new SegmentRange(0, 2), 3);
        Thread.sleep(3100);
        assertEquals(SeatLockService.ACTIVE, serviceB.lock("u2", "T1", List.of("EKS1-1A"), new SegmentRange(0, 2), null).status());
        assertEquals(2, claims());
    }

    @Test
    @DisplayName("Sweeper dari dua instance tidak melepas dua kali")
    void sweepersDoNotDoubleProcess() throws Exception {
        serviceA.lock("u1", "T1", List.of("EKS1-1A"), new SegmentRange(0, 2), 3);
        Thread.sleep(3100);
        int first = serviceA.expireDue().size();
        int second = serviceB.expireDue().size();
        assertEquals(1, first + second);
        assertEquals(0, claims());
        assertEquals(1, Db.num(instanceA.one("SELECT COUNT(*) c FROM outbox WHERE topic='seat.lock.expired'").orElseThrow(), "c"));
    }
}
