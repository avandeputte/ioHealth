"""Blood glucose: the summary a CGM report gives (time in range, GMI, variability, the ambulatory glucose profile and
per-day figures). Everything is computed in mg/dL; the browser converts to mmol/L when asked."""
import math
from dataclasses import dataclass
from datetime import datetime, timedelta

MGDL_PER_MMOL = 18.0182


@dataclass
class Reading:
    t: datetime
    mgdl: float
    source: str = ""
    meal: str = ""  # "before meal" / "after meal" from HKBloodGlucoseMealTime, for finger-pricks


def to_mgdl(v: float, unit: str) -> float:
    """HealthKit writes mmol/L as "mmol<180.15588...>/L"."""
    return v * MGDL_PER_MMOL if (unit or "").lower().startswith("mmol") else v


def shares(vals, low: float, high: float) -> dict:
    """The consensus CGM bands (Battelino et al., Diabetes Care 2019), with the target range configurable:
    very low < 54 <= low < target low <= in range <= target high < high <= 250 < very high."""
    r = {"veryLow": 0.0, "low": 0.0, "inRange": 0.0, "high": 0.0, "veryHigh": 0.0}
    if not vals:
        return r
    for v in vals:
        if v < 54:
            r["veryLow"] += 1
        elif v < low:
            r["low"] += 1
        elif v <= high:
            r["inRange"] += 1
        elif v <= 250:
            r["high"] += 1
        else:
            r["veryHigh"] += 1
    n = len(vals)
    return {k: v / n for k, v in r.items()}


def percentile(s, p: float) -> float:
    if not s:
        return math.nan
    x = p * (len(s) - 1)
    i = int(x)
    if i + 1 >= len(s):
        return s[-1]
    return s[i] + (s[i + 1] - s[i]) * (x - i)


def mean_sd(vals) -> tuple:
    if not vals:
        return 0.0, 0.0
    mean = sum(vals) / len(vals)
    sd = 0.0
    if len(vals) > 1:
        sd = math.sqrt(sum((v - mean) ** 2 for v in vals) / (len(vals) - 1))
    return mean, sd


def summarize(rs, loc, low: float, high: float, bin_minutes: int = 15) -> tuple:
    """(stats, agp bins, days) for readings sorted by time."""
    st = {"readings": 0, "days": 0, "perDay": 0.0, "mean": 0.0, "sd": 0.0, "cv": 0.0, "gmi": 0.0, "min": 0.0, "max": 0.0,
          "median": 0.0, "ranges": shares([], low, high), "lows": 0}
    if not rs:
        return st, [], []
    all_vals = [r.mgdl for r in rs]
    bins = [[] for _ in range(24 * 60 // bin_minutes)]
    by_day = {}
    for r in rs:
        lt = r.t.astimezone(loc)
        bins[(lt.hour * 60 + lt.minute) // bin_minutes].append(r.mgdl)
        by_day.setdefault(lt.strftime("%Y-%m-%d"), []).append(r.mgdl)
    st["readings"] = len(rs)
    st["days"] = len(by_day)
    st["perDay"] = len(rs) / st["days"]
    st["mean"], st["sd"] = mean_sd(all_vals)
    if st["mean"] > 0:
        st["cv"] = st["sd"] / st["mean"] * 100
    st["gmi"] = 3.31 + 0.02392 * st["mean"]
    st["ranges"] = shares(all_vals, low, high)
    s = sorted(all_vals)
    st["min"], st["max"], st["median"] = s[0], s[-1], percentile(s, .5)

    # low episodes: consecutive readings below target spanning at least 15 minutes (gaps over 30 minutes split them)
    start = prev = None
    inside = False
    for r in rs:
        if r.mgdl < low:
            if inside and r.t - prev > timedelta(minutes=30):
                if prev - start >= timedelta(minutes=15):
                    st["lows"] += 1
                inside = False
            if not inside:
                inside, start = True, r.t
        elif inside:
            if prev - start >= timedelta(minutes=15):
                st["lows"] += 1
            inside = False
        prev = r.t
    if inside and prev - start >= timedelta(minutes=15):
        st["lows"] += 1

    agp = []
    for i, b in enumerate(bins):
        if not b:
            continue
        b.sort()
        agp.append({"minute": i * bin_minutes, "n": len(b), "p5": percentile(b, .05), "p25": percentile(b, .25),
                    "p50": percentile(b, .5), "p75": percentile(b, .75), "p95": percentile(b, .95)})
    days = []
    for d in sorted(by_day):
        vals = by_day[d]
        m, sd = mean_sd(vals)
        days.append({"date": d, "n": len(vals), "mean": m, "min": min(vals), "max": max(vals), "sd": sd, "ranges": shares(vals, low, high)})
    return st, agp, days
