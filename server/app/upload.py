"""The upload API the iPhone app uses; each upload belongs to an account:

  GET  /v1/health                       no sign-in: {"ok", "schemaVersion"}, for the phone's Test and the healthcheck
  POST /v1/sessions                     {"deviceName","systemVersion","fullResync"} -> {"sessionId"}
  POST /v1/sessions/{id}/items          NDJSON lines (gzip or deflate), X-Batch-Seq: n -> {"applied"}
  POST /v1/sessions/{id}/finish         {"totalSent"} -> {"received"}: the items this session applied

The phone signs in with `Authorization: Bearer <app password>` (an app password of an editor account, made under
Settings › Account in the web app). A batch is applied in
one transaction together with its sequence number, so a batch resent after a lost reply is acknowledged without
being applied twice. The line shapes mirror Shared/SyncProtocol.swift.
"""
import gzip
import logging
import time
import zlib
from datetime import datetime, timezone

import orjson
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from app import access, db, rollup
from app.auth import uploader

log = logging.getLogger("app.upload")
router = APIRouter()

MAX_BODY = 64 << 20  # per request, after decompression
BATCH_ROWS = 1000
WORKOUT_CHILDREN = ("workout_statistics", "workout_events", "workout_activities", "workout_route_points")

on_sync = []  # callbacks after a sync finishes (the web API's caches)


# ---- decoding

def parse_time(s):
    if s is None:
        return None
    d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return (d.astimezone(timezone.utc) if d.tzinfo else d.replace(tzinfo=timezone.utc)).replace(tzinfo=None)


def meta_json(m):
    return orjson.dumps(m).decode() if m else None


UNLABELED = {"hello", "sample", "workout", "routePoint", "activitySummary"}
LABELED = {"characteristic", "heartbeat", "deleted", "typeDone", "done"}
IGNORED = {"ecg", "ecgVoltage", "ack", "error"}


def decode(line: bytes) -> tuple:
    """(kind, payload) for one line. Swift's Codable writes each enum case as a one-key object: unlabeled values as
    {"case": {"_0": {...}}}, labeled ones as {"case": {"label": ...}}."""
    outer = orjson.loads(line)
    if not isinstance(outer, dict) or len(outer) != 1:
        raise ValueError(f"expected one key, got {len(outer) if isinstance(outer, dict) else 'no object'}")
    (k, v), = outer.items()
    if k in UNLABELED:
        if not isinstance(v, dict) or not isinstance(v.get("_0"), dict):
            raise ValueError(f"{k}: expected {{\"_0\": {{...}}}}")
        return k, v["_0"]
    if k in LABELED:
        if not isinstance(v, dict):
            raise ValueError(f"{k}: expected an object")
        return k, v
    if k in IGNORED:
        return "ignored", None
    raise ValueError(f'unknown message "{k}"')


def read_body(raw: bytes, encoding: str) -> bytes:
    enc = (encoding or "").strip().lower()
    try:
        if enc in ("", "identity"):
            body = raw
        elif enc == "gzip":
            d = zlib.decompressobj(wbits=31)
            body = d.decompress(raw, MAX_BODY + 1)
        elif enc == "deflate":  # officially zlib-wrapped, but raw deflate is common; accept both
            try:
                body = zlib.decompressobj().decompress(raw, MAX_BODY + 1)
            except zlib.error:
                body = zlib.decompressobj(wbits=-15).decompress(raw, MAX_BODY + 1)
        else:
            raise HTTPException(400, f'unsupported Content-Encoding "{encoding}"')
    except (zlib.error, gzip.BadGzipFile) as e:
        raise HTTPException(400, str(e))
    if len(body) > MAX_BODY:
        raise HTTPException(413, "request body too large")
    return body


# ---- applying a batch

