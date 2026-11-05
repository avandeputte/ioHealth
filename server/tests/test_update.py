"""The version check (Settings › Server) and Maintenance: admins only, and the "a newer version is out" banner while the daily check is on."""
from app import __version__, updates


def test_status_tells_admins_of_a_newer_version_while_the_daily_check_is_on(client, admin):
    updates._checked.clear()
    updates._checked.update(status="update", remote="abc1234", remoteVersion="9.9.9", remoteMessage="v9.9.9: new", remoteDate="2026-11-03")
    try:
        s = client.get("/api/status").json()
        assert s["version"] == __version__ and s["commit"]
        assert s["update"]["version"] == "9.9.9" and "canRun" in s["update"] and "docker" in s["update"]
        assert client.post("/api/server", json={"autoCheck": False}).json()["autoCheck"] is False
        assert client.get("/api/status").json()["update"] is None
        client.post("/api/server", json={"autoCheck": True})
        assert client.get("/api/status").json()["update"]["remote"] == "abc1234"
        # the same version under a newer commit (docs, workflow) is nothing to install
        updates._checked.update(status="current")
        assert client.get("/api/status").json()["update"] is None
    finally:
        updates._checked.clear()


def test_a_viewer_gets_neither_the_banner_nor_maintenance(client, admin):
    client.post("/api/users", json={"name": "bo", "password": "secretpw2", "role": "viewer"})
    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={"name": "bo", "password": "secretpw2"})
    assert "update" not in client.get("/api/status").json()
    assert client.get("/api/maintenance").status_code == 403
    assert client.get("/api/maintenance/uploads").status_code == 403
    assert client.get("/api/server").status_code == 403
    assert client.post("/api/server", json={"action": "check"}).status_code == 403
    assert client.post("/api/server", json={"action": "update"}).status_code == 403


def test_maintenance(client, admin):
    m = client.get("/api/maintenance").json()
    assert m["version"] == __version__ and m["database"]["schemaVersion"] >= 9
    assert [t["name"] for t in m["database"]["tables"]][0] == "samples" and all("rows" in t and "bytes" in t for t in m["database"]["tables"])
    assert "ready" in m["rollup"] and "update" not in m  # the version and updates are under Settings › Server
    u = client.get("/api/maintenance/uploads").json()
    assert u["syncs"] == [] and u["total"] == 0


def test_server_status_and_update(client, admin, monkeypatch):
    s = client.get("/api/server").json()
    assert s["version"] == __version__ and s["installed"] and isinstance(s["canRun"], bool)
    assert s["autoCheck"] is True and s["progress"]["running"] is False and s["repo"] and s["branch"] and s["database"]
    # in Docker (or with no update.sh to run) the run is refused with the pull hint, nothing is started
    monkeypatch.setattr(updates, "in_docker", lambda: True)
    r = client.post("/api/server", json={"action": "update"})
    assert r.status_code == 409 and "docker compose pull" in r.json()["error"]
    r = client.post("/api/server", json={"action": "update", "ref": "--evil"})
    assert r.status_code == 409


def test_remote_version_from_a_commit_message():
    assert updates.remote_version("v2.1.0: sidebar") == "2.1.0"
    assert updates.remote_version("Fix a typo") is None
