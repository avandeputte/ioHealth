"""A database at schema 8 (the Go receiver's) with rows in it comes up to the current schema in place."""
import os

import pymysql
import pytest

from app import db


@pytest.fixture
def old_db():
    """A database at schema 8 holding a few rows, as the Go receiver left it; db points at it for the test."""
    name = "health_mig_test"
    con = pymysql.connect(host=os.environ["DB_HOST"], port=int(os.environ["DB_PORT"]), user=os.environ["DB_USER"], password=os.environ["DB_PASSWORD"], autocommit=True)
    with con.cursor() as cur:
        cur.execute(f"DROP DATABASE IF EXISTS {name}")
        cur.execute(f"CREATE DATABASE {name}")
    con.close()
    db.configure(database=name)
    try:
        # schema 1..8 as the Go receiver applied them, then some rows
        steps = db.migrations()[:8]
        with db.conn() as con, con.cursor() as cur:
            cur.execute("CREATE TABLE schema_version (version INT PRIMARY KEY, applied_at DATETIME(3) NOT NULL)" + db.TABLE_OPTIONS)
            for i, step in enumerate(steps):
                for stmt in step:
                    if callable(stmt):
                        stmt(con)
                    else:
                        cur.execute(stmt + (db.TABLE_OPTIONS if stmt.startswith("CREATE TABLE") else ""))
                cur.execute("INSERT INTO schema_version VALUES (%s, UTC_TIMESTAMP(3))", (i + 1,))
            cur.execute("INSERT INTO samples (uuid, type, kind, start_date, end_date, value, unit) VALUES ('s1', 'step_count', 'quantity', '2026-10-01 08:00', '2026-10-01 08:01', 12, 'count')")
            cur.execute("INSERT INTO characteristics (`key`, value) VALUES ('dateOfBirth', '1980-01-01')")
            cur.execute("INSERT INTO activity_summaries (date, active_energy_kcal) VALUES ('2026-10-01', 100)")
            cur.execute("INSERT INTO web_settings (`key`, value) VALUES ('units', '\"metric\"')")
            cur.execute("INSERT INTO sample_hourly (type, hour, source_name, sum, n) VALUES ('step_count', '2026-10-01 08:00', 'Watch', 12, 1)")
        yield name
    finally:
        db.configure(database=os.environ["DB_NAME"])
        con = pymysql.connect(host=os.environ["DB_HOST"], port=int(os.environ["DB_PORT"]), user=os.environ["DB_USER"], password=os.environ["DB_PASSWORD"], autocommit=True)
        with con.cursor() as cur:
            cur.execute(f"DROP DATABASE IF EXISTS {name}")
        con.close()


def test_schema_8_comes_up_to_date_in_place(old_db):
    assert db.one("SELECT MAX(version) FROM schema_version")[0] == 8  # the table took the hlt_ prefix in 11
    db.migrate()
    assert db.schema_version() == db.SCHEMA_VERSION
    # the rows are kept; user_id is there on every table (the pre-account rows read 0, nobody's)
    assert db.one("SELECT user_id FROM hlt_samples WHERE uuid = 's1'")[0] == 0
    assert db.one("SELECT user_id, value FROM hlt_characteristics") == (0, "1980-01-01")
    assert db.one("SELECT user_id FROM hlt_sample_hourly")[0] == 0
    # 11: the suite naming convention, every row kept
    assert db.one("SELECT name, value FROM hlt_user_settings") == ("units", '"metric"')
    assert db.one("SELECT created_at IS NOT NULL FROM hlt_samples WHERE uuid = 's1'")[0]
    assert {r[0] for r in db.q("SHOW TABLES")} >= {"hlt_schema_version", "hlt_sample_delay_by_type", "hlt_sample_delay_by_day", "hlt_activity_summaries"}
    assert not {r[0] for r in db.q("SHOW TABLES")} & {"samples", "schema_version", "web_settings", "sample_delay_by_type"}
    assert db.one("SELECT samples FROM hlt_sample_delay_by_type WHERE type = 'step_count'")[0] == 1
    assert "idx_hlt_samples_created" in {r[2] for r in db.q("SHOW INDEX FROM hlt_samples")}
    # keyed tables carry the account in their primary key: another account's row with the same key sits beside
    db.ex("INSERT INTO hlt_characteristics (user_id, name, value) VALUES (8, 'dateOfBirth', '1990-01-01')")
    db.ex("INSERT INTO hlt_activity_summaries (user_id, date, active_energy_kcal) VALUES (8, '2026-10-01', 5)")
    assert db.one("SELECT COUNT(*) FROM hlt_characteristics")[0] == 2
    db.migrate()  # a second run is a no-op
    assert db.schema_version() == db.SCHEMA_VERSION
