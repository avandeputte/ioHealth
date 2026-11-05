"""Sign-in, uploads per account, and the web API over them."""
import gzip
import json
from datetime import datetime, timedelta, timezone

import pytest

from app import db

UTC = timezone.utc


def ndjson(*msgs) -> bytes:
    return b"".join(json.dumps(m).encode() + b"\n" for m in msgs)


def sample(uuid, typ, t, value, unit="count", kind="quantity", source="Watch", minutes=1, **extra):
    s = {"uuid": uuid, "type": typ, "kind": kind, "start": t.strftime("%Y-%m-%dT%H:%M:%SZ"), "end": (t + timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%SZ"),
         "value": value, "unit": unit, "source": {"name": source}}
    s.update(extra)
    return {"sample": {"_0": s}}


def upload(client, token, *msgs, seq=1, gz=True):
    r = client.post("/v1/sessions", json={"deviceName": "aphone", "systemVersion": "26.1", "fullResync": False}, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 201, r.text
    sid = r.json()["sessionId"]
    body = ndjson(*msgs)
    headers = {"Authorization": f"Bearer {token}", "X-Batch-Seq": str(seq), "Content-Type": "application/x-ndjson"}
    if gz:
        body, headers["Content-Encoding"] = gzip.compress(body), "gzip"
    r = client.post(f"/v1/sessions/{sid}/items", content=body, headers=headers)
    assert r.status_code == 200, r.text
    applied = r.json()["applied"]
    r = client.post(f"/v1/sessions/{sid}/finish", json={"totalSent": len(msgs)}, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    return sid, applied, r.json()["received"]


def app_password(client, label="iPhone"):
    r = client.post("/api/auth/app-passwords", json={"label": label})
    assert r.status_code == 200, r.text
    return r.json()["password"]


T0 = datetime(2026, 10, 1, 8, tzinfo=UTC)


def test_everything_needs_an_account(client):
    assert client.get("/v1/health").status_code == 200
    assert client.get("/api/status").status_code == 401
    assert client.get("/api/series?type=step_count").status_code == 401
    assert client.get("/").status_code == 200  # the shell, which shows the sign-in
    r = client.post("/v1/sessions", json={"deviceName": "x"})
    assert r.status_code == 401 and "error" in r.json()


def test_upload_with_app_password_and_read_back(client, admin):
    pw = app_password(client)
    assert pw.startswith("iohealth-")
    sid, applied, received = upload(client, pw,
                                    sample("s1", "step_count", T0, 100), sample("s2", "step_count", T0 + timedelta(minutes=5), 50, source="iPhone"),
                                    sample("s3", "heart_rate", T0, 70, "count/min"), {"characteristic": {"key": "dateOfBirth", "value": "1980-01-01"}},
                                    {"typeDone": {"type": "step_count", "added": 2, "deleted": 0}}, {"ecg": {"_0": {"uuid": "e"}}})
    assert applied == 4 and received == 4
    assert db.one("SELECT user_id FROM samples WHERE uuid = 's1'")[0] == admin["id"]
    assert db.one("SELECT user_id, device FROM sync_log WHERE id = %s", (sid,)) == (admin["id"], "aphone")
    # the rollup kept the hours up to date inside the batch
    assert db.one("SELECT SUM(n) FROM sample_hourly WHERE type = 'step_count' AND user_id = %s", (admin["id"],))[0] == 2

    types = {t["type"]: t for t in client.get("/api/types").json()}
    assert types["step_count"]["count"] == 2 and types["step_count"]["cumulative"] and types["heart_rate"]["unit"] == "count/min"
    s = client.get("/api/series", params={"type": "step_count", "from": "2026-10-01", "to": "2026-10-01", "bucket": "day", "tz": "Europe/Brussels"}).json()
    assert [p["v"] for p in s["points"]] == [100]  # the biggest source, not the sum
    st = client.get("/api/status").json()
    assert st["lastSync"]["device"] == "aphone" and st["lastSync"]["items"] == 6
    p = client.get("/api/profile").json()
    assert p["age"] == 46 and p["maxHrFrom"] == "age"
    assert client.get("/api/settings").json() == {}
    assert client.put("/api/settings", json={"units": "imperial"}).json() == {"saved": 1}
    assert client.get("/api/settings").json() == {"units": "imperial"}


def test_duplicate_batch_is_skipped(client, admin):
    pw = app_password(client)
    r = client.post("/v1/sessions", json={"deviceName": "aphone"}, headers={"Authorization": f"Bearer {pw}"})
    sid = r.json()["sessionId"]
    h = {"Authorization": f"Bearer {pw}", "X-Batch-Seq": "1"}
    assert client.post(f"/v1/sessions/{sid}/items", content=ndjson(sample("s1", "step_count", T0, 100)), headers=h).json()["applied"] == 1
    assert client.post(f"/v1/sessions/{sid}/items", content=ndjson(sample("s1", "step_count", T0, 100)), headers=h).json() == {"applied": 0, "duplicate": True}
    assert client.post(f"/v1/sessions/{sid}/items", content=b"{}", headers={**h, "X-Batch-Seq": "2"}).status_code == 400
    assert client.post(f"/v1/sessions/{sid}/items", content=b"", headers={"Authorization": f"Bearer {pw}"}).status_code == 400
    assert client.post("/v1/sessions/999999/items", content=b"", headers={**h, "X-Batch-Seq": "3"}).status_code == 404


def test_accounts_see_only_their_own_data(client, admin):
    alex_pw = app_password(client)
    upload(client, alex_pw, sample("a1", "step_count", T0, 100), {"workout": {"_0": {
        "uuid": "w1", "activityType": "running", "activityTypeRaw": 37, "start": "2026-10-01T07:00:00Z", "end": "2026-10-01T07:30:00Z", "duration": 1800,
        "source": {"name": "Watch"}, "statistics": [{"type": "distance_walking_running", "unit": "km", "sum": 5}], "events": [], "activities": []}}})
    # a second account: an editor
    r = client.post("/api/users", json={"name": "bo", "password": "secretpw2", "role": "editor"})
    assert r.status_code == 200, r.text
    client.cookies.clear()
    assert client.post("/api/auth/login", json={"name": "bo", "password": "secretpw2"}).status_code == 200
    bo_pw = app_password(client, "Bo's phone")
    upload(client, bo_pw, sample("b1", "step_count", T0, 7), sample("a1", "step_count", T0, 999))  # a1 is alex's: left alone
    assert db.one("SELECT value, user_id FROM samples WHERE uuid = 'a1'") == (100, admin["id"])
    types = {t["type"]: t for t in client.get("/api/types").json()}
    assert types["step_count"]["count"] == 1
    assert client.get("/api/workouts").json() == []
    assert client.get("/api/workouts/w1").status_code == 404
    assert client.get("/api/records").json()["totals"] == []
    # alex still sees the workout
    client.cookies.clear()
    client.post("/api/auth/login", json={"name": "alex", "password": "secretpw1"})
    ws = client.get("/api/workouts").json()
    assert len(ws) == 1 and ws[0]["distance"] == 5000 and ws[0]["hasRoute"] is False
    w = client.get("/api/workouts/w1").json()
    assert w["activityType"] == "running" and w["statistics"][0]["sum"] == 5
    rec = client.get("/api/records").json()
    assert rec["totals"][0]["count"] == 1 and any(r["name"] == "Farthest" for r in rec["records"])
    # a viewer may not upload
    client.post("/api/users", json={"name": "cy", "password": "secretpw3", "role": "viewer"})
    client.cookies.clear()
    client.post("/api/auth/login", json={"name": "cy", "password": "secretpw3"})
    cy_pw = app_password(client)
    r = client.post("/v1/sessions", json={"deviceName": "x"}, headers={"Authorization": f"Bearer {cy_pw}"})
    assert r.status_code == 403


def test_sleep_glucose_and_deletes(client, admin):
    pw = app_password(client)
    night = datetime(2026, 10, 1, 22, tzinfo=UTC)
    glucose = [sample(f"g{i}", "blood_glucose", T0 + timedelta(minutes=5 * i), 100 + i, "mg/dL") for i in range(10)]
    upload(client, pw, sample("sl1", "sleep_analysis", night, None, None, "category", minutes=420, text="core"),
           sample("sl2", "sleep_analysis", night + timedelta(minutes=420), None, None, "category", minutes=60, text="rem"),
           {"activitySummary": {"_0": {"date": "2026-10-01", "activeEnergyBurned": 600, "activeEnergyBurnedGoal": 500, "appleExerciseTime": 40,
                                        "appleExerciseTimeGoal": 30, "appleStandHours": 12, "appleStandHoursGoal": 12, "appleMoveTime": 0, "appleMoveTimeGoal": 0}}},
           *glucose)
    nights = client.get("/api/sleep", params={"from": "2026-10-01", "to": "2026-10-03", "tz": "UTC"}).json()
    assert len(nights) == 1 and nights[0]["asleep"] == 480 and nights[0]["date"] == "2026-10-02"
    one = client.get("/api/sleep", params={"date": "2026-10-02", "tz": "UTC"}).json()
    assert len(one["segments"]) == 2
    g = client.get("/api/glucose", params={"from": "2026-10-01", "to": "2026-10-01", "tz": "UTC"}).json()
    assert g["stats"]["readings"] == 10 and g["stats"]["min"] == 100 and len(g["readings"]) == 10
    act = client.get("/api/activity", params={"from": "2026-10-01", "to": "2026-10-01", "tz": "UTC"}).json()
    assert act == [{"date": "2026-10-01", "move": 600, "moveGoal": 500, "exercise": 40, "exerciseGoal": 30, "stand": 12, "standGoal": 12}]
    types = {t["type"]: t for t in client.get("/api/types").json()}
    assert types["activity_move"]["kind"] == "ring" and types["sleep_analysis"]["unit"] == "h"
    s = client.get("/api/series", params={"type": "activity_move", "from": "2026-10-01", "to": "2026-10-01", "tz": "UTC"}).json()
    assert [p["v"] for p in s["points"]] == [600]
    rec = client.get("/api/records").json()
    assert rec["rings"][3]["longest"] == 1
    # a delete removes the sample and its hour
    upload(client, pw, {"deleted": {"uuid": "g0", "type": "blood_glucose"}}, seq=1)
    assert db.one("SELECT COUNT(*) FROM samples WHERE type = 'blood_glucose'")[0] == 9
    assert db.one("SELECT uuid FROM deleted_objects")[0] == "g0"


def test_every_api_route_declares_access(app):
    from app import access
    for r in app.routes:
        path = getattr(r, "path", "")
        if path.startswith(("/api/", "/v1/")):
            assert access.declared(r) is not None, f"{path} has no access marker"


@pytest.mark.parametrize("bad", ["2026-13-01", "nope"])
def test_bad_dates(client, admin, bad):
    r = client.get("/api/series", params={"type": "step_count", "from": bad})
    assert r.status_code == 400 and "yyyy-mm-dd" in r.json()["error"]


def test_the_phone_signs_in_with_the_account_password(client, admin):
    """HTTP Basic with the user name and account password, as the iPhone app sends it (an app password works there too)."""
    import base64
    client.cookies.clear()
    basic = "Basic " + base64.b64encode(b"alex:secretpw1").decode()
    r = client.post("/v1/sessions", json={"deviceName": "aphone"}, headers={"Authorization": basic})
    assert r.status_code == 201 and r.json()["sessionId"]
    wrong = "Basic " + base64.b64encode(b"alex:not-the-password").decode()
    assert client.post("/v1/sessions", json={"deviceName": "aphone"}, headers={"Authorization": wrong}).status_code == 401


def test_registers_in_the_suite_list(client):
    from iothing_auth import suite
    from app import __version__
    assert suite.get("iohealth") is None
    client.get("/v1/health")
    row = suite.get("iohealth")
    assert row["name"] == "ioHealth" and row["version"] == __version__
    assert row["description"] == "Health and fitness" and row["color"] == "#e8445a"


def test_suite_apps_for_the_app_switcher(client):
    """The app mark becomes a menu of the suite's other apps: /api/auth/suite lists them with an address and an
    absolute icon, ioHealth among them."""
    from iothing_auth import suite
    client.get("/v1/health")
    suite.register("iopix", name="ioPix", url="https://photo.example.net", color="#123456", icon="/static/icon.svg")
    r = client.get("/api/auth/suite").json()
    assert r["app"] == "iohealth"
    other = [a for a in r["items"] if a["app"] != r["app"]]
    assert [(a["name"], a["url"], a["icon"]) for a in other] == [("ioPix", "https://photo.example.net", "https://photo.example.net/static/icon.svg")]
