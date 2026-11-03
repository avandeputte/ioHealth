"""sample_hourly holds every account's samples summed per type, UTC hour and source, so charts and records over
months or years read a few thousand rows instead of millions. Each upload batch keeps its own account's hours up to
date inside the batch's transaction; data that predates the rollup is filled by a background job that works one
type and one month at a time, for every account at once (small transactions, which a Galera cluster replicates
without trouble). Until a type is filled, its charts read samples."""
import logging
import threading
import time
from datetime import datetime, timedelta, timezone

from app import db

log = logging.getLogger("app.rollup")

# keeps the backfill and upload batches from recomputing the same hours at once
lock = threading.Lock()

# what a sample adds to its hour: its value, or for category samples (mindful sessions, stand hours) its minutes
HOURLY_VALUE = "CASE WHEN kind = 'category' THEN TIMESTAMPDIFF(SECOND, start_date, end_date) / 60 ELSE value END"


class Touched:
    """The (type, UTC hour) pairs an upload batch changed."""

    def __init__(self):
        self.hours = set()

    def add(self, typ: str, start: datetime):
        self.hours.add((typ, start.replace(minute=0, second=0, microsecond=0)))

    def spans(self) -> dict:
        """Each type's hours grouped into runs with no gap over a day, so a batch with samples years apart
        recomputes a few short spans rather than everything between them."""
        by_type = {}
        for typ, h in self.hours:
            by_type.setdefault(typ, []).append(h)
        out = {}
        for typ, hours in by_type.items():
            hours.sort()
            start = last = hours[0]
            for h in hours[1:]:
                if h - last > timedelta(hours=24):
                    out.setdefault(typ, []).append((start, last + timedelta(hours=1)))
                    start = h
                last = h
            out.setdefault(typ, []).append((start, last + timedelta(hours=1)))
        return out


def recompute(cur, user_id, typ: str, start: datetime, end: datetime):
    """Rebuild sample_hourly for one type over [start, end) (naive UTC, on hour boundaries), for one account, or for
    every account when user_id is None."""
    who = "" if user_id is None else " AND user_id = %s"
    args = () if user_id is None else (user_id,)
    cur.execute("DELETE FROM sample_hourly WHERE type = %s AND hour >= %s AND hour < %s" + who, (typ, start, end) + args)
    cur.execute(f"""INSERT INTO sample_hourly (user_id, type, hour, source_name, sum, n, min, max)
        SELECT user_id, type, DATE_FORMAT(start_date, '%%Y-%%m-%%d %%H:00:00') AS h, COALESCE(source_name, ''),
            SUM({HOURLY_VALUE}), COUNT(*), MIN({HOURLY_VALUE}), MAX({HOURLY_VALUE})
        FROM samples WHERE type = %s AND start_date >= %s AND start_date < %s AND (value IS NOT NULL OR kind = 'category'){who}
        GROUP BY user_id, h, COALESCE(source_name, '')""", (typ, start, end) + args)


class Ready:
    """The types whose sample_hourly rows are complete (for every account: new accounts' data only ever arrives
    through uploads, which keep their hours up to date)."""

    def __init__(self):
        self.types = set()
        self._lock = threading.Lock()

    def has(self, t: str) -> bool:
        return t in self.types

    def add(self, t: str):
        with self._lock:
            self.types = self.types | {t}


def backfill(ready: Ready, done=None):
    """Fill sample_hourly for every type not yet marked ready, a month per transaction, and mark each type ready when
    it's done. Safe to interrupt: a restart redoes the unfinished type."""
    try:
        for (t,) in db.q("SELECT type FROM sample_hourly_ready"):
            ready.add(t)
        todo = [r for r in db.q("SELECT type, MIN(start_date), MAX(start_date) FROM samples GROUP BY type") if not ready.has(r[0])]
    except Exception as e:
        log.warning("hourly rollup: %s", e)
        return
    if not todo:
        return
    started = time.time()
    log.info("hourly rollup: filling %d types in the background", len(todo))
    for typ, first, last in todo:
        month = datetime(first.year, first.month, 1)
        while month <= last:
            nxt = datetime(month.year + month.month // 12, month.month % 12 + 1, 1)
            try:
                with lock, db.tx() as con, con.cursor() as cur:
                    recompute(cur, None, typ, month, nxt)
            except Exception as e:
                log.warning("hourly rollup: %s %s: %s (will retry on next start)", typ, month.strftime("%Y-%m"), e)
                return
            month = nxt
        db.ex("INSERT IGNORE INTO sample_hourly_ready (type) VALUES (%s)", (typ,))
        ready.add(typ)
        if done:
            done()
    log.info("hourly rollup: done in %ds", time.time() - started)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
