package id.rangkai.booking.infra;

import id.rangkai.booking.domain.FareCalculator;
import id.rangkai.booking.domain.PassengerType;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;

/**
 * Mengisi riwayat penumpang untuk perjalanan yang sudah lewat, sekali saja saat database baru dibuat.
 * Tujuannya agar halaman riwayat armada di admin langsung punya isi. Data ini fiktif dan ditandai dengan id berawalan hist-.
 * Penulisan dibagi per kelompok kecil perjalanan supaya instance lain tidak tertahan lama oleh transaksi panjang.
 */
public final class HistorySeeder {
    private static final String[] FIRST = {"Andi", "Budi", "Citra", "Dewi", "Eko", "Fajar", "Gita", "Hendra", "Intan", "Joko", "Kartika", "Lukman", "Maya", "Nanda", "Oki",
        "Putri", "Rizky", "Sari", "Teguh", "Utami", "Vina", "Wahyu", "Yoga", "Zahra", "Agus", "Bayu", "Dian", "Fitri", "Hadi", "Indah"};
    private static final String[] LAST = {"Pratama", "Saputra", "Wulandari", "Hidayat", "Lestari", "Nugroho", "Rahmawati", "Setiawan", "Kurniawan", "Permata",
        "Susanto", "Anggraini", "Wibowo", "Maharani", "Santoso", "Ramadhan", "Purnomo", "Safitri"};
    private static final String KEY = "history_seeded";
    private static final int CHUNK = 40;

    private final Db db;
    private final FieldCrypto crypto;
    private final TripCatalog catalog;
    private final int days;

    public HistorySeeder(Db db, FieldCrypto crypto, TripCatalog catalog, int days) {
        this.db = db;
        this.crypto = crypto;
        this.catalog = catalog;
        this.days = days;
    }

