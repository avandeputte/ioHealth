"""The web app's read API. Every figure is the signed-in account's own. Times in replies are Unix seconds; dates are
local to the `tz` parameter (an IANA name the browser sends), falling back to TZ."""
import json
import math
import threading
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import ORJSONResponse

from app import access, analytics as an, config, db, glucose as gl, rollup
from app.auth import uid as uid_of

router = APIRouter(default_response_class=ORJSONResponse)
UTC = timezone.utc
EPOCH = datetime(1970, 1, 1, tzinfo=UTC)

ready = rollup.Ready()


class BadRequest(ValueError):
    pass


class NotFound(LookupError):
    pass


# ---- cache: replies per account and URL, dropped when a sync finishes

class Cache:
    def __init__(self, ttl: float):
        self.ttl, self.m, self.lock = ttl, {}, threading.Lock()

    def get(self, key, ttl, f):
        ttl = ttl or self.ttl
        with self.lock:
            hit = self.m.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
        v = f()
        with self.lock:
            if len(self.m) > 500:
                self.m = {}
            self.m[key] = (time.time(), v)
        return v

    def clear(self):
        with self.lock:
            self.m = {}


cache = Cache(120)
effort_cache = {}  # workout uuid -> (start, [efforts]); a route only changes when it is resent


def sync_finished():
    """New data shows up right away, and a type seen for the first time gets rolled up."""
    cache.clear()
    effort_cache.clear()
    _all_types["at"] = 0.0
    start_backfill()


_backfilling = threading.Lock()


def start_backfill():
    if not _backfilling.acquire(blocking=False):
        return

    def run():
        try:
            rollup.backfill(ready, cache.clear)
        finally:
            _backfilling.release()
    threading.Thread(target=run, name="hourly-rollup", daemon=True).start()


def cached(request: Request, ttl: float, f):
    key = (uid_of(request), request.url.path, request.url.query)
    try:
        return cache.get(key, ttl, f)
    except NotFound as e:
        raise HTTPException(404, str(e) or "not found")
    except BadRequest as e:
        raise HTTPException(400, str(e))


# ---- parameters

def location(request: Request):
    tz = request.query_params.get("tz")
    for name in (tz, config.TZ, "UTC"):
        if name:
            try:
                return ZoneInfo(name)
            except (ZoneInfoNotFoundError, ValueError):
                continue
    return UTC


def time_range(request: Request, loc, days: int) -> tuple:
    """from/to as local dates (to inclusive) or Unix seconds, as naive UTC for the database; the default is the last
    `days` days."""
    qp = request.query_params

    def parse(s, end):
        try:
            return datetime.fromtimestamp(int(s), UTC)
        except ValueError:
            pass
        try:
            d = datetime.strptime(s, "%Y-%m-%d")
        except ValueError:
            raise BadRequest(f'bad date "{s}", want yyyy-mm-dd')
        d = datetime(d.year, d.month, d.day, tzinfo=loc)
        if end:
            d = local_add_days(d, 1, loc)
        return d

    now = datetime.now(loc)
    to = local_add_days(datetime(now.year, now.month, now.day, tzinfo=loc), 1, loc)
    frm = local_add_days(to, -days, loc)
    if qp.get("from"):
        frm = parse(qp["from"], False)
    if qp.get("to"):
        to = parse(qp["to"], True)
    if to <= frm:
        raise BadRequest("to must be after from")
    return db.naive(frm), db.naive(to)


def local_add_days(d: datetime, n: int, loc) -> datetime:
    x = date(d.year, d.month, d.day) + timedelta(days=n)
    return datetime(x.year, x.month, x.day, d.hour, d.minute, tzinfo=loc)


def aware(dt):
    return db.utc(dt)


def ts(dt) -> int:
    return int(aware(dt).timestamp())


