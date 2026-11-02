"""Fixture bersama PyTest: alamat gateway, sesi login PKCE, dan pembuat kursi yang tidak bentrok antar test."""
import base64
import hashlib
import os
import random
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
PASSWORD = os.environ.get("SEED_USER_PASSWORD", "Rangkai2026!")
WIB = timezone(timedelta(hours=7))
ROWS = {"PRM1": 16, "PRM2": 16, "EKS1": 12, "EKS2": 12}


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def login(email: str, password: str = PASSWORD) -> str:
    verifier = b64url(secrets.token_bytes(48))
    challenge = b64url(hashlib.sha256(verifier.encode()).digest())
    redirect = f"{BASE_URL}/auth/callback"
    auth = requests.get(
        f"{BASE_URL}/oauth/authorize",
        params={
            "response_type": "code", "client_id": "rangkai-postman", "redirect_uri": redirect,
            "code_challenge": challenge, "code_challenge_method": "S256", "state": secrets.token_urlsafe(12),
        },
        headers={"Accept": "application/json"}, timeout=10,
    ).json()
    code = requests.post(f"{BASE_URL}/oauth/login", json={"auth_request": auth["auth_request"], "email": email, "password": password}, timeout=10).json()["code"]
    token = requests.post(
        f"{BASE_URL}/oauth/token",
        data={"grant_type": "authorization_code", "client_id": "rangkai-postman", "code": code, "code_verifier": verifier, "redirect_uri": redirect},
        timeout=10,
    ).json()
    return token["access_token"]


class Api:
    """Pembungkus tipis requests yang selalu memakai gateway."""

    def __init__(self, token=None):
        self.token = token

    def _headers(self, extra=None, idem=False):
        h = dict(extra or {})
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        if idem:
            h["Idempotency-Key"] = str(uuid.uuid4())
        return h

    def get(self, path, **kw):
        return requests.get(BASE_URL + path, headers=self._headers(kw.pop("headers", None)), timeout=15, **kw)

    def post(self, path, json=None, idem=False, **kw):
        return requests.post(BASE_URL + path, json=json, headers=self._headers(kw.pop("headers", None), idem), timeout=15, **kw)

    def delete(self, path):
        return requests.delete(BASE_URL + path, headers=self._headers(), timeout=15)


def wib_date(days_ahead: int) -> str:
    return (datetime.now(WIB) + timedelta(days=days_ahead)).strftime("%Y-%m-%d")


@pytest.fixture(scope="session")
def anon():
    return Api()


@pytest.fixture(scope="session")
def customer():
    return Api(login("customer@rangkai.test"))


@pytest.fixture(scope="session")
def other():
    return Api(login("customer2@rangkai.test"))


@pytest.fixture(scope="session")
def admin():
    return Api(login("admin@rangkai.test"))


@pytest.fixture(scope="session")
def trip_id(anon):
    data = anon.get(f"/api/schedules?from=SGU&to=YK&date={wib_date(9)}").json()
    return next(t["tripId"] for t in data["trips"] if t["tripId"].startswith("ARN-"))


@pytest.fixture()
def seat():
    """Kursi acak agar tiap test mandiri dan bisa diulang (prinsip FIRST)."""
    coach = random.choice(list(ROWS))
    return f"{coach}-{random.randint(1, ROWS[coach])}{random.choice('ABCD')}"


@pytest.fixture()
def fresh_user():
    email = f"pytest.{uuid.uuid4().hex[:12]}@rangkai.test"
    password = "UjiPytest12345"
    r = requests.post(f"{BASE_URL}/api/auth/register", json={"name": "Pengguna PyTest", "email": email, "password": password}, timeout=10)
    assert r.status_code == 201
    return Api(login(email, password))
