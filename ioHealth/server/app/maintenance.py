"""Maintenance (admins): the server itself. What is installed and whether a newer version exists (app/updates.py),
the database and its tables, the hourly rollup, and the last upload of every account."""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import ORJSONResponse
from iothing_auth import users as shared

from app import __version__, access, config, db, updates, webapi

router = APIRouter(default_response_class=ORJSONResponse)

TABLES = ("samples", "workouts", "workout_route_points", "heartbeats", "activity_summaries", "sample_hourly", "sync_log")


@router.get("/api/maintenance", dependencies=[access.admin])
def maintenance(request: Request):
    p = db.params()
    counts = {t: db.one(f"SELECT COUNT(*) FROM {t}")[0] for t in TABLES}
    types = db.one("SELECT COUNT(DISTINCT type) FROM samples")[0]
    names = {u["id"]: u["name"] for u in shared.list_users()}
    syncs = []
    for uid, started, finished, device, items, full in db.q(
            "SELECT s.user_id, s.started_at, s.finished_at, s.device, s.items, s.full_resync FROM sync_log s "
            "JOIN (SELECT user_id, MAX(id) id FROM sync_log GROUP BY user_id) m ON m.id = s.id ORDER BY s.started_at DESC"):
        syncs.append({"user": names.get(uid, f"#{uid}"), "started": db.unix(started), "finished": db.unix(finished), "device": device or "",
                      "items": items or 0, "fullResync": bool(full)})
    return {
        "version": __version__, "commit": updates.local_commit()[:7], "docker": updates.in_docker(),
        "database": {"host": p["host"], "port": p["port"], "name": p["database"], "schemaVersion": db.schema_version(), "tables": counts, "types": types},
        "auth": {"host": config.env("IOTHING_AUTH_DB_HOST", config.DB_HOST), "name": config.env("IOTHING_AUTH_DB_NAME", "auth")},
        "rollup": {"ready": sorted(webapi.ready.types), "total": types},
        "syncs": syncs,
        "tz": config.TZ, "update": updates.status(),
    }


@router.get("/api/update", dependencies=[access.admin])
def update_status():
    return updates.status()


@router.post("/api/update/check", dependencies=[access.admin])
def update_check():
    return updates.check()


@router.post("/api/update/auto", dependencies=[access.admin])
async def update_auto(request: Request):
    if not config.UPDATE_CHECK:
        raise HTTPException(409, "UPDATE_CHECK=0 in the environment: the daily check is off for good")
    body = await request.json()
    updates.set_auto_check(bool(body.get("on", True)))
    return {"autoCheck": updates.auto_check_enabled()}


@router.post("/api/update/run", dependencies=[access.admin])
async def update_run(request: Request):
    body = await request.json() if int(request.headers.get("content-length") or 0) else {}
    try:
        updates.run(str(body.get("ref") or ""))
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    return {"started": True}
