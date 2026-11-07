"""The health database: a small connection pool, query helpers and the numbered schema migrations.

Every timestamp is UTC: the session time zone is +00:00 and DATETIME values come back as naive datetimes in UTC.
"""
import logging
import queue
import re
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone

import pymysql

from app import config

log = logging.getLogger("app.db")

TABLE_OPTIONS = " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
POOL_SIZE = 8

_pool: "queue.LifoQueue" = queue.LifoQueue(maxsize=POOL_SIZE)
_params: dict = {}


def configure(**values):
    """Point the pool at another database (the tests)."""
    _params.update(values)
    close_all()


def params() -> dict:
    p = {"host": config.DB_HOST, "port": config.DB_PORT, "user": config.DB_USER, "password": config.DB_PASSWORD, "database": config.DB_NAME}
    p.update(_params)
    return p


def _connect(database=...):
    p = params()
    return pymysql.connect(host=p["host"], port=int(p["port"]), user=p["user"], password=p["password"],
                           database=p["database"] if database is ... else database, charset="utf8mb4", autocommit=True,
                           connect_timeout=8, read_timeout=300, write_timeout=300, init_command="SET time_zone = '+00:00'")


def close_all():
    while True:
        try:
            _pool.get_nowait().close()
        except queue.Empty:
            return
        except Exception:
            pass


@contextmanager
def conn():
    """A pooled connection in autocommit mode."""
    try:
        con = _pool.get_nowait()
        try:
            con.ping(reconnect=False)
        except Exception:
            con.close()
            con = _connect()
    except queue.Empty:
        con = _connect()
    ok = False
    try:
        yield con
        ok = True
    finally:
        if ok and con.get_autocommit():
            try:
                _pool.put_nowait(con)
            except queue.Full:
                con.close()
        else:
            con.close()


@contextmanager
def tx():
    """A transaction: committed at the end of the block, rolled back on an exception."""
    with conn() as con:
        con.autocommit(False)
        try:
            con.begin()
            yield con
            con.commit()
        except BaseException:
            try:
                con.rollback()
            except pymysql.MySQLError:
                pass  # a dropped connection: the error worth seeing is the one being raised
            raise
        finally:
            try:
                con.autocommit(True)
            except pymysql.MySQLError:
                pass  # conn() closes it rather than pooling it: it's not in autocommit mode


def q(sql: str, args=None) -> list:
    with conn() as con, con.cursor() as cur:
        cur.execute(sql, args)
        return list(cur.fetchall())


def qd(sql: str, args=None) -> list:
    """Rows as dicts."""
    with conn() as con, con.cursor(pymysql.cursors.DictCursor) as cur:
        cur.execute(sql, args)
        return list(cur.fetchall())


def one(sql: str, args=None):
    rows = q(sql, args)
    return rows[0] if rows else None


def ex(sql: str, args=None) -> int:
    with conn() as con, con.cursor() as cur:
        cur.execute(sql, args)
        return cur.lastrowid or cur.rowcount


def utc(dt) -> datetime:
    """A naive UTC datetime from the database as an aware one."""
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt


def unix(dt):
    return None if dt is None else int(utc(dt).timestamp())


def naive(dt: datetime) -> datetime:
    """An aware datetime as the naive UTC value the database stores."""
    return dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt


# ---- start-up

