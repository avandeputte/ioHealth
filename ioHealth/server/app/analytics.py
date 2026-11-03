"""Pure calculations behind the web app's API: bucketing, de-duplicating sources, sleep nights, route maths and heart
rate zones. Nothing here touches the database, so it is all unit-tested. Times are aware datetimes."""
import bisect
import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

UTC = timezone.utc

# added up per bucket (steps per day); every other quantity type is averaged (heart rate)
CUMULATIVE_TYPES = {
    "step_count", "distance_walking_running", "distance_cycling", "distance_swimming", "distance_wheelchair",
    "distance_downhill_snow_sports", "distance_cross_country_skiing", "distance_paddle_sports", "distance_rowing",
    "distance_skating_sports", "active_energy_burned", "basal_energy_burned", "flights_climbed", "push_count",
    "swimming_stroke_count", "apple_exercise_time", "apple_stand_time", "apple_move_time", "time_in_daylight",
    "number_of_times_fallen", "number_of_alcoholic_beverages", "nike_fuel", "insulin_delivery",
    "cross_country_skiing_stroke_count", "paddle_sports_stroke_count", "rowing_stroke_count",
}


def is_cumulative(t: str) -> bool:
    return t in CUMULATIVE_TYPES or t.startswith("dietary_")


@dataclass
class HourRow:
    """One (UTC hour, source) group."""
    hour: datetime
    source: str
    sum: float
    n: int
    min: float
    max: float


def bucket_start(t: datetime, bucket: str, loc) -> datetime:
    """The local start of the hour, day, week (Monday), month or year containing t."""
    t = t.astimezone(loc)
    if bucket == "hour":
        return datetime(t.year, t.month, t.day, t.hour, tzinfo=loc)
    if bucket == "week":
        d = date(t.year, t.month, t.day) - timedelta(days=t.weekday())
        return datetime(d.year, d.month, d.day, tzinfo=loc)
    if bucket == "month":
        return datetime(t.year, t.month, 1, tzinfo=loc)
    if bucket == "year":
        return datetime(t.year, 1, 1, tzinfo=loc)
    return datetime(t.year, t.month, t.day, tzinfo=loc)


def auto_bucket(start: datetime, end: datetime) -> str:
    """A bucket that gives a chart between roughly 30 and 400 points."""
    span = end - start
    if span <= timedelta(days=3):
        return "hour"
    if span <= timedelta(days=400):
        return "day"
    if span <= timedelta(days=4 * 365):
        return "week"
    return "month"


def fold_hours(rows, bucket: str, loc, cumulative: bool) -> list:
    """Hourly per-source groups as local buckets. Cumulative types take the source that recorded the most (an
    iPhone and a Watch both counting steps aren't added together); the others are averaged, with min and max."""
    buckets = {}
    memo = {}
    for r in rows:
        k = memo.get(r.hour)
        if k is None:
            k = memo[r.hour] = int(bucket_start(r.hour, bucket, loc).timestamp())
        a = buckets.get(k)
        if a is None:
            a = buckets[k] = [0.0, 0, math.inf, -math.inf, {}]
        a[0] += r.sum
        a[1] += r.n
        a[2] = min(a[2], r.min)
        a[3] = max(a[3], r.max)
        a[4][r.source] = a[4].get(r.source, 0.0) + r.sum
    out = []
    for k in sorted(buckets):
        s, n, mn, mx, by_source = buckets[k]
        p = {"t": k, "v": 0.0, "n": n}
        if cumulative:
            p["v"] = max([0.0] + list(by_source.values()))
        elif n > 0:
            p["v"] = s / n
            p["min"], p["max"] = mn, mx
        out.append(p)
    return out


# ---- sleep

@dataclass
class SleepSample:
    start: datetime
    end: datetime
    stage: str  # inBed, asleep, awake, core, deep, rem
    source: str


def night_of(t: datetime, loc) -> str:
    """The night a sleep sample belongs to: the local date six hours after it starts, so sleep from 18:00 until the
    next 18:00 belongs to the day it ends on and an afternoon nap stays on its own day."""
    return (t.astimezone(loc) + timedelta(hours=6)).strftime("%Y-%m-%d")