def clean(v):
    if isinstance(v, Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
    if isinstance(v, datetime):
        return ts(v)
    if isinstance(v, bytes):
        return v.decode()
    return v


def maps(sql: str, args=None) -> list:
    return [{k: clean(v) for k, v in r.items()} for r in db.qd(sql, args)]


def rnd(v: float, places: int) -> float:
    if v is None or math.isnan(v):
        return -1
    p = 10 ** places
    return an.round_half_away(v * p) / p


# ---- status and types

def last_sync(u: int) -> dict:
    """The account's latest upload, for GET /api/status (app.main): {lastSync: {started, finished, device, items}, latestArrival}, or {}."""
    r = db.one("SELECT started_at, finished_at, device, items FROM hlt_sync_log WHERE user_id = %s ORDER BY id DESC LIMIT 1", (u,))
    if not r:
        return {}
    return {"lastSync": {"started": db.unix(r[0]), "finished": db.unix(r[1]), "device": r[2] or "", "items": r[3] or 0},
            "latestArrival": db.unix(r[1] or r[0])}


_all_types = {"at": 0.0, "v": []}


def all_type_names() -> list:
    """Every type anyone has; cached a few minutes. GROUP BY, not DISTINCT: MariaDB answers it from the type index by
    jumping from one type to the next (a loose index scan), where DISTINCT reads every sample's index entry."""
    if time.time() - _all_types["at"] > 300:
        _all_types.update(v=[r[0] for r in db.q("SELECT type FROM hlt_samples GROUP BY type")], at=time.time())
    return _all_types["v"]


_kinds = {}


def kind_of(t: str) -> str:
    if t not in _kinds:
        r = db.one("SELECT kind FROM hlt_samples WHERE type = %s LIMIT 1", (t,))
        _kinds[t] = r[0] if r else ""
    return _kinds[t]


def type_list(u: int) -> list:
    def f():
        rolled = {r[0]: r for r in db.q("SELECT type, SUM(n), MIN(hour), MAX(hour) FROM hlt_sample_hourly WHERE user_id = %s GROUP BY type", (u,))}
        out = []
        for name in all_type_names():
            if ready.has(name) and name in rolled:
                _, n, first, last = rolled[name]
                t = {"type": name, "count": int(n), "first": ts(first), "last": ts(last), "since": last}
            elif ready.has(name) and kind_of(name) in ("quantity", "category"):
                continue  # every sample of these kinds is in the rollup: none of this account's
            else:
                n, first, last = db.one("SELECT COUNT(*), MIN(start_date), MAX(start_date) FROM hlt_samples WHERE type = %s AND user_id = %s", (name, u))
                if not n:
                    continue
                t = {"type": name, "count": int(n), "first": ts(first), "last": ts(last), "since": last}
            r = db.one("SELECT kind, unit, start_date FROM hlt_samples WHERE type = %s AND user_id = %s AND start_date >= %s ORDER BY start_date DESC LIMIT 1",
                       (name, u, t.pop("since")))
            if not r:
                continue
            t["kind"], t["unit"], t["last"] = r[0], r[1] or "", ts(r[2])  # the rollup's last is only its hour
            t["cumulative"] = t["kind"] == "category" or an.is_cumulative(name)
            if t["kind"] == "category":
                t["unit"] = "min"
            if name == "sleep_analysis":  # hours asleep per night, see sleep_series
                t["unit"], t["cumulative"] = "h", False
            out.append(t)
        out += ring_types(u)
        out.sort(key=lambda t: t["type"])
        return [{k: t[k] for k in ("type", "kind", "unit", "count", "first", "last", "cumulative")} for t in out]
    return cache.get((u, "types"), 600, f)


@router.get("/api/types", dependencies=[access.signed_in])
def types(request: Request):
    return type_list(uid_of(request))


def type_info(u: int, name: str):
    for t in type_list(u):
        if t["type"] == name:
            return t
    return None


# ---- activity rings as metric types

RING_TYPES = [
    ("activity_move", "kcal", "active_energy_kcal"),
    ("activity_move_goal", "kcal", "active_energy_goal_kcal"),
    ("activity_move_percent", "%", "active_energy_kcal / NULLIF(active_energy_goal_kcal, 0)"),
    ("activity_exercise", "min", "exercise_min"),
    ("activity_exercise_goal", "min", "exercise_goal_min"),
    ("activity_exercise_percent", "%", "exercise_min / NULLIF(exercise_goal_min, 0)"),
    ("activity_stand", "h", "stand_hours"),
    ("activity_stand_goal", "h", "stand_hours_goal"),
    ("activity_stand_percent", "%", "stand_hours / NULLIF(stand_hours_goal, 0)"),
]


def ring_types(u: int) -> list:
    n, first, last = db.one("SELECT COUNT(*), MIN(date), MAX(date) FROM hlt_activity_summaries WHERE user_id = %s", (u,))
    if not n:
        return []

    def day(d):
        return int(datetime(d.year, d.month, d.day, tzinfo=UTC).timestamp()) if d else 0
    return [{"type": name, "kind": "ring", "unit": unit, "count": int(n), "first": day(first), "last": day(last), "cumulative": False}
            for name, unit, _ in RING_TYPES]


def ring_series(u: int, info: dict, frm, to, bucket: str, loc) -> dict:
    expr = next(e for name, _, e in RING_TYPES if name == info["type"])
    if bucket in ("raw", "hour"):
        bucket = "day"
    rows = []
    for d, v in db.q(f"SELECT date, {expr} FROM hlt_activity_summaries WHERE user_id = %s AND date >= %s AND date <= %s ORDER BY date",
                     (u, aware(frm).astimezone(loc).strftime("%Y-%m-%d"), (aware(to) - timedelta(seconds=1)).astimezone(loc).strftime("%Y-%m-%d"))):
        if v is None:
            continue
        v = float(v)
        rows.append(an.HourRow(datetime(d.year, d.month, d.day, tzinfo=loc), "", v, 1, v, v))
    return {"type": info["type"], "unit": info["unit"], "bucket": bucket, "cumulative": False, "points": an.fold_hours(rows, bucket, loc, False)}


# ---- series

@router.get("/api/series", dependencies=[access.signed_in])
def series(request: Request):
    u = uid_of(request)

    def f():
        loc = location(request)
        frm, to = time_range(request, loc, 30)
        bucket = request.query_params.get("bucket") or "auto"
        if bucket == "auto":
            bucket = an.auto_bucket(frm, to)
        return series_for(u, request.query_params.get("type", ""), frm, to, bucket, loc)
    return cached(request, 0, f)


def series_for(u: int, name: str, frm, to, bucket: str, loc) -> dict:
    info = type_info(u, name)
    reply = {"type": name, "unit": info["unit"] if info else "", "bucket": bucket, "cumulative": bool(info and info["cumulative"]), "points": []}
    if not info:
        return reply
    if name == "sleep_analysis":
        return sleep_series(u, frm, to, bucket, loc)
    if info["kind"] == "ring":
        return ring_series(u, info, frm, to, bucket, loc)
    if bucket == "raw":
        if info["kind"] == "category":
            raise BadRequest("raw is only for quantity types")
        reply["points"] = [{"t": ts(t), "v": v, "n": 1} for t, v in db.q(
            """SELECT start_date, value FROM hlt_samples WHERE type = %s AND user_id = %s AND start_date >= %s AND start_date < %s
            AND value IS NOT NULL ORDER BY start_date LIMIT 20000""", (name, u, frm, to))]
        return reply
    if bucket not in ("hour", "day", "week", "month", "year"):
        raise BadRequest("bucket must be raw, hour, day, week, month or year")
    if ready.has(name):
        hours = hourly_rollup(u, name, frm, to)
    else:
        val, cond = ("TIMESTAMPDIFF(SECOND, start_date, end_date) / 60", "") if info["kind"] == "category" else ("value", "AND value IS NOT NULL")
        hours = hourly_samples(u, name, val, cond, frm, to)
    reply["points"] = an.fold_hours(hours, bucket, loc, info["cumulative"])
    return reply


def sleep_series(u: int, frm, to, bucket: str, loc) -> dict:
    """Hours asleep per night (the sleep page's night logic), averaged per bucket."""
    if bucket in ("raw", "hour"):
        bucket = "day"
    rows = []
    for n in an.sleep_nights(sleep_samples(u, frm - timedelta(hours=6), to - timedelta(hours=6)), loc, False):
        if not n["asleep"]:
            continue
        d = datetime.strptime(n["date"], "%Y-%m-%d")
        h = n["asleep"] / 60
        rows.append(an.HourRow(datetime(d.year, d.month, d.day, tzinfo=loc), "", h, 1, h, h))
    return {"type": "sleep_analysis", "unit": "h", "bucket": bucket, "cumulative": False, "points": an.fold_hours(rows, bucket, loc, False)}


def hourly_rollup(u: int, name: str, frm, to) -> list:
    return [an.HourRow(aware(h), s, float(sm or 0), int(n), float(mn or 0), float(mx or 0)) for h, s, sm, n, mn, mx in db.q(
        "SELECT hour, source_name, sum, n, min, max FROM hlt_sample_hourly WHERE user_id = %s AND type = %s AND hour >= %s AND hour < %s",
        (u, name, frm.replace(minute=0, second=0, microsecond=0), to))]


def hourly_samples(u: int, name: str, val: str, cond: str, frm, to) -> list:
    """A type's samples grouped by UTC hour and source; the hours are folded into local buckets afterwards, which
    keeps time zones right without MariaDB's time zone tables."""
    rows = db.q(f"""SELECT DATE_FORMAT(start_date, '%%Y-%%m-%%d %%H:00:00') AS h, COALESCE(source_name, ''),
        SUM({val}), COUNT(*), MIN({val}), MAX({val})
        FROM hlt_samples WHERE type = %s AND user_id = %s AND start_date >= %s AND start_date < %s {cond}
        GROUP BY h, source_name""", (name, u, frm, to))
    return [an.HourRow(datetime.strptime(h, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC), s, float(sm or 0), int(n), float(mn or 0), float(mx or 0))
            for h, s, sm, n, mn, mx in rows]


# ---- workouts

def apply_workout_meta(x: dict, meta: str):
    try:
        m = json.loads(meta or "{}")
    except ValueError:
        return
    if not isinstance(m, dict):
        return
    q = an.parse_quantity(m.get("HKElevationAscended", ""))
    if q:
        x["elevation"] = an.to_metres(q[0], q[1])
    if m.get("HKIndoorWorkout") in ("1", "true"):
        x["indoor"] = True


def workout_list(u: int, frm, to) -> list:
    out, index = [], {}
    for uuid, at, s, e, dur, src, meta, has_route in db.q(
            """SELECT w.uuid, COALESCE(w.activity_type, ''), w.start_date, w.end_date, COALESCE(w.duration_s, 0),
            COALESCE(w.source_name, ''), COALESCE(w.metadata_json, '{}'),
            EXISTS(SELECT 1 FROM hlt_workout_route_points p WHERE p.workout_uuid = w.uuid AND p.user_id = w.user_id LIMIT 1)
            FROM hlt_workouts w WHERE w.user_id = %s AND w.start_date >= %s AND w.start_date < %s ORDER BY w.start_date DESC""", (u, frm, to)):
        x = {"uuid": uuid, "activityType": at, "start": ts(s), "end": ts(e), "duration": float(dur), "source": src}
        apply_workout_meta(x, meta)
        x["hasRoute"] = bool(has_route)
        index[uuid] = x
        out.append(x)
    if not out:
        return out
    for wid, typ, unit, avg, mx, sm in db.q(
            """SELECT s.workout_uuid, s.type, COALESCE(s.unit, ''), s.average, s.maximum, s.sum
            FROM hlt_workout_statistics s JOIN hlt_workouts w ON w.uuid = s.workout_uuid AND w.user_id = s.user_id
            WHERE w.user_id = %s AND w.start_date >= %s AND w.start_date < %s
            AND (s.type LIKE 'distance%%' OR s.type = 'active_energy_burned' OR s.type = 'heart_rate')""", (u, frm, to)):
        x = index.get(wid)
        if x is None:
            continue
        if typ == "heart_rate":
            if avg is not None:
                x["hrAvg"] = avg
            if mx is not None:
                x["hrMax"] = mx
        elif typ == "active_energy_burned" and sm is not None:
            x["energy"] = an.to_kcal(sm, unit)
        elif typ.startswith("distance") and sm is not None:
            v = an.to_metres(sm, unit)
            if x.get("distance") is None or v > x["distance"]:
                x["distance"] = v
    return out


FIELD_ORDER = ("uuid", "activityType", "start", "end", "duration", "source", "distance", "energy", "hrAvg", "hrMax", "elevation", "indoor", "hasRoute")


def ordered(x: dict) -> dict:
    return {k: x[k] for k in FIELD_ORDER if k in x} | {k: v for k, v in x.items() if k not in FIELD_ORDER}


@router.get("/api/workouts", dependencies=[access.signed_in])
def workouts(request: Request):
    u = uid_of(request)

    def f():
        frm, to = time_range(request, location(request), 365 * 30)
        t = request.query_params.get("type")
        return [ordered(x) for x in workout_list(u, frm, to) if not t or x["activityType"] == t]
    return cached(request, 0, f)


EFFORT_DISTANCES = [("400 m", 400), ("1 km", 1000), ("1 mile", 1609.344), ("5 km", 5000), ("10 km", 10000), ("Half marathon", 21097.5), ("Marathon", 42195)]
WORKOUT_SERIES_TYPES = ["heart_rate", "running_power", "running_speed", "running_stride_length", "running_vertical_oscillation",
                        "running_ground_contact_time", "cycling_power", "cycling_cadence", "cycling_speed", "physical_effort"]


def route_points(u: int, wid: str) -> list:
    return an.clean_route([an.RoutePoint(aware(t), lat, lon, float(alt), float(sp), float(acc)) for t, lat, lon, alt, sp, acc in db.q(
        """SELECT time, latitude, longitude, COALESCE(altitude, 0), COALESCE(speed, -1), COALESCE(horizontal_accuracy, 0)
        FROM hlt_workout_route_points WHERE workout_uuid = %s AND user_id = %s ORDER BY time""", (wid, u))])


def max_hr(u: int, request: Request, at: datetime) -> tuple:
    """The maxHr parameter if given, else 220 minus age from the date of birth, else the highest heart rate recorded
    in the last year."""
    try:
        v = float(request.query_params.get("maxHr", ""))
        if 100 < v < 250:
            return v, "setting"
    except ValueError:
        pass
    r = db.one("SELECT value FROM hlt_characteristics WHERE user_id = %s AND name = 'dateOfBirth'", (u,))
    age = an.age_on(r[0] if r else "", at)
    if 5 < age < 110:
        return float(220 - age), "age"
    since = db.naive(at) - timedelta(days=365)
    if ready.has("heart_rate"):
        mx = db.one("SELECT MAX(max) FROM hlt_sample_hourly WHERE user_id = %s AND type = 'heart_rate' AND hour >= %s", (u, since))[0]
    else:
        mx = db.one("SELECT MAX(value) FROM hlt_samples WHERE type = 'heart_rate' AND user_id = %s AND start_date >= %s", (u, since))[0]
    if mx is not None and mx > 100:
        return float(mx), "observed"
    return 0.0, ""


@router.get("/api/workouts/{wid}", dependencies=[access.signed_in])
def workout(wid: str, request: Request):
    u = uid_of(request)

    def f():
        r = db.one("""SELECT uuid, COALESCE(activity_type, ''), start_date, end_date, COALESCE(duration_s, 0),
            COALESCE(source_name, ''), COALESCE(metadata_json, '{}') FROM hlt_workouts WHERE uuid = %s AND user_id = %s""", (wid, u))
        if not r:
            raise NotFound("not found")
        s, e = aware(r[2]), aware(r[3])
        d = {"uuid": r[0], "activityType": r[1], "start": ts(s), "end": ts(e), "duration": float(r[4]), "source": r[5]}
        apply_workout_meta(d, r[6])
        try:
            d["metadata"] = json.loads(r[6]) if r[6] else None
        except ValueError:
            d["metadata"] = None
        d["statistics"] = maps("""SELECT type, unit, average, minimum, maximum, sum, most_recent FROM hlt_workout_statistics
            WHERE workout_uuid = %s AND user_id = %s ORDER BY type""", (wid, u))
        for st in d["statistics"]:
            typ, unit = st.get("type") or "", st.get("unit") or ""
            if typ == "heart_rate":
                if st.get("average") is not None:
                    d["hrAvg"] = st["average"]
                if st.get("maximum") is not None:
                    d["hrMax"] = st["maximum"]
            elif typ == "active_energy_burned" and st.get("sum") is not None:
                d["energy"] = an.to_kcal(st["sum"], unit)
            elif typ.startswith("distance") and st.get("sum") is not None:
                d["distance"] = an.to_metres(st["sum"], unit)
        d["events"] = maps("""SELECT type, UNIX_TIMESTAMP(start_date) AS start, UNIX_TIMESTAMP(end_date) AS end
            FROM hlt_workout_events WHERE workout_uuid = %s AND user_id = %s ORDER BY start_date""", (wid, u))
        d["activities"] = maps("""SELECT activity_type, UNIX_TIMESTAMP(start_date) AS start, UNIX_TIMESTAMP(end_date) AS end
            FROM hlt_workout_activities WHERE workout_uuid = %s AND user_id = %s ORDER BY start_date""", (wid, u))

        d["series"], d["units"] = {}, {}
        hr = an.HRSeries()
        ph = ", ".join(["%s"] * len(WORKOUT_SERIES_TYPES))
        for typ, t, v, unit in db.q(f"""SELECT type, start_date, value, COALESCE(unit, '') FROM hlt_samples
                WHERE start_date >= %s AND start_date <= %s AND type IN ({ph}) AND user_id = %s AND value IS NOT NULL ORDER BY start_date""",
                                    [db.naive(s), db.naive(e)] + WORKOUT_SERIES_TYPES + [u]):
            t = aware(t)
            d["series"].setdefault(typ, []).append([t.timestamp(), v])
            d["units"][typ] = unit
            if typ == "heart_rate":
                hr.add(t, v)
        d["maxHr"], d["maxHrFrom"] = max_hr(u, request, e)
        d["zones"] = an.hr_zones(hr.samples, d["maxHr"], e) if hr.samples and d["maxHr"] > 0 else None

        pts = route_points(u, wid)
        d["route"], d["routeGain"], d["splits"], d["efforts"] = [], 0.0, {}, []
        if len(pts) > 1:
            if d.get("distance") is None:
                d["distance"] = pts[-1].dist
            d["routeGain"], _ = an.elevation_gain(pts, 3)
            d["splits"]["km"] = an.splits(pts, 1000, hr.between)
            d["splits"]["mi"] = an.splits(pts, 1609.344, hr.between)
            for name, m in EFFORT_DISTANCES:
                sec = an.best_effort(pts, m)
                if sec is not None:
                    d["efforts"].append({"name": name, "distance": m, "seconds": an.round_half_away(sec)})
            for p in an.simplify(pts, 3, 3000):
                h = hr.between(p.t - timedelta(seconds=5), p.t + timedelta(seconds=5))
                d["route"].append([p.t.timestamp(), rnd(p.lat, 6), rnd(p.lon, 6), rnd(p.alt, 1), rnd(p.dist, 1), rnd(p.speed, 2),
                                   rnd(h if h is not None else math.nan, 0)])
        return ordered(d)
    return cached(request, 0, f)


@router.get("/api/routes", dependencies=[access.signed_in])
def routes(request: Request):
    u = uid_of(request)

    def f():
        frm, to = time_range(request, location(request), 365)
        typ = request.query_params.get("type", "")
        out, cur, pts = [], None, []

        def flush():
            nonlocal pts
            if cur is None:
                return
            pts = an.clean_route(pts)
            if len(pts) > 1:
                cur["distance"] = float(an.round_half_away(pts[-1].dist))
                cur["points"] = [[rnd(p.lat, 5), rnd(p.lon, 5)] for p in an.simplify(pts, 25, 600)]
                out.append(cur)
            pts = []
        for wid, at, start, t, lat, lon, acc in db.q(
                """SELECT p.workout_uuid, COALESCE(w.activity_type, ''), w.start_date, p.time, p.latitude, p.longitude,
                COALESCE(p.horizontal_accuracy, 0)
                FROM hlt_workouts w JOIN hlt_workout_route_points p ON p.workout_uuid = w.uuid AND p.user_id = w.user_id
                WHERE w.user_id = %s AND w.start_date >= %s AND w.start_date < %s AND (%s = '' OR w.activity_type = %s)
                ORDER BY p.workout_uuid, p.time""", (u, frm, to, typ, typ)):
            if cur is None or cur["uuid"] != wid:
                flush()
                cur = {"uuid": wid, "activityType": at, "start": ts(start), "distance": 0.0, "points": None}
            pts.append(an.RoutePoint(aware(t), lat, lon, h_accuracy=float(acc)))
        flush()
        out.sort(key=lambda r: -r["start"])
        return out
    return cached(request, 600, f)


# ---- sleep

def sleep_samples(u: int, frm, to) -> list:
    return [an.SleepSample(aware(s), aware(e), stage, src) for s, e, stage, src in db.q(
        """SELECT start_date, end_date, COALESCE(text, ''), COALESCE(source_name, '') FROM hlt_samples
        WHERE type = 'sleep_analysis' AND user_id = %s AND start_date >= %s AND start_date < %s ORDER BY start_date""", (u, frm, to))]


@router.get("/api/sleep", dependencies=[access.signed_in])
def sleep(request: Request):
    """Nights from..to; with date=yyyy-mm-dd, that one night with its segments."""
    u = uid_of(request)

    def f():
        loc = location(request)
        d = request.query_params.get("date")
        if d:
            try:
                day = datetime.strptime(d, "%Y-%m-%d")
            except ValueError as e:
                raise BadRequest(str(e))
            day = datetime(day.year, day.month, day.day, tzinfo=loc)
            for n in an.sleep_nights(sleep_samples(u, db.naive(day - timedelta(hours=6)), db.naive(day + timedelta(hours=18))), loc, True):
                if n["date"] == d:
                    return n
            raise NotFound("not found")
        frm, to = time_range(request, loc, 30)
        # samples from six hours before the first day belong to its night
        return an.sleep_nights(sleep_samples(u, frm - timedelta(hours=6), to - timedelta(hours=6)), loc, False)
    return cached(request, 0, f)


# ---- activity rings

@router.get("/api/activity", dependencies=[access.signed_in])
def activity(request: Request):
    u = uid_of(request)

    def f():
        loc = location(request)
        frm, to = time_range(request, loc, 30)
        return maps("""SELECT DATE_FORMAT(date, '%%Y-%%m-%%d') AS date, active_energy_kcal AS move, active_energy_goal_kcal AS moveGoal,
            exercise_min AS exercise, exercise_goal_min AS exerciseGoal, stand_hours AS stand, stand_hours_goal AS standGoal
            FROM hlt_activity_summaries WHERE user_id = %s AND date >= %s AND date < %s ORDER BY date""",
                    (u, aware(frm).astimezone(loc).strftime("%Y-%m-%d"), aware(to).astimezone(loc).strftime("%Y-%m-%d")))
    return cached(request, 0, f)


# ---- profile

@router.get("/api/profile", dependencies=[access.signed_in])
def profile(request: Request):
    u = uid_of(request)

    def f():
        chars = {k: v or "" for k, v in db.q("SELECT name, value FROM hlt_characteristics WHERE user_id = %s", (u,))}
        out = {"characteristics": chars}
        now = datetime.now(UTC)
        age = an.age_on(chars.get("dateOfBirth", ""), now)
        if age > 0:
            out["age"] = age
        out["maxHr"], out["maxHrFrom"] = max_hr(u, request, now)
        rhr = db.one("SELECT AVG(value) FROM hlt_samples WHERE type = 'resting_heart_rate' AND user_id = %s AND start_date >= %s",
                     (u, db.naive(now) - timedelta(days=30)))[0]
        if rhr is not None:
            out["restingHr"] = an.round_half_away(float(rhr))
        return out
    return cached(request, 0, f)


# ---- records

DAILY_RECORDS = [
    ("step_count", "Most steps in a day", "day", True),
    ("distance_walking_running", "Most walking + running distance in a day", "day", True),
    ("active_energy_burned", "Most active energy in a day", "day", True),
    ("flights_climbed", "Most flights climbed in a day", "day", True),
    ("apple_exercise_time", "Most exercise minutes in a day", "day", True),
    ("vo2_max", "Highest VO₂ max", "health", True),
    ("resting_heart_rate", "Lowest resting heart rate", "health", False),
    ("heart_rate_variability_sdnn", "Highest daily HRV", "health", True),
    ("walking_heart_rate_average", "Lowest walking heart rate", "health", False),
]


@router.get("/api/records", dependencies=[access.signed_in])
def records(request: Request):
    """Bests per activity type, best days, best health readings and ring streaks."""
    u = uid_of(request)

    def f():
        loc = location(request)
        far = db.naive(datetime.now(UTC) + timedelta(days=1))
        recs, totals, best = [], {}, {}

        def consider(key, rec, higher):
            cur = best.get(key)
            if cur is None or (higher and rec["value"] > cur["value"]) or (not higher and rec["value"] < cur["value"]):
                best[key] = rec
        for x in workout_list(u, datetime(1970, 1, 1), far):
            at = x["activityType"]
            t = totals.get(at)
            if t is None:
                t = totals[at] = {"activityType": at, "count": 0, "duration": 0.0, "distance": 0.0, "energy": 0.0, "first": x["start"]}
            t["count"] += 1
            t["duration"] += x["duration"]
            t["first"] = min(t["first"], x["start"])

            def rec(name, value, unit):
                return {"group": "workout", "name": name, "value": value, "unit": unit, "when": x["start"], "uuid": x["uuid"], "type": at}
            consider(at + "/duration", rec("Longest", x["duration"], "s"), True)
            dist = x.get("distance")
            if dist:
                t["distance"] += dist
                consider(at + "/distance", rec("Farthest", dist, "m"), True)
                if dist >= 1000 and x["duration"] > 0:
                    consider(at + "/pace", rec("Fastest average pace", x["duration"] / (dist / 1000), "s/km"), False)
            if x.get("energy") is not None:
                t["energy"] += x["energy"]
                consider(at + "/energy", rec("Most energy", x["energy"], "kcal"), True)
            if x.get("elevation") is not None:
                consider(at + "/elevation", rec("Most climbing", x["elevation"], "m"), True)
        recs += best.values()

        for typ, name, group, higher in DAILY_RECORDS:
            s = series_for(u, typ, datetime(1970, 1, 1), far, "day", loc)
            pts = s["points"]
            if not pts:
                continue
            bi = 0
            for i, p in enumerate(pts):
                if (higher and p["v"] > pts[bi]["v"]) or (not higher and p["v"] < pts[bi]["v"]):
                    bi = i
            recs.append({"group": group, "name": name, "value": pts[bi]["v"], "unit": s["unit"], "when": pts[bi]["t"], "type": typ})

        streaks = [{"ring": n, "cur": 0, "best": 0, "end": None, "days": 0} for n in ("Move", "Exercise", "Stand", "All three rings")]
        prev = None
        for d, m, e, s in db.q("""SELECT date, active_energy_kcal >= active_energy_goal_kcal AND active_energy_goal_kcal > 0,
                exercise_min >= exercise_goal_min AND exercise_goal_min > 0, stand_hours >= stand_hours_goal AND stand_hours_goal > 0
                FROM hlt_activity_summaries WHERE user_id = %s ORDER BY date""", (u,)):
            gap = prev is not None and (d - prev).days > 1
            prev = d
            closed = [bool(m), bool(e), bool(s), bool(m) and bool(e) and bool(s)]
            for i, st in enumerate(streaks):
                if gap:
                    st["cur"] = 0
                if closed[i]:
                    st["cur"] += 1
                    st["days"] += 1
                    if st["cur"] > st["best"]:
                        st["best"], st["end"] = st["cur"], d
                else:
                    st["cur"] = 0
        rings = [{"ring": st["ring"], "current": st["cur"], "longest": st["best"],
                  "longestEnded": st["end"].strftime("%Y-%m-%d") if st["end"] else "0001-01-01", "daysClosed": st["days"]} for st in streaks]
        tl = sorted(totals.values(), key=lambda t: -t["count"])
        for t in tl:
            t["distance"], t["energy"] = float(an.round_half_away(t["distance"])), float(an.round_half_away(t["energy"]))
        recs.sort(key=lambda r: (r["group"], r.get("type", ""), r["name"]))
        return {"records": recs, "totals": tl, "rings": rings}
    return cached(request, 600, f)


@router.get("/api/records/efforts", dependencies=[access.signed_in])
def efforts(request: Request):
    """The fastest 400 m … marathon anywhere in the GPS routes of one activity type, with the workout each came from."""
    u = uid_of(request)
    typ = request.query_params.get("type") or "running"

    def f():
        bests = {}
        for x in workout_list(u, datetime(1970, 1, 1), db.naive(datetime.now(UTC) + timedelta(days=1))):
            if x["activityType"] != typ or not x["hasRoute"]:
                continue
            we = effort_cache.get(x["uuid"])
            if we is None:
                pts = route_points(u, x["uuid"])
                we = []
                for name, m in EFFORT_DISTANCES:
                    sec = an.best_effort(pts, m)
                    if sec is not None:
                        we.append({"name": name, "distance": m, "seconds": an.round_half_away(sec)})
                effort_cache[x["uuid"]] = we
            for e in we:
                b = bests.get(e["name"])
                if b is None or e["seconds"] < b["seconds"]:
                    bests[e["name"]] = {**e, "uuid": x["uuid"], "start": x["start"]}
        return [bests[name] for name, _ in EFFORT_DISTANCES if name in bests]
    return cached(request, 600, f)


# ---- glucose

@router.get("/api/glucose", dependencies=[access.signed_in])
def glucose(request: Request):
    """from, to, and the target range low/high in mg/dL (default 70–180)."""
    u = uid_of(request)

    def f():
        loc = location(request)
        frm, to = time_range(request, loc, 14)
        low, high = 70.0, 180.0
        try:
            v = float(request.query_params.get("low", ""))
            if 40 <= v <= 120:
                low = v
        except ValueError:
            pass
        try:
            v = float(request.query_params.get("high", ""))
            if low < v <= 300:
                high = v
        except ValueError:
            pass
        rs, units, sources = [], {}, {}
        for t, v, unit, src, meal in db.q(
                """SELECT start_date, value, COALESCE(unit, ''), COALESCE(source_name, ''),
                COALESCE(JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.HKBloodGlucoseMealTime')), '')
                FROM hlt_samples WHERE type = 'blood_glucose' AND user_id = %s AND start_date >= %s AND start_date < %s AND value IS NOT NULL
                ORDER BY start_date""", (u, frm, to)):
            rs.append(gl.Reading(aware(t), gl.to_mgdl(v, unit), src, {"1": "before meal", "2": "after meal"}.get(meal, "")))
            units[unit] = units.get(unit, 0) + 1
            sources[src] = sources.get(src, 0) + 1
        stats, agp, days = gl.summarize(rs, loc, low, high, 15)
        recorded, most = "mg/dL", 0
        for unit, n in units.items():
            if n > most:
                most = n
                recorded = "mmol/L" if unit.lower().startswith("mmol") else "mg/dL"
        # raw readings for the chart: everything up to ~50k points, otherwise one per 15 minutes
        readings, step, last = [], timedelta(minutes=15) if len(rs) > 50000 else None, None
        for x in rs:
            if step and last is not None and x.t - last < step:
                continue
            last = x.t
            row = [int(x.t.timestamp()), an.round_half_away(x.mgdl * 10) / 10]
            if x.meal:
                row.append(x.meal)
            readings.append(row)
        return {"unit": "mg/dL", "recordedUnit": recorded, "target": [low, high], "stats": stats, "agp": agp, "days": days,
                "readings": readings, "sources": sources}
    return cached(request, 0, f)


# ---- settings (units, theme, hidden sections and metrics, targets, goals): per account, shared by its browsers

@router.get("/api/settings", dependencies=[access.signed_in])
def get_settings(request: Request):
    out = {}
    for k, v in db.q("SELECT name, value FROM hlt_user_settings WHERE user_id = %s", (uid_of(request),)):
        try:
            out[k] = json.loads(v)
        except ValueError:
            pass
    return out


@router.put("/api/settings", dependencies=[access.signed_in])
async def put_settings(request: Request):
    u = uid_of(request)
    body = await request.body()
    if len(body) > 256 << 10:
        raise HTTPException(413, "too large")
    try:
        data = json.loads(body)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not isinstance(data, dict):
        raise HTTPException(400, "A JSON object is expected")
    if len(data) > 100:
        raise HTTPException(400, "too many settings")
    rows = []
    for k, v in data.items():
        if not 0 < len(k) <= 64:
            raise HTTPException(400, "setting names are 1 to 64 characters")
        rows.append((u, k, json.dumps(v, ensure_ascii=False)))
    if rows:
        with db.tx() as con, con.cursor() as cur:
            cur.executemany("INSERT INTO hlt_user_settings (user_id, name, value) VALUES (%s, %s, %s) ON DUPLICATE KEY UPDATE value = VALUES(value)", rows)
    return {"saved": len(rows)}