class Batch:
    """One upload batch for one account, applied in one transaction."""

    COLS = {
        "samples": ("uuid", "type", "kind", "start_date", "end_date", "value", "unit", "text", "count", "source_name", "metadata_json"),
        "workout_route_points": ("route_uuid", "time", "workout_uuid", "latitude", "longitude", "altitude", "horizontal_accuracy",
                                 "vertical_accuracy", "speed", "course"),
        "heartbeats": ("series_uuid", "time_since_start_s", "preceded_by_gap"),
        "activity_summaries": ("date", "active_energy_kcal", "active_energy_goal_kcal", "exercise_min", "exercise_goal_min",
                               "stand_hours", "stand_hours_goal", "move_min", "move_goal_min"),
        "characteristics": ("`key`", "value"),
    }
    # how many leading columns of COLS are the table's key (user_id aside): an upsert leaves those alone
    KEYS = {"samples": 1, "workout_route_points": 2, "heartbeats": 2, "activity_summaries": 1, "characteristics": 1}

    def __init__(self, cur, user_id: int):
        self.cur, self.uid = cur, user_id
        self.rows = {t: [] for t in self.COLS}
        self.applied = 0
        self.touched = rollup.Touched()

    @staticmethod
    def upsert_sql(table: str, cols, keys: int) -> str:
        """An upsert that never takes over another account's row: a UUID seen again from another account (which a
        real phone never sends) leaves the row as it was."""
        allc = tuple(cols) + ("user_id",)
        sets = ", ".join(f"{c} = IF(user_id = VALUES(user_id), VALUES({c}), {c})" for c in cols[keys:])
        return (f"INSERT INTO {table} ({', '.join(allc)}) VALUES ({', '.join(['%s'] * len(allc))}) "
                f"ON DUPLICATE KEY UPDATE {sets}")

    def add(self, table: str, row: tuple):
        rows = self.rows[table]
        rows.append(row + (self.uid,))
        if len(rows) >= BATCH_ROWS:
            self.flush(table)

    def flush(self, table: str):
        rows = self.rows[table]
        if not rows:
            return
        self.cur.executemany(self.upsert_sql(table, self.COLS[table], self.KEYS[table]), rows)
        if table == "samples":
            for r in rows:
                if r[5] is not None or r[2] == "category":
                    self.touched.add(r[1], r[3])
            uuids = [r[0] for r in rows]
            self.cur.execute(f"DELETE FROM deleted_objects WHERE user_id = %s AND uuid IN ({', '.join(['%s'] * len(uuids))})",
                             [self.uid] + uuids)  # a re-added object is no longer deleted
        rows.clear()

    def flush_all(self):
        for t in self.COLS:
            self.flush(t)

    def finish(self):
        """Everything buffered, and the account's hourly rollup for the hours this batch touched."""
        self.flush_all()
        for typ, spans in self.touched.spans().items():
            for a, b in spans:
                rollup.recompute(self.cur, self.uid, typ, a, b)

    def apply(self, kind: str, m):
        if kind == "characteristic":
            self.add("characteristics", (m["key"], m.get("value")))
        elif kind == "sample":
            self.add("samples", (m["uuid"], m["type"], m["kind"], parse_time(m["start"]), parse_time(m["end"]), m.get("value"),
                                 m.get("unit"), m.get("text"), m.get("count"), (m.get("source") or {}).get("name", ""), meta_json(m.get("metadata"))))
        elif kind == "workout":
            self.workout(m)
        elif kind == "routePoint":
            self.add("workout_route_points", (m["routeUUID"], parse_time(m["time"]), m["workoutUUID"], m["latitude"], m["longitude"],
                                              m.get("altitude"), m.get("horizontalAccuracy"), m.get("verticalAccuracy"), m.get("speed"), m.get("course")))
        elif kind == "heartbeat":
            self.add("heartbeats", (m["seriesUUID"], m["timeSinceStart"], bool(m.get("precededByGap"))))
        elif kind == "activitySummary":
            self.add("activity_summaries", (m["date"], m.get("activeEnergyBurned"), m.get("activeEnergyBurnedGoal"), m.get("appleExerciseTime"),
                                            m.get("appleExerciseTimeGoal"), m.get("appleStandHours"), m.get("appleStandHoursGoal"),
                                            m.get("appleMoveTime"), m.get("appleMoveTimeGoal")))
        elif kind == "deleted":
            self.deleted(m["uuid"], m.get("type"))
        else:  # typeDone and ignored ECG lines; hello and done have their own endpoints
            return
        self.applied += 1

    def deleted(self, uuid: str, typ):
        self.flush_all()  # buffered inserts first, so a delete always wins over an earlier add of the same object
        c = self.cur
        c.execute("SELECT type, start_date FROM samples WHERE uuid = %s AND user_id = %s", (uuid, self.uid))
        r = c.fetchone()
        if r:
            self.touched.add(r[0], r[1])
        c.execute("DELETE FROM samples WHERE uuid = %s AND user_id = %s", (uuid, self.uid))
        c.execute("DELETE FROM heartbeats WHERE series_uuid = %s AND user_id = %s", (uuid, self.uid))
        if c.execute("DELETE FROM workouts WHERE uuid = %s AND user_id = %s", (uuid, self.uid)):
            for t in WORKOUT_CHILDREN:
                c.execute(f"DELETE FROM {t} WHERE workout_uuid = %s AND user_id = %s", (uuid, self.uid))
        c.execute("INSERT INTO deleted_objects (uuid, type, deleted_at, user_id) VALUES (%s, %s, %s, %s) "
                  "ON DUPLICATE KEY UPDATE type = IF(user_id = VALUES(user_id), VALUES(type), type), "
                  "deleted_at = IF(user_id = VALUES(user_id), VALUES(deleted_at), deleted_at)",
                  (uuid, typ, datetime.now(timezone.utc).replace(tzinfo=None), self.uid))

    def workout(self, w):
        self.flush_all()
        c, uid = self.cur, self.uid
        c.execute("SELECT user_id FROM workouts WHERE uuid = %s", (w["uuid"],))
        r = c.fetchone()
        if r and r[0] != uid:
            log.warning("workout %s belongs to another account: ignored", w["uuid"])
            return
        # an upsert rather than REPLACE, so inserted_at survives a resend and updated_at only moves when a value changed
        c.execute("""INSERT INTO workouts (uuid, activity_type, activity_type_raw, start_date, end_date, duration_s, source_name, metadata_json, user_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE activity_type = VALUES(activity_type), activity_type_raw = VALUES(activity_type_raw),
            start_date = VALUES(start_date), end_date = VALUES(end_date), duration_s = VALUES(duration_s),
            source_name = VALUES(source_name), metadata_json = VALUES(metadata_json)""",
                  (w["uuid"], w.get("activityType"), w.get("activityTypeRaw"), parse_time(w["start"]), parse_time(w["end"]), w.get("duration"),
                   (w.get("source") or {}).get("name", ""), meta_json(w.get("metadata")), uid))
        c.execute("DELETE FROM workout_events WHERE workout_uuid = %s AND user_id = %s", (w["uuid"], uid))
        c.execute("DELETE FROM workout_activities WHERE workout_uuid = %s AND user_id = %s", (w["uuid"], uid))
        stats = [(w["uuid"], s.get("type"), s.get("unit"), s.get("average"), s.get("minimum"), s.get("maximum"), s.get("sum"), s.get("mostRecent"))
                 for s in w.get("statistics") or []]
        # statistics the workout no longer has go; the others are upserted below, keeping their inserted_at
        keep = [s[1] for s in stats]
        c.execute("DELETE FROM workout_statistics WHERE workout_uuid = %s AND user_id = %s"
                  + (f" AND type NOT IN ({', '.join(['%s'] * len(keep))})" if keep else ""), [w["uuid"], uid] + keep)
        if stats:
            c.executemany(self.upsert_sql("workout_statistics", ("workout_uuid", "type", "unit", "average", "minimum", "maximum", "sum", "most_recent"), 2),
                          [s + (uid,) for s in stats])
        for e in w.get("events") or []:
            c.execute("INSERT INTO workout_events (workout_uuid, type, start_date, end_date, metadata_json, user_id) VALUES (%s, %s, %s, %s, %s, %s)",
                      (w["uuid"], e.get("type"), parse_time(e.get("start")), parse_time(e.get("end")), meta_json(e.get("metadata")), uid))
        for a in w.get("activities") or []:
            c.execute("INSERT INTO workout_activities (workout_uuid, activity_type, start_date, end_date, metadata_json, user_id) VALUES (%s, %s, %s, %s, %s, %s)",
                      (w["uuid"], a.get("activityType"), parse_time(a.get("start")), parse_time(a.get("end")), meta_json(a.get("metadata")), uid))


