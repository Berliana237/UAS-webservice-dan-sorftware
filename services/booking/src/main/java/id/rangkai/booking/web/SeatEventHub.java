package id.rangkai.booking.web;

import id.rangkai.booking.infra.Db;
import id.rangkai.booking.infra.Log;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingQueue;

/**
 * Siaran perubahan kursi untuk Server-Sent Events. Satu pembaca membaca tabel seat_events,
 * sehingga perubahan dari instance lain ikut tersiar ke pelanggan di instance ini.
 */
public final class SeatEventHub {
    private static final long POLL_MS = 250;

    private final Db db;
    private final Map<String, Set<BlockingQueue<Map<String, Object>>>> subscribers = new ConcurrentHashMap<>();
    private volatile long lastSeq;

    public SeatEventHub(Db db) {
        this.db = db;
        this.lastSeq = Db.num(db.one("SELECT COALESCE(MAX(seq),0) s FROM seat_events").orElseThrow(), "s");
        Thread.ofPlatform().daemon().name("seat-event-hub").start(this::run);
    }

    public BlockingQueue<Map<String, Object>> subscribe(String tripId) {
        BlockingQueue<Map<String, Object>> q = new LinkedBlockingQueue<>(1000);
        subscribers.computeIfAbsent(tripId, k -> ConcurrentHashMap.newKeySet()).add(q);
        return q;
    }

    public void unsubscribe(String tripId, BlockingQueue<Map<String, Object>> q) {
        var set = subscribers.get(tripId);
        if (set != null) set.remove(q);
    }

    private void run() {
        while (!Thread.currentThread().isInterrupted()) {
            try {
                var rows = db.list("SELECT * FROM seat_events WHERE seq>? ORDER BY seq LIMIT 500", lastSeq);
                for (var r : rows) {
                    lastSeq = Db.num(r, "seq");
                    var set = subscribers.get(Db.str(r, "trip_id"));
                    if (set != null) for (var q : set) q.offer(r);
                }
            } catch (RuntimeException e) {
                Log.warn("seat-event-hub gagal", "err", String.valueOf(e.getMessage()));
            }
            try {
                Thread.sleep(POLL_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }
}
