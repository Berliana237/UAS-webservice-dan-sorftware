"""Uji API berbasis Equivalence Partitioning dan Boundary Value Analysis, memakai pytest.mark.parametrize."""
import time

import pytest
import requests

from conftest import BASE_URL, Api, login, wib_date

NIK = "3578015203990001"


def lock(api, trip, seat, frm="SGU", to="MN", **extra):
    return api.post("/api/locks", json={"tripId": trip, "from": frm, "to": to, "seats": [seat], **extra}, idem=True)


def release(api, res):
    if res.status_code == 201:
        api.delete(f"/api/locks/{res.json()['id']}")


class TestRegistration:
    @pytest.mark.parametrize("password,status", [
        ("abc1234", 422),            # 7 karakter, tepat di bawah batas
        ("abcd1234", 201),           # 8 karakter, tepat di batas
        ("abcdefgh", 422),           # tanpa angka
        ("12345678", 422),           # tanpa huruf
        ("a1" + "x" * 70, 201),      # 72 karakter, batas atas
        ("a1" + "x" * 71, 422),      # 73 karakter
    ])
    def test_password_boundaries(self, password, status):
        email = f"pw.{time.time_ns()}@rangkai.test"
        r = requests.post(f"{BASE_URL}/api/auth/register", json={"name": "Uji Sandi", "email": email, "password": password}, timeout=10)
        assert r.status_code == status

    @pytest.mark.parametrize("email", ["tanpa-at", "a@b", "@rangkai.test", "spasi di@email.com"])
    def test_invalid_email_rejected(self, email):
        r = requests.post(f"{BASE_URL}/api/auth/register", json={"name": "Uji Email", "email": email, "password": "abcd1234"}, timeout=10)
        assert r.status_code == 422
        assert "email" in r.json()["error"]["details"]["fields"]

    def test_duplicate_email_rejected(self):
        email = f"dup.{time.time_ns()}@rangkai.test"
        body = {"name": "Uji Ganda", "email": email, "password": "abcd1234"}
        assert requests.post(f"{BASE_URL}/api/auth/register", json=body, timeout=10).status_code == 201
        again = requests.post(f"{BASE_URL}/api/auth/register", json={**body, "email": email.upper()}, timeout=10)
        assert again.status_code == 409


class TestSchedule:
    @pytest.mark.parametrize("params,status", [
        ({"from": "SGU", "to": "MN", "date": wib_date(1)}, 200),
        ({"from": "SGU", "to": "SGU", "date": wib_date(1)}, 422),   # asal sama dengan tujuan
        ({"from": "SGU", "to": "MN", "date": "2026/11/10"}, 422),   # format tanggal salah
        ({"from": "SGU", "to": "MN"}, 422),                         # parameter kurang
        ({"from": "XXX", "to": "MN", "date": wib_date(1)}, 200),    # stasiun tak dikenal: hasil kosong
    ])
    def test_search_partitions(self, anon, params, status):
        assert anon.get("/api/schedules", params=params).status_code == status

    def test_unknown_station_returns_empty(self, anon):
        data = anon.get("/api/schedules", params={"from": "XXX", "to": "MN", "date": wib_date(1)}).json()
        assert data["count"] == 0

    def test_only_forward_direction(self, anon):
        fwd = anon.get("/api/schedules", params={"from": "SGU", "to": "MN", "date": wib_date(2)}).json()
        back = anon.get("/api/schedules", params={"from": "MN", "to": "SGU", "date": wib_date(2)}).json()
        assert any(t["tripId"].startswith("ARN-") for t in fwd["trips"])
        assert not any(t["tripId"].startswith("ARN-") for t in back["trips"])

    def test_fare_matches_formula_for_every_class(self, anon):
        trip = anon.get("/api/schedules", params={"from": "SGU", "to": "MN", "date": wib_date(2)}).json()["trips"][0]
        fares = {f["seatClass"]: f["adult"] for f in trip["fares"]}
        assert fares["EKSEKUTIF"] == 189000  # (45.000 + 900 x 160) dibulatkan ke atas
        assert fares["PREMIUM"] == 114000
        assert fares["SUITE"] == 411000