    public void startInBackground() {
        if (days <= 0) return;
        Thread.ofPlatform().daemon().name("history-seeder").start(() -> {
            for (int attempt = 0; attempt < 30; attempt++) {
                try {
                    if (db.one("SELECT value FROM kv WHERE key=?", KEY).isPresent()) return;
                    seed(catalog.past(days));
                    return;
                } catch (Exception e) {
                    Log.warn("pengisian riwayat menunggu catalog", "err", String.valueOf(e.getMessage()));
                    try { Thread.sleep(3000); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); return; }
                }
            }
        });
    }

    void seed(List<TripCatalog.Trip> trips) {
        int bookings = 0;
        for (int i = 0; i < trips.size(); i += CHUNK) {
            List<TripCatalog.Trip> part = trips.subList(i, Math.min(trips.size(), i + CHUNK));
            bookings += db.run(() -> {
                int n = 0;
                for (TripCatalog.Trip t : part) n += seedTrip(t);
                return n;
            });
        }
        db.update("INSERT OR IGNORE INTO kv(key,value) VALUES(?,?)", KEY, String.valueOf(System.currentTimeMillis()));
        Log.info("riwayat perjalanan terisi", "trips", trips.size(), "bookings", bookings);
    }

    private int seedTrip(TripCatalog.Trip t) {
        if (t.stops().size() < 2 || t.seatClass().isEmpty()) return 0;
        Random rnd = new Random(t.id().hashCode());
        List<String> seats = new ArrayList<>(t.seatClass().keySet());
        Set<String> taken = new HashSet<>();
        int segments = t.stops().size() - 1;
        int count = 3 + rnd.nextInt(10);
        int made = 0;
        for (int k = 0; k < count; k++) {
            int a = rnd.nextInt(segments);
            int b = a + 1 + rnd.nextInt(segments - a);
            int pax = 1 + (rnd.nextInt(10) < 3 ? 1 + rnd.nextInt(2) : 0);
            List<String> chosen = new ArrayList<>();
            for (int tries = 0; tries < 40 && chosen.size() < pax; tries++) {
                String seat = seats.get(rnd.nextInt(seats.size()));
                boolean free = !chosen.contains(seat);
                for (int s = a; s < b && free; s++) free = !taken.contains(seat + "|" + s);
                if (free) chosen.add(seat);
            }
            if (chosen.isEmpty()) continue;
            String id = "hist-" + t.id() + "-" + k;
            int roll = rnd.nextInt(100);
            String status = roll < 80 ? "CHECKED_IN" : roll < 92 ? "CONFIRMED" : "CANCELLED";
            var from = t.stops().get(a);
            var to = t.stops().get(b);
            int km = to.km() - from.km();
            long departure = from.departAt();
            long created = departure - (1 + rnd.nextInt(20)) * 86_400_000L - rnd.nextInt(36_000_000);
            long paid = created + 300_000L;
            long amount = 0;
            List<Object[]> rows = new ArrayList<>();
            String contactFirst = FIRST[rnd.nextInt(FIRST.length)];
            String contactLast = LAST[rnd.nextInt(LAST.length)];
            for (int p = 0; p < chosen.size(); p++) {
                String seat = chosen.get(p);
                String cls = t.seatClass().get(seat);
                TripCatalog.Fare rule = t.fares().get(cls);
                if (rule == null) return made;
                int age = p == 0 ? 20 + rnd.nextInt(50) : 1 + rnd.nextInt(80);
                PassengerType type = PassengerType.fromAge(age);
                long fare = FareCalculator.fare(rule.base(), rule.perKm(), km, type, t.seniorDiscountPercent());
                amount += fare;
                String name = p == 0 ? contactFirst + " " + contactLast : FIRST[rnd.nextInt(FIRST.length)] + " " + contactLast;
                String nik = age >= 17 ? String.format("35%014d", Math.abs(rnd.nextLong()) % 100_000_000_000_000L) : null;
                rows.add(new Object[] {id + "-p" + p, id, seat, cls, crypto.encrypt(name), nik == null ? null : crypto.encrypt(nik), crypto.encrypt("08" + (1_000_000_000L + rnd.nextInt(899_999_999))),
                    age, type.name(), fare, "CANCELLED".equals(status) ? null : "TKT-HIST" + Integer.toHexString((id + p).hashCode()).toUpperCase() + p,
                    "CHECKED_IN".equals(status) ? departure - 1_200_000L : null});
            }
            String email = (contactFirst + "." + contactLast + k).toLowerCase() + "@contoh.id";
            int changed = db.update("""
                INSERT OR IGNORE INTO bookings(id,code,user_id,trip_id,train_id,train_name,from_code,from_name,to_code,to_name,from_idx,to_idx,departure_at,status,amount,lock_id,expires_at,
                  payment_id,paid_at,cancelled_at,refund_amount,created_at,contact_name_enc,contact_email_enc,reminded_payment,reminded_departure)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1)""",
                id, "H" + Integer.toString(Math.abs(id.hashCode()) % 1_679_616, 36).toUpperCase(), "usr_hist_" + Math.abs((contactFirst + contactLast).hashCode() % 500), t.id(), t.trainId(), t.trainName(),
                from.code(), from.name(), to.code(), to.name(), a, b, departure, status, amount, "hist-lock-" + id, paid, "hist-pay-" + id, paid,
                "CANCELLED".equals(status) ? paid + 86_400_000L : null, "CANCELLED".equals(status) ? amount * 75 / 100 : 0, created,
                crypto.encrypt(contactFirst + " " + contactLast), crypto.encrypt(email));
            if (changed == 0) continue;
            for (Object[] r : rows) {
                db.update("INSERT OR IGNORE INTO passengers(id,booking_id,seat_id,seat_class,name_enc,nik_enc,phone_enc,age,passenger_type,fare,ticket_code,checked_in_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", r);
            }
            if (!"CANCELLED".equals(status)) {
                for (String seat : chosen) {
                    for (int s = a; s < b; s++) {
                        taken.add(seat + "|" + s);
                        db.update("INSERT OR IGNORE INTO seat_claims(trip_id,seat_id,segment_idx,owner_type,owner_id,expires_at) VALUES(?,?,?,'BOOKING',?,NULL)", t.id(), seat, s, id);
                    }
                }
            }
            made++;
        }
        return made;
    }
}
