"""Admins: Settings › Server (the installed version, the update check and update.sh, app/updates.py) and Maintenance
(the database and its tables, the hourly rollup, the last upload of every account), laid out as in ioContacts and
ioCalendar.

Maintenance answers from the server's own statistics: the row counts are information_schema's estimates, not a
COUNT(*) per table, which on tens of millions of samples and heartbeats took many seconds every time the page opened."""
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import ORJSONResponse
from iothing_auth import users as shared

from app import __version__, access, config, db, updates, webapi

router = APIRouter(default_response_class=ORJSONResponse)

TABLES = ("samples", "workouts", "workout_route_points", "heartbeats", "activity_summaries", "sample_hourly", "sync_log")


def _database() -> dict:
    p = db.params()
    return {"host": p["host"], "port": p["port"], "name": p["database"], "schemaVersion": db.schema_version()}


def _auth_database() -> dict:
    """The Shared ioSuite database, as iothing-auth resolved it (IOSUITE_SHARED_DB_*, the older names, or the defaults)."""
    from iothing_auth import db as shared
    p = shared.params()
    return {"host": p["host"], "name": p["database"]}


# ---- Settings › Server

@router.get("/api/server", dependencies=[access.admin])
def server_info():
    """The installed version, the last update check, whether update.sh can run here, the daily check switch."""
    d = _database()
    return {**updates.status(), "repo": updates.REPO, "branch": updates.BRANCH, "timezone": config.TZ,
            "database": f"{d['host']}:{d['port']}/{d['name']}", "schemaVersion": d["schemaVersion"]}


@router.post("/api/server", dependencies=[access.admin])
async def server_action(request: Request):
    """Body: {action: check | update, ref?} or {autoCheck: bool}; answers with the server info (or the check)."""
    b = await request.json() if int(request.headers.get("content-length") or 0) else {}
    if "autoCheck" in b:
        if not config.UPDATE_CHECK:
            raise HTTPException(409, "UPDATE_CHECK=0 in the environment keeps the daily check off")
        updates.set_auto_check(bool(b["autoCheck"]))
    action = b.get("action")
    if action == "check":
        return await run_in_threadpool(updates.check)
    if action == "update":
        try:
            updates.run(str(b.get("ref") or ""))
        except RuntimeError as e:
            raise HTTPException(409, str(e))
        return {"started": True}
    return await run_in_threadpool(server_info)


# ---- Maintenance

@router.get("/api/maintenance", dependencies=[access.admin])
def maintenance():
    """The health database: its tables (estimated rows and size on disk), the types, and the hourly rollup."""
    p = db.params()
    stats = {name: {"rows": int(rows or 0), "bytes": int(size or 0)} for name, rows, size in db.q(
        "SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH + INDEX_LENGTH FROM information_schema.TABLES WHERE TABLE_SCHEMA = %s",
        (p["database"],))}
    tables = [{"name": t, **stats.get(t, {"rows": 0, "bytes": 0})} for t in TABLES]
    types = len(webapi.all_type_names())  # the samples index, cached
    return {
        "version": __version__,
        "database": {**_database(), "tables": tables, "bytes": sum(s["bytes"] for s in stats.values()), "types": types},
        "auth": _auth_database(),
        "rollup": {"ready": len(webapi.ready.types), "total": types},
        "tz": config.TZ,
    }


@router.get("/api/maintenance/uploads", dependencies=[access.admin])
def uploads():
    """The last sync of every account, newest first."""
    names = {u["id"]: u["name"] for u in shared.list_users()}
    syncs = [{"user": names.get(uid, f"#{uid}"), "started": db.unix(started), "finished": db.unix(finished), "device": device or "",
              "items": items or 0, "fullResync": bool(full)}
             for uid, started, finished, device, items, full in db.q(
                 "SELECT s.user_id, s.started_at, s.finished_at, s.device, s.items, s.full_resync FROM sync_log s "
                 "JOIN (SELECT user_id, MAX(id) id FROM sync_log GROUP BY user_id) m ON m.id = s.id ORDER BY s.started_at DESC")]
    total = db.one("SELECT COUNT(*) FROM sync_log")[0]  # small: one row per sync
    return {"syncs": syncs, "total": total}
