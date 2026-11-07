"""Admins: Maintenance › Storage and backups and Uploads (the database and its tables, the hourly rollup, the last
upload of every account), laid out as in ioContacts and ioCalendar. The version, updates, restart and the server log
(Maintenance › Updates and logs) are iosuite_shared's server_router, mounted in app/main.py.

Maintenance answers from the server's own statistics: the row counts are information_schema's estimates, not a
COUNT(*) per table, which on tens of millions of samples and heartbeats took many seconds every time the page opened."""
from fastapi import APIRouter
from fastapi.responses import ORJSONResponse
from iosuite_shared import config as shared_config, users as shared

from app import __version__, access, config, db, webapi

router = APIRouter(default_response_class=ORJSONResponse)

TABLES = ("hlt_samples", "hlt_workouts", "hlt_workout_route_points", "hlt_heartbeats", "hlt_activity_summaries", "hlt_sample_hourly", "hlt_sync_log")


def _database() -> dict:
    p = db.params()
    return {"host": p["host"], "port": p["port"], "name": p["database"], "schemaVersion": db.schema_version()}


def _suite_database() -> dict:
    return {"host": shared_config.DB_HOST, "name": shared_config.DB_NAME}


@router.get("/api/maintenance", dependencies=[access.admin])
def maintenance():
    """The health database: its tables (estimated rows and size on disk), the types, and the hourly rollup."""
    p = db.params()
    stats = {name: {"rows": int(rows or 0), "bytes": int(size or 0)} for name, rows, size in db.q(
        "SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH + INDEX_LENGTH FROM information_schema.TABLES WHERE TABLE_SCHEMA = %s "
        "AND TABLE_NAME LIKE 'hlt\\_%%'",  # ioHealth's own: the database may hold the other apps' tables too
        (p["database"],))}
    tables = [{"name": t, **stats.get(t, {"rows": 0, "bytes": 0})} for t in TABLES]
    types = len(webapi.all_type_names())  # the samples index, cached
    return {
        "version": __version__,
        "database": {**_database(), "tables": tables, "bytes": sum(s["bytes"] for s in stats.values()), "types": types},
        "suite": _suite_database(),
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
                 "SELECT s.user_id, s.started_at, s.finished_at, s.device, s.items, s.full_resync FROM hlt_sync_log s "
                 "JOIN (SELECT user_id, MAX(id) id FROM hlt_sync_log GROUP BY user_id) m ON m.id = s.id ORDER BY s.started_at DESC")]
    total = db.one("SELECT COUNT(*) FROM hlt_sync_log")[0]  # small: one row per sync
    return {"syncs": syncs, "total": total}