def sleep_nights(samples, loc, with_segments: bool) -> list:
    """One night per date, from the source that recorded the most sleep that night. Minutes per stage."""
    groups = {}
    for s in samples:
        groups.setdefault((night_of(s.start, loc), s.source), []).append(s)
    in_bed = {}
    for (night, _), ss in groups.items():
        total = sum((s.end - s.start).total_seconds() / 60 for s in ss if s.stage == "inBed")
        in_bed[night] = max(in_bed.get(night, 0.0), total)
    best = {}
    for (night, source), ss in groups.items():
        n = {"date": night, "source": source, "start": 0, "end": 0, "asleep": 0.0, "inBed": 0.0, "stages": {}}
        first = last = None
        for s in ss:
            mins = (s.end - s.start).total_seconds() / 60
            if s.stage == "inBed":
                n["inBed"] += mins
                continue
            n["stages"][s.stage] = n["stages"].get(s.stage, 0.0) + mins
            if s.stage != "awake":
                n["asleep"] += mins
                if first is None or s.start < first:
                    first = s.start
                if last is None or s.end > last:
                    last = s.end
        if first is not None:
            n["start"], n["end"] = int(first.timestamp()), int(last.timestamp())
        if with_segments:
            n["segments"] = [{"s": int(s.start.timestamp()), "e": int(s.end.timestamp()), "stage": s.stage}
                             for s in sorted(ss, key=lambda s: s.start)]
        cur = best.get(night)
        if cur is None or n["asleep"] > cur["asleep"] or (n["asleep"] == cur["asleep"] and n["inBed"] > cur["inBed"]):
            best[night] = n
    out = []
    for night, n in best.items():
        n["inBed"] = in_bed.get(night, 0.0)
        out.append(n)
    out.sort(key=lambda n: n["date"])
    return out


# ---- routes

@dataclass
class RoutePoint:
    t: datetime
    lat: float
    lon: float
    alt: float = 0.0
    speed: float = -1.0
    h_accuracy: float = 0.0
    dist: float = 0.0  # metres from the start


EARTH_RADIUS = 6371008.8


def haversine(lat1, lon1, lat2, lon2) -> float:
    r = math.pi / 180
    d_lat, d_lon = (lat2 - lat1) * r, (lon2 - lon1) * r
    a = math.sin(d_lat / 2) ** 2 + math.cos(lat1 * r) * math.cos(lat2 * r) * math.sin(d_lon / 2) ** 2
    return 2 * EARTH_RADIUS * math.asin(min(1.0, math.sqrt(a)))


def clean_route(pts) -> list:
    """Drops fixes with a poor horizontal accuracy and fills in the cumulative distance."""
    out = []
    for p in pts:
        if p.h_accuracy > 50 or (p.lat == 0 and p.lon == 0):
            continue
        if out:
            q = out[-1]
            p.dist = q.dist + haversine(q.lat, q.lon, p.lat, p.lon)
        else:
            p.dist = 0.0
        out.append(p)
    return out


def elevation_gain(pts, threshold: float) -> tuple:
    """Climbs and descents, ignoring wiggles smaller than the threshold (GPS altitude is noisy)."""
    gain = loss = 0.0
    if not pts:
        return gain, loss
    ref = pts[0].alt
    for p in pts[1:]:
        d = p.alt - ref
        if d >= threshold:
            gain += d
            ref = p.alt
        elif d <= -threshold:
            loss -= d
            ref = p.alt
    return gain, loss


def splits(pts, every: float, hr_at=None) -> list:
    """The route cut every `every` metres; hr_at(a, b) gives the average heart rate over a time range, or None."""
    out = []
    if len(pts) < 2 or every <= 0:
        return out
    start = 0
    nxt = every

    def emit(end):
        nonlocal start
        a, b = pts[start], pts[end]
        gain, _ = elevation_gain(pts[start:end + 1], 2)
        s = {"index": len(out) + 1, "distance": b.dist - a.dist, "seconds": (b.t - a.t).total_seconds(), "gain": gain}
        if hr_at is not None:
            hr = hr_at(a.t, b.t)
            if hr is not None:
                s["hr"] = hr
        out.append(s)
        start = end

    for i in range(1, len(pts)):
        if pts[i].dist >= nxt:
            emit(i)
            nxt += every
    last = len(pts) - 1
    if start < last and pts[last].dist - pts[start].dist > 10:
        emit(last)
    return out


