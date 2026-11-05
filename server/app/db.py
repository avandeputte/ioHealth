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


def _rename_types(con):
    """4: types stored with full HealthKit identifiers become short names, one type per transaction."""
    for table in ("samples", "workout_statistics", "deleted_objects"):
        with con.cursor() as cur:
            cur.execute(f"SELECT DISTINCT type FROM {table} WHERE type LIKE BINARY 'HK%%'")
            types = [r[0] for r in cur.fetchall()]
        for t in types:
            with con.cursor() as cur:
                cur.execute("BEGIN")
                n = cur.execute(f"UPDATE {table} SET type = %s WHERE type = %s", (storage_name(t), t))
                cur.execute("COMMIT")
            log.info("renamed %s.type %s -> %s (%d rows)", table, t, storage_name(t), n)


def _timestamp_columns(*tables) -> list:
    """inserted_at / updated_at, added without a default first and given one after, so existing rows stay NULL
    without a row-by-row UPDATE (on a Galera cluster that is one huge replicated transaction)."""
    out = []
    for t in tables:
        out += [f"ALTER TABLE {t} ADD COLUMN IF NOT EXISTS inserted_at DATETIME(3) NULL DEFAULT NULL, "
                "ADD COLUMN IF NOT EXISTS updated_at DATETIME(3) NULL DEFAULT NULL",
                f"ALTER TABLE {t} MODIFY COLUMN inserted_at DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3), "
                "MODIFY COLUMN updated_at DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)"]
    return out


# Tables whose rows belong to one account. The ones keyed by UUID get the column only (instant, no rewrite): a UUID
# is unique across phones. The ones keyed by a date or a name get it in their primary key; they are small.
USER_TABLES = ("samples", "workouts", "workout_statistics", "workout_events", "workout_activities", "workout_route_points",
               "heartbeats", "deleted_objects", "sync_log")
USER_KEYED = {"activity_summaries": "date", "characteristics": "`key`", "web_settings": "`key`", "sample_hourly": "type, hour, source_name"}


def _multi_user():
    """9: every row belongs to an account (user_id, the account's id in the Shared ioSuite database). The column is added
    without touching a row (ALGORITHM=INSTANT; it fails rather than rewrite a big table)."""
    def run(con):
        with con.cursor() as cur:
            for t in USER_TABLES:
                cur.execute(f"ALTER TABLE {t} ADD COLUMN IF NOT EXISTS user_id INT NOT NULL DEFAULT 0, ALGORITHM=INSTANT")
            for t, key in USER_KEYED.items():
                cur.execute(f"ALTER TABLE {t} ADD COLUMN IF NOT EXISTS user_id INT NOT NULL DEFAULT 0, "
                            f"DROP PRIMARY KEY, ADD PRIMARY KEY (user_id, {key})")
            # the background rollup recomputes a type's hours for every account at once
            cur.execute("ALTER TABLE sample_hourly ADD INDEX IF NOT EXISTS idx_hourly_type_hour (type, hour)")
            cur.execute("ALTER TABLE sync_log ADD INDEX IF NOT EXISTS idx_sync_log_user (user_id, id)")
    return run