def apply_batch(user_id: int, session_id: int, seq: int, body: bytes) -> dict:
    started = time.time()
    with rollup.lock, db.tx() as con, con.cursor() as cur:
        cur.execute("SELECT last_batch_seq FROM sync_log WHERE id = %s AND user_id = %s FOR UPDATE", (session_id, user_id))
        r = cur.fetchone()
        if not r:
            raise HTTPException(404, f"no session {session_id}")
        if seq <= r[0]:
            log.info("session %d: batch %d already applied, skipped", session_id, seq)
            return {"applied": 0, "duplicate": True}
        b = Batch(cur, user_id)
        lines = 0
        for line in body.split(b"\n"):
            if not line.strip():
                continue
            lines += 1
            try:
                kind, m = decode(line)
                b.apply(kind, m)
            except (ValueError, KeyError, TypeError) as e:
                raise HTTPException(400, f"line {lines}: {e}")
        b.finish()
        cur.execute("UPDATE sync_log SET last_batch_seq = %s, applied = applied + %s WHERE id = %s", (seq, b.applied, session_id))
    log.info("session %d: batch %d, %d lines, %d items applied in %dms", session_id, seq, lines, b.applied, (time.time() - started) * 1000)
    return {"applied": b.applied}


# ---- routes

@router.get("/v1/health", dependencies=[access.public])
def health():
    try:
        return {"ok": True, "schemaVersion": db.schema_version()}
    except Exception as e:
        raise HTTPException(503, str(e))