class TestLockInput:
    @pytest.mark.parametrize("count,status", [(0, 422), (1, 201), (4, 201), (5, 422)])
    def test_seat_count_boundaries(self, fresh_user, trip_id, count, status):
        seats = [f"EKS2-{time.time_ns() % 12 + 1}{'ABCD'[i % 4]}" if i < 4 else "EKS2-1A" for i in range(count)]
        seats = list(dict.fromkeys(seats)) + (["EKS1-1A"] if count == 5 else [])
        r = fresh_user.post("/api/locks", json={"tripId": trip_id, "from": "SGU", "to": "MR", "seats": seats}, idem=True)
        assert r.status_code in (status, 409 if status == 201 else status)
        release(fresh_user, r)

    @pytest.mark.parametrize("ttl,status", [(2, 422), (3, 201), (600, 201)])
    def test_ttl_boundaries(self, fresh_user, trip_id, seat, ttl, status):
        r = lock(fresh_user, trip_id, seat, ttlSeconds=ttl)
        assert r.status_code in (status, 409 if status == 201 else status)
        release(fresh_user, r)

    def test_ttl_cannot_extend_server_limit(self, fresh_user, trip_id, seat):
        r = lock(fresh_user, trip_id, seat, ttlSeconds=3600)
        if r.status_code == 201:
            body = r.json()
            assert body["expiresAt"] - body["serverTime"] <= 601_000
        release(fresh_user, r)

    @pytest.mark.parametrize("frm,to", [("MN", "SGU"), ("SGU", "SGU"), ("SGU", "GMR"), ("XXX", "MN")])
    def test_invalid_segment(self, fresh_user, trip_id, seat, frm, to):
        r = lock(fresh_user, trip_id, seat, frm=frm, to=to)
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "INVALID_SEGMENT"

    @pytest.mark.parametrize("bad", ["ZZZ1-1A", "EKS1-99A"])
    def test_unknown_seat_rejected(self, fresh_user, trip_id, bad):
        r = lock(fresh_user, trip_id, bad)
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "UNKNOWN_SEAT"

    @pytest.mark.parametrize("bad", ["1' OR 1=1", "<script>", "EKS1-1Z", ""])
    def test_malformed_seat_rejected_by_gateway(self, fresh_user, trip_id, bad):
        r = lock(fresh_user, trip_id, bad)
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "SCHEMA_VALIDATION_FAILED"

    def test_unknown_trip(self, fresh_user, seat):
        assert lock(fresh_user, "TIDAK-ADA", seat).status_code == 404

    def test_active_lock_limit(self, fresh_user, trip_id):
        held = [lock(fresh_user, trip_id, f"EKS1-{r}C", frm="SLO", to="YK") for r in (10, 11)]
        third = lock(fresh_user, trip_id, "EKS1-12C", frm="SLO", to="YK")
        statuses = [h.status_code for h in held]
        if statuses == [201, 201]:
            assert third.status_code == 409
            assert third.json()["error"]["code"] == "TOO_MANY_ACTIVE_LOCKS"
        for h in held + [third]:
            release(fresh_user, h)


class TestSegments:
    @pytest.mark.parametrize("second,expected", [
        (("MN", "YK"), 201),    # bersebelahan: boleh
        (("JG", "NGW"), 409),   # menyeberangi batas
        (("NJ", "MN"), 409),    # ruas terakhir pemegang pertama
        (("SGU", "MR"), 409),   # ruas pertama pemegang pertama
        (("NGW", "SLO"), 201),  # jauh setelah batas
    ])
    def test_overlap_decision(self, customer, other, trip_id, seat, second, expected):
        first = lock(customer, trip_id, seat)
        if first.status_code != 201:
            pytest.skip("kursi acak sedang terpakai")
        r = lock(other, trip_id, seat, frm=second[0], to=second[1])
        try:
            assert r.status_code == expected
        finally:
            release(other, r)
            release(customer, first)


