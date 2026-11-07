"""Tests run against a test MariaDB of their own (iosuite_shared.testing: a Docker container, or the server named by
IOSUITE_TEST_DB=host:port:user:password): two scratch databases, health_test and health_test_auth, dropped and
recreated per session, never a live one. Without a test server the suite is skipped. The app starts once per session;
every test begins with empty tables."""
import os
import re

import pytest

from iosuite_shared import testing as _authtest

if _authtest.server() is None:
    pytest.skip(f"{_authtest.server.reason}: the tests need a MariaDB (Docker, or IOSUITE_TEST_DB=host:port:user:password)", allow_module_level=True)
_s = _authtest.server()
os.environ.update(DB_HOST=_s["host"], DB_PORT=str(_s["port"]), DB_USER=_s["user"], DB_PASSWORD=_s["password"], DB_NAME="health_test")
_authtest.fresh_database("health_test")
os.environ.update(_authtest.auth_env("health_test_auth"))
os.environ.update(TZ="Europe/Brussels", LOG_FILE="")  # no server log from the tests
os.environ.pop("ADMIN_USER", None)
os.environ.pop("ADMIN_PASSWORD", None)

from app import db  # noqa: E402

HEALTH_TABLES = tuple(re.search(r"hlt_\w+", s).group(0) for s in db.SCHEMA)


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
    from app import webapi
    from app.auth import auth
    with db.conn() as con, con.cursor() as cur:
        for t in HEALTH_TABLES:
            cur.execute(f"DELETE FROM {t}")
    _authtest.clean_shared_tables(auth)
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