def migrations() -> list:
    """Applied in order, once each, and recorded in schema_version. Append; never edit one that has shipped (the
    first eight are the Go receiver's, unchanged)."""
    return [
        # 1: the Mac app's SQLite tables, minus ECGs
        ["CREATE TABLE IF NOT EXISTS characteristics (`key` VARCHAR(64) PRIMARY KEY, value TEXT)",
         """CREATE TABLE IF NOT EXISTS samples (
            uuid CHAR(36) PRIMARY KEY, type VARCHAR(128) NOT NULL, kind VARCHAR(32) NOT NULL,
            start_date DATETIME(3) NOT NULL, end_date DATETIME(3) NOT NULL,
            value DOUBLE, unit VARCHAR(64), text MEDIUMTEXT, count INT,
            source_name VARCHAR(255), source_bundle VARCHAR(255), source_version VARCHAR(64), source_product VARCHAR(64), source_os VARCHAR(32),
            device_json JSON, metadata_json JSON,
            INDEX idx_samples_type_start (type, start_date))""",
         """CREATE TABLE IF NOT EXISTS workouts (
            uuid CHAR(36) PRIMARY KEY, activity_type VARCHAR(64), activity_type_raw INT,
            start_date DATETIME(3), end_date DATETIME(3), duration_s DOUBLE,
            source_name VARCHAR(255), source_bundle VARCHAR(255), source_version VARCHAR(64), source_product VARCHAR(64), source_os VARCHAR(32),
            device_json JSON, metadata_json JSON,
            INDEX idx_workouts_start (start_date))""",
         """CREATE TABLE IF NOT EXISTS workout_statistics (
            workout_uuid CHAR(36), type VARCHAR(128), unit VARCHAR(64),
            average DOUBLE, minimum DOUBLE, maximum DOUBLE, sum DOUBLE, most_recent DOUBLE,
            PRIMARY KEY (workout_uuid, type))""",
         """CREATE TABLE IF NOT EXISTS workout_events (
            workout_uuid CHAR(36), type VARCHAR(64), start_date DATETIME(3), end_date DATETIME(3), metadata_json JSON,
            INDEX idx_events_workout (workout_uuid))""",
         """CREATE TABLE IF NOT EXISTS workout_activities (
            workout_uuid CHAR(36), activity_type VARCHAR(64), start_date DATETIME(3), end_date DATETIME(3), metadata_json JSON,
            INDEX idx_activities_workout (workout_uuid))""",
         """CREATE TABLE IF NOT EXISTS workout_route_points (
            workout_uuid CHAR(36), route_uuid CHAR(36), time DATETIME(3),
            latitude DOUBLE, longitude DOUBLE, altitude DOUBLE, horizontal_accuracy DOUBLE, vertical_accuracy DOUBLE, speed DOUBLE, course DOUBLE,
            PRIMARY KEY (route_uuid, time),
            INDEX idx_route_points_workout (workout_uuid))""",
         """CREATE TABLE IF NOT EXISTS heartbeats (
            series_uuid CHAR(36), time_since_start_s DOUBLE, preceded_by_gap BOOL,
            PRIMARY KEY (series_uuid, time_since_start_s))""",
         """CREATE TABLE IF NOT EXISTS activity_summaries (
            date DATE PRIMARY KEY,
            active_energy_kcal DOUBLE, active_energy_goal_kcal DOUBLE, exercise_min DOUBLE, exercise_goal_min DOUBLE,
            stand_hours DOUBLE, stand_hours_goal DOUBLE, move_min DOUBLE, move_goal_min DOUBLE)""",
         "CREATE TABLE IF NOT EXISTS deleted_objects (uuid CHAR(36) PRIMARY KEY, type VARCHAR(128), deleted_at DATETIME(3))",
         "CREATE TABLE IF NOT EXISTS sync_log (id INT AUTO_INCREMENT PRIMARY KEY, started_at DATETIME(3), finished_at DATETIME(3), "
         "device VARCHAR(255), `system` VARCHAR(32), full_resync BOOL, items INT)"],
        # 2: numbered upload batches; the last one applied makes a retried batch a no-op
        ["ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS last_batch_seq INT NOT NULL DEFAULT 0"],
        # 3: only the source's name is sent now
        ["ALTER TABLE samples DROP COLUMN IF EXISTS source_bundle, DROP COLUMN IF EXISTS source_version, "
         "DROP COLUMN IF EXISTS source_product, DROP COLUMN IF EXISTS source_os, DROP COLUMN IF EXISTS device_json",
         "ALTER TABLE workouts DROP COLUMN IF EXISTS source_bundle, DROP COLUMN IF EXISTS source_version, "
         "DROP COLUMN IF EXISTS source_product, DROP COLUMN IF EXISTS source_os, DROP COLUMN IF EXISTS device_json"],
        # 4: short type names
        [_rename_types],
        # 5: when each row arrived and when it last changed
        _timestamp_columns("samples", "workouts", "workout_statistics", "workout_events", "workout_activities", "workout_route_points",
                           "heartbeats", "activity_summaries", "characteristics", "deleted_objects"),
        # 6: how long samples take to reach the database
        ["""CREATE OR REPLACE VIEW sample_delay_by_type AS
            SELECT type, COUNT(*) AS samples,
                ROUND(MIN(TIMESTAMPDIFF(SECOND, end_date, inserted_at)) / 60, 1) AS min_delay_min,
                ROUND(AVG(TIMESTAMPDIFF(SECOND, end_date, inserted_at)) / 60, 1) AS avg_delay_min,
                ROUND(MAX(TIMESTAMPDIFF(SECOND, end_date, inserted_at)) / 60, 1) AS max_delay_min,
                MAX(end_date) AS latest_sample, MAX(inserted_at) AS latest_arrival
            FROM samples WHERE inserted_at IS NOT NULL GROUP BY type""",
         """CREATE OR REPLACE VIEW sample_delay_by_day AS
            SELECT DATE(inserted_at) AS day, type, COUNT(*) AS samples,
                ROUND(MIN(TIMESTAMPDIFF(SECOND, end_date, inserted_at)) / 60, 1) AS min_delay_min,
                ROUND(AVG(TIMESTAMPDIFF(SECOND, end_date, inserted_at)) / 60, 1) AS avg_delay_min,
                ROUND(MAX(TIMESTAMPDIFF(SECOND, end_date, inserted_at)) / 60, 1) AS max_delay_min
            FROM samples WHERE inserted_at IS NOT NULL GROUP BY DATE(inserted_at), type"""],
        # 7: a covering index for the delay views
        ["ALTER TABLE samples ADD INDEX IF NOT EXISTS idx_samples_inserted (inserted_at, type, end_date)"],
        # 8: the web app's hourly rollup and settings
        ["""CREATE TABLE IF NOT EXISTS sample_hourly (
            type VARCHAR(128) NOT NULL, hour DATETIME NOT NULL, source_name VARCHAR(255) NOT NULL DEFAULT '',
            sum DOUBLE, n INT NOT NULL, min DOUBLE, max DOUBLE,
            PRIMARY KEY (type, hour, source_name))""",
         "CREATE TABLE IF NOT EXISTS sample_hourly_ready (type VARCHAR(128) PRIMARY KEY)",
         "CREATE TABLE IF NOT EXISTS web_settings (`key` VARCHAR(64) PRIMARY KEY, value MEDIUMTEXT NOT NULL, "
         "updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3))"],
        # 9: every row belongs to an account
        [_multi_user()],
        # 10: what each sync applied (its reply, without counting the account's rows), and the delay views per account
        ["ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS applied INT NOT NULL DEFAULT 0",
         """CREATE OR REPLACE VIEW sample_delay_by_type AS
            SELECT user_id, type, COUNT(*) AS samples,
                ROUND(MIN(TIMESTAMPDIFF(SECOND, end_date, inserted_at)) / 60, 1) AS min_delay_min,
                ROUND(AVG(TIMESTAMPDIFF(SECOND, end_date, inserted_at)) / 60, 1) AS avg_delay_min,
                ROUND(MAX(TIMESTAMPDIFF(SECOND, end_date, inserted_at)) / 60, 1) AS max_delay_min,
                MAX(end_date) AS latest_sample, MAX(inserted_at) AS latest_arrival
            FROM samples WHERE inserted_at IS NOT NULL GROUP BY user_id, type""",
         """CREATE OR REPLACE VIEW sample_delay_by_day AS
            SELECT user_id, DATE(inserted_at) AS day, type, COUNT(*) AS samples,
                ROUND(MIN(TIMESTAMPDIFF(SECOND, end_date, inserted_at)) / 60, 1) AS min_delay_min,
                ROUND(AVG(TIMESTAMPDIFF(SECOND, end_date, inserted_at)) / 60, 1) AS avg_delay_min,
                ROUND(MAX(TIMESTAMPDIFF(SECOND, end_date, inserted_at)) / 60, 1) AS max_delay_min
            FROM samples WHERE inserted_at IS NOT NULL GROUP BY user_id, DATE(inserted_at), type"""],
    ]


