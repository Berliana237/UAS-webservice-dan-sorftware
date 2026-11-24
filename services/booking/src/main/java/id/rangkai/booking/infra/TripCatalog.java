package id.rangkai.booking.infra;

import com.fasterxml.jackson.databind.JsonNode;
import id.rangkai.booking.domain.DomainException;
import id.rangkai.booking.domain.SegmentRange;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Snapshot perjalanan dari catalog-service lewat mTLS, di-cache sebentar agar lonjakan booking tidak membebani catalog. */
public final class TripCatalog {
    private static final long CACHE_MS = 2000;

    public record Stop(int seq, String code, String name, int km, long departAt) {}
    public record Fare(long base, long perKm) {}

    public record Trip(String id, String trainId, String trainName, boolean trainEnabled, String status, long departureAt, String masinisId,
                       List<Stop> stops, Map<String, String> seatClass, Map<String, Fare> fares, int seniorDiscountPercent) {

        /** Rute melingkar bisa melewati stasiun yang sama dua kali, jadi tujuan dicari setelah stasiun asal. */
        public SegmentRange range(String from, String to) {
            Stop a = stops.stream().filter(s -> s.code().equals(from)).findFirst().orElse(null);
            Stop b = a == null ? null : stops.stream().filter(s -> s.code().equals(to) && s.seq() > a.seq()).findFirst().orElse(null);
            if (a == null || b == null) {
                throw new DomainException(422, "INVALID_SEGMENT", "Stasiun asal harus berada sebelum stasiun tujuan pada rute ini.");
            }
            return new SegmentRange(a.seq(), b.seq());
        }

        public int km(SegmentRange r) {
            return stops.get(r.to()).km() - stops.get(r.from()).km();
        }

        public void assertSeatsExist(List<String> seats) {
            List<String> unknown = seats.stream().filter(s -> !seatClass.containsKey(s)).toList();
            if (!unknown.isEmpty()) throw new DomainException(422, "UNKNOWN_SEAT", "Kursi tidak ada di perjalanan ini.", Map.of("seats", unknown));
        }

        /** Penjualan ruas ditutup begitu kereta meninggalkan stasiun asal ruas tersebut. */
        public void assertBookable(SegmentRange r, long now) {
            if (!trainEnabled) throw new DomainException(409, "TRAIN_DISABLED", "Kereta ini sedang tidak beroperasi.");
            if ("CANCELLED".equals(status)) throw new DomainException(409, "TRIP_CANCELLED", "Perjalanan ini dibatalkan.");
            if (stops.get(r.from()).departAt() <= now) throw new DomainException(409, "TRIP_DEPARTED", "Kereta sudah berangkat dari stasiun asal.");
        }
    }

    private record Cached(Trip trip, long at) {}

    private final Mtls mtls;
    private final Discovery discovery;
    private final Map<String, Cached> cache = new ConcurrentHashMap<>();

    public TripCatalog(Mtls mtls, Discovery discovery) {
        this.mtls = mtls;
        this.discovery = discovery;
    }

    /** Memasukkan data perjalanan tanpa memanggil catalog-service (dipakai uji integrasi BookingService). */
    public void put(Trip trip) {
        cache.put(trip.id(), new Cached(trip, Long.MAX_VALUE / 4));
    }

    public Trip get(String tripId) {
        Cached hit = cache.get(tripId);
        if (hit != null && System.currentTimeMillis() - hit.at() < CACHE_MS) return hit.trip();
        if (!tripId.matches("[A-Za-z0-9_-]{1,64}")) throw new DomainException(404, "TRIP_NOT_FOUND", "Perjalanan tidak ditemukan.");
        Mtls.Response r;
        try {
            r = mtls.get(discovery.urlOf("catalog") + "/internal/trips/" + tripId, Duration.ofSeconds(4));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw unavailable();
        } catch (Exception e) {
            if (hit != null) return hit.trip();
            throw unavailable();
        }
        if (r.status() == 404) throw new DomainException(404, "TRIP_NOT_FOUND", "Perjalanan tidak ditemukan.");
        if (r.status() != 200 || r.json() == null) throw unavailable();
        Trip trip = parse(r.json());
        cache.put(tripId, new Cached(trip, System.currentTimeMillis()));
        return trip;
    }

    /** Perjalanan yang sudah lewat, dipakai sekali untuk mengisi riwayat demo. */
    public List<Trip> past(int days) throws Exception {
        Mtls.Response r = mtls.get(discovery.urlOf("catalog") + "/internal/trips-past?days=" + days, Duration.ofSeconds(30));
        if (r.status() != 200 || r.json() == null) throw new IllegalStateException("catalog status " + r.status());
        List<Trip> out = new ArrayList<>();
        for (JsonNode t : r.json().path("trips")) out.add(parse(t));
        return out;
    }

    private static DomainException unavailable() {
        return new DomainException(503, "SERVICE_UNAVAILABLE", "Layanan jadwal sedang tidak tersedia. Coba lagi sebentar.");
    }

    static Trip parse(JsonNode j) {
        List<Stop> stops = new ArrayList<>();
        for (JsonNode s : j.path("stops")) stops.add(new Stop(s.path("seq").asInt(), s.path("code").asText(), s.path("name").asText(), s.path("km").asInt(), s.path("departAt").asLong()));
        Map<String, String> seatClass = new java.util.LinkedHashMap<>();
        for (JsonNode c : j.path("coaches")) for (JsonNode s : c.path("seats")) seatClass.put(s.asText(), c.path("seatClass").asText());
        Map<String, Fare> fares = new HashMap<>();
        j.path("fares").fields().forEachRemaining(e -> fares.put(e.getKey(), new Fare(e.getValue().path("base").asLong(), e.getValue().path("perKm").asLong())));
        return new Trip(j.path("id").asText(), j.path("trainId").asText(), j.path("trainName").asText(), j.path("trainEnabled").asBoolean(true), j.path("status").asText(),
            j.path("departureAt").asLong(), j.path("masinisId").isNull() ? null : j.path("masinisId").asText(null), stops, seatClass, fares, j.path("seniorDiscountPercent").asInt(10));
    }
}
