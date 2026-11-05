"""Test set-up: a scratch health database and a scratch Shared ioSuite database on a real MariaDB, emptied before every test.

IOSUITE_TEST_DB=host:port:user:password names the server, as in every app of the suite (default
127.0.0.1:3306:health:health); the databases are health_test and iosuite_test_iohealth. The tests skip without a
server. CI gets a service."""
import os

import pymysql
import pytest

_h, _p, _u, _w = (os.environ.get("IOSUITE_TEST_DB", "").split(":", 3) + ["", "", "", ""])[:4]
os.environ.update(DB_HOST=_h or "127.0.0.1", DB_PORT=_p or "3306", DB_USER=_u or "health", DB_PASSWORD=_w or ("" if _u else "health"),
                  DB_NAME="health_test", TZ="Europe/Brussels")
os.environ.pop("ADMIN_USER", None)
os.environ.pop("ADMIN_PASSWORD", None)
os.environ["IOSUITE_DB_NAME"] = "iosuite_test_iohealth"
os.environ["IOSUITE_DB_USER"] = os.environ["DB_USER"]
os.environ["IOSUITE_DB_PASSWORD"] = os.environ["DB_PASSWORD"]

from app import db  # noqa: E402

HEALTH_TABLES = tuple(db.RENAME_TABLES.values())


def _server_up() -> bool:
    try:
        pymysql.connect(host=os.environ["DB_HOST"], port=int(os.environ["DB_PORT"]), user=os.environ["DB_USER"], password=os.environ["DB_PASSWORD"],
                        connect_timeout=3).close()
        return True
    except pymysql.MySQLError:
        return False


def pytest_collection_modifyitems(config, items):
    if not _server_up():
        skip = pytest.mark.skip(reason="no MariaDB at IOSUITE_TEST_DB")
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
    from iosuite_shared import db as authdb, suite, users
    from app import webapi
    from app.auth import auth
    with db.conn() as con, con.cursor() as cur:
        for t in HEALTH_TABLES:
            cur.execute(f"DELETE FROM {t}")
    authdb.ex("DELETE FROM ios_users")
    authdb.ex("ALTER TABLE ios_users AUTO_INCREMENT = 1")
    authdb.ex("DELETE FROM ios_settings")
    authdb.ex("DELETE FROM ios_apps")
    auth._registered = False
    suite.invalidate()
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
