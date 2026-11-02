# Contoh Query dan Mutation GraphQL

Endpoint: `POST /graphql`. Skema lengkap: [schema.graphql](schema.graphql), atau `GET /graphql/schema`. Query publik. Mutation butuh token dengan scope `schedule:write` (operator atau admin).

## Query

### Daftar stasiun

```graphql
{ stations { code name city } }
```

### Cari perjalanan

```graphql
query Cari($from: String!, $to: String!, $date: String!) {
  searchTrips(from: $from, to: $to, date: $date) {
    trip { id trainName status delayMinutes }
    from { departAt station { name } }
    to { arriveAt station { name } }
    durationMinutes
    km
    stopsBetween
    availableSeats
    fares { seatClass adult }
  }
}
```

Variabel: `{ "from": "SGU", "to": "MN", "date": "2026-11-10" }`

### Peta kursi per segmen

Status kursi dihitung untuk ruas yang diminta. `segments` berisi status tiap ruas di seluruh rute, sehingga kursi yang terpakai sebagian bisa ditampilkan.

```graphql
query Peta($id: ID!) {
  seatMap(tripId: $id, from: "SGU", to: "MN") {
    fromIndex
    toIndex
    km
    available
    total
    segments { index from { name } to { name } km }
    coaches {
      coach { code name seatClass rows letters }
      adultFare
      available
      seats { id row letter status segments { index status } }
    }
  }
}
```

### Hanya meminta yang perlu

Inilah keunggulan GraphQL untuk polling: muatannya kecil.

```graphql
query Ringkas($id: ID!) {
  seatMap(tripId: $id, from: "SGU", to: "YK") { available total }
}
```

### Papan keberangkatan

```graphql
{ upcomingDepartures(limit: 5) { tripId trainName fromName toName departureAt status delayMinutes } }
```

## Mutation

### Membuat perjalanan

```graphql
mutation {
  createTrip(input: { lineCode: "ARN", serviceDate: "2026-11-30", departureTime: "14:30" }) {
    id trainName departureAt
  }
}
```

### Mengubah status perjalanan

`CANCELLED` membatalkan semua pesanan dan mengembalikan dana penuh lewat antrian.

```graphql
mutation Status($id: ID!) {
  updateTripStatus(id: $id, status: DELAYED, delayMinutes: 15) { id status delayMinutes }
}
```

## Kode error

Dikembalikan pada `errors[0].extensions.code`.

| Kode | Arti |
|---|---|
| `GRAPHQL_PARSE_FAILED` | Sintaks query salah (HTTP 400) |
| `GRAPHQL_VALIDATION_FAILED` | Field atau argumen tidak ada (HTTP 400) |
| `QUERY_TOO_DEEP` | Kedalaman lebih dari 8 (HTTP 400) |
| `QUERY_TOO_LARGE` | Lebih dari 200 field (HTTP 400) |
| `INSUFFICIENT_SCOPE` | Token tidak punya scope yang diperlukan |
| `INVALID_SEGMENT` | Asal tidak berada sebelum tujuan |
| `TRIP_NOT_FOUND` | Perjalanan tidak ditemukan |
| `SERVICE_UNAVAILABLE` | Booking-service tidak bisa dihubungi |