def wait_for_server(attempts: int = 30):
    """The server may still be starting when the container comes up."""
    for attempt in range(1, attempts + 1):
        try:
            con = _connect(database=None)
            try:
                with con.cursor() as cur:
                    name = params()["database"].replace("`", "``")
                    try:
                        cur.execute(f"CREATE DATABASE IF NOT EXISTS `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
                    except pymysql.MySQLError as e:
                        log.info("couldn't create database %s (fine if it already exists): %s", name, e)
            finally:
                con.close()
            return
        except pymysql.MySQLError as e:
            if attempt == attempts:
                raise
            log.warning("waiting for MariaDB at %s:%s: %s", params()["host"], params()["port"], e)
            time.sleep(2)


# ---- schema

TYPE_PREFIXES = ("HKQuantityTypeIdentifier", "HKCategoryTypeIdentifier", "HKCharacteristicTypeIdentifier", "HKDataTypeIdentifier")


def storage_name(identifier: str) -> str:
    """A HealthKit identifier as the short name stored in `type` columns, the rule HealthTypes.storageName uses on the
    phone: HKQuantityTypeIdentifierHeartRate -> heart_rate, ...VO2Max -> vo2_max, ...HeartRateVariabilitySDNN ->
    heart_rate_variability_sdnn."""
    name = identifier
    for p in TYPE_PREFIXES:
        if name.startswith(p):
            name = name[len(p):]
            break
    if name.startswith("HK"):
        name = name[2:]
        if name.endswith("TypeIdentifier") and len(name) > len("TypeIdentifier"):
            name = name[:-len("TypeIdentifier")]
    name = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", name)
    name = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", "_", name)
    return name.lower()


# Every table is hlt_<name> (the suite's naming convention: the apps can share one database). Rows belong to an
# account (user_id: its id in the Shared ioSuite database); created_at / updated_at say when a row arrived and last
# changed. Types are stored as short names (storage_name).
_STAMPS = ("created_at DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3), "
           "updated_at DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), "
           "user_id INT NOT NULL DEFAULT 0")
SCHEMA = [
    f"""CREATE TABLE IF NOT EXISTS hlt_characteristics (
        name VARCHAR(64) NOT NULL, value TEXT, {_STAMPS},
        PRIMARY KEY (user_id, name))""",
    f"""CREATE TABLE IF NOT EXISTS hlt_samples (
        uuid CHAR(36) PRIMARY KEY, type VARCHAR(128) NOT NULL, kind VARCHAR(32) NOT NULL,
        start_date DATETIME(3) NOT NULL, end_date DATETIME(3) NOT NULL,
        value DOUBLE, unit VARCHAR(64), text MEDIUMTEXT, count INT, source_name VARCHAR(255), metadata_json JSON, {_STAMPS},
        INDEX idx_hlt_samples_type_start (type, start_date),
        INDEX idx_hlt_samples_created (created_at, type, end_date))""",
    f"""CREATE TABLE IF NOT EXISTS hlt_workouts (
        uuid CHAR(36) PRIMARY KEY, activity_type VARCHAR(64), activity_type_raw INT,
        start_date DATETIME(3), end_date DATETIME(3), duration_s DOUBLE, source_name VARCHAR(255), metadata_json JSON, {_STAMPS},
        INDEX idx_hlt_workouts_start (start_date))""",
    f"""CREATE TABLE IF NOT EXISTS hlt_workout_statistics (
        workout_uuid CHAR(36) NOT NULL, type VARCHAR(128) NOT NULL, unit VARCHAR(64),
        average DOUBLE, minimum DOUBLE, maximum DOUBLE, sum DOUBLE, most_recent DOUBLE, {_STAMPS},
        PRIMARY KEY (workout_uuid, type))""",
    f"""CREATE TABLE IF NOT EXISTS hlt_workout_events (
        workout_uuid CHAR(36), type VARCHAR(64), start_date DATETIME(3), end_date DATETIME(3), metadata_json JSON, {_STAMPS},
        INDEX idx_hlt_workout_events_workout (workout_uuid))""",
    f"""CREATE TABLE IF NOT EXISTS hlt_workout_activities (
        workout_uuid CHAR(36), activity_type VARCHAR(64), start_date DATETIME(3), end_date DATETIME(3), metadata_json JSON, {_STAMPS},
        INDEX idx_hlt_workout_activities_workout (workout_uuid))""",
    f"""CREATE TABLE IF NOT EXISTS hlt_workout_route_points (
        workout_uuid CHAR(36), route_uuid CHAR(36) NOT NULL, time DATETIME(3) NOT NULL,
        latitude DOUBLE, longitude DOUBLE, altitude DOUBLE, horizontal_accuracy DOUBLE, vertical_accuracy DOUBLE, speed DOUBLE, course DOUBLE,
        {_STAMPS},
        PRIMARY KEY (route_uuid, time),
        INDEX idx_hlt_workout_route_points_workout (workout_uuid))""",
    f"""CREATE TABLE IF NOT EXISTS hlt_heartbeats (
        series_uuid CHAR(36) NOT NULL, time_since_start_s DOUBLE NOT NULL, preceded_by_gap BOOL, {_STAMPS},
        PRIMARY KEY (series_uuid, time_since_start_s))""",
    f"""CREATE TABLE IF NOT EXISTS hlt_activity_summaries (
        date DATE NOT NULL,
        active_energy_kcal DOUBLE, active_energy_goal_kcal DOUBLE, exercise_min DOUBLE, exercise_goal_min DOUBLE,
        stand_hours DOUBLE, stand_hours_goal DOUBLE, move_min DOUBLE, move_goal_min DOUBLE, {_STAMPS},
        PRIMARY KEY (user_id, date))""",
    f"""CREATE TABLE IF NOT EXISTS hlt_deleted_objects (
        uuid CHAR(36) PRIMARY KEY, type VARCHAR(128), deleted_at DATETIME(3), {_STAMPS})""",
    # one row per sync; last_batch_seq: the last numbered upload batch applied makes a retried batch a no-op;
    # applied: what it applied (its reply, without counting the account's rows)
    """CREATE TABLE IF NOT EXISTS hlt_sync_log (
        id INT AUTO_INCREMENT PRIMARY KEY, started_at DATETIME(3), finished_at DATETIME(3),
        device VARCHAR(255), os VARCHAR(32), full_resync BOOL, items INT,
        last_batch_seq INT NOT NULL DEFAULT 0, user_id INT NOT NULL DEFAULT 0, applied INT NOT NULL DEFAULT 0,
        INDEX idx_hlt_sync_log_user (user_id, id))""",
    # the web app's hourly rollup (the background rollup recomputes a type's hours for every account at once) and settings
    """CREATE TABLE IF NOT EXISTS hlt_sample_hourly (
        type VARCHAR(128) NOT NULL, hour DATETIME NOT NULL, source_name VARCHAR(255) NOT NULL DEFAULT '',
        sum DOUBLE, n INT NOT NULL, min DOUBLE, max DOUBLE, user_id INT NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, type, hour, source_name),
        INDEX idx_hlt_sample_hourly_type_hour (type, hour))""",
    "CREATE TABLE IF NOT EXISTS hlt_sample_hourly_ready (type VARCHAR(128) PRIMARY KEY)",
    """CREATE TABLE IF NOT EXISTS hlt_user_settings (
        name VARCHAR(64) NOT NULL, value MEDIUMTEXT NOT NULL,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        user_id INT NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, name))""",
]


# how long samples take to reach the database, per account and type, and per day of arrival (UTC)
DELAY_BY_TYPE = """CREATE OR REPLACE VIEW hlt_sample_delay_by_type AS
    SELECT user_id, type, COUNT(*) AS samples,
        ROUND(MIN(TIMESTAMPDIFF(SECOND, end_date, created_at)) / 60, 1) AS min_delay_min,
        ROUND(AVG(TIMESTAMPDIFF(SECOND, end_date, created_at)) / 60, 1) AS avg_delay_min,
        ROUND(MAX(TIMESTAMPDIFF(SECOND, end_date, created_at)) / 60, 1) AS max_delay_min,
        MAX(end_date) AS latest_sample, MAX(created_at) AS latest_arrival
    FROM hlt_samples WHERE created_at IS NOT NULL GROUP BY user_id, type"""
DELAY_BY_DAY = """CREATE OR REPLACE VIEW hlt_sample_delay_by_day AS
    SELECT user_id, DATE(created_at) AS day, type, COUNT(*) AS samples,
        ROUND(MIN(TIMESTAMPDIFF(SECOND, end_date, created_at)) / 60, 1) AS min_delay_min,
        ROUND(AVG(TIMESTAMPDIFF(SECOND, end_date, created_at)) / 60, 1) AS avg_delay_min,
        ROUND(MAX(TIMESTAMPDIFF(SECOND, end_date, created_at)) / 60, 1) AS max_delay_min
    FROM hlt_samples WHERE created_at IS NOT NULL GROUP BY user_id, DATE(created_at), type"""


SCHEMA_VERSION = 11
_lock = threading.Lock()


def schema_version() -> int:
    return one("SELECT COALESCE(MAX(version), 0) FROM hlt_schema_version")[0]


def pending() -> bool:
    try:
        return schema_version() < SCHEMA_VERSION
    except pymysql.MySQLError:
        return True


def migrate():
    """Create the tables and views that are missing (idempotent)."""
    with _lock, conn() as con:
        with con.cursor() as cur:
            for stmt in SCHEMA:
                cur.execute(stmt + TABLE_OPTIONS)
            cur.execute(DELAY_BY_TYPE)
            cur.execute(DELAY_BY_DAY)
            cur.execute("CREATE TABLE IF NOT EXISTS hlt_schema_version (version INT PRIMARY KEY, applied_at DATETIME(3) NOT NULL)" + TABLE_OPTIONS)
            cur.execute("INSERT IGNORE INTO hlt_schema_version VALUES (%s, UTC_TIMESTAMP(3))", (SCHEMA_VERSION,))