SCHEMA_VERSION = 10
_lock = threading.Lock()


def schema_version() -> int:
    return one("SELECT COALESCE(MAX(version), 0) FROM schema_version")[0]


def pending() -> bool:
    try:
        return schema_version() < SCHEMA_VERSION
    except pymysql.MySQLError:
        return True


def migrate():
    """Bring the schema up to date."""
    with _lock, conn() as con:
        with con.cursor() as cur:
            cur.execute("CREATE TABLE IF NOT EXISTS schema_version (version INT PRIMARY KEY, applied_at DATETIME(3) NOT NULL)" + TABLE_OPTIONS)
            cur.execute("SELECT COALESCE(MAX(version), 0) FROM schema_version")
            current = cur.fetchone()[0]
        steps = migrations()
        assert len(steps) == SCHEMA_VERSION
        for i in range(current, len(steps)):
            version = i + 1
            for stmt in steps[i]:
                if callable(stmt):
                    stmt(con)
                    continue
                if stmt.startswith("CREATE TABLE"):
                    stmt += TABLE_OPTIONS
                with con.cursor() as cur:
                    try:
                        cur.execute(stmt)
                    except pymysql.MySQLError as e:
                        raise RuntimeError(f"migration {version}: {e}\n{stmt}") from e
            with con.cursor() as cur:
                cur.execute("INSERT INTO schema_version VALUES (%s, UTC_TIMESTAMP(3))", (version,))
            log.info("applied schema migration %d", version)