class TestPassengers:
    @pytest.mark.parametrize("age,nik,status,code", [
        (2, None, 422, "INFANT_NO_SEAT"),
        (3, None, 201, None),
        (16, None, 201, None),
        (17, None, 422, "NIK_REQUIRED"),
        (17, NIK, 201, None),
        (30, "123", 422, "INVALID_NIK"),
        (30, "1001015203990001", 422, "INVALID_NIK"),
        (30, "3578013203990001", 422, "INVALID_NIK"),
        (120, NIK, 201, None),
    ])
    def test_age_and_nik_decision_table(self, fresh_user, trip_id, seat, age, nik, status, code):
        lk = lock(fresh_user, trip_id, seat)
        if lk.status_code != 201:
            pytest.skip("kursi acak sedang terpakai")
        pax = {"seatId": seat, "name": "Uji Penumpang", "age": age}
        if nik:
            pax["nik"] = nik
        r = fresh_user.post("/api/bookings", json={"lockId": lk.json()["id"], "passengers": [pax]}, idem=True)
        assert r.status_code == status
        if code:
            assert r.json()["error"]["code"] == code
            release(fresh_user, lk)
        else:
            fresh_user.post(f"/api/bookings/{r.json()['id']}/cancel")

    @pytest.mark.parametrize("age,factor", [(3, 0.75), (11, 0.75), (12, 1.0), (59, 1.0), (60, 0.8)])
    def test_fare_by_age_boundaries(self, fresh_user, trip_id, age, factor):
        seat = f"PRM2-{time.time_ns() % 16 + 1}B"
        lk = lock(fresh_user, trip_id, seat, frm="MN", to="NGW")
        if lk.status_code != 201:
            pytest.skip("kursi acak sedang terpakai")
        pax = {"seatId": seat, "name": "Uji Tarif", "age": age, **({"nik": NIK} if age >= 17 else {})}
        r = fresh_user.post("/api/bookings", json={"lockId": lk.json()["id"], "passengers": [pax]}, idem=True)
        assert r.status_code == 201
        adult = 48000  # Premium, 33 km: 30.000 + 520 x 33 = 47.160, dibulatkan ke atas
        expected = ((int(adult * factor) + 999) // 1000) * 1000
        assert r.json()["amount"] == expected
        fresh_user.post(f"/api/bookings/{r.json()['id']}/cancel")

    def test_seat_mismatch_rejected(self, fresh_user, trip_id, seat):
        lk = lock(fresh_user, trip_id, seat)
        if lk.status_code != 201:
            pytest.skip("kursi acak sedang terpakai")
        r = fresh_user.post("/api/bookings", json={"lockId": lk.json()["id"], "passengers": [{"seatId": "EKS1-1B" if seat != "EKS1-1B" else "EKS1-1C", "name": "Salah Kursi", "age": 30, "nik": NIK}]}, idem=True)
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "PASSENGER_SEAT_MISMATCH"
        release(fresh_user, lk)


class TestAccessControl:
    @pytest.mark.parametrize("method,path", [
        ("GET", "/api/bookings"), ("GET", "/api/auth/me"), ("GET", "/api/notifications"), ("GET", "/api/admin/users"),
        ("GET", "/api/admin/queues"), ("GET", "/api/admin/audit"), ("GET", "/api/admin/registry"), ("POST", "/api/locks"),
    ])
    def test_requires_token(self, anon, method, path):
        r = anon.get(path) if method == "GET" else anon.post(path, json={})
        assert r.status_code == 401

    @pytest.mark.parametrize("path", ["/api/admin/users", "/api/admin/queues", "/api/admin/audit", "/api/admin/registry", "/api/admin/api-keys"])
    def test_customer_cannot_use_admin_routes(self, customer, path):
        assert customer.get(path).status_code == 403

    @pytest.mark.parametrize("path", ["/api/admin/users", "/api/admin/queues", "/api/admin/audit", "/api/admin/registry", "/api/admin/api-keys"])
    def test_admin_can_use_admin_routes(self, admin, path):
        assert admin.get(path).status_code == 200

    def test_partner_route_requires_key(self, anon):
        assert anon.get("/api/partner/v1/stations").status_code == 401
        assert anon.get("/api/partner/v1/stations", headers={"X-API-Key": "rk_live_palsu"}).status_code == 401


class TestGateway:
    def test_unknown_route(self, anon):
        assert anon.get("/api/tidak-ada").status_code == 404

    def test_wrong_method(self, anon):
        assert requests.put(f"{BASE_URL}/api/stations", timeout=10).status_code == 405

    def test_invalid_json(self, customer):
        r = requests.post(f"{BASE_URL}/api/locks", data="{bukan json", headers={"Authorization": f"Bearer {customer.token}", "Content-Type": "application/json", "Idempotency-Key": "kunci-json-rusak"}, timeout=10)
        assert r.status_code == 400

    def test_request_id_present(self, anon):
        assert anon.get("/api/stations").headers.get("X-Request-Id")

    def test_load_balancer_uses_both_instances(self, anon):
        seen = {anon.get("/api/bookings/instance").json()["instance"] for _ in range(10)}
        assert seen == {"booking-a", "booking-b"}


def test_login_helper_rejects_wrong_password():
    with pytest.raises(KeyError):
        login("customer2@rangkai.test", "SandiSalah999")


def test_api_wrapper_sets_bearer():
    assert Api("abc")._headers()["Authorization"] == "Bearer abc"
