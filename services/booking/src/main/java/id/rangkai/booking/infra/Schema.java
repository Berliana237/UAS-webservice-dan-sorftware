package id.rangkai.booking.infra;

/** Skema database booking-service. Kunci dari seat locking per segmen adalah PRIMARY KEY tabel seat_claims. */
public final class Schema {
    private Schema() {}

    public static final String DDL = """
        CREATE TABLE IF NOT EXISTS seat_claims(
          trip_id TEXT NOT NULL, seat_id TEXT NOT NULL, segment_idx INTEGER NOT NULL,
          owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, expires_at INTEGER,
          PRIMARY KEY(trip_id, seat_id, segment_idx));
        CREATE INDEX IF NOT EXISTS idx_claim_owner ON seat_claims(owner_id);
        CREATE TABLE IF NOT EXISTS seat_locks(
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, trip_id TEXT NOT NULL, seats TEXT NOT NULL,
          from_idx INTEGER NOT NULL, to_idx INTEGER NOT NULL, status TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_lock_status ON seat_locks(status, expires_at);
        CREATE INDEX IF NOT EXISTS idx_lock_user ON seat_locks(user_id, trip_id, status);
        CREATE TABLE IF NOT EXISTS bookings(
          id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL, trip_id TEXT NOT NULL, train_name TEXT NOT NULL,
          from_code TEXT NOT NULL, from_name TEXT NOT NULL, to_code TEXT NOT NULL, to_name TEXT NOT NULL, from_idx INTEGER NOT NULL, to_idx INTEGER NOT NULL,
          departure_at INTEGER NOT NULL, status TEXT NOT NULL, amount INTEGER NOT NULL, lock_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
          payment_id TEXT, paid_at INTEGER, cancelled_at INTEGER, refund_amount INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_booking_user ON bookings(user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_booking_trip ON bookings(trip_id, status);
        CREATE INDEX IF NOT EXISTS idx_booking_lock ON bookings(lock_id);
        CREATE TABLE IF NOT EXISTS passengers(
          id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id), seat_id TEXT NOT NULL, seat_class TEXT NOT NULL,
          name_enc TEXT NOT NULL, nik_enc TEXT, phone_enc TEXT, age INTEGER NOT NULL, passenger_type TEXT NOT NULL, fare INTEGER NOT NULL,
          ticket_code TEXT UNIQUE, checked_in_at INTEGER);
        CREATE INDEX IF NOT EXISTS idx_pax_booking ON passengers(booking_id);
        CREATE TABLE IF NOT EXISTS idempotency(
          user_id TEXT NOT NULL, route TEXT NOT NULL, idem_key TEXT NOT NULL, request_hash TEXT NOT NULL, status INTEGER NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL,
          PRIMARY KEY(user_id, route, idem_key));
        CREATE TABLE IF NOT EXISTS seat_events(
          seq INTEGER PRIMARY KEY AUTOINCREMENT, trip_id TEXT NOT NULL, seats TEXT NOT NULL, from_idx INTEGER NOT NULL, to_idx INTEGER NOT NULL, status TEXT NOT NULL, at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS outbox(
          id TEXT PRIMARY KEY, topic TEXT NOT NULL, msg_key TEXT, payload TEXT NOT NULL, created_at INTEGER NOT NULL, published_at INTEGER);
        CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(published_at, created_at);
        CREATE TABLE IF NOT EXISTS processed_messages(msg_id TEXT PRIMARY KEY, at INTEGER NOT NULL)
        """;
}
