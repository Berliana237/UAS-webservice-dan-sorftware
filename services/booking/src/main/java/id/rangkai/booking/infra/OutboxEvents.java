package id.rangkai.booking.infra;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import id.rangkai.booking.domain.SegmentRange;
import id.rangkai.booking.service.SeatEvents;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Transactional outbox: event ditulis dalam transaksi yang sama dengan perubahan data, lalu dikirim ke broker oleh relay.
 * Jadi tidak ada keadaan "data berubah tetapi event hilang", walau broker sedang mati.
 */
public final class OutboxEvents implements SeatEvents {
    private static final ObjectMapper JSON = new ObjectMapper();
    private final Db db;

    public OutboxEvents(Db db) {
        this.db = db;
    }

    @Override
    public void seatsChanged(String tripId, List<String> seats, SegmentRange range, String status) {
        db.update("INSERT INTO seat_events(trip_id,seats,from_idx,to_idx,status,at) VALUES(?,?,?,?,?,?)",
            tripId, json(seats), range.from(), range.to(), status, System.currentTimeMillis());
    }

    @Override
    public void publish(String topic, String key, Map<String, Object> payload) {
        db.update("INSERT INTO outbox(id,topic,msg_key,payload,created_at) VALUES(?,?,?,?,?)",
            UUID.randomUUID().toString(), topic, key, json(payload), System.currentTimeMillis());
    }

    private static String json(Object o) {
        try {
            return JSON.writeValueAsString(o);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }
}