def best_effort(pts, distance: float):
    """The fastest time over `distance` metres anywhere in the route (two-pointer sweep), or None."""
    j = 0
    best = math.inf
    n = len(pts)
    for i in range(n):
        while j < n and pts[j].dist - pts[i].dist < distance:
            j += 1
        if j == n:
            break
        d0, d1 = pts[j - 1].dist - pts[i].dist, pts[j].dist - pts[i].dist
        t0, t1 = (pts[j - 1].t - pts[i].t).total_seconds(), (pts[j].t - pts[i].t).total_seconds()
        t = t1
        if d1 > d0:
            t = t0 + (t1 - t0) * (distance - d0) / (d1 - d0)
        if 0 < t < best:
            best = t
    return None if math.isinf(best) else best


def simplify(pts, min_step: float, max_points: int) -> list:
    """Every point that moves at least min_step metres from the last kept one, and at most max_points points."""
    if len(pts) <= 2:
        return list(pts)
    out = [pts[0]]
    for p in pts[1:-1]:
        if p.dist - out[-1].dist >= min_step:
            out.append(p)
    out.append(pts[-1])
    if max_points > 0 and len(out) > max_points:
        step = (len(out) - 1) / (max_points - 1)
        out = [out[int(round_half_away(i * step))] for i in range(max_points)]
    return out


def round_half_away(x: float) -> float:
    """Go's math.Round: halves away from zero (Python's round() goes to even)."""
    return math.floor(x + 0.5) if x >= 0 else -math.floor(-x + 0.5)


# ---- heart rate

@dataclass
class HRSample:
    t: datetime
    bpm: float


@dataclass
class HRSeries:
    samples: list = field(default_factory=list)
    times: list = field(default_factory=list)

    def add(self, t: datetime, bpm: float):
        self.samples.append(HRSample(t, bpm))
        self.times.append(t)

    def between(self, a: datetime, b: datetime):
        """The mean heart rate in [a, b], or None. A plain mean is close enough at the Watch's workout rate."""
        i = bisect.bisect_left(self.times, a)
        total, n = 0.0, 0
        while i < len(self.samples) and self.samples[i].t <= b:
            total += self.samples[i].bpm
            n += 1
            i += 1
        return total / n if n else None


def hr_zones(hr, max_hr: float, end: datetime) -> list:
    """The classic five zones at 50/60/70/80/90 % of maximum. Each sample counts until the next one, capped at a
    minute so a gap in the data isn't credited to whatever came before it."""
    bounds = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    zones = [{"zone": i + 1, "low": round_half_away(bounds[i] * max_hr), "high": round_half_away(bounds[i + 1] * max_hr), "seconds": 0.0}
             for i in range(5)]
    for i, s in enumerate(hr):
        nxt = hr[i + 1].t if i + 1 < len(hr) else end
        dt = min((nxt - s.t).total_seconds(), 60)
        if dt <= 0:
            continue
        f = s.bpm / max_hr
        for k in range(4, -1, -1):
            if f >= bounds[k]:
                zones[k]["seconds"] += dt
                break
    return zones


def age_on(dob: str, t: datetime) -> int:
    """Whole years between a yyyy-mm-dd birth date and t, or 0."""
    try:
        b = datetime.strptime((dob or "")[:10].strip(), "%Y-%m-%d")
    except ValueError:
        return 0
    age = t.year - b.year
    if (t.month, t.day) < (b.month, b.day):
        age -= 1
    return age


# ---- units

def to_metres(v: float, unit: str) -> float:
    return v * {"km": 1000, "mi": 1609.344, "yd": 0.9144, "ft": 0.3048, "cm": 0.01}.get(unit, 1)


def to_kcal(v: float, unit: str) -> float:
    return {"kJ": v / 4.184, "J": v / 4184, "cal": v / 1000}.get(unit, v)


def parse_quantity(s: str):
    """A metadata quantity as HealthKit prints it ("123.4 m", "25 degC") as (value, unit), or None."""
    f = (s or "").split()
    if not f:
        return None
    try:
        v = float(f[0])
    except ValueError:
        return None
    return v, " ".join(f[1:])
