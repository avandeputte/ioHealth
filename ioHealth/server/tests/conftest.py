"""Test set-up: a scratch health database and a scratch auth database on a real MariaDB, emptied before every test.

IOHEALTH_TEST_DB_HOST / _PORT / _USER / _PASSWORD name the server (default 127.0.0.1:3306, health/health); the
databases are health_test and auth_test_iohealth. The tests skip without a server. CI gets a service."""
import os

import pymysql
import pytest

os.environ.update(DB_HOST=os.environ.get("IOHEALTH_TEST_DB_HOST", "127.0.0.1"), DB_PORT=os.environ.get("IOHEALTH_TEST_DB_PORT", "3306"),
                  DB_USER=os.environ.get("IOHEALTH_TEST_DB_USER", "health"), DB_PASSWORD=os.environ.get("IOHEALTH_TEST_DB_PASSWORD", "health"),
                  DB_NAME="health_test", TZ="Europe/Brussels")
os.environ.pop("ADMIN_USER", None)
os.environ.pop("ADMIN_PASSWORD", None)
os.environ["IOTHING_AUTH_DB_NAME"] = "auth_test_iohealth"
os.environ["IOTHING_AUTH_DB_USER"] = os.environ["DB_USER"]
os.environ["IOTHING_AUTH_DB_PASSWORD"] = os.environ["DB_PASSWORD"]

from app import db  # noqa: E402

HEALTH_TABLES = ("characteristics", "samples", "workouts", "workout_statistics", "workout_events", "workout_activities", "workout_route_points",
                 "heartbeats", "activity_summaries", "deleted_objects", "sync_log", "sample_hourly", "sample_hourly_ready", "web_settings")


def _server_up() -> bool:
    try:
        pymysql.connect(host=os.environ["DB_HOST"], port=int(os.environ["DB_PORT"]), user=os.environ["DB_USER"], password=os.environ["DB_PASSWORD"],
                        connect_timeout=3).close()
        return True
    except pymysql.MySQLError:
        return False


def pytest_collection_modifyitems(config, items):
    if not _server_up():
        skip = pytest.mark.skip(reason="no MariaDB at IOHEALTH_TEST_DB_HOST")
        for it in items:
            it.add_marker(skip)


@pytest.fixture(scope="session")
def app():
    from app.main import app as a
    return a


@pytest.fixture(scope="session")
def _client(app):
    from fastapi.testclient import TestClient
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def clean(_client):
    from iothing_auth import db as authdb, users
    from app import webapi
    with db.conn() as con, con.cursor() as cur:
        for t in HEALTH_TABLES:
            cur.execute(f"DELETE FROM {t}")
    authdb.ex("DELETE FROM users")
    authdb.ex("ALTER TABLE users AUTO_INCREMENT = 1")
    authdb.ex("DELETE FROM settings")
    users.invalidate()
    users._attempts.clear()
    webapi.cache.clear()
    webapi.effort_cache.clear()
    webapi._all_types["at"] = 0.0
    webapi._kinds.clear()
    webapi.ready.types = set()
    yield


@pytest.fixture
def client(_client):
    _client.cookies.clear()
    return _client


@pytest.fixture
def admin(client):
    """A signed-in suite admin, alex (the client carries the session cookie)."""
    r = client.post("/api/auth/setup", json={"name": "alex", "password": "secretpw1"})
    assert r.status_code == 200, r.text
    return r.json()["user"]