async def raw_body(request: Request) -> bytes:
    """The request body as sent, refused with 413 as soon as it passes MAX_BODY rather than read whole first."""
    try:
        if int(request.headers.get("content-length") or 0) > MAX_BODY:
            raise HTTPException(413, "request body too large")
    except ValueError:
        raise HTTPException(400, "bad Content-Length")
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BODY:
            raise HTTPException(413, "request body too large")
        chunks.append(chunk)
    return b"".join(chunks)


async def body_of(request: Request) -> bytes:
    return read_body(await raw_body(request), request.headers.get("content-encoding", ""))


async def _json(request: Request) -> dict:
    body = await body_of(request)
    try:
        v = orjson.loads(body or b"{}")
    except orjson.JSONDecodeError as e:
        raise HTTPException(400, str(e))
    if not isinstance(v, dict):
        raise HTTPException(400, "A JSON object is expected")
    return v


@router.post("/v1/sessions", status_code=201, dependencies=[access.public])
async def start(request: Request):
    uid = uploader(request)
    h = await _json(request)
    sid = await run_in_threadpool(db.ex, "INSERT INTO sync_log (started_at, device, `system`, full_resync, items, user_id) VALUES (%s, %s, %s, %s, 0, %s)",
                                  (datetime.now(timezone.utc).replace(tzinfo=None), str(h.get("deviceName", ""))[:255],
                                   str(h.get("systemVersion", ""))[:32], bool(h.get("fullResync")), uid))
    log.info("session %d: started by %s for %s (iOS %s), full resync: %s", sid, h.get("deviceName"), request.state.user["name"],
             h.get("systemVersion"), bool(h.get("fullResync")))
    return {"sessionId": sid}


@router.post("/v1/sessions/{session_id}/items", dependencies=[access.public])
async def items(session_id: int, request: Request):
    uid = uploader(request)
    try:
        seq = int(request.headers.get("x-batch-seq", ""))
    except ValueError:
        seq = 0
    if seq < 1:
        raise HTTPException(400, "X-Batch-Seq header must be a positive integer")
    body = await body_of(request)
    return await run_in_threadpool(apply_batch, uid, session_id, seq, body)


@router.post("/v1/sessions/{session_id}/finish", dependencies=[access.public])
async def finish(session_id: int, request: Request):
    uid = uploader(request)
    d = await _json(request)

    def work():
        n = db.ex("UPDATE sync_log SET finished_at = %s, items = %s WHERE id = %s AND user_id = %s",
                  (datetime.now(timezone.utc).replace(tzinfo=None), int(d.get("totalSent") or 0), session_id, uid))
        if not n and not db.one("SELECT 1 FROM sync_log WHERE id = %s AND user_id = %s", (session_id, uid)):
            raise HTTPException(404, f"no session {session_id}")
        applied = db.one("SELECT applied FROM sync_log WHERE id = %s AND user_id = %s", (session_id, uid))[0]
        for f in on_sync:
            f()
        log.info("session %d: finished, %s items sent, %d applied", session_id, d.get("totalSent"), applied)
        return {"received": applied}
    return await run_in_threadpool(work)
