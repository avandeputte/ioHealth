"""The pure calculations, with the same cases as the Go receiver's tests."""
import math
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app import analytics as an, db, glucose as gl

UTC = timezone.utc
BRU = ZoneInfo("Europe/Brussels")


def test_bucket_start():
    t = datetime(2026, 10, 29, 23, 30, tzinfo=UTC)  # Friday 00:30 local
    want = {"hour": "2026-10-30 00:00", "day": "2026-10-30 00:00", "week": "2026-10-26 00:00", "month": "2026-10-01 00:00", "year": "2026-01-01 00:00"}
    for b, w in want.items():
        assert an.bucket_start(t, b, BRU).strftime("%Y-%m-%d %H:%M") == w, b


def test_fold_hours_cumulative_takes_biggest_source():
    day = datetime(2026, 10, 1, tzinfo=UTC)
    rows = [an.HourRow(day + timedelta(hours=8), "Watch", 3000, 10, 1, 500), an.HourRow(day + timedelta(hours=9), "Watch", 2000, 10, 1, 500),
            an.HourRow(day + timedelta(hours=8), "iPhone", 4500, 10, 1, 500), an.HourRow(day + timedelta(hours=30), "iPhone", 100, 1, 100, 100)]
    pts = an.fold_hours(rows, "day", UTC, True)
    assert [p["v"] for p in pts] == [5000, 100]


def test_fold_hours_average():
    day = datetime(2026, 10, 1, tzinfo=UTC)
    pts = an.fold_hours([an.HourRow(day, "Watch", 600, 10, 50, 70), an.HourRow(day + timedelta(hours=1), "Watch", 900, 10, 80, 120)], "day", UTC, False)
    assert len(pts) == 1 and pts[0]["v"] == 75 and pts[0]["min"] == 50 and pts[0]["max"] == 120 and pts[0]["n"] == 20


def test_sleep_nights_picks_best_source():
    def at(d, h, m):
        return datetime(2026, 10, d, h, m, tzinfo=BRU)
    ss = [an.SleepSample(at(29, 23, 0), at(30, 7, 0), "inBed", "iPhone"), an.SleepSample(at(29, 23, 10), at(30, 1, 0), "core", "Watch"),
          an.SleepSample(at(30, 1, 0), at(30, 2, 0), "deep", "Watch"), an.SleepSample(at(30, 2, 0), at(30, 2, 15), "awake", "Watch"),
          an.SleepSample(at(30, 2, 15), at(30, 6, 45), "rem", "Watch"), an.SleepSample(at(29, 23, 30), at(30, 3, 0), "asleep", "Other app"),
          an.SleepSample(at(30, 14, 0), at(30, 14, 30), "asleep", "Watch")]
    nights = an.sleep_nights(ss, BRU, True)
    assert len(nights) == 1
    n = nights[0]
    assert n["date"] == "2026-10-30" and n["source"] == "Watch"
    assert n["asleep"] == 470 and n["stages"]["awake"] == 15 and n["inBed"] == 480  # 110 core + 60 deep + 270 rem + 30 nap


def line(seconds, mps):
    """A straight route heading north at the given speed, one point per second."""
    start = datetime(2026, 10, 1, 7, tzinfo=UTC)
    return an.clean_route([an.RoutePoint(start + timedelta(seconds=i), 50 + i * mps / 111195, 4, 10, h_accuracy=5) for i in range(seconds + 1)])


def test_splits_and_best_effort():
    pts = line(1500, 4)  # 6 km at 4 m/s, 250 s per km
    assert abs(pts[-1].dist - 6000) < 5
    sp = an.splits(pts, 1000)
    assert len(sp) == 6 and all(abs(s["seconds"] - 250) <= 2 for s in sp)
    assert abs(an.best_effort(pts, 5000) - 1250) < 2
    assert an.best_effort(pts, 10000) is None
    assert len(an.simplify(pts, 3, 100)) == 100


def test_hr_zones_and_age():
    start = datetime(2026, 10, 1, 7, tzinfo=UTC)
    hr = [an.HRSample(start + timedelta(seconds=i * 10), 120 if i < 6 else 170) for i in range(12)]
    z = an.hr_zones(hr, 200, start + timedelta(seconds=120))
    assert z[1]["seconds"] == 60 and z[3]["seconds"] == 60 and z[0]["low"] == 100
    assert an.age_on("1980-06-15", datetime(2026, 6, 14, tzinfo=UTC)) == 45
    assert an.age_on("1980-06-15", datetime(2026, 6, 15, tzinfo=UTC)) == 46
    assert an.age_on("", datetime.now(UTC)) == 0


def test_units():
    assert an.to_metres(1, "km") == 1000 and an.to_kcal(4.184, "kJ") == 1
    assert an.parse_quantity("123.4 m") == (123.4, "m") and an.parse_quantity("") is None
    assert gl.to_mgdl(5.5, "mmol<180.15588000005408>/L") > 99 and gl.to_mgdl(99, "mg/dL") == 99


def test_storage_name():
    cases = {"HKQuantityTypeIdentifierHeartRate": "heart_rate", "HKQuantityTypeIdentifierDistanceWalkingRunning": "distance_walking_running",
             "HKCategoryTypeIdentifierSleepAnalysis": "sleep_analysis", "HKQuantityTypeIdentifierVO2Max": "vo2_max",
             "HKQuantityTypeIdentifierHeartRateVariabilitySDNN": "heart_rate_variability_sdnn", "HKQuantityTypeIdentifierUVExposure": "uv_exposure",
             "HKQuantityTypeIdentifierForcedExpiratoryVolume1": "forced_expiratory_volume1", "HKDataTypeIdentifierHeartbeatSeries": "heartbeat_series",
             "HKWorkoutTypeIdentifier": "workout", "HKWorkoutRouteTypeIdentifier": "workout_route", "HKActivitySummaryTypeIdentifier": "activity_summary",
             "heart_rate": "heart_rate"}
    for k, v in cases.items():
        assert db.storage_name(k) == v, k


def test_summarize_glucose():
    start = datetime(2026, 10, 1, tzinfo=UTC)
    rs = []
    for i in range(288):  # one day at 5-minute intervals: 100, except 01:00–01:30 at 60 and 12:00–14:00 at 200
        t = start + timedelta(minutes=5 * i)
        v = 60 if (t.hour == 1 and t.minute <= 30) else 200 if 12 <= t.hour < 14 else 100
        rs.append(gl.Reading(t, v))
    st, agp, days = gl.summarize(rs, UTC, 70, 180, 15)
    assert st["readings"] == 288 and st["days"] == 1 and len(days) == 1 and len(agp) == 96
    assert st["lows"] == 1
    assert math.isclose(st["ranges"]["low"], 7 / 288) and math.isclose(st["ranges"]["high"], 24 / 288)
    assert math.isclose(st["gmi"], 3.31 + 0.02392 * st["mean"]) and st["min"] == 60 and st["max"] == 200
    assert agp[48]["p50"] == 200 and agp[0]["p50"] == 100
