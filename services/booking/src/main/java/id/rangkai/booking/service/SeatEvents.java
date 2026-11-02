package id.rangkai.booking.service;

import id.rangkai.booking.domain.SegmentRange;
import java.util.List;
import java.util.Map;

/** Efek samping domain: perubahan kursi untuk siaran real-time, dan event untuk message queue. */
public interface SeatEvents {
    void seatsChanged(String tripId, List<String> seats, SegmentRange range, String status);

    void publish(String topic, String key, Map<String, Object> payload);
}
